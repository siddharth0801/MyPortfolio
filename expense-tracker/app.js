/* UPI Spend Tracker — app shell. Depends on cfb-decrypt.js, parsers.js, metrics.js, Chart.js and SheetJS (window.XLSX). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = Metrics.fmt;
  const R0 = { decimals: 0 };
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTH_NAMES[+m - 1]} ${y}`; };
  const dateLabel = (iso) => { const [y, m, d] = iso.split('-'); return `${+d} ${MONTH_NAMES[+m - 1]} ${y}`; };
  const APP_VERSION = '1.0';

  // ------------------------------------------------------------ store
  const KEY_TX = 'et:v1:txns';
  const KEY_META = 'et:v1:meta';
  const defaultMeta = () => ({
    schemaVersion: 1, imports: [], headerMappings: {}, payeeCategoryMap: {},
    settings: {
      budget: 0, excludedTypes: Metrics.DEFAULT_EXCLUDED_TYPES.slice(), excludedCategories: Metrics.DEFAULT_EXCLUDED_CATEGORIES.slice(),
      ownVPAs: [], ownName: '', notifications: false, lastBackupAt: null, statementPassword: null,
    },
  });
  const state = { txns: [], meta: defaultMeta(), tab: 'home', month: todayISO().slice(0, 7), insightPeriod: 'month', pending: null, filters: { q: '', cat: '', kind: '' } };

  function load() {
    try {
      const t = JSON.parse(localStorage.getItem(KEY_TX) || '[]');
      const m = JSON.parse(localStorage.getItem(KEY_META) || 'null');
      state.txns = Array.isArray(t) ? t : [];
      state.meta = m ? Object.assign(defaultMeta(), m, { settings: Object.assign(defaultMeta().settings, m.settings || {}) }) : defaultMeta();
    } catch (e) { console.warn('storage unavailable', e); }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY_TX, JSON.stringify(state.txns));
        localStorage.setItem(KEY_META, JSON.stringify(state.meta));
      } catch (e) {
        toast('Storage is full or blocked. Download a backup now.', { action: 'Backup', onAction: exportBackup, sticky: true });
      }
    }, 200);
  }

  // ------------------------------------------------------------ UI helpers
  let toastTimer = null;
  function toast(msg, opts = {}) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (opts.action ? `<button type="button">${esc(opts.action)}</button>` : '');
    if (opts.action) $('button', el).onclick = () => { el.hidden = true; opts.onAction && opts.onAction(); };
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!opts.sticky) toastTimer = setTimeout(() => { el.hidden = true; }, opts.ms || 3500);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const SLOT_VARS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
  const CATEGORY_SLOT = { 'Food & Dining': 0, 'Transport & Fuel': 1, 'Groceries & Essentials': 2, 'Untagged': 3, 'Shopping': 4, 'Health & Fitness': 5, 'Bills & Subscriptions': 6, 'Entertainment': 7 };
  const CHANNEL_SLOT = { 'Paytm': 0, 'BharatPe': 1, 'Google Pay': 2, 'Payment gateway': 3, 'Amazon Pay': 4, 'CRED': 5, 'PhonePe': 6, 'Pine Labs': 7 };
  const colorFor = (map, key) => (map[key] != null ? cssVar(SLOT_VARS[map[key]]) : cssVar('--other'));

  function setTab(tab) {
    state.tab = tab;
    $$('section.tab').forEach((s) => s.classList.toggle('active', s.dataset.tab === tab));
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    render();
    window.scrollTo({ top: 0 });
  }

  const charts = {};
  function chart(id, config) {
    if (charts[id]) charts[id].destroy();
    const ctx = $('#' + id);
    if (!ctx || typeof Chart === 'undefined') return null;
    charts[id] = new Chart(ctx, config);
    return charts[id];
  }
  function chartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--grid');
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--ink');
    Chart.defaults.plugins.tooltip.titleColor = cssVar('--bg');
    Chart.defaults.plugins.tooltip.bodyColor = cssVar('--bg');
    Chart.defaults.plugins.tooltip.displayColors = false;
  }
  const rupeeTicks = { callback: (v) => (v >= 100000 ? (v / 100000).toFixed(1).replace(/\.0$/, '') + 'L' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(v)) };

  // ------------------------------------------------------------ derived data
  const settings = () => state.meta.settings;
  const spendTxs = () => state.txns.filter((t) => Metrics.isSpend(t, settings()));
  const fixedTxs = () => state.txns.filter((t) => Metrics.isFixed(t, settings()));
  function periodRange(p, today) {
    const ym = today.slice(0, 7);
    if (p === 'month') return [Metrics.monthStart(ym), today];
    if (p === '3m') return [Metrics.monthStart(Metrics.addMonths(ym, -2)), today];
    if (p === '12m') return [Metrics.monthStart(Metrics.addMonths(ym, -11)), today];
    return ['0000-01-01', '9999-12-31'];
  }

  // ------------------------------------------------------------ HOME
  function renderHome() {
    const today = todayISO();
    const s = Metrics.summarize(state.txns, settings(), state.meta.imports, today);
    const levelTitle = { safe: 'Safe', caution: 'Caution', danger: 'Danger — overspending', neutral: 'Not enough data yet' }[s.level];
    const icon = { safe: '✓', caution: '!', danger: '!!', neutral: '…' }[s.level];
    $('#home-banner').innerHTML = `<div class="banner ${s.level}" role="status"><div class="icon">${icon}</div><div><div class="title">${esc(levelTitle)}</div><div class="reason">${esc(s.reason)}</div></div></div>`;
    const stale = $('#home-stale');
    if (s.coverage.end && s.dataStale > 0) {
      stale.innerHTML = `<div class="stale">Statement data ends <b>${dateLabel(s.coverage.end)}</b> (${s.dataStale} day${s.dataStale === 1 ? '' : 's'} ago). Today's figure only includes what you add manually — <a href="#import" data-go="import">import a fresh statement</a> for the full picture.</div>`;
    } else stale.innerHTML = '';

    const tiles = [
      { label: 'Today', value: fmt(s.todayPaise, R0), sub: s.txCountToday ? `${s.txCountToday} payment${s.txCountToday > 1 ? 's' : ''}` : 'no payments yet' },
      { label: 'This week', value: fmt(s.weekPaise, R0), sub: 'since Monday' },
      { label: 'This month so far', value: fmt(s.mtd, R0), sub: `${s.daysRemaining} days left` },
      { label: 'Your usual day', value: fmt(s.baseline.perDay, R0), sub: s.baseline.days ? `trimmed mean of ${s.baseline.days} days` : 'need more data' },
      { label: 'Projected month', value: fmt(s.projected, R0), sub: s.reference ? `vs ${fmt(s.reference)} ${s.referenceKind === 'budget' ? 'budget' : s.referenceKind === 'prior-months' ? 'recent avg' : 'baseline'}` : 'no reference yet' },
      { label: 'Fixed this month', value: fmt(s.fixedMtd, R0), sub: 'rent, SIPs, bills, card' },
    ];
    if (s.budget) tiles.push({ label: 'Safe to spend / day', value: fmt(s.safePerDay, R0), sub: 'to stay within budget' });
    $('#home-tiles').innerHTML = tiles.map((t) => `<div class="tile"><div class="label">${esc(t.label)}</div><div class="value">${esc(t.value)}</div><div class="sub">${esc(t.sub)}</div></div>`).join('');

    chartDefaults();
    // Focus month: the current month, or the latest month that has any debit when the statement is older.
    let ym = today.slice(0, 7);
    if (!state.txns.some((t) => t.dir === 'DR' && t.date.startsWith(ym))) {
      const months = state.txns.filter((t) => t.dir === 'DR').map((t) => t.date.slice(0, 7)).sort();
      if (months.length) ym = months[months.length - 1];
    }
    const isCurrent = ym === today.slice(0, 7);
    const dim = Metrics.daysInMonth(ym);
    const series = Metrics.dailySeries(spendTxs(), Metrics.monthStart(ym), Metrics.monthEnd(ym));
    const dayOfMonth = isCurrent ? +today.slice(8, 10) : dim;
    const surface = cssVar('--surface');
    $('#daily-title').textContent = `${monthLabel(ym)}, day by day`;
    $('#daily-sub').textContent = s.baseline.perDay ? `usual day ${fmt(s.baseline.perDay, R0)}` : '';
    chart('chart-daily', {
      type: 'bar',
      data: {
        labels: series.map((d) => +d.date.slice(8, 10)),
        datasets: [
          { type: 'line', label: 'Your usual day', data: series.map((d, i) => (i < dayOfMonth ? s.baseline.perDay / 100 : null)), borderColor: cssVar('--muted'), borderWidth: 2, pointRadius: 0, tension: 0, order: 0 },
          { label: 'Spent', data: series.map((d, i) => (i < dayOfMonth ? d.paise / 100 : null)), backgroundColor: cssVar('--s1'), maxBarThickness: 24, borderRadius: 4, borderSkipped: 'bottom', order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, grid: { color: cssVar('--grid') }, border: { display: false }, ticks: rupeeTicks } },
        plugins: { tooltip: { callbacks: { title: (items) => `${items[0].label} ${MONTH_NAMES[+ym.slice(5) - 1]}`, label: (c) => `${c.dataset.label}: ${fmt(Math.round(c.parsed.y * 100))}` } } },
      },
    });
    $('#daily-legend').innerHTML = `<span><i class="sw" style="background:${cssVar('--s1')}"></i>Spent</span><span><i class="sw" style="background:${cssVar('--muted')}"></i>Your usual day</span>`;

    const focusEnd = isCurrent ? today : Metrics.monthEnd(ym);
    const mtdTxs = Metrics.inRange(spendTxs(), Metrics.monthStart(ym), focusEnd);
    const fixedMtd = Metrics.inRange(fixedTxs(), Metrics.monthStart(ym), focusEnd);
    $('#cat-sub').textContent = monthLabel(ym);
    $('#channel-sub').textContent = `${monthLabel(ym)} · merchant's provider`;
    donut('chart-cat', 'cat-legend', groupTop(mtdTxs.concat(fixedMtd), (t) => t.category, 7), CATEGORY_SLOT, surface);
    donut('chart-channel', 'channel-legend', groupTop(mtdTxs, (t) => t.channel, 7), CHANNEL_SLOT, surface);

    const months = Metrics.lastMonths(today, 12);
    const bym = Metrics.byMonth(spendTxs(), months);
    chart('chart-months', {
      type: 'bar',
      data: { labels: months.map((m) => MONTH_NAMES[+m.slice(5) - 1] + (m.endsWith('-01') ? ' ' + m.slice(2, 4) : '')), datasets: [{ label: 'Day-to-day spend', data: months.map((m) => (s.coverage.start && Metrics.monthEnd(m) >= s.coverage.start ? bym.get(m) / 100 : null)), backgroundColor: cssVar('--s1'), maxBarThickness: 24, borderRadius: 4, borderSkipped: 'bottom' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: cssVar('--grid') }, border: { display: false }, ticks: rupeeTicks } },
        plugins: { tooltip: { callbacks: { title: (items) => monthLabel(months[items[0].dataIndex]), label: (c) => fmt(Math.round(c.parsed.y * 100)) } } },
      },
    });
    $$('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setTab(a.dataset.go); }));
  }

  function groupTop(txs, keyFn, n) {
    const g = Metrics.groupSum(txs, keyFn).sort((a, b) => b.paise - a.paise);
    if (g.length <= n) return g;
    const head = g.slice(0, n);
    const rest = g.slice(n);
    head.push({ key: 'Other', paise: rest.reduce((a, x) => a + x.paise, 0), count: rest.reduce((a, x) => a + x.count, 0) });
    return head;
  }

  function donut(canvasId, legendId, groups, slotMap, surface) {
    const total = groups.reduce((a, g) => a + g.paise, 0);
    const legend = $('#' + legendId);
    if (!total) { if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; } legend.innerHTML = '<span class="muted">Nothing yet this period.</span>'; return; }
    const colors = groups.map((g) => (g.key === 'Other' ? cssVar('--other') : colorFor(slotMap, g.key)));
    chart(canvasId, {
      type: 'doughnut',
      data: { labels: groups.map((g) => g.key), datasets: [{ data: groups.map((g) => g.paise / 100), backgroundColor: colors, borderColor: surface, borderWidth: 2, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(Math.round(c.parsed * 100))} (${Math.round((c.parsed * 100 / total) * 100)}%)` } } } },
    });
    legend.innerHTML = groups.map((g, i) => `<span><i class="sw" style="background:${colors[i]}"></i>${esc(g.key)} <b>${fmt(g.paise)}</b></span>`).join('');
  }

  // ------------------------------------------------------------ HISTORY
  function renderHistory() {
    const ym = state.month;
    $('#month-label').textContent = monthLabel(ym);
    const catSel = $('#filter-cat');
    if (catSel.options.length <= 1) Parsers.CATEGORIES.forEach((c) => catSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`));
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    let rows = state.txns.filter((t) => t.date.startsWith(ym));
    if (f.cat) rows = rows.filter((t) => t.category === f.cat);
    if (f.kind === 'CR') rows = rows.filter((t) => t.dir === 'CR');
    if (f.kind === 'spend') rows = rows.filter((t) => Metrics.isSpend(t, settings()));
    if (f.kind === 'fixed') rows = rows.filter((t) => Metrics.isFixed(t, settings()));
    if (q) rows = rows.filter((t) => [t.payee, t.note, t.narration, t.category, t.channel, t.vpa].filter(Boolean).join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => (b.date + (b.time || '') + String(b.seq || 0).padStart(6, '0')).localeCompare(a.date + (a.time || '') + String(a.seq || 0).padStart(6, '0')));
    const spend = rows.filter((t) => Metrics.isSpend(t, settings())).reduce((a, t) => a + t.amount, 0);
    const fixed = rows.filter((t) => Metrics.isFixed(t, settings())).reduce((a, t) => a + t.amount, 0);
    $('#month-total').textContent = rows.length ? `${fmt(spend)} day-to-day · ${fmt(fixed)} fixed · ${rows.length} rows` : 'no transactions';
    const list = $('#tx-list');
    if (!rows.length) { list.innerHTML = `<div class="empty">Nothing here. ${state.txns.length ? 'Try another month or clear the filters.' : 'Import a statement to get started.'}</div>`; return; }
    let html = '';
    let lastDay = null;
    for (const t of rows) {
      if (t.date !== lastDay) {
        lastDay = t.date;
        const dayTotal = rows.filter((x) => x.date === t.date && Metrics.isSpend(x, settings())).reduce((a, x) => a + x.amount, 0);
        html += `<div class="day-head"><span>${esc(dateLabel(t.date))}</span><span>${dayTotal ? fmt(dayTotal) : ''}</span></div>`;
      }
      const col = colorFor(CATEGORY_SLOT, t.category);
      const initial = (t.payee || '?').trim().charAt(0).toUpperCase();
      const metaBits = [t.category, t.channel && t.channel !== 'Other UPI' ? t.channel : null, t.note].filter(Boolean);
      html += `<div class="row ${t.excluded ? 'excluded' : ''}" data-id="${esc(t.id)}"><div class="avatar" style="background:${col}">${esc(initial)}</div><div class="who"><div class="name">${esc(t.payee)}</div><div class="meta">${esc(metaBits.join(' · '))}</div></div><div class="amt ${t.dir === 'CR' ? 'cr' : ''}">${t.dir === 'CR' ? '+' : '−'}${fmt(t.amount)}</div></div>`;
    }
    list.innerHTML = html;
    $$('.row', list).forEach((r) => r.addEventListener('click', () => openEdit(r.dataset.id)));
  }

  // ------------------------------------------------------------ INSIGHTS
  function renderInsights() {
    const today = todayISO();
    const [start, end] = periodRange(state.insightPeriod, today);
    const spend = Metrics.inRange(spendTxs(), start, end);
    const fixed = Metrics.inRange(fixedTxs(), start, end);
    const body = $('#insights-body');
    if (!spend.length && !fixed.length) { body.innerHTML = '<div class="card empty">No transactions in this period.</div>'; return; }
    const total = Metrics.sum(spend);
    const bars = (groups, valueFn, labelFn, subFn) => {
      const max = Math.max(...groups.map(valueFn), 1);
      return `<div class="bars">${groups.map((g) => `<div class="bar-row"><div class="name" title="${esc(labelFn(g))}">${esc(labelFn(g))}${subFn ? `<div class="fine">${esc(subFn(g))}</div>` : ''}</div><div class="track"><div class="fill" style="width:${Math.max(2, (valueFn(g) / max) * 100)}%"></div></div><div class="val">${esc(typeof valueFn(g) === 'number' && valueFn(g) > 1000 ? fmt(valueFn(g)) : String(valueFn(g)))}</div></div>`).join('')}</div>`;
    };
    const payeeName = (g) => (spend.concat(fixed).find((t) => (t.payeeNorm || t.payee) === g.key) || {}).payee || g.key;
    const top = Metrics.topPayees(spend, 8);
    const freq = Metrics.frequentPayees(spend, 8);
    const rec = Metrics.recurring(spend.concat(fixed), 3).slice(0, 10);
    const biggest = spend.slice().sort((a, b) => b.amount - a.amount).slice(0, 8);
    const wd = Metrics.weekdayPattern(spend, start < '2000' ? (spend[0] ? spend.map((t) => t.date).sort()[0] : today) : start, end > '3000' ? today : end);
    const buckets = Metrics.amountBuckets(spend);
    const untagged = Metrics.groupSum(spend.filter((t) => t.category === 'Untagged'), (t) => t.payeeNorm || t.payee).sort((a, b) => b.paise - a.paise).slice(0, 12);
    const ym = today.slice(0, 7), prev = Metrics.addMonths(ym, -1);
    const thisM = Metrics.sum(Metrics.inRange(spendTxs(), Metrics.monthStart(ym), today));
    const lastMsameDay = Metrics.sum(Metrics.inRange(spendTxs(), Metrics.monthStart(prev), prev + '-' + today.slice(8)));
    const lastMfull = Metrics.sum(Metrics.inRange(spendTxs(), Metrics.monthStart(prev), Metrics.monthEnd(prev)));
    const fixedByCat = groupTop(fixed, (t) => t.category, 8);

    body.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="label">Day-to-day spend</div><div class="value">${fmt(total)}</div><div class="sub">${spend.length} payments</div></div>
        <div class="tile"><div class="label">Fixed commitments</div><div class="value">${fmt(Metrics.sum(fixed))}</div><div class="sub">${fixed.length} payments</div></div>
        <div class="tile"><div class="label">Median payment</div><div class="value">${fmt(median(spend.map((t) => t.amount)))}</div><div class="sub">half your payments are smaller</div></div>
        <div class="tile"><div class="label">${monthLabel(ym)} vs ${monthLabel(prev)}</div><div class="value">${lastMsameDay ? (thisM >= lastMsameDay ? '+' : '−') + Math.round(Math.abs(thisM - lastMsameDay) / lastMsameDay * 100) + '%' : '—'}</div><div class="sub">same day last month: ${fmt(lastMsameDay)} · full month ${fmt(lastMfull)}</div></div>
      </div>
      ${untagged.length ? `<div class="card"><div class="card-head"><h2>Tag these payees</h2><span class="small muted">${untagged.length} untagged</span></div><p class="fine">PNB cuts names to 8 characters. Pick a category once; it applies to every past and future payment to that payee.</p><div class="list" id="untagged-list">${untagged.map((g) => `<div class="row" style="cursor:default"><div class="avatar" style="background:${cssVar('--s4')}">${esc(payeeName(g).charAt(0).toUpperCase())}</div><div class="who"><div class="name">${esc(payeeName(g))}</div><div class="meta">${g.count}× · ${fmt(g.paise)}</div></div><select data-payee="${esc(g.key)}" style="width:auto;max-width:46vw"><option value="">Choose…</option>${Parsers.CATEGORIES.filter((c) => !['Received', 'Refund', 'Income', 'Untagged'].includes(c)).map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>`).join('')}</div></div>` : ''}
      <div class="two">
        <div class="card"><div class="card-head"><h2>Top payees</h2><span class="small muted">by amount</span></div>${bars(top, (g) => g.paise, payeeName, (g) => `${g.count}×`)}</div>
        <div class="card"><div class="card-head"><h2>Most frequent</h2><span class="small muted">by count</span></div>${bars(freq, (g) => g.count, payeeName, (g) => `${fmt(g.paise)} total · avg ${fmt(g.paise / g.count)}`)}</div>
      </div>
      <div class="two">
        <div class="card"><div class="card-head"><h2>Recurring payments</h2><span class="small muted">same payee in 3+ months</span></div>${rec.length ? bars(rec, (g) => g.paise, payeeName, (g) => `${g.months} months · ${g.count}× · avg ${fmt(g.paise / g.count)}`) : '<div class="empty">Nothing recurring yet.</div>'}</div>
        <div class="card"><div class="card-head"><h2>Biggest payments</h2></div><div class="list">${biggest.map((t) => `<div class="row" data-id="${esc(t.id)}"><div class="avatar" style="background:${colorFor(CATEGORY_SLOT, t.category)}">${esc((t.payee || '?').charAt(0).toUpperCase())}</div><div class="who"><div class="name">${esc(t.payee)}</div><div class="meta">${esc(dateLabel(t.date))} · ${esc(t.category)}</div></div><div class="amt">${fmt(t.amount)}</div></div>`).join('')}</div></div>
      </div>
      <div class="two">
        <div class="card"><div class="card-head"><h2>Weekday pattern</h2><span class="small muted">average per day</span></div>${bars(wd, (g) => Math.round(g.avg), (g) => g.weekday)}</div>
        <div class="card"><div class="card-head"><h2>Payment sizes</h2><span class="small muted">count · total</span></div>${bars(buckets, (g) => g.count, (g) => g.label, (g) => fmt(g.paise))}</div>
      </div>
      ${fixed.length ? `<div class="card"><div class="card-head"><h2>Fixed commitments</h2><span class="small muted">excluded from alerts</span></div>${bars(fixedByCat, (g) => g.paise, (g) => g.key, (g) => `${g.count}×`)}</div>` : ''}
    `;
    $$('#untagged-list select', body).forEach((sel) => sel.addEventListener('change', () => { if (sel.value) { applyCategory(sel.dataset.payee, sel.value); toast(`Tagged as ${sel.value}`); render(); } }));
    $$('.row[data-id]', body).forEach((r) => r.addEventListener('click', () => openEdit(r.dataset.id)));
  }
  function median(arr) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  function applyCategory(payeeNorm, category) {
    state.meta.payeeCategoryMap[payeeNorm] = category;
    for (const t of state.txns) if ((t.payeeNorm || Parsers.payeeNorm(t.payee)) === payeeNorm) { t.category = category; t.categorySource = 'user'; }
    save();
  }

  // ------------------------------------------------------------ EDIT / ADD dialogs
  function fillCategorySelect(sel, current) {
    sel.innerHTML = Parsers.CATEGORIES.map((c) => `<option ${c === current ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }
  function openEdit(id) {
    const t = state.txns.find((x) => x.id === id);
    if (!t) return;
    const dlg = $('#dlg-edit');
    $('#edit-title').textContent = t.payee;
    $('#edit-kv').innerHTML = [['Amount', (t.dir === 'CR' ? '+' : '−') + fmt(t.amount)], ['Date', dateLabel(t.date) + (t.time ? ' ' + t.time : '')], ['Channel', t.channel || '—'], ['UPI ID', t.vpa || '—'], ['Ref', t.upiRef || t.txnId || '—'], ['Narration', t.narration || '—']].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    fillCategorySelect($('#edit-cat'), t.category);
    $('#edit-apply-all').checked = t.source !== 'manual';
    $('#edit-exclude').checked = !!t.excluded;
    $('#edit-note').value = t.note || '';
    dlg.returnValue = '';
    dlg.showModal();
    const form = $('form', dlg);
    form.onsubmit = () => {
      const cat = $('#edit-cat').value;
      if ($('#edit-apply-all').checked && t.payeeNorm) applyCategory(t.payeeNorm, cat);
      else { t.category = cat; t.categorySource = 'user'; }
      t.excluded = $('#edit-exclude').checked;
      t.note = $('#edit-note').value.trim();
      save(); render();
    };
    $('#edit-cancel').onclick = () => dlg.close();
    $('#edit-delete').onclick = () => {
      if (!confirm('Delete this transaction? Re-importing the statement will bring it back.')) return;
      state.txns = state.txns.filter((x) => x.id !== id);
      save(); dlg.close(); render(); toast('Deleted');
    };
  }

  function openAdd() {
    const dlg = $('#dlg-add');
    $('#add-date').value = todayISO();
    $('#add-amount').value = '';
    $('#add-payee').value = '';
    $('#add-note').value = '';
    $('#add-warn').hidden = true;
    fillCategorySelect($('#add-cat'), 'Food & Dining');
    dlg.showModal();
    setTimeout(() => $('#add-amount').focus(), 50);
    const form = $('form', dlg);
    const check = () => {
      const amt = Math.round(parseFloat($('#add-amount').value || '0') * 100);
      const d = $('#add-date').value;
      const dup = state.txns.find((t) => t.date === d && t.amount === amt && t.dir === 'DR');
      $('#add-warn').hidden = !dup;
      if (dup) $('#add-warn').textContent = `You already have ${fmt(amt)} to ${dup.payee} on this day. Adding anyway will count it twice.`;
    };
    $('#add-amount').oninput = check; $('#add-date').onchange = check;
    form.onsubmit = () => {
      const amount = Math.round(parseFloat($('#add-amount').value) * 100);
      if (!(amount > 0)) return;
      const payee = $('#add-payee').value.trim();
      const tx = {
        id: uid(), date: $('#add-date').value, time: null, amount, dir: 'DR', type: 'MANUAL', upiRef: null, vpa: null, payee, payeeNorm: Parsers.payeeNorm(payee),
        bankCode: null, remark: '', narration: 'Added manually', balanceAfter: null, txnId: null, source: 'manual', excluded: false, note: $('#add-note').value.trim(),
        channel: 'Manual', category: $('#add-cat').value, categorySource: 'user', importId: null, seq: 0,
      };
      state.txns.push(tx); save(); render(); toast('Added ' + fmt(amount));
    };
    $('#add-cancel').onclick = () => dlg.close();
  }

  // ------------------------------------------------------------ IMPORT
  function askPassword(errorMsg) {
    return new Promise((resolve) => {
      const dlg = $('#dlg-password');
      const err = $('#pw-error');
      err.hidden = !errorMsg; err.textContent = errorMsg || '';
      $('#pw-input').value = '';
      $('#pw-remember').checked = !!settings().statementPassword;
      // Resolve only once the dialog has fully closed, so a retry can reopen it safely.
      let answer = null;
      $('form', dlg).onsubmit = () => { answer = { password: $('#pw-input').value, remember: $('#pw-remember').checked }; };
      $('#pw-cancel').onclick = () => { answer = null; dlg.close(); };
      dlg.addEventListener('close', () => resolve(answer), { once: true });
      dlg.showModal();
      setTimeout(() => $('#pw-input').focus(), 50);
    });
  }

  async function handleFile(file) {
    const status = $('#import-status');
    const preview = $('#import-preview');
    preview.innerHTML = '';
    status.innerHTML = `<div class="notice">Reading <b>${esc(file.name)}</b>…</div>`;
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      if (OfficeCrypto.isEncrypted(bytes)) {
        let pw = settings().statementPassword ? { password: settings().statementPassword, remember: true } : null;
        let errorMsg = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          if (!pw) pw = await askPassword(errorMsg);
          if (!pw) { status.innerHTML = '<div class="notice">Import cancelled.</div>'; return; }
          status.innerHTML = '<div class="notice">Decrypting on this device…</div>';
          try {
            bytes = await OfficeCrypto.decrypt(bytes, pw.password);
            settings().statementPassword = pw.remember ? pw.password : null; save();
            break;
          } catch (e) {
            if (e.code === 'WRONG_PASSWORD') { errorMsg = 'That password did not open the file. Try your full account number.'; pw = null; settings().statementPassword = null; continue; }
            throw e;
          }
        }
        if (OfficeCrypto.isEncrypted(bytes)) { status.innerHTML = '<div class="notice bad">Could not decrypt the file.</div>'; return; }
      }
      const XLSX = await window.__xlsxReady;
      if (!XLSX) throw new Error('The spreadsheet library could not be loaded. Check your connection and reload.');
      const wb = XLSX.read(bytes, { type: 'array', raw: true, cellDates: false });
      let best = null;
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        const det = Parsers.detectHeader(aoa);
        const rank = (det.confidence === 'high' ? 2 : det.confidence === 'medium' ? 1 : 0) * 1000 + Object.keys(det.mapping).length;
        if (!best || rank > best.rank) best = { name, aoa, det, rank };
      }
      const sig = (best.det.headerRow >= 0 ? best.aoa[best.det.headerRow] : []).map(Parsers.norm).join('|');
      const remembered = state.meta.headerMappings[sig];
      state.pending = { fileName: file.name, aoa: best.aoa, sheet: best.name, headerRow: best.det.headerRow, mapping: remembered || best.det.mapping, auto: best.det, sig, showMapping: best.det.confidence !== 'high' && !remembered };
      status.innerHTML = '';
      renderPreview();
    } catch (e) {
      console.error(e);
      status.innerHTML = `<div class="notice bad">Could not read this file: ${esc(e.message || e)}</div>`;
    }
  }

  function renderPreview() {
    const p = state.pending;
    const box = $('#import-preview');
    if (!p) { box.innerHTML = ''; return; }
    const res = Parsers.parseStatement(p.aoa, { mapping: p.mapping, headerRow: p.headerRow, payeeMap: state.meta.payeeCategoryMap, settings: settings() });
    const merged = Parsers.mergeImport(state.txns.map((t) => Object.assign({}, t)), res.transactions);
    p.result = res; p.merged = merged;
    const m = res.meta;
    const header = p.headerRow >= 0 ? p.aoa[p.headerRow] : [];
    const colName = (i) => (header[i] !== '' && header[i] != null ? String(header[i]) : `Column ${i + 1}`);
    const roles = [['date', 'Date'], ['narration', 'Description'], ['debit', 'Debit'], ['credit', 'Credit'], ['amount', 'Amount (single column)'], ['drcr', 'Dr/Cr flag'], ['balance', 'Balance'], ['txnid', 'Txn No.'], ['ref', 'Cheque / Ref No.']];
    const ncols = Math.max(...p.aoa.slice(0, 60).map((r) => r.length), 0);
    const spendNew = merged.added.filter((t) => t.dir === 'DR').reduce((a, t) => a + t.amount, 0);
    const conf = { high: 'Columns recognised automatically', medium: 'Columns partly recognised — check the mapping', manual: 'Using your column mapping', none: 'Could not find the table — map the columns below' }[p.auto.confidence === 'none' && !p.mapping.date ? 'none' : (p.mapping === p.auto.mapping ? p.auto.confidence : 'manual')];
    box.innerHTML = `
      <div class="card stack">
        <div class="card-head"><h2>${esc(p.fileName)}</h2><span class="small muted">${esc(p.sheet)}</span></div>
        <div class="kv">
          <dt>Recognised</dt><dd>${esc(conf)} <button class="btn ghost small" id="toggle-mapping">${p.showMapping ? 'Hide columns' : 'Fix columns'}</button></dd>
          ${m.ownName ? `<dt>Account holder</dt><dd>${esc(m.ownName)}${m.accountMasked ? ' · ' + esc(m.accountMasked) : ''}</dd>` : ''}
          <dt>Statement period</dt><dd>${m.periodStart ? `${dateLabel(m.periodStart)} → ${dateLabel(m.periodEnd)}` : '—'}</dd>
          <dt>Rows found</dt><dd>${m.rows}${m.skipped ? ` · ${m.skipped} skipped` : ''}${m.firstTxDate ? ` · ${dateLabel(m.firstTxDate)} → ${dateLabel(m.lastTxDate)}` : ''}</dd>
          <dt>New</dt><dd>${merged.added.length} transactions (${fmt(spendNew)} debits) · ${merged.dupes} already imported</dd>
        </div>
        ${m.capHit ? `<div class="notice warn"><b>PNB One's 500-row limit was hit.</b> This file claims to start ${m.periodStart ? dateLabel(m.periodStart) : 'earlier'} but the oldest row is ${dateLabel(m.firstTxDate)}. Download another statement ending ${dateLabel(m.firstTxDate)} to fill the gap.</div>` : ''}
        ${m.unparsed.length ? `<div class="notice">Skipped rows, e.g. <span class="mono small">${esc(m.unparsed[0])}</span></div>` : ''}
        <div class="mapping" id="mapping-ui" ${p.showMapping ? '' : 'hidden'}>
          <label class="field">Header row <input type="number" id="map-header" min="1" max="${p.aoa.length}" value="${p.headerRow + 1}"></label>
          ${roles.map(([k, label]) => `<label class="field">${esc(label)} <select data-role="${k}"><option value="">—</option>${Array.from({ length: ncols }, (_, i) => `<option value="${i}" ${p.mapping[k] === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('')}</select></label>`).join('')}
        </div>
        <div class="preview"><table><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Channel</th><th>Amount</th></tr></thead><tbody>
          ${res.transactions.slice(0, 8).map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.payee)}</td><td>${esc(t.category)}</td><td>${esc(t.channel)}</td><td class="mono">${t.dir === 'CR' ? '+' : '−'}${fmt(t.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No rows parsed</td></tr>'}
        </tbody></table></div>
        <div class="toolbar">
          <button class="btn primary" id="do-import" ${merged.added.length ? '' : 'disabled'}>Import ${merged.added.length} new</button>
          <button class="btn" id="cancel-import">Cancel</button>
        </div>
      </div>`;
    $('#toggle-mapping').onclick = () => { p.showMapping = !p.showMapping; renderPreview(); };
    $('#map-header').onchange = (e) => { p.headerRow = Math.max(0, (+e.target.value || 1) - 1); const det = Parsers.detectHeader([p.aoa[p.headerRow]].concat(p.aoa.slice(p.headerRow + 1, p.headerRow + 6))); p.mapping = det.mapping.date != null ? det.mapping : p.mapping; renderPreview(); };
    $$('#mapping-ui select').forEach((sel) => sel.onchange = () => { const map = Object.assign({}, p.mapping); if (sel.value === '') delete map[sel.dataset.role]; else map[sel.dataset.role] = +sel.value; p.mapping = map; renderPreview(); });
    $('#cancel-import').onclick = () => { state.pending = null; renderPreview(); $('#file-input').value = ''; };
    $('#do-import').onclick = commitImport;
  }

  function commitImport() {
    const p = state.pending;
    if (!p || !p.merged) return;
    const importId = uid();
    const m = p.result.meta;
    for (const t of p.merged.added) { t.id = uid(); t.importId = importId; state.txns.push(t); }
    // mergeImport also back-fills empty fields on existing rows; copy those over
    const byKey = new Map(state.txns.map((t) => [t.id, t]));
    state.meta.imports.push({ id: importId, fileName: p.fileName, importedAt: new Date().toISOString(), added: p.merged.added.length, dupes: p.merged.dupes, skipped: m.skipped, coverageStart: m.coverageStart, coverageEnd: m.coverageEnd, capHit: !!m.capHit, firstTxDate: m.firstTxDate, lastTxDate: m.lastTxDate, periodStart: m.periodStart, periodEnd: m.periodEnd });
    if (p.sig) state.meta.headerMappings[p.sig] = p.mapping;
    if (m.ownName && !settings().ownName) settings().ownName = m.ownName;
    state.txns.sort((a, b) => a.date.localeCompare(b.date));
    save();
    const added = p.merged.added.length;
    state.pending = null;
    $('#file-input').value = '';
    renderPreview();
    toast(`Imported ${added} new transaction${added === 1 ? '' : 's'}, ${p.merged.dupes} duplicates skipped`);
    if (m.capHit) setTimeout(() => toast(`Older rows are missing: download a statement ending ${dateLabel(m.firstTxDate)}`, { ms: 6000 }), 3800);
    setTab(added ? 'home' : 'import');
    maybeNotify();
    void byKey;
  }

  function renderImport() {
    const hist = $('#import-history');
    const imports = state.meta.imports.slice().reverse();
    $('#undo-import').hidden = !imports.length;
    hist.innerHTML = imports.length ? imports.map((im) => `<div class="check" style="display:block"><b>${esc(im.fileName)}</b><div class="muted">${new Date(im.importedAt).toLocaleString('en-IN')} · ${im.added} new, ${im.dupes} duplicates${im.skipped ? `, ${im.skipped} skipped` : ''}${im.firstTxDate ? ` · ${dateLabel(im.firstTxDate)} → ${dateLabel(im.lastTxDate)}` : ''}${im.capHit ? ' · <b>500-row cap hit</b>' : ''}</div></div>`).join('') : '<div class="muted">No statements imported yet.</div>';
    const cov = Metrics.coverage(state.meta.imports, state.txns);
    if (cov.start) {
      const yearAgo = Metrics.addDays(todayISO(), -365);
      hist.insertAdjacentHTML('afterbegin', `<div class="notice ${cov.start <= yearAgo ? 'good' : ''}" style="margin-bottom:10px">Coverage: <b>${dateLabel(cov.start)} → ${dateLabel(cov.end)}</b>.${cov.start > yearAgo ? ` For a full year, add statements back to ${dateLabel(yearAgo)}.` : ' You have a full year.'}</div>`);
    }
  }
  function undoImport() {
    const last = state.meta.imports[state.meta.imports.length - 1];
    if (!last) return;
    if (!confirm(`Remove the ${last.added} transactions imported from ${last.fileName}?`)) return;
    state.txns = state.txns.filter((t) => t.importId !== last.id);
    state.meta.imports.pop();
    save(); render(); toast('Import undone');
  }

  // ------------------------------------------------------------ SETTINGS
  function renderSettings() {
    const s = settings();
    $('#set-budget').value = s.budget ? Math.round(s.budget / 100) : '';
    $('#set-notify').checked = !!s.notifications;
    $('#set-ownname').value = s.ownName || '';
    $('#set-ownvpas').value = (s.ownVPAs || []).join(', ');
    const spendCats = Parsers.CATEGORIES.filter((c) => !['Received', 'Refund', 'Income', 'Transfer (self)'].includes(c));
    $('#set-categories').innerHTML = spendCats.map((c) => `<label class="check"><input type="checkbox" data-cat="${esc(c)}" ${s.excludedCategories.includes(c) ? '' : 'checked'}> ${esc(c)}</label>`).join('') + `<label class="check"><input type="checkbox" data-type="AUTOPAY" ${s.excludedTypes.includes('AUTOPAY') ? '' : 'checked'}> Auto-debits (ACH / NACH mandates)</label>`;
    $$('#set-categories input[data-cat]').forEach((cb) => cb.onchange = () => { const set = new Set(s.excludedCategories); if (cb.checked) set.delete(cb.dataset.cat); else set.add(cb.dataset.cat); s.excludedCategories = [...set]; save(); });
    $$('#set-categories input[data-type]').forEach((cb) => cb.onchange = () => { const set = new Set(s.excludedTypes); if (cb.checked) set.delete(cb.dataset.type); else set.add(cb.dataset.type); s.excludedTypes = [...set]; save(); });
    const days = s.lastBackupAt ? Math.floor((Date.now() - new Date(s.lastBackupAt)) / 86400000) : null;
    $('#backup-note').textContent = state.txns.length ? (days == null ? 'No backup yet. Your data lives only in this browser — keep a copy in Drive.' : `Last backup ${days === 0 ? 'today' : days + ' days ago'}.${days > 30 ? ' Time for a fresh one.' : ''}`) : 'Nothing to back up yet.';
    $('#about-version').textContent = `Version ${APP_VERSION} · ${state.txns.length} transactions stored`;
  }
  function exportBackup() {
    const data = { app: 'upi-spend-tracker', version: 1, exportedAt: new Date().toISOString(), txns: state.txns, meta: Object.assign({}, state.meta, { settings: Object.assign({}, settings(), { statementPassword: null }) }) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `upi-spend-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    settings().lastBackupAt = new Date().toISOString(); save(); renderSettings();
  }
  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.txns) || !data.meta) throw new Error('not a backup file');
      if (!confirm(`Replace the ${state.txns.length} transactions on this device with the ${data.txns.length} in the backup?`)) return;
      state.txns = data.txns; state.meta = Object.assign(defaultMeta(), data.meta, { settings: Object.assign(defaultMeta().settings, data.meta.settings || {}) });
      save(); render(); toast('Backup restored');
    } catch (e) { toast('Could not read that backup: ' + (e.message || e), { ms: 5000 }); }
  }

  // ------------------------------------------------------------ notifications & PWA
  function maybeNotify() {
    if (!settings().notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const s = Metrics.summarize(state.txns, settings(), state.meta.imports, todayISO());
    if (s.level !== 'danger') return;
    const key = 'et:notified:' + todayISO();
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
    try { new Notification('Overspending today', { body: s.reason, icon: 'icons/icon-192.png' }); } catch (e) { /* ignore */ }
  }
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update available', { action: 'Reload', onAction: () => location.reload(), sticky: true }); });
      });
    }).catch((e) => console.warn('SW registration failed', e));
  }

  // ------------------------------------------------------------ render & wire
  function render() {
    ({ home: renderHome, history: renderHistory, insights: renderInsights, import: renderImport, settings: renderSettings }[state.tab] || renderHome)();
  }

  function wire() {
    $$('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#quick-add').addEventListener('click', openAdd);
    $('#month-prev').addEventListener('click', () => { state.month = Metrics.addMonths(state.month, -1); renderHistory(); });
    $('#month-next').addEventListener('click', () => { state.month = Metrics.addMonths(state.month, 1); renderHistory(); });
    $('#filter-search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderHistory(); });
    $('#filter-cat').addEventListener('change', (e) => { state.filters.cat = e.target.value; renderHistory(); });
    $('#filter-kind').addEventListener('change', (e) => { state.filters.kind = e.target.value; renderHistory(); });
    $$('#insight-period button').forEach((b) => b.addEventListener('click', () => { state.insightPeriod = b.dataset.p; $$('#insight-period button').forEach((x) => x.classList.toggle('active', x === b)); renderInsights(); }));
    const drop = $('#drop');
    const fi = $('#file-input');
    fi.addEventListener('change', () => { if (fi.files[0]) handleFile(fi.files[0]); });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
    $('#undo-import').addEventListener('click', undoImport);
    $('#set-budget').addEventListener('change', (e) => { settings().budget = Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)); save(); toast(settings().budget ? 'Budget saved' : 'Budget cleared'); });
    $('#set-notify').addEventListener('change', async (e) => {
      if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { e.target.checked = false; toast('Notifications were not allowed by the browser'); }
      }
      settings().notifications = e.target.checked; save();
    });
    $('#set-ownname').addEventListener('change', (e) => { settings().ownName = e.target.value.trim(); save(); });
    $('#set-ownvpas').addEventListener('change', (e) => { settings().ownVPAs = e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); save(); });
    $('#backup-export').addEventListener('click', exportBackup);
    $('#backup-import').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
    $('#clear-data').addEventListener('click', () => {
      if (!confirm('Delete every transaction and setting stored in this browser? Download a backup first if you want to keep them.')) return;
      state.txns = []; state.meta = defaultMeta(); save(); render(); toast('All data cleared');
    });
    window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== state.tab && $(`#tab-${t}`)) setTab(t); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.tab === 'home') renderHome(); });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

  load();
  wire();
  const initial = location.hash.slice(1);
  setTab(initial && $(`#tab-${initial}`) ? initial : (state.txns.length ? 'home' : 'import'));
  maybeNotify();
  registerSW();
  window.__app = { state, render, save, load, todayISO };
})();
