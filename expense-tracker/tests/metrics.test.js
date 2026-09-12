const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../metrics.js');

const R = (rupees) => Math.round(rupees * 100);
function tx(date, rupees, over) {
  return Object.assign({ date, amount: R(rupees), dir: 'DR', type: 'UPI', category: 'Food & Dining', excluded: false, payee: 'X', payeeNorm: 'x', source: 'pnb' }, over || {});
}
// 30 quiet days of ₹500 ending 2026-09-11, then "today" 2026-09-12
function quietMonth(perDay = 500, days = 30, end = '2026-09-11') {
  const out = [];
  for (let i = 0; i < days; i++) out.push(tx(M.addDays(end, -i), perDay));
  return out;
}
const IMPORTS = [{ coverageStart: '2026-06-01', coverageEnd: '2026-09-12' }];
const TODAY = '2026-09-12';

test('isSpend excludes credits, excluded rows, default fixed types and categories', () => {
  assert.equal(M.isSpend(tx('2026-09-01', 100)), true);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { dir: 'CR' })), false);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { excluded: true })), false);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { type: 'AUTOPAY', category: 'Investments' })), false);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { category: 'Rent' })), false);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { category: 'Credit Card Bill' })), false);
  assert.equal(M.isSpend(tx('2026-09-01', 100, { category: 'Rent' }), { excludedCategories: [] }), true);
  assert.equal(M.isFixed(tx('2026-09-01', 100, { category: 'Rent' })), true);
  assert.equal(M.isFixed(tx('2026-09-01', 100, { dir: 'CR', category: 'Rent' })), false);
});

test('dailySeries includes zero days and trimmedMean drops the top 10%', () => {
  const s = M.dailySeries([tx('2026-09-01', 10), tx('2026-09-03', 20)], '2026-09-01', '2026-09-03');
  assert.deepEqual(s.map((d) => d.paise), [1000, 0, 2000]);
  const vals = Array(27).fill(500).concat([15000, 20000, 30000]);
  assert.equal(M.trimmedMean(vals), 500);            // top 3 of 30 dropped
  assert.equal(M.trimmedMean([1, 2, 3]), 2);         // n<10: nothing dropped
  assert.equal(M.trimmedMean([]), 0);
});

test('baseline uses the trailing 30 covered days ending yesterday and resists one huge day', () => {
  const txs = quietMonth().concat([tx('2026-09-05', 15000, { payee: 'FLIGHT' })]);
  const b = M.baseline(txs, { start: '2026-06-01', end: '2026-09-12' }, TODAY);
  assert.equal(b.days, 30);
  assert.equal(b.end, '2026-09-11');
  assert.equal(b.perDay, R(500)); // the ₹15,500 day is trimmed away
  const plain = M.baseline(quietMonth().concat([tx(TODAY, 99999)]), { start: '2026-06-01', end: '2026-09-12' }, TODAY);
  assert.equal(plain.perDay, R(500)); // today never feeds the baseline
});

test('baseline with short coverage uses what exists and labels the day count', () => {
  const txs = quietMonth(500, 10);
  const b = M.baseline(txs, { start: '2026-09-02', end: '2026-09-12' }, TODAY);
  assert.equal(b.days, 10);
  assert.equal(b.perDay, R(500));
});

test('summarize: safe day, caution and danger thresholds, and the ₹200 floor', () => {
  const base = quietMonth();
  const safe = M.summarize(base.concat([tx(TODAY, 600)]), {}, IMPORTS, TODAY);
  assert.equal(safe.dayLevel, 'safe');
  assert.equal(safe.todayPaise, R(600));
  const caution = M.summarize(base.concat([tx(TODAY, 800)]), {}, IMPORTS, TODAY);
  assert.equal(caution.dayLevel, 'caution'); // 1.6x
  const danger = M.summarize(base.concat([tx(TODAY, 1300, { payee: 'BIG SHOP' })]), {}, IMPORTS, TODAY);
  assert.equal(danger.dayLevel, 'danger'); // 2.6x
  assert.equal(danger.level, 'danger');
  assert.match(danger.reason, /2\.6× your usual daily spend/);
  assert.match(danger.reason, /BIG SHOP/);
  // tiny baseline: ₹90 on a ₹30/day baseline must not alert
  const tiny = quietMonth(30).concat([tx(TODAY, 90)]);
  assert.equal(M.summarize(tiny, {}, IMPORTS, TODAY).dayLevel, 'safe');
});

test('summarize: month projection is MTD + baseline × remaining days, referenced to prior full months', () => {
  // Jun, Jul, Aug each ₹15,000 spread evenly; Sep 1-11 at ₹500/day; today ₹0
  const txs = [];
  for (const ym of ['2026-06', '2026-07', '2026-08']) {
    const dim = M.daysInMonth(ym);
    for (let d = 1; d <= dim; d++) txs.push(tx(`${ym}-${String(d).padStart(2, '0')}`, 15000 / dim));
  }
  for (let d = 1; d <= 11; d++) txs.push(tx(`2026-09-${String(d).padStart(2, '0')}`, 500));
  const s = M.summarize(txs, {}, IMPORTS, TODAY);
  assert.equal(s.referenceKind, 'prior-months');
  assert.ok(Math.abs(s.reference - R(15000)) < 200, 'reference ~ ₹15,000');
  assert.equal(s.daysRemaining, 18);
  assert.equal(s.mtd, R(5500));
  const expected = s.mtd + s.baseline.perDay * 18; // baseline ~₹500 (mix of ₹500 days and ₹484 Aug days, trimmed)
  assert.equal(s.projected, expected);
  assert.equal(s.monthLevel, 'safe');
});

test('summarize: a budget overrides the prior-month reference and yields safe-per-day', () => {
  const txs = quietMonth().concat([tx('2026-09-01', 9000)]);
  const s = M.summarize(txs, { budget: R(10000) }, IMPORTS, TODAY);
  assert.equal(s.referenceKind, 'budget');
  assert.equal(s.reference, R(10000));
  assert.ok(s.projected > s.reference * 1.25, 'projected well over budget');
  assert.equal(s.monthLevel, 'danger');
  assert.equal(s.level, 'danger');
  assert.match(s.reason, /budget/);
  assert.ok(s.safePerDay >= 0);
});

test('summarize: cold start with < 7 covered days gives a neutral verdict', () => {
  const txs = quietMonth(500, 5);
  const s = M.summarize(txs, {}, [{ coverageStart: '2026-09-07', coverageEnd: '2026-09-12' }], TODAY);
  assert.equal(s.level, 'neutral');
  assert.match(s.reason, /at least 7 days/);
  const none = M.summarize([], {}, [], TODAY);
  assert.equal(none.level, 'neutral');
  assert.match(none.reason, /Import/);
});

test('summarize: fixed spend is reported separately and excluded categories never enter the baseline', () => {
  const txs = quietMonth().concat([tx('2026-09-06', 14950, { category: 'Credit Card Bill', payee: 'CRED' }), tx('2026-09-02', 9500, { category: 'Rent' })]);
  const s = M.summarize(txs, {}, IMPORTS, TODAY);
  assert.equal(s.fixedMtd, R(14950 + 9500));
  assert.equal(s.baseline.perDay, R(500));
});

test('summarize: same-day-last-month comparison is clamped and coverage-aware', () => {
  const txs = [];
  for (let d = 1; d <= 31; d++) txs.push(tx(`2026-08-${String(d).padStart(2, '0')}`, 100));
  for (let d = 1; d <= 12; d++) txs.push(tx(`2026-09-${String(d).padStart(2, '0')}`, 200));
  const s = M.summarize(txs, {}, IMPORTS, TODAY);
  assert.equal(s.prevMonth, '2026-08');
  assert.equal(s.lastMonthCovered, true);
  assert.equal(s.lastMonthSameDay, R(1200)); // Aug 1–12
  assert.equal(s.lastMonthTotal, R(3100));
  const s31 = M.summarize(txs, {}, IMPORTS, '2026-10-31'); // September has 30 days → clamp to Sep 30
  assert.equal(s31.prevMonth, '2026-09');
  assert.equal(s31.lastMonthSameDay, R(2400));
  const uncovered = M.summarize(txs.filter((t) => t.date >= '2026-09-01'), {}, [{ coverageStart: '2026-09-01', coverageEnd: '2026-09-12' }], TODAY);
  assert.equal(uncovered.lastMonthCovered, false);
});

test('summarize: stale data is flagged when the latest statement ends before today', () => {
  const s = M.summarize(quietMonth(500, 30, '2026-09-05'), {}, [{ coverageStart: '2026-06-01', coverageEnd: '2026-09-05' }], TODAY);
  assert.equal(s.dataStale, 7);
});

test('insight helpers: recurring payees, weekday pattern, buckets, formatting', () => {
  const txs = [tx('2026-06-05', 100, { payeeNorm: 'jio' }), tx('2026-07-05', 100, { payeeNorm: 'jio' }), tx('2026-08-05', 100, { payeeNorm: 'jio' }), tx('2026-08-06', 5, { payeeNorm: 'chai' })];
  const rec = M.recurring(txs, 3);
  assert.equal(rec.length, 1); assert.equal(rec[0].key, 'jio'); assert.equal(rec[0].months, 3);
  assert.equal(M.topPayees(txs, 1)[0].key, 'jio');
  const wd = M.weekdayPattern([tx('2026-09-07', 700)], '2026-09-07', '2026-09-13'); // Monday
  assert.equal(wd[1].weekday, 'Mon'); assert.equal(wd[1].avg, R(700)); assert.equal(wd[2].avg, 0);
  const b = M.amountBuckets([tx('2026-09-01', 50), tx('2026-09-01', 250), tx('2026-09-01', 12000)]);
  assert.deepEqual(b.map((x) => x.count), [1, 1, 0, 0, 1]);
  assert.equal(M.fmt(R(470106)), '₹4,70,106');
  assert.equal(M.fmt(R(84)), '₹84');
  assert.equal(M.fmt(R(148.5)), '₹148.5');
  assert.equal(M.fmt(R(1596.41)), '₹1,596');
});
