/*
 * Parsers — pure functions that turn a bank statement (array of rows) into transactions.
 * No DOM, no SheetJS, no storage. Runs in the browser and under `node --test`.
 *
 * Tuned for Punjab National Bank (PNB One) statements:
 *   header: Txn No. | Txn Date | Description | Branch Name | Cheque No. | Dr Amount | Cr Amount | Balance
 *   dates dd/mm/yyyy, amounts as text, balance like "5045.32 Cr.", descriptions cut at 50 chars:
 *   UPI/DR/<12-digit ref>/<payee 8 chars>/<bank>/<vpa 15 chars>/<remark>
 * but detects columns by synonym so other layouts also work.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ helpers
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const payeeNorm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // ------------------------------------------------------------ dates
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return { date: isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate()), time: null };
    }
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null; // Excel serial range ~1954..2119
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      const frac = v - Math.floor(v);
      const time = frac > 0 ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : null;
      return { date: isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), time };
    }
    const s = clean(v);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return finish(+m[1], +m[2], +m[3], m[4], m[5]);
    m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9}|\d{1,2})[-/. ](\d{2}|\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/);
    if (m) {
      let mon = /^\d+$/.test(m[2]) ? +m[2] : MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
      let y = +m[3];
      if (m[3].length === 2) y += 2000;
      let hh = m[4] != null ? +m[4] : null;
      if (hh != null && m[6]) {
        const pm = m[6].toLowerCase() === 'pm';
        if (pm && hh < 12) hh += 12;
        if (!pm && hh === 12) hh = 0;
      }
      return finish(y, mon, +m[1], hh, m[5]);
    }
    return null;
    function finish(y, mo, d, hh, mm) {
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
      const time = hh != null && hh !== '' ? `${pad2(+hh)}:${pad2(+mm || 0)}` : null;
      return { date: isoDate(y, mo, d), time };
    }
  }

  // ------------------------------------------------------------ amounts (integer paise)
  function parseAmount(v) {
    if (v == null) return null;
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      return { paise: Math.round(Math.abs(v) * 100), negative: v < 0, dirHint: null };
    }
    let s = clean(v);
    if (!s || /^(-+|na|nil|null|0(\.0+)?)$/i.test(s)) return s === '0' || /^0(\.0+)?$/.test(s) ? { paise: 0, negative: false, dirHint: null } : null;
    let dirHint = null;
    const dm = s.match(/(?:^|[\s.])(dr|cr)\.?(?:$|\s)/i) || s.match(/^(dr|cr)\.?\s/i) || s.match(/\s(dr|cr)\.?$/i);
    if (dm) dirHint = dm[1].toUpperCase();
    const stripped = s.replace(/[A-Za-z]+\.?/g, '').replace(/₹/g, '').trim(); // drop "Rs." / "INR" / "Dr." tokens
    const negative = /^\(.*\)$/.test(stripped) || /^-/.test(stripped);
    const num = stripped.replace(/[^0-9.]/g, '');
    if (!num || num === '.') return null;
    const f = parseFloat(num);
    if (!isFinite(f)) return null;
    return { paise: Math.round(f * 100), negative, dirHint };
  }

  // ------------------------------------------------------------ header detection
  const GROUPS = [
    ['drcr', /^(drcr|crdr|type|txntype|transactiontype|debitcredit|creditdebit|indicator)$/],
    ['valueDate', /^(value|val)date$/],
    ['date', /^((txn|trans|transaction|tran|post|posting|book|booking)date|date|dateoftransaction|transactiondt|txndt)$/],
    ['txnid', /^(txnno|txnid|txnnumber|transactionno|transactionid|transactionnumber|tranid|tranno|txn)$/],
    ['ref', /^(chequeno|chqno|cheque|instrumentid|instrumentno|refno|referenceno|reference|utr|utrno|rrn|upiref)$/],
    ['balance', /balance|^bal$|^closingbal|^runningbal/],
    ['debit', /^(debit|dr|withdraw)/],
    ['credit', /^(credit|cr|deposit)/],
    ['amount', /^(amount|amt|transactionamount|txnamount|amountinr|amountrs)$/],
    ['narration', /narration|description|particular|remark|details|narrative/],
  ];

  function classifyHeaderCell(cell) {
    const n = norm(cell);
    if (!n) return null;
    for (const [g, re] of GROUPS) if (re.test(n)) return g;
    return null;
  }

  function rowMapping(row) {
    const map = {};
    row.forEach((cell, i) => {
      const g = classifyHeaderCell(cell);
      if (g && map[g] == null) map[g] = i;
    });
    return map;
  }

  function mappingConfidence(map) {
    const has = (k) => map[k] != null;
    if (!has('date') && !has('valueDate')) return 'none';
    if (!has('narration')) return 'none';
    if ((has('debit') && has('credit')) || (has('amount') && has('drcr'))) return 'high';
    if (has('amount') || has('debit') || has('credit')) return 'medium';
    return 'none';
  }

  function detectHeader(aoa, maxScan = 60) {
    let best = null;
    const limit = Math.min(aoa.length, maxScan);
    for (let r = 0; r < limit; r++) {
      const row = aoa[r] || [];
      const map = rowMapping(row);
      const score = Object.keys(map).length;
      if (score < 3) continue;
      const conf = mappingConfidence(map);
      if (conf === 'none') continue;
      const dateCol = map.date != null ? map.date : map.valueDate;
      // the first non-empty row under a real header is a dated transaction
      let firstDated = null;
      for (let k = r + 1; k < aoa.length; k++) {
        const rr = aoa[k] || [];
        if (rr.every((c) => c === '' || c == null)) continue;
        firstDated = !!parseDate(rr[dateCol]);
        break;
      }
      if (firstDated === false) continue;
      const rank = (conf === 'high' ? 100 : 50) + score;
      if (!best || rank > best.rank) best = { headerRow: r, mapping: map, confidence: conf, rank };
    }
    if (!best) return { headerRow: -1, mapping: {}, confidence: 'none' };
    delete best.rank;
    return best;
  }

  // ------------------------------------------------------------ preamble (rows above the header)
  function extractPreamble(aoa, headerRow) {
    const out = { ownName: null, periodStart: null, periodEnd: null, accountMasked: null };
    const dateRe = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/g;
    for (let r = 0; r < Math.max(0, headerRow); r++) {
      const row = aoa[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = clean(row[c]);
        if (!cell) continue;
        if (!out.ownName && /(customer|account\s*holder|a\/c\s*holder)\s*name|name\s*of\s*(the\s*)?(customer|account)/i.test(cell)) {
          const after = cell.split(':').slice(1).join(':').trim();
          const next = row.slice(c + 1).map(clean).find((x) => x);
          out.ownName = after || next || null;
        }
        if (!out.periodStart && /period|statement\s*(from|for)|from/i.test(cell)) {
          const ds = cell.match(dateRe) || [];
          const joined = ds.length >= 2 ? ds : cell.concat(' ', row.slice(c + 1).map(clean).join(' ')).match(dateRe) || [];
          if (joined.length >= 2) {
            const a = parseDate(joined[0]), b = parseDate(joined[1]);
            if (a && b) { out.periodStart = a.date; out.periodEnd = b.date; }
          }
        }
        if (!out.accountMasked) {
          const am = cell.match(/account\s*(number|no\.?)\D*(\d{6,})/i);
          if (am) out.accountMasked = 'XX' + am[2].slice(-4);
        }
      }
    }
    if (out.ownName) out.ownName = clean(out.ownName).replace(/^[:\s]+/, '');
    return out;
  }

  // ------------------------------------------------------------ narration
  const TYPE_RULES = [
    ['UPI', /^UPI\b/i],
    ['AUTOPAY', /^(ACH|NACH|ECS)\b(?!\/CR)/i],
    ['ECS_CREDIT', /^NPCI\/ECS\/CR|^(ACH|NACH|ECS)\/CR/i],
    ['NEFT', /^NEFT/i],
    ['IMPS', /^IMPS/i],
    ['RTGS', /^RTGS/i],
    ['INTEREST', /Int\.?\s*Pd|\bINT\s*PD\b|INTEREST/i],
    ['REFUND', /^RCRADJ|\bREV(ERSAL)?\b|REFUND|\bRRC\b/i],
    ['CHARGE', /CHRG|CHARGE|\bGST\b|MIN\s*BAL|\bAMB\b|PENAL/i],
    ['ATM', /\bATM\b|\bNFS\b|CASH\s*WDL|\bCWDR\b|\bCASH\b/i],
    ['CARD', /\bPOS\b|\bECOM\b|\bVISA\b|\bRUPAY\b|MASTERCARD/i],
    ['CHEQUE', /\bCHQ\b|\bCLG\b|CHEQUE|\bCLEARING\b/i],
    ['SALARY', /\bSAL(ARY)?\b/i],
  ];

  function parseNarration(narration) {
    const desc = clean(narration);
    const out = { type: 'OTHER', dir: null, upiRef: null, payee: '', bankCode: null, vpa: null, remark: '' };
    for (const [t, re] of TYPE_RULES) { if (re.test(desc)) { out.type = t; break; } }
    const seg = desc.split('/').map((s) => s.trim());

    if (out.type === 'UPI') {
      const rest = seg.slice(1);
      const unclassified = [];
      let vpaIdx = -1;
      rest.forEach((s, i) => {
        if (/^(DR|CR)$/i.test(s)) { out.dir = s.toUpperCase(); return; }
        if (/^\d{12}$/.test(s) && !out.upiRef) { out.upiRef = s; return; }
        if (/^[A-Za-z0-9._-]+@[A-Za-z0-9]+$/.test(s) && !out.vpa) { out.vpa = s.toLowerCase(); vpaIdx = i; return; }
        unclassified.push({ s, i });
      });
      if (!out.upiRef) {
        const u = unclassified.find((x) => /^\d{10,}$/.test(x.s));
        if (u) { out.upiRef = u.s; unclassified.splice(unclassified.indexOf(u), 1); }
      }
      // PNB layout: UPI/DR/ref/PAYEE/BANK/vpa/remark — after the ref comes payee, then 4-letter bank code, then vpa
      const refIdx = rest.indexOf(out.upiRef);
      const afterRef = unclassified.filter((x) => x.i > refIdx);
      const before = unclassified.filter((x) => x.i <= refIdx);
      const list = afterRef.length ? afterRef : before;
      if (list.length) {
        out.payee = list[0].s;
        let k = 1;
        if (list[k] && /^[A-Z]{4}$/.test(list[k].s)) { out.bankCode = list[k].s; k++; }
        else if (list[k] && list[k].s === '') { k++; } // PNB leaves the bank code empty for some merchants
        const cand = list[k] ? list[k].s : '';
        // VPA truncated before the '@' (PNB cuts VPAs at 15 chars): lowercase token with no spaces
        if (!out.vpa && cand && /^[a-z0-9._-]+(@[a-z0-9]*)?$/.test(cand) && /[a-z]/.test(cand) && cand.length >= 5) {
          out.vpa = cand; k++;
        }
        out.remark = list.slice(k).map((x) => x.s).filter(Boolean).join('/');
      } else if (vpaIdx >= 0) {
        out.payee = out.vpa.split('@')[0];
      }
      if (!out.payee) out.payee = out.vpa ? out.vpa.split('@')[0] : desc.replace(/^UPI\W*/i, '');
      return out;
    }

    if (out.type === 'AUTOPAY') { out.dir = 'DR'; out.payee = seg[1] || desc; out.remark = seg.slice(2).join('/'); return out; }
    if (out.type === 'ECS_CREDIT') { out.dir = 'CR'; out.payee = seg[seg.length - 1] || desc; out.upiRef = null; return out; }
    if (out.type === 'NEFT' || out.type === 'IMPS' || out.type === 'RTGS') {
      out.dir = /_IN|\bIN\b|\/CR\b/i.test(desc) ? 'CR' : (/_OUT|\/DR\b/i.test(desc) ? 'DR' : null);
      const parts = desc.split(/[\/:]/).map((s) => s.trim()).filter(Boolean);
      const name = [...parts].reverse().find((p) => /[A-Za-z]{3}/.test(p) && !/^(NEFT|IMPS|RTGS)/i.test(p) && !/^[A-Z0-9]{12,}$/.test(p));
      out.payee = name || out.type;
      return out;
    }
    if (out.type === 'INTEREST') { out.dir = 'CR'; out.payee = 'Bank interest'; return out; }
    if (out.type === 'REFUND') { out.payee = seg.length > 2 ? seg[2] : 'Reversal'; if (/^RCRADJ/i.test(desc)) out.payee = 'Reversal'; return out; }
    if (out.type === 'CHARGE') { out.dir = 'DR'; out.payee = /SMS/i.test(desc) ? 'SMS charges' : 'Bank charges'; return out; }
    if (out.type === 'ATM') { out.dir = 'DR'; out.payee = 'ATM withdrawal'; return out; }
    out.payee = seg.length > 1 ? seg.find((s, i) => i > 0 && /[A-Za-z]{3}/.test(s)) || seg[0] : desc;
    return out;
  }

  // ------------------------------------------------------------ payment channel (the payee's UPI provider)
  // Matched against the part before '@' (PNB truncates VPAs at 15 chars, so the handle is often cut or missing)
  const CHANNEL_RULES = [
    ['Paytm', /^paytm|paytmqr/i],
    ['PhonePe', /^phonepe|^ppe\./i],
    ['Google Pay', /^gpay|googlepay/i],
    ['BharatPe', /bharatpe|^bpe\./i],
    ['Pine Labs', /^pinelabs|^plutus/i],
    ['CRED', /^cred\./i],
    ['Amazon Pay', /^amzn|amazonpay/i],
    ['Vyapar', /^vyapar/i],
    ['Payment gateway', /^razorpay|^rzp|^pg\.|^payu|^billdesk|^ccavenue|^cashfree|^cf\.|^easebuzz|^juspay|^instamojo|^mobikwik|^freecharge|^airtelpay|^ezetap|^mswipe|^mab0|^ombk|\.rzp$|\.payu$/i],
  ];
  // Matched with startsWith against the (possibly truncated) handle after '@'
  const HANDLE_PREFIXES = [
    ['ok', 'Google Pay'], ['ybl', 'PhonePe'], ['yb', 'PhonePe'], ['ibl', 'PhonePe'], ['ib', 'PhonePe'], ['axl', 'PhonePe'],
    ['paytm', 'Paytm'], ['pty', 'Paytm'], ['pts', 'Paytm'], ['pth', 'Paytm'], ['pta', 'Paytm'], ['pt', 'Paytm'], ['p', 'Paytm'],
    ['apl', 'Amazon Pay'], ['rapl', 'Amazon Pay'], ['yapl', 'Amazon Pay'], ['amaz', 'Amazon Pay'],
    ['cas', 'Payment gateway'], ['rzp', 'Payment gateway'], ['payu', 'Payment gateway'],
    ['wa', 'WhatsApp Pay'], ['upi', 'BHIM'], ['jupiter', 'Jupiter'], ['fam', 'FamPay'], ['navi', 'Navi'], ['slc', 'slice'], ['sl', 'slice'],
    ['axisb', 'Axis Bank'], ['axi', 'Axis Bank'], ['ax', 'Axis Bank'], ['icici', 'ICICI Bank'], ['ic', 'ICICI Bank'],
    ['hdfc', 'HDFC Bank'], ['h', 'HDFC Bank'], ['sbi', 'SBI'], ['yesb', 'Yes Bank'], ['yes', 'Yes Bank'], ['y', 'Yes Bank'],
    ['kotak', 'Kotak'], ['kota', 'Kotak'], ['kmbl', 'Kotak'], ['idfc', 'IDFC First'], ['pnb', 'PNB'], ['mair', 'Airtel'], ['airtel', 'Airtel'],
    ['cnrb', 'Canara Bank'], ['boi', 'Bank of India'], ['barodampay', 'Bank of Baroda'], ['federal', 'Federal Bank'], ['indus', 'IndusInd'],
  ];

  function detectChannel(vpa, type) {
    if (type && type !== 'UPI') {
      return { AUTOPAY: 'Auto-debit (ACH)', ECS_CREDIT: 'ECS credit', NEFT: 'NEFT', IMPS: 'IMPS', RTGS: 'RTGS', INTEREST: 'Bank', REFUND: 'Bank', CHARGE: 'Bank', ATM: 'ATM', CARD: 'Card', CHEQUE: 'Cheque', SALARY: 'Bank' }[type] || 'Other';
    }
    const v = String(vpa || '').toLowerCase();
    if (!v) return 'Other UPI';
    const [local, handle] = v.split('@');
    for (const [name, re] of CHANNEL_RULES) if (re.test(local)) return name;
    if (handle) {
      for (const [prefix, name] of HANDLE_PREFIXES) if (handle.startsWith(prefix)) return name;
    }
    return 'Other UPI';
  }

  // ------------------------------------------------------------ categories
  const CATEGORIES = [
    'Food & Dining', 'Groceries & Essentials', 'Transport & Fuel', 'Bills & Subscriptions', 'Shopping',
    'Health & Fitness', 'Entertainment', 'Personal Care', 'Travel & Stay', 'Education',
    'Rent', 'Credit Card Bill', 'Investments', 'Insurance', 'Taxes & Government', 'Cash (ATM)', 'Fees & Charges',
    'Transfer (self)', 'Untagged', 'Received', 'Refund', 'Income', 'Other',
  ];

  const CATEGORY_RULES = [
    ['Fees & Charges', /SMS CHRG|CHRG|CHARGE|\bGST\b|MIN\s*BAL|\bAMB\b|PENAL/i],
    ['Income', /Int\.?\s*Pd|INTEREST|NPCI\/ECS\/CR|\bDIV(IDEND)?\b|SALARY|\bSAL\b/i],
    ['Refund', /^RCRADJ|\bREV(ERSAL)?\b|REFUND|\bRRC\b/i],
    ['Credit Card Bill', /cred\.club|CRED Clu|CARD PAYMENT|CARDPAY|HDFC CARD|ICICI CARD|SBI CARD|AXIS CARD|\bAMEX\b|ONECARD|SLICE|UNI CARD/i],
    ['Investments', /GROWW|Indian Clearing|\bICCL\b|MUTUAL F|ZERODHA|UPSTOX|KUVERA|INDMONEY|PAYTM MONEY|ETMONEY|\bSIP\b|NIPPON|\bMF\b|\bCAMS\b|KFIN|SMALLCASE|COIN|ANGEL ONE|DHAN|BSE|\bNSE\b|NPS|PPF/i],
    ['Insurance', /Policyba|POLICYBAZAAR|\bLIC\b|INSURANCE|HDFC LIFE|ICICI PRU|MAX LIFE|BAJAJ ALLIANZ|\bACKO\b|\bDIGIT\b|STAR HEALTH|\bNIVA\b|TATA AIG|NEW INDIA ASSUR/i],
    ['Taxes & Government', /\bCBDT\b|\bTIN\b|Passport|\bGOVT?\b|MP Madhy|TRAFFIC|CHALLAN|MUNICIPAL|\bRTO\b|VAHAN|DEFMACRO|CLEARTAX|\bGST\b|INCOME TAX|E-?CHALLAN|PARIVAHAN|MPONLINE|DIGITAL GRAM/i],
    ['Rent', /\bRENT\b|LANDLORD|NOBROKER|HOUSING\.COM|PAYING GUEST|HOSTEL|\bFLAT\b/i],
    ['Groceries & Essentials', /Blinkit|Zepto|BigBasket|BIG BASKET|Instamart|JioMart|D ?Mart|Reliance Fresh|More Super|Grocer|Kirana|Supermarket|Super Market|Nature'?s Basket|FreshToHome|Licious|FAMILY M|Family M|Provision|Ratnadeep|Star Bazaar|Spencer|Vishal Mega|Country Delight|Milk|Dairy|Bakery|Vegetable|Fruit/i],
    ['Food & Dining', /SmartQ|Bottle ?L|bottlelab|Swiggy|Zomato|Domino|Burrito|Californ|McDonald|MC DONAL|\bKFC\b|Burger|Pizza|\bPiz\b|Subway|Starbucks|Cafe|Café|Coffee|Chai|\bTea\b|Restaurant|Resto|Hotel|Dhaba|Kitchen|\bKITC|Udupi|UDUP|Biryani|Sweets?|\bSWE\b|Foods?|\bEat|Dine|Canteen|Mess|Litti|Momo|Juice|Brew|Tiffin|Dosa|Idli|Chicken|Haldiram|Bikaner|Wow Momo|Faasos|Behrouz|Box8|EatSure|Theobroma|Barbeque|BBQ|Chaayos|Third Wave|Blue Tokai|Cha Bar|Kulfi|Ice ?Cream|Baskin|Natural|Cream Stone|Corner House|Sandwich|Wrap|Roll|Paratha|Thali|Bhojanalaya|Nandhini|Meghana|Empire|Truffles|Nandhana|A2B|Adyar|Sangeetha|Saravana|Rameshwaram|Vidyarthi|CTR|Brahmin|Mavalli|MTR|Taaza|Thindi|Cowrks|Hosp/i],
    ['Transport & Fuel', /\bUber\b|\bOla\b|Rapido|IRCTC|IndiGo|INDIGO|Air ?India|AirAsia|Vistara|Akasa|SpiceJet|Redbus|RedBus|Metro|BMTC|\bBEST\b|\bDTC\b|\bMSRTC\b|\bKSRTC\b|\bTSRTC\b|\bAPSRTC\b|Petrol|Fuel|HP AUTO|HPCL|IOCL|Indian Oil|BPCL|Bharat Petrol|\bShell\b|Nayara|Fastag|FASTag|Parking|\bToll\b|Namma Yatri|Yulu|Bounce|\bAuto\b|Cab|Taxi|Railway|Train|Bus\b|Airport|Ixigo|Confirmtkt|CONFIRM|Abhibus|Zoomcar|Revv|Drivezy|Vogo|Blu Smart|BluSmart|Flexirid|\bRide\b|Filling Station|Service Station/i],
    ['Bills & Subscriptions', /\bJio\b|Jiostar|Jiosaavn|JioFiber|Airtel|\bBSNL\b|\bVi\b|Vodafone|Tata Play|Tata Sky|\bDTH\b|Broadband|Fibernet|Hathway|Electric|MSEB|BESCOM|TNEB|MPEB|MPPKVVCL|Torrent Power|Adani Elec|BSES|Tata Power|\bGas\b|Indane|HP Gas|Bharat Gas|Water|Google|YouTube|Netflix|Prime Video|Hotstar|Spotify|Apple|iCloud|LinkedIn|Microsoft|Adobe|OpenAI|ChatGPT|Claude|Notion|Dropbox|Recharge|Postpaid|Prepaid|cred\.utility|BBPS|Utility|Sony ?LIV|ZEE5|Audible|Kindle|Gaana|Wynk|Canva|GitHub|Cursor|Vercel|AWS|Azure|Digital Ocean/i],
    ['Health & Fitness', /Pharma|Medical|Medic|Chemist|Apollo|MedPlus|\b1mg\b|PharmEasy|Netmeds|Hospital|Clinic|Doctor|\bDr\.|Diagnostic|Dental|\bCult\b|Cult\.fit|Gym|Fitness|Health|Wellness|Practo|Optical|Lens|Physio|Ayur|Homeo/i],
    ['Entertainment', /BookMyShow|Book My Show|\bPVR\b|INOX|Cinepolis|Cinema|Movie|Multiplex|Game|Gaming|Steam|PlayStation|Xbox|Dream11|\bMPL\b|Rummy|Zoo|Museum|Amusement|Wonderla|Event|Concert|Ticket|Insider|District|Snow|Bowling|Arcade|Timezone|Smaaash|Lounge|\bBar\b|\bPub\b|Brewery/i],
    ['Personal Care', /Salon|Saloon|\bSpa\b|Barber|Parlour|Parlor|Beauty|Urban Company|UrbanClap|Laundry|Dry ?Clean|Hair|Nail|Grooming|Cosmetic|Nykaa|Purplle/i],
    ['Travel & Stay', /\bOYO\b|MakeMyTrip|\bMMT\b|Goibibo|Yatra|Cleartrip|Agoda|Booking\.com|Airbnb|Treebo|FabHotel|Zostel|Resort|Homestay|Lemon Tree|Taj|Marriott|Hyatt|ITC Hotel|Radisson|Ginger|Trivago|EaseMyTrip/i],
    ['Education', /Udemy|Coursera|Unacademy|Byju|Course|Academy|School|College|University|Institute|Tuition|Coaching|Books?|Library|Scaler|Upgrad|Great Learning|Simplilearn|Physics ?Wallah|Vedantu|Toppr|Exam|Test Series|Leetcode|Educative|Pluralsight|O'?Reilly|Stationery|Xerox/i],
    ['Shopping', /Amazon|Flipkart|Myntra|\bAjio\b|Meesho|Croma|Reliance Digital|Decathlon|Zudio|H&M|Uniqlo|Lifestyle|Westside|Pantaloons|\bMax\b|IKEA|Pepperfry|Snapdeal|Tata Cliq|Shopsy|Store|\bMart\b|Retail|Bazaar|Boutique|Fashion|Textile|Garments|Electronics|Mobile|Shoppe|Shop\b|Emporium|Footwear|Shoes|Bata|Puma|Nike|Adidas|Titan|Tanishq|Jewel|Gift|Flowers?|Ferns|Lenskart|Boat|Samsung|Apple Store|Mi Store|OnePlus|Vijay Sales|Poorvika|Sangeetha Mobiles|Lulu|Phoenix|Forum|Orion|Mantri|Nexus|Mall/i],
  ];

  function categorize(tx, payeeMap, settings) {
    const pm = payeeMap || {};
    const key = tx.payeeNorm || payeeNorm(tx.payee);
    if (key && pm[key]) return { category: pm[key], source: 'user' };
    const own = settings && settings.ownName ? payeeNorm(settings.ownName) : '';
    const ownVpas = (settings && settings.ownVPAs) || [];
    const hay = [tx.payee, tx.vpa, tx.narration, tx.remark].filter(Boolean).join(' | ');
    if (tx.type === 'ATM') return { category: 'Cash (ATM)', source: 'rule' };
    if (tx.type === 'CHARGE') return { category: 'Fees & Charges', source: 'rule' };
    if (tx.type === 'INTEREST' || tx.type === 'ECS_CREDIT' || tx.type === 'SALARY') return { category: 'Income', source: 'rule' };
    if (tx.type === 'REFUND') return { category: 'Refund', source: 'rule' };
    if (own && key && (key === own || own.startsWith(key) || key.startsWith(own))) return { category: 'Transfer (self)', source: 'rule' };
    if (tx.vpa && ownVpas.some((v) => String(v).toLowerCase() === tx.vpa)) return { category: 'Transfer (self)', source: 'rule' };
    if ((tx.type === 'NEFT' || tx.type === 'IMPS' || tx.type === 'RTGS') && tx.dir === 'CR' && own && key && key.includes(own.split(' ')[0])) return { category: 'Transfer (self)', source: 'rule' };
    for (const [cat, re] of CATEGORY_RULES) {
      if (!re.test(hay)) continue;
      if (tx.dir === 'CR' && !['Income', 'Refund', 'Transfer (self)'].includes(cat)) return { category: 'Received', source: 'rule' };
      return { category: cat, source: 'rule' };
    }
    if (tx.type === 'AUTOPAY') return { category: 'Investments', source: 'rule' };
    if (tx.dir === 'CR') return { category: 'Received', source: 'rule' };
    if (tx.type === 'UPI') return { category: 'Untagged', source: 'rule' };
    return { category: 'Other', source: 'rule' };
  }

  // ------------------------------------------------------------ dedupe
  function dedupeKeys(tx) {
    const keys = [];
    // PNB's Txn No. is shared by batch debits (e.g. several SIPs on the 28th), so qualify it with amount and balance.
    if (tx.txnId) keys.push('t:' + tx.txnId + ':' + tx.dir + ':' + tx.amount + (tx.balanceAfter != null ? ':' + tx.balanceAfter : ''));
    if (tx.upiRef) keys.push('r:' + tx.upiRef + ':' + tx.dir + ':' + tx.amount);
    const base = 'h:' + tx.date + ':' + tx.dir + ':' + tx.amount + ':' + (tx.payeeNorm || '').slice(0, 12);
    if (tx.balanceAfter != null) keys.push(base + ':' + tx.balanceAfter);
    else if (tx.seqKey != null) keys.push(base + '#' + tx.seqKey);
    return keys;
  }

  function mergeImport(existing, incoming) {
    const index = new Map();
    existing.forEach((tx) => dedupeKeys(tx).forEach((k) => index.set(k, tx)));
    const added = [];
    let dupes = 0;
    for (const tx of incoming) {
      const keys = dedupeKeys(tx);
      const hit = keys.map((k) => index.get(k)).find(Boolean);
      if (hit) {
        dupes++;
        for (const f of ['balanceAfter', 'vpa', 'bankCode', 'upiRef', 'txnId', 'remark', 'time']) if ((hit[f] == null || hit[f] === '') && tx[f] != null && tx[f] !== '') hit[f] = tx[f];
        continue;
      }
      keys.forEach((k) => index.set(k, tx));
      added.push(tx);
    }
    return { added, dupes };
  }

  // ------------------------------------------------------------ whole statement
  function parseStatement(aoa, opts = {}) {
    const detected = opts.mapping ? { headerRow: opts.headerRow != null ? opts.headerRow : detectHeader(aoa).headerRow, mapping: opts.mapping, confidence: 'manual' } : detectHeader(aoa);
    const { headerRow, mapping, confidence } = detected;
    const result = { transactions: [], meta: { headerRow, mapping, confidence, rows: 0, skipped: 0, unparsed: [], capHit: false, capLimit: 500 } };
    if (headerRow < 0 || confidence === 'none') return result;
    const pre = extractPreamble(aoa, headerRow);
    Object.assign(result.meta, pre);
    const settings = Object.assign({}, opts.settings || {}, { ownName: (opts.settings && opts.settings.ownName) || pre.ownName });
    const dateCol = mapping.date != null ? mapping.date : mapping.valueDate;
    const seqCounter = new Map();
    let blank = 0;
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (row.every((c) => c === '' || c == null)) { if (++blank >= 3 && result.transactions.length) break; continue; }
      blank = 0;
      const dt = parseDate(row[dateCol]);
      const narration = clean(row[mapping.narration]);
      if (!dt) {
        if (/closing|opening|total|summary|generated|balance b\/f|brought forward|carried forward|^\*+/i.test(narration + ' ' + clean(row[0]))) { if (result.transactions.length) break; else continue; }
        result.meta.skipped++;
        if (result.meta.unparsed.length < 5) result.meta.unparsed.push(row.map(clean).join(' | ').slice(0, 120));
        continue;
      }
      let dir = null, amount = null;
      const deb = mapping.debit != null ? parseAmount(row[mapping.debit]) : null;
      const cre = mapping.credit != null ? parseAmount(row[mapping.credit]) : null;
      if (deb && deb.paise > 0 && cre && cre.paise > 0) { result.meta.skipped++; continue; }
      if (deb && deb.paise > 0) { dir = 'DR'; amount = deb.paise; }
      else if (cre && cre.paise > 0) { dir = 'CR'; amount = cre.paise; }
      else if (mapping.amount != null) {
        const a = parseAmount(row[mapping.amount]);
        if (a && a.paise > 0) {
          amount = a.paise;
          const flag = mapping.drcr != null ? clean(row[mapping.drcr]).toUpperCase() : '';
          if (/^(DR|D|DEBIT|WITHDRAWAL|PAID|SENT)\b/.test(flag)) dir = 'DR';
          else if (/^(CR|C|CREDIT|DEPOSIT|RECEIVED)\b/.test(flag)) dir = 'CR';
          else if (a.dirHint) dir = a.dirHint;
          else if (a.negative) dir = 'DR';
          else if (/\/DR\b/i.test(narration)) dir = 'DR';
          else if (/\/CR\b/i.test(narration)) dir = 'CR';
          else if (mapping.drcr == null && !a.negative && mapping.debit == null) dir = 'DR';
        }
      }
      if (!amount || !dir) { result.meta.skipped++; if (result.meta.unparsed.length < 5) result.meta.unparsed.push(row.map(clean).join(' | ').slice(0, 120)); continue; }

      const n = parseNarration(narration);
      if (!n.dir) n.dir = dir;
      const balP = mapping.balance != null ? parseAmount(row[mapping.balance]) : null;
      const balanceAfter = balP ? (balP.dirHint === 'DR' || balP.negative ? -balP.paise : balP.paise) : null;
      const txnId = mapping.txnid != null ? clean(row[mapping.txnid]) || null : null;
      const refCol = mapping.ref != null ? clean(row[mapping.ref]) : '';
      if (!n.upiRef && /^\d{10,}$/.test(refCol)) n.upiRef = refCol;
      const payee = clean(n.payee) || narration || 'Unknown';
      const tx = {
        date: dt.date, time: dt.time, amount, dir, type: n.type, upiRef: n.upiRef, vpa: n.vpa, payee,
        payeeNorm: payeeNorm(payee), bankCode: n.bankCode, remark: n.remark || '', narration,
        balanceAfter, txnId, source: 'pnb', excluded: false, note: '', seq: r - headerRow - 1,
      };
      tx.channel = detectChannel(tx.vpa, tx.type);
      if (balanceAfter == null && !txnId && !tx.upiRef) {
        const k = tx.date + ':' + tx.dir + ':' + tx.amount + ':' + tx.payeeNorm;
        const c = (seqCounter.get(k) || 0) + 1; seqCounter.set(k, c); tx.seqKey = c;
      }
      const cat = categorize(tx, opts.payeeMap, settings);
      tx.category = cat.category; tx.categorySource = cat.source;
      result.transactions.push(tx);
    }
    const txs = result.transactions;
    result.meta.rows = txs.length;
    if (txs.length) {
      const dates = txs.map((t) => t.date).sort();
      result.meta.firstTxDate = dates[0];
      result.meta.lastTxDate = dates[dates.length - 1];
      const cap = result.meta.capLimit;
      if (txs.length >= cap && (!pre.periodStart || pre.periodStart < result.meta.firstTxDate)) result.meta.capHit = true;
      result.meta.coverageStart = result.meta.capHit || !pre.periodStart ? result.meta.firstTxDate : (pre.periodStart < result.meta.firstTxDate ? pre.periodStart : result.meta.firstTxDate);
      result.meta.coverageEnd = pre.periodEnd && pre.periodEnd > result.meta.lastTxDate ? pre.periodEnd : result.meta.lastTxDate;
    }
    return result;
  }

  const api = {
    parseDate, parseAmount, detectHeader, classifyHeaderCell, extractPreamble, parseNarration, detectChannel,
    categorize, CATEGORIES, CATEGORY_RULES, dedupeKeys, mergeImport, parseStatement, payeeNorm, norm,
  };
  root.Parsers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
