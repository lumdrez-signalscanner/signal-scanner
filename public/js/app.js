/* SIGNAL//SCANNER front-end — plain JS, no build step. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('ss.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ss.' + k, JSON.stringify(v)); } catch {} },
};
async function api(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
function km(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v == null || isNaN(v))) return null;
  const R = 6371, toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtKm = d => d == null ? '' : d < 10 ? d.toFixed(1) + ' km' : Math.round(d).toLocaleString() + ' km';
const fmtFreq = khz => khz >= 1000 ? (khz / 1000).toFixed(khz % 1000 ? 3 : 1).replace(/\.?0+$/, '') + ' MHz' : khz + ' kHz';

const state = {
  cfg: null,
  loc: LS.get('loc', null),
  view: 'radio',
};

/* ===================== THEME ===================== */
const THEMES = {
  phosphor: { name: 'Phosphor', dark: true, vars: { '--bg': '#05090a', '--panel': '#0b1214', '--panel2': '#0f1a1c', '--line': '#1c2e2f', '--text': '#c8f7d4', '--muted': '#6f9a86', '--accent': '#39ff88', '--accent2': '#22d3ee', '--warn': '#ffcc33', '--danger': '#ff4d6d' } },
  ice:      { name: 'Ice / Cyan', dark: true, vars: { '--bg': '#050a10', '--panel': '#0a121b', '--panel2': '#0e1824', '--line': '#1a2a3a', '--text': '#d4ecff', '--muted': '#7590ab', '--accent': '#22e3ff', '--accent2': '#8c9eff', '--warn': '#ffd166', '--danger': '#ff5c7a' } },
  amber:    { name: 'Amber CRT', dark: true, vars: { '--bg': '#0b0803', '--panel': '#140f06', '--panel2': '#1b1409', '--line': '#33260f', '--text': '#ffe3b0', '--muted': '#a88a5a', '--accent': '#ffb000', '--accent2': '#ff7a3d', '--warn': '#ffe066', '--danger': '#ff4d4d' } },
  synth:    { name: 'Synthwave', dark: true, vars: { '--bg': '#0b0614', '--panel': '#140b22', '--panel2': '#1b102d', '--line': '#2e1c48', '--text': '#f0dcff', '--muted': '#9a83b8', '--accent': '#ff3ec8', '--accent2': '#38e8ff', '--warn': '#ffd23f', '--danger': '#ff4f6d' } },
  redline:  { name: 'Night-vision red', dark: true, vars: { '--bg': '#0a0405', '--panel': '#140809', '--panel2': '#1b0b0d', '--line': '#331517', '--text': '#ffd0d0', '--muted': '#a77474', '--accent': '#ff4040', '--accent2': '#ff9a6b', '--warn': '#ffcc66', '--danger': '#ff2a6d' } },
  daylight: { name: 'Daylight', dark: false, vars: { '--bg': '#eef3f1', '--panel': '#ffffff', '--panel2': '#f4f8f6', '--line': '#cfdcd6', '--text': '#0d1f17', '--muted': '#557265', '--accent': '#0a8f4f', '--accent2': '#0b7fa3', '--warn': '#a86b00', '--danger': '#c4203f' } },
};
const DEFAULT_THEME = { preset: 'phosphor', vars: THEMES.phosphor.vars, fx: { scanlines: true, grid: true, glow: true }, scale: 1, dark: true };
let theme = LS.get('theme', null) || structuredClone(DEFAULT_THEME);
const COLOR_FIELDS = [['--accent', 'accent'], ['--accent2', 'accent 2'], ['--bg', 'background'], ['--panel', 'panel'], ['--text', 'text'], ['--muted', 'muted text'], ['--line', 'borders'], ['--warn', 'warning']];

function applyTheme() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  for (const f of ['scanlines', 'grid', 'glow']) root.classList.toggle('fx-' + f, !!theme.fx[f]);
  root.style.fontSize = (16 * (theme.scale || 1)) + 'px';
  root.style.colorScheme = theme.dark === false ? 'light' : 'dark';
  $('meta[name=theme-color]').content = theme.vars['--bg'];
  LS.set('theme', theme);
  renderThemeUI();
  flights.updateTiles?.(); mapview.updateTiles?.();
}
function renderThemeUI() {
  $('#set-themes').innerHTML = Object.entries(THEMES).map(([id, t]) => `
    <button class="theme ${theme.preset === id ? 'on' : ''}" data-theme="${id}" style="background:${t.vars['--panel']};color:${t.vars['--text']};border-color:${t.vars['--line']}">
      ${esc(t.name)}<div class="swatches">${['--bg', '--accent', '--accent2', '--text'].map(k => `<i style="background:${t.vars[k]}"></i>`).join('')}</div></button>`).join('')
    + `<button class="theme ${theme.preset === 'custom' ? 'on' : ''}" disabled style="background:var(--panel2);color:var(--muted)">Custom<div class="swatches"><i style="background:var(--accent)"></i><i style="background:var(--accent2)"></i></div></button>`;
  $('#set-colors').innerHTML = COLOR_FIELDS.map(([k, label]) => `<label class="color"><input type="color" data-var="${k}" value="${theme.vars[k]}">${label}</label>`).join('');
  $('#fx-scanlines').checked = !!theme.fx.scanlines; $('#fx-grid').checked = !!theme.fx.grid; $('#fx-glow').checked = !!theme.fx.glow;
  $('#set-scale').value = theme.scale || 1;
}
function initSettings() {
  $('#set-themes').addEventListener('click', e => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    const t = THEMES[b.dataset.theme];
    theme = { ...theme, preset: b.dataset.theme, vars: { ...t.vars }, dark: t.dark };
    applyTheme();
  });
  $('#set-colors').addEventListener('input', e => {
    const v = e.target.dataset.var; if (!v) return;
    theme.vars = { ...theme.vars, [v]: e.target.value }; theme.preset = 'custom';
    document.documentElement.style.setProperty(v, e.target.value);
    LS.set('theme', theme);
  });
  $('#set-colors').addEventListener('change', () => applyTheme());
  for (const f of ['scanlines', 'grid', 'glow']) $('#fx-' + f).addEventListener('change', e => { theme.fx[f] = e.target.checked; applyTheme(); });
  $('#set-scale').addEventListener('input', e => { theme.scale = parseFloat(e.target.value); applyTheme(); });
  $('#set-reset').addEventListener('click', () => { theme = structuredClone(DEFAULT_THEME); applyTheme(); });

  const fill = () => { $('#set-label').value = state.loc.label || ''; $('#set-lat').value = state.loc.lat; $('#set-lon').value = state.loc.lon; };
  fill();
  $('#set-save-loc').addEventListener('click', () => {
    const lat = parseFloat($('#set-lat').value), lon = parseFloat($('#set-lon').value);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return ($('#set-loc-msg').textContent = 'Invalid coordinates.');
    setLoc({ lat, lon, label: $('#set-label').value.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
    $('#set-loc-msg').textContent = 'Saved.';
  });
  $('#set-geo').addEventListener('click', () => geolocate(l => { setLoc(l); fill(); $('#set-loc-msg').textContent = 'Using device location.'; }, msg => ($('#set-loc-msg').textContent = msg)));
}
function geolocate(ok, fail) {
  if (!navigator.geolocation) return fail('Geolocation not available in this browser.');
  if (!window.isSecureContext) return fail('Browsers only share location over https or on localhost. On the iPhone, type coordinates instead (PEI ≈ 46.24, -63.13).');
  navigator.geolocation.getCurrentPosition(p => ok({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), label: 'My location' }), e => fail('Location error: ' + e.message), { timeout: 10000 });
}
function setLoc(l) {
  state.loc = l; LS.set('loc', l);
  $('#st-loc').textContent = '⊕ ' + l.label;
  radio.render(); flights.syncInputs(); flights.refresh(true); mapview.relocate();
}

/* ===================== ROUTER / CHROME ===================== */
const VIEWS = ['radio', 'map', 'flights', 'cams', 'learn', 'local', 'settings'];
function route() {
  let v = location.hash.replace('#', '') || 'radio';
  if (v === 'legal') { v = 'settings'; setTimeout(() => $('#legal').scrollIntoView({ behavior: 'smooth' }), 50); }
  if (!VIEWS.includes(v)) v = 'radio';
  state.view = v;
  VIEWS.forEach(id => ($('#view-' + id).hidden = id !== v));
  $$('#nav > a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
  if (v === 'flights') flights.show(); else flights.hide();
  if (v === 'map') mapview.show(); else mapview.hide();
  if (v === 'cams') cams.show();
  if (v === 'learn') learn.show();
  if (v !== 'legal') window.scrollTo(0, 0);
}
function clock() { const d = new Date(); $('#st-clock').textContent = d.toISOString().slice(11, 19) + ' UTC'; }
async function heartbeat() {
  try { await api('/api/health'); $('#st-net').className = 'pill ok'; $('#st-net').textContent = '● LINK'; }
  catch { $('#st-net').className = 'pill bad'; $('#st-net').textContent = '● OFFLINE'; }
}

/* ===================== RADIO ===================== */
const radio = (() => {
  let presets = { groups: [], categories: [], audioStreams: [] };
  let all = [], info = null, counts = {};
  let cat = LS.get('rxCat', 'all'), net = 'all', preset = null, limit = 40, sort = LS.get('rxSort', 'near');
  let scanRes = {}, scanOn = false, mon = null; // mic monitor + per-receiver scan state (keyed by rx.url)
  const MODE = {
    kiwisdr: { fm: 'nbfm', wfm: 'nbfm' }, websdr: { wfm: 'fm' }, ubersdr: { wfm: 'fm' }, novasdr: { wfm: 'fm' }, openwebrx: { fm: 'nfm' },
  };
  const NETS = { kiwisdr: 'KiwiSDR', websdr: 'WebSDR', openwebrx: 'OpenWebRX' };
  // true = band list says yes, false = band list says no, null = receiver didn't publish its coverage
  function covers(rx, khz) { if (!rx.bands) return null; const hz = khz * 1000; return rx.bands.some(([a, b]) => hz >= a && hz <= b); }
  function overlaps(rx, ranges) { if (!rx.bands) return null; return rx.bands.some(([a, b]) => ranges.some(([lo, hi]) => a <= hi * 1000 && b >= lo * 1000)); }
  const tagHit = (rx, c) => (c.tags || []).some(t => (rx.tags || []).includes(t));
  // match result: 2 = confirmed coverage, 1 = likely (unknown band list but keywords match), 0 = no
  function match(rx, c, p) {
    if (!c) return 2;
    const v = p ? covers(rx, p.khz) : overlaps(rx, c.ranges || []);
    if (v === true) return 2;
    if (v === null && tagHit(rx, c)) return 1;
    return 0;
  }
  function tuneUrl(rx, p) {
    const base = rx.url;
    if (!p) return base;
    const m = (MODE[rx.kind] || {})[p.mode] || p.mode, hz = Math.round(p.khz * 1000);
    switch (rx.kind) {
      case 'kiwisdr': return base.replace(/\/$/, '') + `/?f=${p.khz}${m}`;
      case 'ubersdr': return base + `?freq=${hz}&mode=${m}`;
      case 'novasdr': return base + `?frequency=${hz}&modulation=${m.toUpperCase()}`;
      case 'openwebrx': return base + `#freq=${hz},mod=${m}`;
      default: return base + `?tune=${p.khz}${m}`;
    }
  }
  const curCat = () => presets.categories.find(x => x.id === cat);
  function filtered() {
    const c = curCat();
    let list = net === 'all' ? all : all.filter(rx => rx.network === net);
    list = list.map(rx => ({ rx, m: match(rx, c, preset) })).filter(x => x.m > 0);
    if ($('#rx-confirmed').checked) list = list.filter(x => x.m === 2);
    const q = $('#rx-search').value.trim().toLowerCase();
    if (q) list = list.filter(({ rx }) => (rx.name + ' ' + rx.loc + ' ' + rx.antenna + ' ' + rx.hw + ' ' + (rx.tags || []).join(' ')).toLowerCase().includes(q));
    if ($('#rx-free').checked) list = list.filter(({ rx }) => rx.users == null || rx.usersMax == null || rx.users < rx.usersMax);
    const L = state.loc;
    list = list.map(({ rx, m }) => ({ ...rx, m, d: km(L.lat, L.lon, rx.lat, rx.lon) }));
    const span = rx => (rx.bands || []).reduce((s, [a, b]) => s + (b - a), 0);
    const free = rx => rx.usersMax != null ? rx.usersMax - (rx.users || 0) : -1;
    const by = {
      near: (a, b) => (a.d ?? 1e9) - (b.d ?? 1e9),
      name: (a, b) => a.name.localeCompare(b.name),
      free: (a, b) => free(b) - free(a) || (a.d ?? 1e9) - (b.d ?? 1e9),
      wide: (a, b) => span(b) - span(a) || (a.d ?? 1e9) - (b.d ?? 1e9),
      net: (a, b) => a.network.localeCompare(b.network) || (a.d ?? 1e9) - (b.d ?? 1e9),
    }[sort] || ((a, b) => 0);
    if ($('#scan-active-only') && $('#scan-active-only').checked)
      list = list.filter(x => scanRes[x.url] && scanRes[x.url].active);
    const rank = rx => { const r = scanRes[rx.url]; return r && r.active ? (r.level || 1) : 0; };
    const seen = rx => { const r = scanRes[rx.url]; return r ? r.ts : 0; };
    if ($('#scan-sort') && $('#scan-sort').value === 'recent')
      return list.sort((a, b) => (b.m - a.m) || (seen(b) - seen(a)) || by(a, b));
    // confirmed coverage first, then talking-now (after a scan), then the chosen sort
    return list.sort((a, b) => (b.m - a.m) || (rank(b) - rank(a)) || by(a, b));
  }
  function computeCounts() {
    counts = { all: all.length };
    for (const c of presets.categories) counts[c.id] = all.reduce((n, rx) => n + (match(rx, c, null) > 0), 0);
  }
  function renderCats() {
    const chip = c => `<button class="chip ${cat === c.id ? 'on' : ''}" data-cat="${c.id}" title="${esc(c.plain || c.label)}">${c.icon} ${esc(c.label)}${counts[c.id] != null ? `<span class="n">${counts[c.id]}</span>` : ''}</button>`;
    $('#rx-cats').innerHTML = `<div class="cat-group"><span class="cat-label">all</span><button class="chip ${cat === 'all' ? 'on' : ''}" data-cat="all">◇ Everything<span class="n">${counts.all ?? '…'}</span></button></div>` +
      presets.groups.map(g => `<div class="cat-group"><span class="cat-label">${esc(g.label)}</span>${presets.categories.filter(c => c.group === g.id).map(chip).join('')}</div>`).join('');
    const c = curCat();
    if (!c) { $('#rx-presets').innerHTML = `<div class="blurb">Every public receiver we know about. Pick a category above to see what to listen for and jump straight to the right frequency — or type one in:</div>${manualHtml()}`; return; }
    $('#rx-presets').innerHTML = `<div class="blurb">${esc(c.blurb)}</div>` +
      (c.plain ? `<div class="plain">🔰 <b>In plain words:</b> ${esc(c.plain)}</div>` : '') +
      (c.legal ? `<div class="legal-note">⚖ ${esc(c.legal)}</div>` : '') +
      (c.view ? `<a class="btn sm" href="#${c.view}">open live ${esc(c.view)} view →</a> ` : '') +
      (c.presets.length ? `<div class="mono small muted" style="margin:8px 0 6px">tap a frequency to tune every receiver to it:</div><div class="preset-row">` +
        c.presets.map((p, i) => `<button class="preset ${preset === p ? 'on' : ''}" data-i="${i}" title="${esc(p.plain || p.name)}"><b>${fmtFreq(p.khz)}</b> ${p.mode.toUpperCase()} · ${esc(p.name)}</button>`).join('') + '</div>' : '') +
      (preset && preset.plain ? `<div class="plain preset-plain">🔰 ${esc(preset.plain)}</div>` : '') +
      manualHtml() +
      (c.links?.length ? `<div class="ref-links">${c.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.note)}">${esc(l.name)} ↗</a>`).join('')}</div>` : '');
  }
  function manualHtml() {
    const custom = preset && preset.custom ? preset : null;
    return `<form class="manual" id="rx-manual"><span class="mono small muted">manual&nbsp;tune</span>
      <input class="input num" id="rx-mf" inputmode="decimal" placeholder="kHz" value="${custom ? custom.khz : ''}">
      <select class="input" id="rx-mm">${['am', 'usb', 'lsb', 'cw', 'fm', 'wfm'].map(m => `<option ${custom?.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <button class="btn sm">set</button>${custom ? '<button type="button" class="btn sm ghost" id="rx-mclear">clear</button>' : ''}</form>`;
  }
  function render() {
    if (!state.loc) return;
    const list = filtered();
    const unk = list.filter(r => r.m === 1).length;
    $('#rx-meta').textContent = all.length ? `${list.length} receivers${preset ? ` that can tune ${fmtFreq(preset.khz)}` : ''}${unk ? ` (${unk} likely — they don't publish exact coverage)` : ''} · ${info.total} public receivers from ${info.sources.length} directories` : 'loading receiver directories…';
    $('#rx-list').innerHTML = list.slice(0, limit).map((rx, i) => {
      const full = rx.users != null && rx.usersMax != null && rx.users >= rx.usersMax;
      const cover = rx.bands ? rx.bands.slice(0, 2).map(([a, b]) => `${fmtFreq(a / 1000)}–${fmtFreq(b / 1000)}`).join(', ') + (rx.bands.length > 2 ? ` +${rx.bands.length - 2}` : '') : 'coverage not published';
      return `<div class="rx" data-i="${i}">
        <div class="rx-name" title="${esc(rx.name)}">${esc(rx.name)}</div>
        <div class="rx-sub">${scanRes[rx.url] ? (scanRes[rx.url].active ? '<span class="tag talk" title="heard activity in the last scan">🔊 talking</span>' : '<span class="tag quiet" title="sounded quiet in the last scan">· quiet</span>') : ''}<span class="tag">${NETS[rx.network] || rx.kind}</span>${rx.m === 1 ? '<span class="tag maybe" title="This receiver does not publish its band list; its description suggests it covers this">likely</span>' : ''}${rx.d != null ? `<span>⊕ ${fmtKm(rx.d)}</span>` : ''}
          ${rx.usersMax != null ? `<span class="tag ${full ? 'full' : 'free'}">${rx.users}/${rx.usersMax} users</span>` : ''}
          <span>${esc(cover)}</span>${rx.antenna ? `<span title="antenna">⌇ ${esc(rx.antenna.slice(0, 60))}</span>` : ''}</div>
        <div class="rx-actions"><button class="btn sm" data-act="tune">▶ ${preset ? 'tune' : 'open'}</button><a class="btn sm ghost" href="${esc(tuneUrl(rx, preset))}" target="_blank" rel="noopener" title="open in new tab">↗</a></div>
      </div>`;
    }).join('') || `<div class="empty">no receivers match — try another band, network, or untick “confirmed only”</div>`;
    $('#rx-more').hidden = list.length <= limit;
    render.list = list;
  }
  function open(url, title) {
    $('#rx-viewer').hidden = false; $('.split').classList.add('has-viewer');
    $('#rx-frame').src = url; $('#rx-vtitle').textContent = title; $('#rx-vopen').href = url;
    if (location.protocol === 'https:' && url.startsWith('http:')) $('#rx-vtitle').textContent += '  (http — may need ↗)';
  }
  function close() { $('#rx-viewer').hidden = true; $('.split').classList.remove('has-viewer'); $('#rx-frame').src = 'about:blank'; $$('.rx.active').forEach(e => e.classList.remove('active')); }
  function select(catId, khz) {
    cat = presets.categories.some(c => c.id === catId) ? catId : 'all'; LS.set('rxCat', cat);
    preset = khz != null ? (curCat()?.presets.find(p => p.khz === khz) || null) : null;
    net = 'all'; $$('#rx-net button').forEach(x => x.classList.toggle('on', x.dataset.net === 'all'));
    limit = 40; renderCats(); render();
  }
  let ready;
  async function load() {
    presets = await api('/api/presets');
    if (!presets.categories.some(c => c.id === cat)) cat = 'all';
    renderCats();
    $('#rx-streams').innerHTML = presets.audioStreams.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a><span>${esc(s.note)}</span></li>`).join('');
    info = await api('/api/receivers/all');
    all = info.stations;
    computeCounts(); renderCats(); render();
    $('#rx-sources').innerHTML = info.sources.map(s => `<li><b>${esc(s.name)}</b> — ${s.count} · <span class="${s.live ? 'ok-t' : 'warn-t'}">${esc(s.source)}</span></li>`).join('');
  }
  function init() {
    $('#rx-sort').value = sort;
    $('#rx-cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; select(b.dataset.cat); });
    $('#rx-presets').addEventListener('click', e => {
      if (e.target.id === 'rx-mclear') { preset = null; renderCats(); render(); return; }
      const b = e.target.closest('[data-i]'); if (!b) return;
      const p = curCat().presets[+b.dataset.i];
      preset = preset === p ? null : p; limit = 40; renderCats(); render();
    });
    $('#rx-presets').addEventListener('submit', e => {
      e.preventDefault();
      const khz = parseFloat($('#rx-mf').value);
      if (!(khz > 0 && khz < 6e6)) return ($('#rx-mf').value = '');
      preset = { name: 'manual', khz, mode: $('#rx-mm').value, custom: true }; limit = 40; renderCats(); render();
    });
    $('#rx-net').addEventListener('click', e => { const b = e.target.closest('[data-net]'); if (!b) return; net = b.dataset.net; $$('#rx-net button').forEach(x => x.classList.toggle('on', x === b)); limit = 40; render(); });
    $('#rx-search').addEventListener('input', () => { limit = 40; render(); });
    $('#rx-sort').addEventListener('change', () => { sort = $('#rx-sort').value; LS.set('rxSort', sort); render(); });
    $('#rx-free').addEventListener('change', render);
    $('#rx-confirmed').addEventListener('change', render);
    $('#rx-more').addEventListener('click', () => { limit += 40; render(); });
    $('#rx-list').addEventListener('click', e => {
      const b = e.target.closest('[data-act=tune]'); if (!b) return;
      const row = b.closest('.rx'), rx = render.list[+row.dataset.i];
      $$('.rx.active').forEach(x => x.classList.remove('active')); row.classList.add('active');
      open(tuneUrl(rx, preset), `${rx.name}${preset ? ' @ ' + fmtFreq(preset.khz) + ' ' + preset.mode.toUpperCase() : ''}`);
    });
    $('#rx-vclose').addEventListener('click', close);
    initMonitor();
    ready = load().catch(e => ($('#rx-meta').textContent = 'Failed to load receivers: ' + e.message));
  }

  // ---------------- Live monitor: mic level meter, voice-activity, captions ----------------
  // Browsers can't tap the audio inside the cross-origin receiver iframe, so this
  // listens through the microphone (play the receiver aloud). Best-effort by design.
  const ACT_THRESH = 0.045;          // RMS above this = "active" (tuned for speaker->mic)
  function monNote(msg) { const n = $('#mon-note'); if (!n) return; n.hidden = !msg; n.textContent = msg || ''; }
  function monBadge(state) {
    const b = $('#mon-badge'); if (!b) return;
    b.textContent = state; b.className = 'act-badge ' + state;
  }
  async function ensureMic(forScan) {
    if (mon && mon.stream) return mon;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      src.connect(an);
      mon = { stream, ctx, an, buf: new Uint8Array(an.fftSize), raf: 0, peak: 0, ccOn: false };
      monNote('');
      loopMeter();
      return mon;
    } catch (e) {
      monBadge('idle');
      monNote('Microphone unavailable: ' + (e && e.message || e) + '. The meter and captions need mic access — allow it, or use a desktop browser.');
      if (forScan) throw e;
      return null;
    }
  }
  function rms() {
    if (!mon) return 0;
    mon.an.getByteTimeDomainData(mon.buf);
    let sum = 0; for (let i = 0; i < mon.buf.length; i++) { const v = (mon.buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / mon.buf.length);
  }
  function loopMeter() {
    if (!mon) return;
    const r = rms();
    mon.peak = Math.max(mon.peak * 0.9, r);
    const pct = Math.min(100, Math.round(r * 350));
    const fill = $('#mon-meter'); if (fill) fill.style.width = pct + '%';
    const db = $('#mon-db'); if (db) db.textContent = (r > 0.0008 ? (20 * Math.log10(r)).toFixed(0) + ' dB' : '—');
    if (!scanOn) monBadge(r > ACT_THRESH ? 'ACTIVE' : 'quiet');
    mon.raf = requestAnimationFrame(loopMeter);
  }
  function stopMic() {
    if (!mon) return;
    cancelAnimationFrame(mon.raf);
    try { mon.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { mon.ctx.close(); } catch (e) {}
    mon = null; monBadge('idle');
    const fill = $('#mon-meter'); if (fill) fill.style.width = '0%';
  }
  // sample peak mic RMS over `ms` and return it (used by the scanner)
  function sampleLevel(ms) {
    return new Promise(res => {
      if (!mon) return res(0);
      let peak = 0; const t0 = performance.now();
      (function tick() {
        peak = Math.max(peak, rms());
        if (performance.now() - t0 < ms && scanOn) requestAnimationFrame(tick);
        else res(peak);
      })();
    });
  }

  // ---- captions (Web Speech API, Chromium desktop only) ----
  let recog = null, ccOn = false;
  function captionsSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function startCaptions() {
    if (!captionsSupported()) {
      monNote('Live captions need a Chromium-based desktop browser (Chrome, Edge or Opera on a computer). This browser — likely Safari, iOS or Firefox — has no in-page speech recognition, so captions are off. The level meter and activity scan still work.');
      const cb = $('#mon-cc'); if (cb) cb.checked = false; return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
    recog.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) addCaption(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      const il = $('#mon-interim'); if (il) il.textContent = interim;
    };
    recog.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') monNote('Captions need microphone permission — it was blocked.');
      else if (ev.error === 'no-speech') { /* ignore */ }
    };
    recog.onend = () => { if (ccOn) { try { recog.start(); } catch (e) {} } };
    try { recog.start(); ccOn = true; $('#mon-ccbox').hidden = false; } catch (e) {}
  }
  function stopCaptions() { ccOn = false; if (recog) { try { recog.stop(); } catch (e) {} } const il = $('#mon-interim'); if (il) il.textContent = ''; }
  function addCaption(text) {
    if (!text) return;
    const log = $('#mon-cclog'); if (!log) return;
    const line = document.createElement('div');
    line.className = 'cc-line';
    line.innerHTML = `<span class="cc-t mono">${new Date().toTimeString().slice(0, 8)}</span> ${esc(text)}`;
    log.appendChild(line);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if ($('#mon-tr') && $('#mon-tr').checked) translateLine(line, text);
  }
  async function translateLine(el, text) {
    try {
      const r = await api('/api/translate?text=' + encodeURIComponent(text));
      if (r && r.ok && !r.alreadyEnglish && r.translated && r.translated.trim().toLowerCase() !== text.trim().toLowerCase()) {
        const tag = document.createElement('span');
        tag.className = 'cc-tr';
        tag.innerHTML = ` ↳ EN: ${esc(r.translated)}` + (r.detected ? ` <span class="muted">(${esc(r.detected)})</span>` : '');
        el.appendChild(tag);
      } else if (r && r.ok === false) {
        const tag = document.createElement('span'); tag.className = 'muted'; tag.textContent = ' (translation unavailable)'; el.appendChild(tag);
      }
    } catch (e) { /* leave original transcript as-is */ }
  }

  // ---- scan a category's receivers for activity ----
  function scanStatus(msg) { const el = $('#scan-status'); if (el) el.textContent = msg; }
  function scanBtns() { $('#scan-go').hidden = scanOn; $('#scan-stop').hidden = !scanOn; }
  async function runScan() {
    if (scanOn) return;
    const list = (render.list || filtered()).slice(0, 12);
    if (!list.length) { scanStatus('no receivers to scan — pick a category/band first'); return; }
    try { await ensureMic(true); } catch (e) { scanStatus('scan needs microphone access (play receivers aloud so the mic can hear them)'); return; }
    scanOn = true; scanBtns();
    monBadge('scanning');
    for (let i = 0; i < list.length && scanOn; i++) {
      const rx = list[i];
      scanStatus(`sampling ${i + 1}/${list.length}: ${rx.name} — play it aloud…`);
      open(tuneUrl(rx, preset), rx.name);
      const peak = await sampleLevel(4500);
      scanRes[rx.url] = { active: peak > ACT_THRESH, level: peak, ts: Date.now() };
      render();
    }
    const done = scanOn;
    scanOn = false; scanBtns();
    const n = list.filter(r => scanRes[r.url] && scanRes[r.url].active).length;
    scanStatus(done ? `scanned ${list.length}, ${n} sounded active — sorted talking-now first. (samples a few at a time; depends on audio playing aloud)` : 'scan stopped');
  }
  function stopScan() { scanOn = false; scanBtns(); scanStatus('scan stopped'); }

  function initMonitor() {
    const mic = $('#mon-mic'); if (!mic) return;
    if (!captionsSupported()) monNote('Heads-up: live captions need a Chromium-based desktop browser (Chrome/Edge/Opera). The level meter and activity scan work everywhere with mic access.');
    mic.addEventListener('click', async () => {
      if (mon) { stopMic(); stopCaptions(); const cb = $('#mon-cc'); if (cb) cb.checked = false; mic.textContent = '▶ Start listening (mic)'; return; }
      const m = await ensureMic(false);
      if (m) mic.textContent = '■ Stop listening';
    });
    $('#mon-cc').addEventListener('change', async e => {
      if (e.target.checked) { await ensureMic(false); startCaptions(); } else { stopCaptions(); }
    });
    $('#scan-go').addEventListener('click', runScan);
    $('#scan-stop').addEventListener('click', stopScan);
    $('#scan-active-only').addEventListener('change', render);
    $('#scan-sort').addEventListener('change', render);
  }

  const matches = (rx, catId) => match(rx, presets.categories.find(c => c.id === catId), null) > 0;
  return { init, render, open, select, tuneUrl, NETS, matches, stations: () => all, categories: () => presets.categories, ready: () => ready };
})();

/* ===================== CAMERAS ===================== */
const cams = (() => {
  let data = [], limit = 24, loadedKey = null, timer = null;
  const bust = (url, t) => url + (url.includes('?') ? '&' : '?') + '_t=' + t;
  function populateSources() {
    $('#cam-source').innerHTML = state.cfg.camSources.map(s => `<option value="${s.id}" ${s.hasKey ? '' : 'data-nokey'}>${esc(s.label)}${s.hasKey ? '' : ' — needs key'}</option>`).join('');
    $('#cam-source').value = LS.get('camSource', 'imagery');
    $('#cam-district').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">District ${i + 1}${({ 3: ' · Sacramento', 4: ' · SF Bay Area', 7: ' · Los Angeles', 11: ' · San Diego' })[i + 1] || ''}</option>`).join('');
    $('#cam-district').value = LS.get('camDistrict', '4');
  }
  async function load() {
    const src = $('#cam-source').value, dist = $('#cam-district').value;
    $('#cam-district').hidden = src !== 'caltrans';
    const key = src + ':' + dist;
    if (key === loadedKey) return render();
    loadedKey = key; LS.set('camSource', src); LS.set('camDistrict', dist);
    $('#cam-meta').textContent = 'loading…'; $('#cam-grid').innerHTML = '';
    try {
      const j = await api(`/api/cameras?source=${src}&district=${dist}&lat=${state.loc.lat}&lon=${state.loc.lon}`);
      data = j.cameras || [];
      $('#cam-meta').textContent = j.message ? j.message : `${data.length} cameras · ${j.label}`;
      if (j.needsKey) $('#cam-grid').innerHTML = `<div class="empty">🔑 ${esc(j.message)}<br><br>See README → “Optional free API keys”.</div>`;
    } catch (e) { data = []; loadedKey = null; $('#cam-meta').textContent = 'Failed: ' + e.message; }
    limit = 24; render();
  }
  function filtered() {
    const q = $('#cam-search').value.trim().toLowerCase();
    const L = state.loc;
    let list = q ? data.filter(c => (c.name + ' ' + c.caption + ' ' + c.region + ' ' + (c.road || '')).toLowerCase().includes(q)) : data;
    return list.map(c => ({ ...c, d: km(L.lat, L.lon, c.lat, c.lon) }));
  }
  function render() {
    const list = filtered();
    if (!data.length) return;
    const t = Date.now();
    $('#cam-grid').innerHTML = list.slice(0, limit).map((c, i) => `
      <div class="cam" data-i="${i}">
        <div class="cam-img"><img loading="lazy" alt="${esc(c.name)}" data-src="${esc(c.image)}" src="${esc(bust(c.image, t))}" onerror="this.style.display='none';this.nextElementSibling.nextElementSibling.hidden=false">
          <span class="live">${c.stream ? '● VIDEO' : 'IMG · ' + Math.round((c.refreshSec || 300) / 60) + 'm'}</span><div class="err" hidden>image unavailable</div></div>
        <div class="cam-body"><div class="cam-name" title="${esc(c.name)}">${esc(c.name)}</div><div class="cam-sub">${esc([c.region, c.caption].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('') || `<div class="empty">no cameras match</div>`;
    $('#cam-more').hidden = list.length <= limit;
    render.list = list;
  }
  function refreshImages() {
    if (!$('#cam-auto').checked || state.view !== 'cams' || document.hidden) return;
    const t = Date.now();
    $$('#cam-grid img[data-src]').forEach(img => { img.src = bust(img.dataset.src, t); });
  }
  function openModal(c) {
    $('#modal').hidden = false; $('#modal-title').textContent = c.name; $('#modal-link').href = c.page || c.image;
    $('#modal-caption').textContent = [c.caption, c.region, c.credit && '© ' + c.credit].filter(Boolean).join(' · ');
    const body = $('#modal-body');
    const showImg = () => (body.innerHTML = `<img src="${esc(bust(c.image, Date.now()))}" alt="">`);
    if (c.player) { body.innerHTML = `<iframe src="${esc(c.player)}" allowfullscreen></iframe>`; return; }
    showImg();
    if (c.stream) {
      const btn = document.createElement('button'); btn.className = 'btn sm'; btn.textContent = '▶ live video';
      $('#modal-caption').prepend(btn, ' ');
      btn.onclick = () => {
        body.innerHTML = '<video controls autoplay muted playsinline></video>';
        const v = body.querySelector('video');
        const fail = () => { showImg(); $('#modal-caption').append(' — live stream unavailable right now, showing latest still.'); };
        v.onerror = fail;
        if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = c.stream;
        else if (window.Hls && Hls.isSupported()) { const h = new Hls(); h.on(Hls.Events.ERROR, (_, d) => d.fatal && (h.destroy(), fail())); h.loadSource(c.stream); h.attachMedia(v); body._hls = h; }
        else fail();
      };
    }
  }
  function init() {
    populateSources();
    $('#cam-source').addEventListener('change', load);
    $('#cam-district').addEventListener('change', load);
    $('#cam-search').addEventListener('input', () => { limit = 24; render(); });
    $('#cam-more').addEventListener('click', () => { limit += 24; render(); });
    $('#cam-grid').addEventListener('click', e => { const el = e.target.closest('.cam'); if (el) openModal(render.list[+el.dataset.i]); });
    $('#modal-close').addEventListener('click', () => { const b = $('#modal-body'); b._hls?.destroy(); b.innerHTML = ''; $('#modal').hidden = true; });
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal-close').click(); });
    timer = setInterval(refreshImages, 60000);
  }
  return { init, show: load, openModal };
})();

/* ===================== FLIGHTS ===================== */
const flights = (() => {
  let map, tiles, ring, center, layer, markers = new Map(), timer = null, busy = false, visible = false;
  const s = LS.get('flights', null);
  let q = s || null;
  // Standard OpenStreetMap tiles (free, no key); dark themes get a CSS filter so the map matches the console.
  const tileUrl = () => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const altColor = a => a === 'ground' || a == null ? '#9aa' : `hsl(${Math.max(0, Math.min(300, 140 + (a / 40000) * 160))} 95% 60%)`;
  const PLANE = '<path d="M12 2 L14 9 L21 13 L21 15 L14 13 L13.5 19 L16 21 L16 22 L12 21 L8 22 L8 21 L10.5 19 L10 13 L3 15 L3 13 L10 9 Z"/>';
  function acIcon(a) {
    return L.divIcon({ className: 'ac-icon', iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<svg width="22" height="22" viewBox="0 0 24 24" style="transform:rotate(${a.track || 0}deg);fill:${/^(7500|7600|7700)$/.test(a.squawk) ? 'var(--danger)' : altColor(a.alt)}">${PLANE}</svg>` });
  }
  function acPopup(a) {
    return `<b>${esc(a.flight || a.hex.toUpperCase())}</b> ${esc(a.reg)}<br>${esc(a.desc || a.type || 'unknown type')}<br>alt ${a.alt ?? '—'} ft · ${a.gs != null ? Math.round(a.gs) : '—'} kt · hdg ${a.track != null ? Math.round(a.track) + '°' : '—'}<br>squawk ${esc(a.squawk || '—')}${a.dst != null ? ' · ' + a.dst.toFixed(0) + ' nm from query point' : ''}<br><a href="https://globe.adsb.fi/?icao=${a.hex}" target="_blank" rel="noopener">track on globe.adsb.fi ↗</a>`;
  }
  function syncInputs() {
    q = { lat: state.loc.lat, lon: state.loc.lon, dist: q?.dist || 150 };
    $('#fl-lat').value = q.lat; $('#fl-lon').value = q.lon; $('#fl-dist').value = String(q.dist);
  }
  function ensureMap() {
    if (map) return;
    map = L.map('fl-map', { zoomControl: true, attributionControl: true }).setView([q.lat, q.lon], 7);
    tiles = L.tileLayer(tileUrl(), { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ADS-B: adsb.fi / adsb.lol' }).addTo(map);
    updateTiles();
    layer = L.layerGroup().addTo(map);
  }
  function updateTiles() { $('#fl-map').classList.toggle('map-dark', theme.dark !== false); }
  function drawRing() {
    if (ring) ring.remove(); if (center) center.remove();
    ring = L.circle([q.lat, q.lon], { radius: q.dist * 1852, color: getComputedStyle(document.documentElement).getPropertyValue('--accent'), weight: 1, fill: false, dashArray: '4 6' }).addTo(map);
    center = L.circleMarker([q.lat, q.lon], { radius: 4, color: getComputedStyle(document.documentElement).getPropertyValue('--accent2'), fillOpacity: 1 }).addTo(map).bindTooltip(state.loc.label || 'you');
  }
  async function refresh(recenter) {
    if (!visible || busy || !q) return;
    busy = true;
    try {
      if (recenter) { map.setView([q.lat, q.lon], q.dist > 150 ? 6 : q.dist > 60 ? 7 : 8); drawRing(); }
      const j = await api(`/api/adsb?lat=${q.lat}&lon=${q.lon}&dist=${q.dist}`);
      const ac = j.aircraft.sort((a, b) => (a.dst ?? 1e9) - (b.dst ?? 1e9));
      const seen = new Set();
      for (const a of ac) {
        seen.add(a.hex);
        const icon = acIcon(a), pop = acPopup(a);
        let m = markers.get(a.hex);
        if (m) { m.setLatLng([a.lat, a.lon]); m.setIcon(icon); m.setPopupContent(pop); }
        else { m = L.marker([a.lat, a.lon], { icon }).bindPopup(pop).addTo(layer); markers.set(a.hex, m); }
      }
      for (const [hex, m] of markers) if (!seen.has(hex)) { m.remove(); markers.delete(hex); }
      $('#fl-table tbody').innerHTML = ac.map(a => `<tr data-hex="${a.hex}" class="${/^(7500|7600|7700)$/.test(a.squawk) ? 'emerg' : ''}"><td>${esc(a.flight || '—')}</td><td>${esc(a.type)}</td><td class="r">${a.alt ?? ''}</td><td class="r">${a.gs != null ? Math.round(a.gs) : ''}</td><td class="r">${a.dst != null ? a.dst.toFixed(0) : ''}</td><td>${esc(a.squawk)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">no aircraft in range right now</td></tr>';
      $('#fl-meta').textContent = `${ac.length} aircraft within ${q.dist} nm of ${state.loc.label || q.lat + ',' + q.lon} · source ${j.source} · ${new Date().toLocaleTimeString()}`;
    } catch (e) { $('#fl-meta').textContent = 'ADS-B error: ' + e.message; }
    finally { busy = false; }
  }
  function schedule() { clearInterval(timer); if ($('#fl-live').checked) timer = setInterval(() => refresh(false), 10000); }
  function show() { visible = true; ensureMap(); setTimeout(() => { map.invalidateSize(); refresh(true); }, 60); schedule(); }
  function hide() { visible = false; clearInterval(timer); }
  function init() {
    syncInputs();
    $('#fl-apply').addEventListener('click', () => {
      const lat = parseFloat($('#fl-lat').value), lon = parseFloat($('#fl-lon').value);
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return ($('#fl-meta').textContent = 'Invalid coordinates');
      q = { lat, lon, dist: +$('#fl-dist').value }; LS.set('flights', q); refresh(true);
    });
    $('#fl-geo').addEventListener('click', () => geolocate(l => { setLoc(l); }, msg => ($('#fl-meta').textContent = msg)));
    $('#fl-live').addEventListener('change', schedule);
    $('#fl-table').addEventListener('click', e => { const tr = e.target.closest('tr[data-hex]'); if (!tr) return; const m = markers.get(tr.dataset.hex); if (m) { map.panTo(m.getLatLng()); m.openPopup(); if (innerWidth < 900) $('#fl-map').scrollIntoView({ behavior: 'smooth' }); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) refresh(false); });
  }
  return { init, show, hide, refresh, syncInputs, updateTiles, acIcon, acPopup };
})();

/* ===================== MAP (all layers) ===================== */
const mapview = (() => {
  let map, renderer, home, rxLayer, camLayer, acLayer, visible = false, acTimer = null, acBusy = false;
  const on = LS.get('mapLayers', { rx: true, ac: true, cam: false });
  let rxShown = [], camData = [], camKey = null;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const netColor = n => ({ kiwisdr: css('--accent'), websdr: css('--accent2'), openwebrx: css('--warn') })[n] || css('--muted');
  function ensure() {
    if (map) return;
    renderer = L.canvas({ padding: 0.3 });
    const v = LS.get('mapView', null);
    map = L.map('mp-map', { preferCanvas: true, worldCopyJump: true }).setView(v ? [v.lat, v.lon] : [state.loc.lat, state.loc.lon], v ? v.z : 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · receivers: kiwisdr.com, websdr.org, receiverbook.de · ADS-B: adsb.fi' }).addTo(map);
    rxLayer = L.layerGroup(); camLayer = L.layerGroup(); acLayer = L.layerGroup();
    drawHome();
    map.on('moveend', () => { const c = map.getCenter(); LS.set('mapView', { lat: +c.lat.toFixed(3), lon: +c.lng.toFixed(3), z: map.getZoom() }); clearTimeout(ensure.t); ensure.t = setTimeout(() => loadAc(), 400); });
    $('#mp-map').addEventListener('click', onPopupClick);
    updateTiles();
  }
  function drawHome() {
    if (home) home.remove();
    home = L.circleMarker([state.loc.lat, state.loc.lon], { radius: 6, color: css('--text'), weight: 2, fillColor: css('--accent2'), fillOpacity: 1, renderer }).bindTooltip(state.loc.label || 'you').addTo(map);
  }
  function updateTiles() { $('#mp-map')?.classList.toggle('map-dark', theme.dark !== false); }
  function syncLayers() {
    for (const [k, layer] of [['rx', rxLayer], ['cam', camLayer], ['ac', acLayer]]) {
      if (on[k]) layer.addTo(map); else layer.remove();
      $(`[data-layer=${k}]`).classList.toggle('on', !!on[k]);
    }
    if (!on.cam) $('#mp-n-cam').textContent = 'off';
    if (!on.ac) { $('#mp-n-ac').textContent = 'off'; clearInterval(acTimer); }
    if (!on.rx) $('#mp-n-rx').textContent = 'off';
    LS.set('mapLayers', on);
  }
  // ---- receivers ----
  function drawRx() {
    rxLayer.clearLayers();
    if (!on.rx) return;
    const cat = $('#mp-rxcat').value;
    rxShown = radio.stations().filter(rx => rx.lat != null && rx.lon != null && (cat === 'all' || radio.matches(rx, cat)));
    rxShown.forEach((rx, i) => {
      L.circleMarker([rx.lat, rx.lon], { radius: 4.5, weight: 1, color: netColor(rx.network), fillColor: netColor(rx.network), fillOpacity: .75, renderer })
        .bindPopup(() => {
          const d = km(state.loc.lat, state.loc.lon, rx.lat, rx.lon);
          const cover = rx.bands ? rx.bands.slice(0, 3).map(([a, b]) => `${fmtFreq(a / 1000)}–${fmtFreq(b / 1000)}`).join(', ') : 'coverage not published';
          return `<b>${esc(rx.name)}</b><br><span class="tag">${radio.NETS[rx.network] || rx.kind}</span> ${esc(rx.loc)}<br>${esc(cover)}${rx.usersMax != null ? `<br>${rx.users}/${rx.usersMax} users` : ''}${d != null ? `<br>⊕ ${fmtKm(d)} from you` : ''}
            <div class="pop-actions"><button class="btn sm" data-listen="${i}">▶ listen</button><a class="btn sm ghost" href="${esc(rx.url)}" target="_blank" rel="noopener">↗</a></div>`;
        }).addTo(rxLayer);
    });
    $('#mp-n-rx').textContent = rxShown.length;
  }
  // ---- cameras ----
  async function drawCams() {
    if (!on.cam) { camLayer.clearLayers(); return; }
    const src = $('#mp-camsrc').value;
    const key = src + ':' + LS.get('camDistrict', '4');
    if (key !== camKey) {
      camKey = key; $('#mp-n-cam').textContent = '…';
      try {
        const j = await api(`/api/cameras?source=${src}&district=${LS.get('camDistrict', '4')}&lat=${state.loc.lat}&lon=${state.loc.lon}`);
        camData = (j.cameras || []).filter(c => c.lat != null && c.lon != null && !isNaN(c.lat));
        if (j.needsKey) setMeta(j.message);
      } catch (e) { camData = []; setMeta('cameras: ' + e.message); }
    }
    camLayer.clearLayers();
    const col = css('--danger');
    camData.forEach((c, i) => L.circleMarker([c.lat, c.lon], { radius: 4, weight: 1, color: col, fillColor: col, fillOpacity: .8, renderer })
      .bindPopup(() => `<b>${esc(c.name)}</b><br><span class="muted">${esc(c.region || '')}</span><img class="pop-img" src="${esc(c.image)}" alt="" loading="lazy"><div class="pop-actions"><button class="btn sm" data-cam="${i}">▣ open</button></div>`, { maxWidth: 280 }).addTo(camLayer));
    $('#mp-n-cam').textContent = camData.length;
    if (camData.length && !map.getBounds().intersects(L.latLngBounds(camData.map(c => [c.lat, c.lon])))) map.fitBounds(camData.map(c => [c.lat, c.lon]), { padding: [20, 20], maxZoom: 9 });
  }
  // ---- aircraft (only fetched for the visible area, up to 250 nm) ----
  async function loadAc() {
    if (!visible || !on.ac || acBusy) return;
    if (map.getZoom() < 5) { acLayer.clearLayers(); $('#mp-n-ac').textContent = 'zoom in'; setMeta(`${rxShown.length} receivers${on.cam ? ' · ' + camData.length + ' cameras' : ''} · zoom in to load live aircraft`); return; }
    const c = map.getCenter(), b = map.getBounds();
    const nm = Math.min(250, Math.max(10, Math.round(map.distance(c, b.getNorthEast()) / 1852)));
    acBusy = true;
    try {
      const j = await api(`/api/adsb?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&dist=${nm}`);
      acLayer.clearLayers();
      for (const a of j.aircraft) L.marker([a.lat, a.lon], { icon: flights.acIcon(a) }).bindPopup(flights.acPopup(a)).addTo(acLayer);
      $('#mp-n-ac').textContent = j.aircraft.length;
      setMeta(`${rxShown.length} receivers · ${on.cam ? camData.length + ' cameras · ' : ''}${j.aircraft.length} aircraft within ${nm} nm of map centre (${j.source}) · ${new Date().toLocaleTimeString()}`);
    } catch (e) { setMeta('ADS-B: ' + e.message); }
    finally { acBusy = false; }
    clearInterval(acTimer); acTimer = setInterval(loadAc, 15000);
  }
  function setMeta(t) { $('#mp-meta').textContent = t; }
  function onPopupClick(e) {
    const l = e.target.closest('[data-listen]'), c = e.target.closest('[data-cam]');
    if (l) { const rx = rxShown[+l.dataset.listen]; location.hash = 'radio'; setTimeout(() => radio.open(rx.url, rx.name), 80); }
    if (c) cams.openModal(camData[+c.dataset.cam]);
  }
  async function show() {
    visible = true; ensure();
    setTimeout(() => map.invalidateSize(), 50);
    syncLayers();
    if (!$('#mp-rxcat').options.length || $('#mp-rxcat').options.length === 1) {
      await radio.ready();
      $('#mp-rxcat').innerHTML = '<option value="all">all categories</option>' + radio.categories().map(c => `<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('');
      $('#mp-rxcat').value = LS.get('mapRxCat', 'all');
    }
    drawRx(); drawCams(); loadAc();
  }
  function hide() { visible = false; clearInterval(acTimer); }
  function init() {
    $('#mp-camsrc').innerHTML = state.cfg.camSources.filter(s => s.id !== 'imagery').map(s => `<option value="${s.id}">${esc(s.label)}${s.hasKey ? '' : ' — needs key'}</option>`).join('');
    $('#mp-camsrc').value = LS.get('mapCamSrc', 'drivebc');
    $('#mp-layers').addEventListener('click', e => {
      const b = e.target.closest('[data-layer]'); if (!b) return;
      on[b.dataset.layer] = !on[b.dataset.layer]; syncLayers();
      if (b.dataset.layer === 'rx') drawRx(); if (b.dataset.layer === 'cam') drawCams(); if (b.dataset.layer === 'ac') loadAc();
    });
    $('#mp-rxcat').addEventListener('change', () => { LS.set('mapRxCat', $('#mp-rxcat').value); drawRx(); });
    $('#mp-camsrc').addEventListener('change', () => { LS.set('mapCamSrc', $('#mp-camsrc').value); if (!on.cam) { on.cam = true; syncLayers(); } drawCams(); });
    $('#mp-home').addEventListener('click', () => map.setView([state.loc.lat, state.loc.lon], 7));
    $('#mp-world').addEventListener('click', () => map.setView([30, -30], 2));
  }
  function relocate() { if (map) { drawHome(); map.setView([state.loc.lat, state.loc.lon], Math.max(map.getZoom(), 6)); } }
  return { init, show, hide, updateTiles, relocate };
})();

/* ===================== LEARNING PATH ===================== */
const learn = (() => {
  let data = null;
  const prog = LS.get('learn', { done: {}, peek: {} });
  const save = () => LS.set('learn', prog);
  const all = () => data.levels.flatMap(l => l.modules.map(m => ({ ...m, level: l.id })));
  // a level unlocks once 3 lessons of the previous level are done (or the user chooses to peek)
  function unlocked(i) {
    if (i === 0 || prog.peek[data.levels[i].id]) return true;
    const prev = data.levels[i - 1];
    return prev.modules.filter(m => prog.done[m.id]).length >= Math.min(3, prev.modules.length) && unlocked(i - 1);
  }
  function hud() {
    const list = all(), n = list.filter(m => prog.done[m.id]).length;
    const next = list.find((m, i) => !prog.done[m.id] && unlocked(data.levels.findIndex(l => l.id === m.level)));
    const rank = ['Novice', 'Listener', 'Operator', 'Engineer'][data.levels.filter(l => l.modules.every(m => prog.done[m.id])).length] || 'Engineer';
    $('#ln-hud').innerHTML = `<div class="hud-row"><div><div class="mono small muted">rank</div><div class="rank">${rank}</div></div>
      <div class="grow"><div class="mono small muted">${n} / ${list.length} lessons</div><div class="bar"><i style="width:${(100 * n / list.length).toFixed(0)}%"></i></div></div></div>
      ${next ? `<button class="btn" data-open="${next.id}">▶ continue: ${esc(next.title)}</button>` : '<div class="ok-t mono">✔ path complete — go build that ADS-B feeder.</div>'}`;
  }
  function lessonHtml(m) {
    const done = !!prog.done[m.id];
    return `<details class="lesson ${done ? 'done' : ''}" id="ln-${m.id}">
      <summary><span class="ln-check">${done ? '✔' : '○'}</span><span class="ln-title">${esc(m.title)}</span><span class="mono small muted">${m.mins} min</span></summary>
      <div class="ln-body">
        ${m.body.map(p => `<p>${p}</p>`).join('')}
        <div class="key-idea"><span class="mono small">key idea</span>${esc(m.key)}</div>
        <div class="tries"><span class="mono small muted">try it live:</span>${m.tries.map((t, i) => `<button class="btn sm ghost" data-try="${m.id}:${i}">${esc(t.label)}${t.url ? ' ↗' : ' →'}</button>`).join('')}</div>
        <div class="quiz" data-quiz="${m.id}"><div class="mono small muted">quick check</div><div class="q">${esc(m.quiz.q)}</div>
          <div class="opts">${m.quiz.opts.map((o, i) => `<button class="opt" data-ans="${i}">${esc(o)}</button>`).join('')}</div><div class="why"></div></div>
      </div></details>`;
  }
  function render() {
    hud();
    $('#ln-levels').innerHTML = data.levels.map((l, i) => {
      const ok = unlocked(i), n = l.modules.filter(m => prog.done[m.id]).length;
      return `<div class="card level ${ok ? '' : 'locked'}">
        <div class="level-head"><h3>${esc(l.title)}</h3><span class="mono small muted">${n}/${l.modules.length}</span></div>
        <p class="muted small">${esc(l.sub)}</p>
        ${ok ? l.modules.map(lessonHtml).join('') : `<ul class="locked-list">${l.modules.map(m => `<li>${esc(m.title)}</li>`).join('')}</ul>
          <div class="row wrap"><span class="mono small muted">🔒 finish 3 lessons in the previous level to unlock</span><button class="btn sm ghost" data-peek="${l.id}">peek anyway</button></div>`}
      </div>`;
    }).join('');
  }
  function go(t) {
    if (t.url) return window.open(t.url, '_blank', 'noopener');
    if (t.go === 'radio') { radio.select(t.cat || 'all', t.khz); location.hash = 'radio'; return; }
    if (t.go === 'cams' && t.src) { $('#cam-source').value = t.src; }
    location.hash = t.anchor || t.go;
  }
  function init() {
    $('#view-learn').addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (o) { const el = $('#ln-' + o.dataset.open); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
      const p = e.target.closest('[data-peek]'); if (p) { prog.peek[p.dataset.peek] = true; save(); render(); return; }
      const t = e.target.closest('[data-try]');
      if (t) { const [id, i] = t.dataset.try.split(':'); go(all().find(m => m.id === id).tries[+i]); return; }
      const a = e.target.closest('[data-ans]');
      if (a) {
        const qz = a.closest('[data-quiz]'), m = all().find(x => x.id === qz.dataset.quiz), right = +a.dataset.ans === m.quiz.ans;
        $$('.opt', qz).forEach((b, i) => { b.classList.toggle('right', i === m.quiz.ans && right); b.classList.toggle('wrong', b === a && !right); });
        $('.why', qz).innerHTML = right ? `<span class="ok-t">✔ correct.</span> ${esc(m.quiz.why)} <button class="btn sm" data-next="${m.id}">next lesson →</button>` : '<span class="warn-t">✕ not quite — have another look above and try again.</span>';
        if (right && !prog.done[m.id]) { prog.done[m.id] = Date.now(); save(); hud(); const s = $(`#ln-${m.id} .ln-check`); s.textContent = '✔'; $('#ln-' + m.id).classList.add('done'); }
        return;
      }
      const nx = e.target.closest('[data-next]');
      if (nx) {
        render();
        const list = all(), i = list.findIndex(m => m.id === nx.dataset.next), next = list.slice(i + 1).find(m => $('#ln-' + m.id));
        if (next) { const el = $('#ln-' + next.id); el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });
  }
  async function show() {
    if (!data) { try { data = await (await fetch('/learn/path.json')).json(); } catch (e) { $('#ln-levels').innerHTML = `<div class="empty">couldn't load lessons: ${esc(e.message)}</div>`; return; } }
    render();
  }
  return { init, show };
})();

/* ===================== LOCAL RECEIVER ===================== */
const local = (() => {
  let cfg, lastOk = false;
  function sync() {
    const t = $('#lr-type').value;
    $('#lr-url-wrap').hidden = t === 'rtltcp'; $('#lr-tcp-wrap').hidden = t !== 'rtltcp';
    $('#lr-open').disabled = !(lastOk && t !== 'rtltcp');
  }
  function banner(ok, text) {
    $('#lr-banner').className = 'card banner' + (ok ? ' live' : '');
    $('#lr-banner').innerHTML = ok ? `<strong>RECEIVER RESPONDING</strong> — ${esc(text)}` : `<strong>NOT YET ACTIVE</strong> — connect your receiver here. ${esc(text || 'No hardware detected.')}`;
  }
  async function probe() {
    const t = $('#lr-type').value, out = $('#lr-out');
    const target = t === 'rtltcp' ? $('#lr-tcp').value.trim() : $('#lr-url').value.trim();
    if (!target) { out.textContent = '$ nothing configured yet — enter an address first.'; return; }
    out.textContent = `$ probe ${target}\n…`;
    try {
      const r = await api('/api/local/probe?' + (t === 'rtltcp' ? 'rtltcp=' : 'url=') + encodeURIComponent(target));
      lastOk = !!r.ok;
      out.textContent = `$ probe ${target}\n` + JSON.stringify(r, null, 2);
      if (r.ok) banner(true, t === 'rtltcp' ? `rtl_tcp answered (tuner ${r.tuner}). Connect SDR++ or SDR# to ${target}.` : `${r.detected} at ${target}. Press “open in viewer”.`);
      else banner(false, `Last probe failed: ${r.error || 'HTTP ' + r.status}.`);
    } catch (e) { lastOk = false; out.textContent += '\nerror: ' + e.message; banner(false); }
    sync();
  }
  function init() {
    cfg = LS.get('local', null) || { type: state.cfg.localReceiver.type || 'openwebrx', url: state.cfg.localReceiver.url || '', tcp: state.cfg.localReceiver.rtlTcp || '' };
    $('#lr-type').value = cfg.type; $('#lr-url').value = cfg.url; $('#lr-tcp').value = cfg.tcp;
    sync(); banner(false);
    $('#lr-type').addEventListener('change', () => { lastOk = false; sync(); });
    $('#lr-save').addEventListener('click', () => { cfg = { type: $('#lr-type').value, url: $('#lr-url').value.trim(), tcp: $('#lr-tcp').value.trim() }; LS.set('local', cfg); $('#lr-out').textContent = '$ saved on this device:\n' + JSON.stringify(cfg, null, 2); });
    $('#lr-probe').addEventListener('click', probe);
    $('#lr-open').addEventListener('click', () => { location.hash = 'radio'; radio.open($('#lr-url').value.trim(), 'LOCAL RECEIVER · ' + $('#lr-url').value.trim()); });
    if (cfg.url || cfg.tcp) $('#lr-out').textContent = '$ saved config found — press “probe connection” to check it.';
  }
  return { init };
})();

/* ===================== BOOT ===================== */
async function boot() {
  applyTheme();
  clock(); setInterval(clock, 1000);
  heartbeat(); setInterval(heartbeat, 30000);
  try { state.cfg = await api('/api/config'); }
  catch { state.cfg = { defaultLocation: { lat: 46.2382, lon: -63.1311, label: 'Charlottetown, PEI' }, camSources: [], localReceiver: {} }; }
  if (!state.loc) state.loc = state.cfg.defaultLocation;
  $('#st-loc').textContent = '⊕ ' + state.loc.label;
  initSettings(); radio.init(); cams.init(); flights.init(); mapview.init(); learn.init(); local.init();
  window.addEventListener('hashchange', route); route();
}
boot();
})();
