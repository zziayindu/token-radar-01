/* Token Radar dashboard logic. No network: every byte it shows comes from window.RADAR. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'No radar data was loaded.'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var moneyFull = function (n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var pct = function (n) {
    if (n == null) return '—';
    var v = (Math.round(n * 100) / 100).toFixed(2) + '%';
    return (n > 0 ? '+' : '') + v;
  };
  var pctCls = function (n) { return n == null ? '' : (n > 0 ? 'up' : (n < 0 ? 'down' : '')); };
  var age = function (d) { return d == null ? '—' : d + 'd'; };

  /* ---- header stats ---- */
  var wl = D.rows.filter(function (r) { return r.watchlist; }).length;
  $('stats').innerHTML =
    '<div><dt>Board</dt><dd>' + D.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + wl + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + D.early_size + '</dd></div>' +
    '<div><dt>Live market</dt><dd>' + D.live_size + '</dd></div>';
  $('asof').textContent = 'Snapshot as of ' + D.as_of + ' · watchlist floor ' + money(D.floor_usd) +
    ' · model ' + D.model_version + ' · all figures from the snapshot, nothing fetched live.';

  /* ---- tabs ---- */
  var tabs = document.querySelectorAll('.tab');
  var views = { board: $('view-board'), live: $('view-live'), method: $('view-method'), detail: $('view-detail') };
  function show(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-view') === name || (name === 'detail' && t.getAttribute('data-view') === 'board');
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    Object.keys(views).forEach(function (k) { views[k].classList.toggle('on', k === name); });
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { location.hash = '#/' + t.getAttribute('data-view'); });
  });

  /* ---- board: filter, search, sort ---- */
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  var sortKey = 'rank', sortDir = 1;
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    category: function (a, b) { return (a.category || '') < (b.category || '') ? -1 : 1; },
    chains: function (a, b) { return (a.chains[0] || '') < (b.chains[0] || '') ? -1 : 1; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); }
  };
  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var onlyWl = $('wl').checked;
    var rows = D.rows.filter(function (r) {
      if (onlyWl && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) { return SORTS[sortKey](a, b) * sortDir; });
    return rows;
  }
  function renderBoard() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + age(r.age_days) + '</td></tr>';
    }).join('');
  }
  ['q', 'cat', 'wl', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (id === 'sort') { sortKey = $('sort').value; sortDir = 1; }
      renderBoard();
    });
  });
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      $('sort').value = k in SORTS ? k : 'rank';
      renderBoard();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/p/' + tr.getAttribute('data-slug');
  });

  /* ---- detail view ---- */
  function renderDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var box = $('detail');
    if (!r) {
      box.innerHTML = '<div class="detail-card"><h2>Not on the board</h2><p>No ranked protocol has that slug.</p></div>';
      show('detail');
      return;
    }
    var m = D.model;
    box.innerHTML =
      '<button type="button" class="back" id="back">&larr; Back to the board</button>' +
      '<div class="detail-card">' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · tracked since ' + (r.listed_at || 'unknown') + ' · TVL ' + moneyFull(r.tvl_usd) +
      ' · 7-day change ' + pct(r.change_7d) + '</p>' +
      '<dl class="model-grid">' +
      '<div class="cell"><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '<small>rank ' + r.rank + ' of ' + D.rows.length + '</small></dd></div>' +
      '<div class="cell"><dt>Peer multiple</dt><dd>' + r.peer_multiple.toFixed(2) + '×<small>median mcap / TVL of live-token peers in ' + esc(r.category || 'all categories') + '</small></dd></div>' +
      '<div class="cell"><dt>Growth</dt><dd>×' + r.growth_multiplier.toFixed(2) + '<small>7-day change ' + pct(r.change_7d) + ', weight ' + m.growth_weight + '</small></dd></div>' +
      '<div class="cell"><dt>Age</dt><dd>×' + r.age_multiplier.toFixed(2) + '<small>' + age(r.age_days) + ' tracked; older without a token counts for more</small></dd></div>' +
      '<div class="cell"><dt>Breadth</dt><dd>×' + r.breadth_multiplier.toFixed(2) + '<small>' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</small></dd></div>' +
      '</dl>' +
      '<p class="formula">implied = TVL × peer multiple × growth × age × breadth<br>' +
      moneyFull(r.tvl_usd) + ' × ' + r.peer_multiple.toFixed(2) + ' × ' + r.growth_multiplier.toFixed(2) +
      ' × ' + r.age_multiplier.toFixed(2) + ' × ' + r.breadth_multiplier.toFixed(2) +
      ' = ' + moneyFull(r.implied_value_usd) + '</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="warn"><strong>Honest labelling:</strong> this protocol <em>records</em> no token in the snapshot. ' +
      'That is not proof it has none — a token may exist that the record does not carry. ' +
      'The implied value is the model’s claim, not a promise: a launch may be worth more, less, or nothing.</p>' +
      '</div>';
    $('back').addEventListener('click', function () { location.hash = '#/board'; });
    show('detail');
  }

  /* ---- live market ---- */
  $('live-rows').innerHTML = D.live.map(function (p) {
    var ratio = (p.mcap_usd != null && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td class="name">' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc(p.chains.slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + ratio + '</td>' +
      '<td class="num ' + pctCls(p.change_7d) + '">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  /* ---- method ---- */
  var m = D.model;
  $('method').innerHTML =
    '<p>The board ranks <strong>' + D.board_size + ' pre-token protocols</strong>: all ' + D.watchlist_size +
    ' on the snapshot’s watchlist, plus the ' + D.early_size + ' highest-valued rankable protocols below the watchlist floor. ' +
    'A protocol is rankable when its record carries no token and it is not a wrapped, staked or bridged product, not an exchange, and not a versioned pool.</p>' +
    '<h3>The formula</h3>' +
    '<p class="formula">implied = TVL × peer multiple × growth × age × breadth</p>' +
    '<table><thead><tr><th>Factor</th><th>How it is built</th><th>Constants</th></tr></thead><tbody>' +
    '<tr><td>Peer multiple</td><td>Median market-cap / TVL of the live-token protocols in the same category; the global median when a category has fewer than ' + m.min_peers + ' peers.</td><td>clamped ' + m.multiple_floor + ' – ' + m.multiple_cap + '</td></tr>' +
    '<tr><td>Growth</td><td>1 + clamped 7-day change × weight. No change recorded counts as 0.</td><td>clamp ' + m.growth_floor + '% – +' + m.growth_cap + '%, weight ' + m.growth_weight + '</td></tr>' +
    '<tr><td>Age</td><td>Older without a token counts for more, up to a cap; unknown age stays near neutral.</td><td>' + m.age_floor + ' + up to ' + m.age_range + ' over ' + m.age_days + ' days; unknown ' + m.unknown_age_factor + '</td></tr>' +
    '<tr><td>Breadth</td><td>One more chain adds a little reach.</td><td>+' + m.breadth_step + ' per extra chain, up to ' + m.breadth_max + '</td></tr>' +
    '</tbody></table>' +
    '<h3>What is kept apart</h3>' +
    '<ul><li><strong>Live market:</strong> protocols that already trade, at the market’s own market cap. Never mixed into the board.</li>' +
    '<li><strong>Wrapped, staked and bridged products</strong> are not launches: they wrap a token that already trades.</li>' +
    '<li><strong>“Records no token”</strong> is the honest phrase. The snapshot is a record, not proof.</li></ul>' +
    '<h3>Farm plans</h3>' +
    '<p>Every row carries 6 or 7 steps. Each step states its cost and its time, and each plan is built from that protocol’s own category, chains, TVL and age — never from a hand-kept list of names. Steps are a plan, not a promise of an airdrop.</p>';

  /* ---- routing ---- */
  function route() {
    var h = location.hash || '#/board';
    var parts = h.replace(/^#\//, '').split('/');
    if (parts[0] === 'p' && parts[1]) renderDetail(decodeURIComponent(parts[1]));
    else if (parts[0] === 'live') show('live');
    else if (parts[0] === 'method') show('method');
    else show('board');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  renderBoard();
  route();
})();
