const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parsers.js');

// ------------------------------------------------------------ dates
test('parseDate handles Indian day-first formats, ISO, serials and Date objects', () => {
  assert.equal(P.parseDate('12/09/2026').date, '2026-09-12');
  assert.equal(P.parseDate('12-09-2026').date, '2026-09-12');
  assert.equal(P.parseDate('12-Sep-2026').date, '2026-09-12');
  assert.equal(P.parseDate('12-SEP-26').date, '2026-09-12');
  assert.equal(P.parseDate('2026-09-12').date, '2026-09-12');
  assert.deepEqual(P.parseDate('12/09/2026 14:32:11'), { date: '2026-09-12', time: '14:32' });
  assert.equal(P.parseDate(46277).date, '2026-09-12'); // Excel serial
  assert.equal(P.parseDate(new Date(2026, 8, 12)).date, '2026-09-12');
  assert.equal(P.parseDate('01/02/2026').date, '2026-02-01'); // day first, never month first
  assert.equal(P.parseDate('abc'), null);
  assert.equal(P.parseDate('31/02/2026'), null);
  assert.equal(P.parseDate(''), null);
  assert.equal(P.parseDate('Statement Period: 01-01-2026 to 12-09-2026'), null);
});

// ------------------------------------------------------------ amounts
test('parseAmount returns integer paise with direction hints', () => {
  assert.deepEqual(P.parseAmount('1,234.50'), { paise: 123450, negative: false, dirHint: null });
  assert.deepEqual(P.parseAmount('Rs. 2,000.00 Dr'), { paise: 200000, negative: false, dirHint: 'DR' });
  assert.equal(P.parseAmount('500 Cr').dirHint, 'CR');
  assert.equal(P.parseAmount('5045.32 Cr.').paise, 504532);
  assert.equal(P.parseAmount('5045.32 Cr.').dirHint, 'CR');
  assert.equal(P.parseAmount('(1,000.00)').negative, true);
  assert.equal(P.parseAmount('₹1,00,000.00').paise, 10000000);
  assert.equal(P.parseAmount(1234.5).paise, 123450);
  assert.equal(P.parseAmount('84.0').paise, 8400);
  assert.equal(P.parseAmount(''), null);
  assert.equal(P.parseAmount('-'), null);
  assert.equal(P.parseAmount(null), null);
});

// ------------------------------------------------------------ header detection
const PNB_HEADER = ['Txn No.', 'Txn Date', 'Description', '', 'Branch Name', 'Cheque No.', 'Dr Amount', 'Cr Amount', 'Balance'];
function pnbSheet(rows, opts = {}) {
  const pre = [
    ['Account Statement for Account Number 99990000001234'], [],
    ['Branch Details'], ['Branch Name:', 'TESTVILLE'], ['IFSC:', 'PUNB0000000'], [],
    ['Customer Details'], ['Customer Name:', opts.name || 'TEST PERSON'], ['City:', 'TESTVILLE'], [], [],
    [`Statement Period:     ${opts.from || '01-06-2026'}    to     ${opts.to || '31-07-2026'}`], [],
    PNB_HEADER,
  ];
  return pre.concat(rows, [[], [], [], ['***Generated through PNB ONE***'], ['1. Unless constituent notifies the bank...']]);
}
const row = (id, date, desc, dr, cr, bal) => [id, date, desc, '', '-', '', dr, cr, bal];

test('detectHeader finds the PNB header below a preamble and maps every column', () => {
  const aoa = pnbSheet([row('U1', '12/07/2026', 'UPI/DR/662130444779/CRED/UTIB/cred.utility@ax/paym', '84.0', '', '5045.32 Cr.')]);
  const d = P.detectHeader(aoa);
  assert.equal(d.headerRow, 13);
  assert.equal(d.confidence, 'high');
  assert.deepEqual(d.mapping, { txnid: 0, date: 1, narration: 2, ref: 5, debit: 6, credit: 7, balance: 8 });
});

test('detectHeader handles other bank layouts by synonym', () => {
  const aoa = [
    ['Transaction Date', 'Value Date', 'Particulars', 'Withdrawal Amt (INR)', 'Deposit Amt (INR)', 'Closing Balance'],
    ['12-Jul-2026', '12-Jul-2026', 'UPI/DR/1/X/Y/z@ybl/r', '100.00', '', '5,000.00'],
    ['13-Jul-2026', '13-Jul-2026', 'NEFT_IN:abc//ref/NAME', '', '2,000.00', '7,000.00'],
  ];
  const d = P.detectHeader(aoa);
  assert.equal(d.headerRow, 0);
  assert.equal(d.confidence, 'high');
  assert.deepEqual(d.mapping, { date: 0, valueDate: 1, narration: 2, debit: 3, credit: 4, balance: 5 });

  const amountType = [['Date', 'Particulars', 'Amount', 'Dr/Cr', 'Balance'], ['12/07/2026', 'UPI/DR/1/X', '100', 'DR', '900']];
  const d2 = P.detectHeader(amountType);
  assert.equal(d2.confidence, 'high');
  assert.equal(d2.mapping.drcr, 3);
  assert.equal(d2.mapping.amount, 2);
});

test('detectHeader rejects the statement-period preamble row and garbage sheets', () => {
  const aoa = pnbSheet([row('U1', '12/07/2026', 'UPI/DR/1/X/Y/z@ybl/r', '10', '', '1 Cr.')]);
  assert.equal(P.detectHeader(aoa).headerRow, 13);
  assert.equal(P.detectHeader([['hello', 'world'], [1, 2, 3]]).confidence, 'none');
  assert.equal(P.detectHeader([]).headerRow, -1);
});

// ------------------------------------------------------------ preamble
test('extractPreamble reads customer name, period and masked account', () => {
  const aoa = pnbSheet([], { name: 'ASHA RAO', from: '01-01-2026', to: '12-09-2026' });
  const pre = P.extractPreamble(aoa, 13);
  assert.equal(pre.ownName, 'ASHA RAO');
  assert.equal(pre.periodStart, '2026-01-01');
  assert.equal(pre.periodEnd, '2026-09-12');
  assert.equal(pre.accountMasked, 'XX1234');
});

// ------------------------------------------------------------ narration
test('parseNarration: PNB fixed-width UPI debit', () => {
  const n = P.parseNarration('UPI/DR/662130444779/CRED/UTIB/cred.utility@ax/paym');
  assert.equal(n.type, 'UPI');
  assert.equal(n.dir, 'DR');
  assert.equal(n.upiRef, '662130444779');
  assert.equal(n.payee, 'CRED');
  assert.equal(n.bankCode, 'UTIB');
  assert.equal(n.vpa, 'cred.utility@ax');
  assert.equal(n.remark, 'paym');
});

test('parseNarration: reordered segments, credits, truncated VPA without @, empty bank code', () => {
  const a = P.parseNarration('UPI/425512345678/DR/ZOMATO/HDFC/zomato@hdfcbank/Food order');
  assert.equal(a.payee, 'ZOMATO'); assert.equal(a.vpa, 'zomato@hdfcbank'); assert.equal(a.dir, 'DR'); assert.equal(a.remark, 'Food order');
  const c = P.parseNarration('UPI/CR/425512345679/AMIT KUMAR/SBIN/amit@oksbi/');
  assert.equal(c.dir, 'CR'); assert.equal(c.payee, 'AMIT KUMAR'); assert.equal(P.detectChannel(c.vpa, 'UPI'), 'Google Pay');
  const t = P.parseNarration('UPI/DR/625469802215/TIF HOSP/HDFC/pinelabs.stq471/');
  assert.equal(t.vpa, 'pinelabs.stq471'); assert.equal(t.payee, 'TIF HOSP');
  const e = P.parseNarration('UPI/DR/314281581806/COWRKS I//cowrksindiapriv/');
  assert.equal(e.payee, 'COWRKS I'); assert.equal(e.bankCode, null); assert.equal(e.vpa, 'cowrksindiapriv'); assert.equal(e.remark, '');
  const q = P.parseNarration('UPI/DR/624942291979/THAR THE/YESB/paytmqr604nj4@p/');
  assert.equal(P.detectChannel(q.vpa, 'UPI'), 'Paytm');
  const noVpa = P.parseNarration('UPI/DR/123456789012/SOME SHOP');
  assert.equal(noVpa.payee, 'SOME SHOP'); assert.equal(noVpa.vpa, null);
});

test('parseNarration: non-UPI PNB rows', () => {
  assert.deepEqual([P.parseNarration('ACH/GROWW INVEST TECH PR/32432').type, P.parseNarration('ACH/GROWW INVEST TECH PR/32432').payee], ['AUTOPAY', 'GROWW INVEST TECH PR']);
  const ecs = P.parseNarration('NPCI/ECS/CR/HDFC04859000023700/TATACAPITALDIV2026');
  assert.equal(ecs.type, 'ECS_CREDIT'); assert.equal(ecs.dir, 'CR'); assert.equal(ecs.payee, 'TATACAPITALDIV2026');
  const neft = P.parseNarration('NEFT_IN:18HDFCH01243461600HDFC0000001//HDFCH01243461600/TEST PERSON');
  assert.equal(neft.type, 'NEFT'); assert.equal(neft.dir, 'CR'); assert.equal(neft.payee, 'TEST PERSON');
  assert.equal(P.parseNarration('99990000001234:Int.Pd:01-06-2026 to 31-08-2026').type, 'INTEREST');
  assert.equal(P.parseNarration('RCRADJ/110247697954/RRC/20072026').type, 'REFUND');
  assert.equal(P.parseNarration('SMS CHRG FOR:01-04-2026to30-06-2026').type, 'CHARGE');
  assert.equal(P.parseNarration('ATM WDL/PNB ATM/DELHI').type, 'ATM');
  assert.equal(P.parseNarration('IMPS/P2A/123456789012/JOHN').type, 'IMPS');
  assert.equal(P.parseNarration('POS 1234 AMAZON').type, 'CARD');
});

// ------------------------------------------------------------ channels & categories
test('detectChannel maps merchant VPAs (including truncated handles) to payment channels', () => {
  assert.equal(P.detectChannel('x@ybl', 'UPI'), 'PhonePe');
  assert.equal(P.detectChannel('x@yb', 'UPI'), 'PhonePe');
  assert.equal(P.detectChannel('x@okaxis', 'UPI'), 'Google Pay');
  assert.equal(P.detectChannel('paytm-8735485@p', 'UPI'), 'Paytm');
  assert.equal(P.detectChannel('paytmqr604nj4@p', 'UPI'), 'Paytm');
  assert.equal(P.detectChannel('x@apl', 'UPI'), 'Amazon Pay');
  assert.equal(P.detectChannel('cf.smartqpg@cas', 'UPI'), 'Payment gateway');
  assert.equal(P.detectChannel('bharatpe09@yesb', 'UPI'), 'BharatPe');
  assert.equal(P.detectChannel('pinelabs.stq471', 'UPI'), 'Pine Labs');
  assert.equal(P.detectChannel('cred.club@axisb', 'UPI'), 'CRED');
  assert.equal(P.detectChannel('someone@icici', 'UPI'), 'ICICI Bank');
  assert.equal(P.detectChannel('cowrksindiapriv', 'UPI'), 'Other UPI');
  assert.equal(P.detectChannel(null, 'AUTOPAY'), 'Auto-debit (ACH)');
  assert.equal(P.detectChannel(null, 'ATM'), 'ATM');
});

function tx(over) {
  const base = { dir: 'DR', type: 'UPI', payee: 'X', vpa: null, narration: '', remark: '' };
  const t = Object.assign(base, over);
  t.payeeNorm = P.payeeNorm(t.payee);
  return t;
}
test('categorize applies keyword rules, type rules, self-transfer detection and user overrides', () => {
  const cat = (t, pm, s) => P.categorize(t, pm, s).category;
  assert.equal(cat(tx({ payee: 'SmartQ', vpa: 'cf.smartqpg@cas' })), 'Food & Dining');
  assert.equal(cat(tx({ payee: 'BOTTLE L', remark: 'bottlelabtechno' })), 'Food & Dining');
  assert.equal(cat(tx({ payee: 'MC DONAL', vpa: 'mcdonalds.27307' })), 'Food & Dining');
  assert.equal(cat(tx({ payee: 'UBER IND', remark: 'uberindiasystem' })), 'Transport & Fuel');
  assert.equal(cat(tx({ payee: 'HP AUTO', vpa: 'paytm.d8750286@' })), 'Transport & Fuel');
  assert.equal(cat(tx({ payee: 'Jio', vpa: 'paytm-jiorech@p' })), 'Bills & Subscriptions');
  assert.equal(cat(tx({ payee: 'FAMILY M', vpa: 'ombk.aafm25846z' })), 'Groceries & Essentials');
  assert.equal(cat(tx({ payee: 'Blinkit' })), 'Groceries & Essentials');
  assert.equal(cat(tx({ payee: 'CRED Clu', vpa: 'cred.club@axisb' })), 'Credit Card Bill');
  assert.equal(cat(tx({ payee: 'CRED', vpa: 'cred.utility@ax' })), 'Bills & Subscriptions');
  assert.equal(cat(tx({ payee: 'Policyba', vpa: 'paytm-8735485@p' })), 'Insurance');
  assert.equal(cat(tx({ payee: 'MUTUAL F', vpa: 'groww.iccl1.brk' })), 'Investments');
  assert.equal(cat(tx({ payee: 'GROWW INVEST TECH PR', type: 'AUTOPAY', narration: 'ACH/GROWW INVEST TECH PR/32432' })), 'Investments');
  assert.equal(cat(tx({ payee: 'CBDT TIN' })), 'Taxes & Government');
  assert.equal(cat(tx({ payee: 'Amazon P', vpa: 'amznplmcdc00011' })), 'Shopping');
  assert.equal(cat(tx({ payee: 'AMUDHA', vpa: 'skenterprises15' })), 'Untagged'); // "Enterprises" must not mean shopping
  assert.equal(cat(tx({ payee: 'RAVI KUM', vpa: '9876543210@ybl' })), 'Untagged');
  assert.equal(cat(tx({ payee: 'SMS charges', type: 'CHARGE' })), 'Fees & Charges');
  assert.equal(cat(tx({ payee: 'ATM withdrawal', type: 'ATM' })), 'Cash (ATM)');
  assert.equal(cat(tx({ payee: 'Bank interest', type: 'INTEREST', dir: 'CR' })), 'Income');
  assert.equal(cat(tx({ payee: 'TATACAPITALDIV2026', type: 'ECS_CREDIT', dir: 'CR' })), 'Income');
  assert.equal(cat(tx({ payee: 'Reversal', type: 'REFUND', dir: 'CR' })), 'Refund');
  assert.equal(cat(tx({ payee: 'TEST PERSON', type: 'NEFT', dir: 'CR' }), {}, { ownName: 'TEST PERSON' }), 'Transfer (self)');
  assert.equal(cat(tx({ payee: 'Razorpay', vpa: 'pg.razorpay@axi', dir: 'CR' })), 'Received'); // credits never land in spend categories
  assert.equal(cat(tx({ payee: 'Aravinds', dir: 'CR' })), 'Received');
  assert.equal(cat(tx({ payee: 'AMUDHA' }), { amudha: 'Rent' }), 'Rent'); // user override wins
  assert.equal(P.categorize(tx({ payee: 'AMUDHA' }), { amudha: 'Rent' }).source, 'user');
  assert.equal(cat(tx({ payee: 'me', vpa: 'me@ybl' }), {}, { ownVPAs: ['me@ybl'] }), 'Transfer (self)');
});

// ------------------------------------------------------------ whole statement + dedupe
const ROWS = [
  row('U62550506', '12/07/2026', 'UPI/DR/662130444779/CRED/UTIB/cred.utility@ax/paym', '84.0', '', '5045.32 Cr.'),
  row('T79196537', '11/07/2026', 'UPI/DR/625469802215/TIF HOSP/HDFC/pinelabs.stq471/', '148.0', '', '5129.32 Cr.'),
  row('T64993567', '11/07/2026', 'UPI/DR/625479555033/FAMILY M/PPIW/ombk.aafm25846z/', '45.0', '', '5277.32 Cr.'),
  row('S63552067', '06/07/2026', 'UPI/DR/661504335582/CRED Clu/UTIB/cred.club@axisb/', '14950.0', '', '8030.36 Cr.'),
  row('N1', '05/07/2026', 'NEFT_IN:18HDFCH01243461600HDFC0000001//HDFCH01243461600/TEST PERSON', '', '30000.0', '22980.36 Cr.'),
  row('A1', '28/06/2026', 'ACH/GROWW INVEST TECH PR/32432', '10000.0', '', '-7019.64 Cr.'),
  row('I1', '30/06/2026', '99990000001234:Int.Pd:01-04-2026 to 30-06-2026', '', '35.0', '2980.36 Cr.'),
  row('C1', '02/06/2026', 'UPI/CR/312345678901/RAHUL K/SBIN/rahulk@oksbi/', '', '500.0', '2945.36 Cr.'),
];

test('parseStatement converts a PNB sheet into transactions with metadata', () => {
  const res = P.parseStatement(pnbSheet(ROWS));
  const m = res.meta;
  assert.equal(m.confidence, 'high');
  assert.equal(m.rows, 8);
  assert.equal(m.skipped, 0);
  assert.equal(m.ownName, 'TEST PERSON');
  assert.equal(m.periodStart, '2026-06-01');
  assert.equal(m.periodEnd, '2026-07-31');
  assert.equal(m.firstTxDate, '2026-06-02');
  assert.equal(m.lastTxDate, '2026-07-12');
  assert.equal(m.capHit, false);
  assert.equal(m.coverageStart, '2026-06-01'); // period start counts when the cap was not hit
  assert.equal(m.coverageEnd, '2026-07-31');
  const t = res.transactions[0];
  assert.equal(t.date, '2026-07-12'); assert.equal(t.amount, 8400); assert.equal(t.dir, 'DR');
  assert.equal(t.txnId, 'U62550506'); assert.equal(t.upiRef, '662130444779'); assert.equal(t.balanceAfter, 504532);
  assert.equal(t.payee, 'CRED'); assert.equal(t.channel, 'CRED'); assert.equal(t.category, 'Bills & Subscriptions');
  const neft = res.transactions.find((x) => x.type === 'NEFT');
  assert.equal(neft.dir, 'CR'); assert.equal(neft.amount, 3000000); assert.equal(neft.category, 'Transfer (self)');
  const ach = res.transactions.find((x) => x.type === 'AUTOPAY');
  assert.equal(ach.category, 'Investments'); assert.equal(ach.channel, 'Auto-debit (ACH)');
  const cr = res.transactions.find((x) => x.txnId === 'C1');
  assert.equal(cr.dir, 'CR'); assert.equal(cr.category, 'Received'); assert.equal(cr.channel, 'Google Pay');
});

test('parseStatement detects the PNB One 500-row cap and narrows coverage to actual rows', () => {
  const rows = [];
  for (let i = 0; i < 500; i++) {
    const d = new Date(Date.UTC(2026, 7, 31) - i * 3600 * 1000 * 4); // ~6 rows/day going back
    const ds = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    rows.push(row('T' + i, ds, `UPI/DR/${String(100000000000 + i)}/SHOP ${i}/YESB/shop${i}@ybl/`, '10.0', '', '100.00 Cr.'));
  }
  const res = P.parseStatement(pnbSheet(rows, { from: '01-01-2026', to: '31-08-2026' }));
  assert.equal(res.meta.rows, 500);
  assert.equal(res.meta.capHit, true);
  assert.equal(res.meta.coverageStart, res.meta.firstTxDate);
  assert.notEqual(res.meta.coverageStart, '2026-01-01');
});

test('parseStatement honours a manual mapping and amount+Dr/Cr layouts', () => {
  const aoa = [
    ['When', 'What', 'How much', 'Kind'],
    ['12/07/2026', 'UPI/DR/1/SHOP/YESB/shop@ybl/', '100', 'DR'],
    ['13/07/2026', 'UPI/CR/2/FRIEND/YESB/f@ybl/', '50', 'CR'],
  ];
  assert.equal(P.detectHeader(aoa).confidence, 'none');
  const res = P.parseStatement(aoa, { headerRow: 0, mapping: { date: 0, narration: 1, amount: 2, drcr: 3 } });
  assert.equal(res.meta.confidence, 'manual');
  assert.equal(res.transactions.length, 2);
  assert.equal(res.transactions[0].dir, 'DR');
  assert.equal(res.transactions[1].dir, 'CR');
});

test('mergeImport: re-import yields zero new rows; overlapping statements add only new rows', () => {
  const first = P.parseStatement(pnbSheet(ROWS)).transactions;
  const again = P.parseStatement(pnbSheet(ROWS)).transactions;
  const r1 = P.mergeImport(first, again);
  assert.equal(r1.added.length, 0); assert.equal(r1.dupes, 8);
  const extra = row('Z9', '13/07/2026', 'UPI/DR/699999999999/NEW SHOP/YESB/newshop@ybl/', '20.0', '', '5025.32 Cr.');
  const r2 = P.mergeImport(first, P.parseStatement(pnbSheet([extra].concat(ROWS.slice(0, 3)))).transactions);
  assert.equal(r2.added.length, 1); assert.equal(r2.dupes, 3);
});

test('dedupeKeys: identical same-day payments are distinct rows; missing ids fall back safely', () => {
  const a = { txnId: null, upiRef: null, date: '2026-07-01', dir: 'DR', amount: 5000, payeeNorm: 'chai', balanceAfter: 100000 };
  const b = Object.assign({}, a, { balanceAfter: 95000 });
  assert.notDeepEqual(P.dedupeKeys(a), P.dedupeKeys(b));
  const c = { txnId: null, upiRef: null, date: '2026-07-01', dir: 'DR', amount: 5000, payeeNorm: 'chai', balanceAfter: null, seqKey: 1 };
  const d = Object.assign({}, c, { seqKey: 2 });
  assert.notDeepEqual(P.dedupeKeys(c), P.dedupeKeys(d));
  const withRef = { txnId: null, upiRef: '123456789012', date: '2026-07-01', dir: 'DR', amount: 5000, payeeNorm: 'chai' };
  assert.deepEqual(P.dedupeKeys(withRef), ['r:123456789012:DR:5000']);
  // same row exported without a Txn No. column still matches through the RRN key
  const withBoth = Object.assign({}, withRef, { txnId: 'U1' });
  const merged = P.mergeImport([withBoth], [withRef]);
  assert.equal(merged.dupes, 1);
});

test('parseStatement skips footer notes and rows without amounts, counting them', () => {
  const res = P.parseStatement(pnbSheet([row('X', '12/07/2026', 'Some note row', '', '', '5.00 Cr.')].concat(ROWS)));
  assert.equal(res.meta.rows, 8);
  assert.equal(res.meta.skipped, 1);
  assert.equal(res.meta.unparsed.length, 1);
});

test('dedupeKeys: PNB Txn No. shared by same-day batch debits does not collapse distinct rows', () => {
  const rows = [
    row('U86459350', '28/08/2026', 'ACH/GROWW INVEST TECH PR/32432', '20000.0', '', '6492.12 Cr.'),
    row('U86459350', '28/08/2026', 'ACH/GROWW INVEST TECH PR/32432', '14000.0', '', '26492.12 Cr.'),
    row('U86459350', '28/08/2026', 'ACH/GROWW INVEST TECH PR/32432', '10000.0', '', '40492.12 Cr.'),
  ];
  const first = P.parseStatement(pnbSheet(rows)).transactions;
  assert.equal(first.length, 3);
  const m = P.mergeImport([], first);
  assert.equal(m.added.length, 3); assert.equal(m.dupes, 0);
  const again = P.mergeImport(m.added, P.parseStatement(pnbSheet(rows)).transactions);
  assert.equal(again.added.length, 0); assert.equal(again.dupes, 3);
});
