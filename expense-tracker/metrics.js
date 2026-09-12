/*
 * Metrics — pure spending maths. No DOM, no storage. Browser + `node --test`.
 * Amounts are integer paise throughout.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const THRESHOLDS = {
    dayCaution: 1.5, dayDanger: 2.5,           // today vs trailing baseline
    monthCaution: 1.10, monthDanger: 1.25,     // projected month vs reference
    floorPaise: 20000,                          // never alert under ₹200
    minCoverageDays: 7, baselineDays: 30, trimFraction: 0.10,
  };
  const DEFAULT_EXCLUDED_TYPES = ['AUTOPAY', 'CHARGE'];
  const DEFAULT_EXCLUDED_CATEGORIES = ['Rent', 'Investments', 'Insurance', 'Transfer (self)', 'Credit Card Bill', 'Taxes & Government'];

  const toDate = (iso) => new Date(iso + 'T00:00:00Z');
  const fromDate = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => fromDate(new Date(toDate(iso).getTime() + n * DAY));
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const monthOf = (iso) => iso.slice(0, 7);
  const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const monthStart = (ym) => ym + '-01';
  const monthEnd = (ym) => ym + '-' + String(daysInMonth(ym)).padStart(2, '0');
  const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

  function isSpend(tx, settings) {
    if (tx.dir !== 'DR' || tx.excluded) return false;
    const et = (settings && settings.excludedTypes) || DEFAULT_EXCLUDED_TYPES;
    const ec = (settings && settings.excludedCategories) || DEFAULT_EXCLUDED_CATEGORIES;
    if (et.includes(tx.type)) return false;
    if (ec.includes(tx.category)) return false;
    return true;
  }
  function isFixed(tx, settings) {
    if (tx.dir !== 'DR' || tx.excluded) return false;
    return !isSpend(tx, settings);
  }

  function sum(txs) { return txs.reduce((a, t) => a + t.amount, 0); }
  function inRange(txs, start, end) { return txs.filter((t) => t.date >= start && t.date <= end); }

  // Daily totals for every day in [start, end], zeros included.
  function dailySeries(txs, start, end) {
    const map = new Map();
    for (const t of txs) if (t.date >= start && t.date <= end) map.set(t.date, (map.get(t.date) || 0) + t.amount);
    const out = [];
    const n = daysBetween(start, end);
    for (let i = 0; i <= n; i++) { const d = addDays(start, i); out.push({ date: d, paise: map.get(d) || 0 }); }
    return out;
  }

  function trimmedMean(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const drop = Math.floor(sorted.length * (fraction == null ? THRESHOLDS.trimFraction : fraction));
    const kept = drop > 0 ? sorted.slice(0, sorted.length - drop) : sorted;
    return kept.reduce((a, b) => a + b, 0) / kept.length;
  }

  // Coverage: from the earliest imported statement start to the latest date we have data for.
  function coverage(imports, txs) {
    let start = null, end = null;
    for (const im of imports || []) {
      if (im.coverageStart && (!start || im.coverageStart < start)) start = im.coverageStart;
      if (im.coverageEnd && (!end || im.coverageEnd > end)) end = im.coverageEnd;
    }
    for (const t of txs || []) {
      if (t.source === 'manual') { if (!start || t.date < start) start = t.date; if (!end || t.date > end) end = t.date; }
      else if (!start || t.date < start) start = t.date;
    }
    return { start, end };
  }

  function baseline(spendTxs, cov, today) {
    if (!cov.start || !cov.end) return { perDay: 0, days: 0, method: 'none' };
    const yesterday = addDays(today, -1);
    const end = cov.end < yesterday ? cov.end : yesterday;
    if (end < cov.start) return { perDay: 0, days: 0, method: 'none' };
    let start = addDays(end, -(THRESHOLDS.baselineDays - 1));
    if (start < cov.start) start = cov.start;
    const series = dailySeries(spendTxs, start, end);
    const perDay = trimmedMean(series.map((d) => d.paise));
    return { perDay, days: series.length, method: 'trimmed-mean', start, end };
  }

  function levelFrom(ratio, caution, danger) {
    if (ratio >= danger) return 'danger';
    if (ratio >= caution) return 'caution';
    return 'safe';
  }

  function summarize(allTxs, settings, imports, today) {
    settings = settings || {};
    const spendTxs = allTxs.filter((t) => isSpend(t, settings));
    const fixedTxs = allTxs.filter((t) => isFixed(t, settings));
    const cov = coverage(imports, allTxs);
    const coveredDays = cov.start ? daysBetween(cov.start, cov.end < today ? cov.end : today) + 1 : 0;
    const base = baseline(spendTxs, cov, today);
    const ym = monthOf(today);
    const mStart = monthStart(ym), mEnd = monthEnd(ym);
    const dim = daysInMonth(ym);
    const dayOfMonth = +today.slice(8, 10);
    const daysRemaining = dim - dayOfMonth;

    const todayTxs = spendTxs.filter((t) => t.date === today);
    const todayPaise = sum(todayTxs);
    const weekStart = addDays(today, -((toDate(today).getUTCDay() + 6) % 7)); // Monday
    const weekPaise = sum(inRange(spendTxs, weekStart, today));
    const mtd = sum(inRange(spendTxs, mStart, today));
    const fixedMtd = sum(inRange(fixedTxs, mStart, today));
    const budget = settings.budget > 0 ? Math.round(settings.budget) : 0; // paise
    const dailyBudget = budget ? budget / dim : 0;

    // reference for month pace
    const priorFull = [];
    for (let i = 1; i <= 3; i++) {
      const pm = addMonths(ym, -i);
      if (cov.start && cov.start <= monthStart(pm) && cov.end >= monthEnd(pm)) priorFull.push(sum(inRange(spendTxs, monthStart(pm), monthEnd(pm))));
    }
    let reference = 0, referenceKind = 'none';
    if (budget) { reference = budget; referenceKind = 'budget'; }
    else if (priorFull.length) { reference = priorFull.reduce((a, b) => a + b, 0) / priorFull.length; referenceKind = 'prior-months'; }
    else if (base.perDay) { reference = base.perDay * dim; referenceKind = 'baseline'; }

    const projected = mtd + base.perDay * daysRemaining;
    // same-day comparison with last month (clamped to that month's length)
    const prevYm = addMonths(ym, -1);
    const prevSameDay = prevYm + '-' + String(Math.min(dayOfMonth, daysInMonth(prevYm))).padStart(2, '0');
    const lastMonthCovered = !!(cov.start && cov.start <= monthStart(prevYm) && cov.end >= prevSameDay);
    const lastMonthSameDay = sum(inRange(spendTxs, monthStart(prevYm), prevSameDay));
    const lastMonthTotal = sum(inRange(spendTxs, monthStart(prevYm), monthEnd(prevYm)));
    const dataStale = cov.end && cov.end < today ? daysBetween(cov.end, today) : 0;

    let dayLevel = 'safe', monthLevel = 'safe', level = 'neutral', reason = '';
    const enough = coveredDays >= THRESHOLDS.minCoverageDays && base.days >= Math.min(THRESHOLDS.minCoverageDays, THRESHOLDS.baselineDays);
    if (!cov.start) { level = 'neutral'; reason = 'Import a PNB statement to start tracking.'; }
    else if (!enough) { level = 'neutral'; reason = `Need at least ${THRESHOLDS.minCoverageDays} days of data to judge spending (have ${coveredDays}).`; }
    else {
      const floor = Math.max(THRESHOLDS.floorPaise, dailyBudget * 0.5);
      if (todayPaise >= floor && base.perDay > 0) dayLevel = levelFrom(todayPaise / base.perDay, THRESHOLDS.dayCaution, THRESHOLDS.dayDanger);
      else if (todayPaise >= floor && dailyBudget && todayPaise > dailyBudget) dayLevel = 'caution';
      if (reference > 0 && referenceKind !== 'baseline') monthLevel = levelFrom(projected / reference, THRESHOLDS.monthCaution, THRESHOLDS.monthDanger);
      const order = { safe: 0, caution: 1, danger: 2 };
      level = order[dayLevel] >= order[monthLevel] ? dayLevel : monthLevel;
      const big = todayTxs.slice().sort((a, b) => b.amount - a.amount)[0];
      if (level === 'safe') reason = referenceKind === 'baseline' ? 'Spending is in line with your usual pattern. Building a monthly reference.' : 'Spending is in line with your usual pattern.';
      else if (dayLevel === level) {
        reason = `Today is ${(todayPaise / base.perDay).toFixed(1)}× your usual daily spend`;
        if (big && big.amount > todayPaise * 0.5) reason += `, mostly ${big.payee} (${fmt(big.amount)})`;
        reason += '.';
      } else {
        reason = `This month is projecting ${fmt(projected)} vs ${referenceKind === 'budget' ? 'your budget of ' : 'your recent average of '}${fmt(reference)} (${Math.round((projected / reference) * 100)}%).`;
      }
    }

    return {
      today, coverage: cov, coveredDays, dataStale,
      todayPaise, weekPaise, mtd, fixedMtd, projected, daysRemaining, daysInMonth: dim,
      baseline: base, reference, referenceKind, budget,
      prevMonth: prevYm, lastMonthSameDay, lastMonthTotal, lastMonthCovered,
      safePerDay: budget ? Math.max(0, (budget - mtd) / Math.max(1, daysRemaining + 1)) : null,
      level, dayLevel, monthLevel, reason,
      txCountToday: todayTxs.length,
    };
  }

  // ------------------------------------------------------------ insights helpers
  function byMonth(txs, months) {
    const out = new Map();
    for (const m of months) out.set(m, 0);
    for (const t of txs) { const m = monthOf(t.date); if (out.has(m)) out.set(m, out.get(m) + t.amount); }
    return out;
  }
  function lastMonths(today, n) { const ym = monthOf(today); const arr = []; for (let i = n - 1; i >= 0; i--) arr.push(addMonths(ym, -i)); return arr; }
  function groupSum(txs, keyFn) {
    const m = new Map();
    for (const t of txs) { const k = keyFn(t); const g = m.get(k) || { key: k, paise: 0, count: 0, months: new Set(), last: '' }; g.paise += t.amount; g.count++; g.months.add(monthOf(t.date)); if (t.date > g.last) g.last = t.date; m.set(k, g); }
    return [...m.values()].map((g) => Object.assign(g, { months: g.months.size }));
  }
  function topPayees(txs, n) { return groupSum(txs, (t) => t.payeeNorm || t.payee).sort((a, b) => b.paise - a.paise).slice(0, n); }
  function frequentPayees(txs, n) { return groupSum(txs, (t) => t.payeeNorm || t.payee).sort((a, b) => b.count - a.count).slice(0, n); }
  function recurring(txs, minMonths) { return groupSum(txs, (t) => t.payeeNorm || t.payee).filter((g) => g.months >= (minMonths || 3)).sort((a, b) => b.paise - a.paise); }
  function weekdayPattern(txs, start, end) {
    const days = dailySeries(txs, start, end);
    const acc = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
    for (const d of days) { const w = toDate(d.date).getUTCDay(); acc[w].total += d.paise; acc[w].n++; }
    return acc.map((a, i) => ({ weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], avg: a.n ? a.total / a.n : 0 }));
  }
  function amountBuckets(txs) {
    const b = [['< ₹100', 0, 10000], ['₹100–500', 10000, 50000], ['₹500–2k', 50000, 200000], ['₹2k–10k', 200000, 1000000], ['₹10k+', 1000000, Infinity]];
    return b.map(([label, lo, hi]) => { const g = txs.filter((t) => t.amount >= lo && t.amount < hi); return { label, count: g.length, paise: sum(g) }; });
  }

  function fmt(paise, opts) {
    const rupees = Math.round(paise) / 100;
    const s = new Intl.NumberFormat('en-IN', { maximumFractionDigits: opts && opts.decimals != null ? opts.decimals : (Math.abs(rupees) >= 1000 ? 0 : 2), minimumFractionDigits: 0 }).format(rupees);
    return '₹' + s;
  }

  const api = {
    THRESHOLDS, DEFAULT_EXCLUDED_TYPES, DEFAULT_EXCLUDED_CATEGORIES,
    isSpend, isFixed, sum, inRange, dailySeries, trimmedMean, coverage, baseline, summarize,
    byMonth, lastMonths, groupSum, topPayees, frequentPayees, recurring, weekdayPattern, amountBuckets, fmt,
    addDays, daysBetween, monthOf, daysInMonth, monthStart, monthEnd, addMonths,
  };
  root.Metrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
