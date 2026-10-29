#!/usr/bin/env node
/*
 * SIGNAL//SCANNER — legal public-signals monitoring dashboard.
 * Zero-dependency Node.js server (Node 18+). Run:  node server.js
 *
 * Only intentionally-public sources are used:
 *   - KiwiSDR / WebSDR / UberSDR / OpenWebRX receivers that owners publish to public directories
 *   - Government-published traffic cameras (DriveBC, Caltrans) + public satellite imagery
 *   - Public ADS-B aggregators (adsb.fi, adsb.lol)
 * Nothing here scans for, discovers, or accesses unsecured devices.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const UA = 'SignalScanner/1.0 (personal hobby dashboard; public data only)';

// ---------- config ----------
function loadConfig() {
  const def = {
    defaultLocation: { lat: 46.2382, lon: -63.1311, label: 'Charlottetown, PEI' },
    keys: { windy: '', ns511: '', nb511: '', on511: '', ab511: '' },
    localReceiver: { enabled: false, type: 'openwebrx', url: '', rtlTcp: '' },
  };
  try {
    const user = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    return { ...def, ...user, keys: { ...def.keys, ...(user.keys || {}) }, localReceiver: { ...def.localReceiver, ...(user.localReceiver || {}) } };
  } catch { return def; }
}
let CONFIG = loadConfig();

// ---------- tiny cache + fetch helpers ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}
async function fetchJSON(url, opts) { return JSON.parse(await fetchText(url, opts)); }
function readData(name) { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }

// ---------- receivers ----------
function parseBands(str) {
  return String(str || '').split(',').map(p => p.split('-').map(Number)).filter(b => b.length === 2 && b.every(Number.isFinite));
}
function parseGps(g) {
  const m = String(g || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [null, null];
}
function detectKind(url, network) {
  if (network === 'kiwisdr') return 'kiwisdr';
  if (/\/v2\//.test(url) || /ubersdr/i.test(url)) return 'ubersdr';
  if (/[?&]frequency=/.test(url)) return 'novasdr';
  if (/#freq=/.test(url)) return 'openwebrx';
  if (/[?&]f=/.test(url)) return 'kiwisdr';
  return 'websdr';
}
function baseUrl(url) { return String(url).replace(/[?#].*$/, ''); }
// Parse the "var x = [ {...}, ]" JS files used by the dyatlov map (rx.skywavelinux.com / rx.linkfanel.net)
function parseDyatlovJs(text) {
  const s = text.indexOf('['), e = text.lastIndexOf(']');
  if (s < 0 || e < 0) throw new Error('no array');
  return JSON.parse(text.slice(s, e + 1).replace(/,(\s*[\]}])/g, '$1'));
}
function normRx(r, network) {
  const url = r.url;
  const [lat, lon] = parseGps(r.gps);
  const kind = detectKind(url, network);
  return {
    id: r.id || url,
    name: String(r.name || url).replace(/\s+/g, ' ').trim(),
    url: baseUrl(url),
    kind, network,
    loc: r.loc || '', lat, lon,
    bands: parseBands(r.bands),
    users: r.users != null ? Number(r.users) : null,
    usersMax: r.users_max != null ? Number(r.users_max) : null,
    antenna: r.antenna || '', hw: r.sdr_hw || '',
  };
}
// kiwisdr.com/public/ embeds each receiver as HTML comments like <!-- name=... --> inside a cl-entry div
function parseKiwiPublicHtml(html) {
  const out = [];
  const chunks = html.split(/<div[^>]+class=['"]cl-entry/i).slice(1);
  for (const c of chunks) {
    const r = {};
    for (const m of c.matchAll(/<!--\s*([a-z_]+)=([\s\S]*?)-->/gi)) r[m[1]] = m[2].trim();
    const href = c.match(/href=['"](https?:\/\/[^'"]+)['"]/i);
    r.url = r.url || (href && href[1]);
    if (r.url && r.offline !== 'yes') out.push(r);
  }
  return out;
}
// websdr.org lists receivers as links with band info nearby; parse links pointing off-site
function parseWebsdrOrgHtml(html) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1];
    if (/websdr\.org|pa3fwm|google|twitter|facebook/i.test(url)) continue;
    const name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(url)) continue;
    seen.add(url);
    // look ahead a bit for frequency ranges like "7000-7200 kHz" / "144 MHz"
    const ctx = html.slice(m.index, m.index + 3000).replace(/<[^>]+>/g, ' ');
    const bands = [];
    for (const b of ctx.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(kHz|MHz)/gi)) {
      const mul = /mhz/i.test(b[3]) ? 1e6 : 1e3;
      bands.push(`${Math.round(b[1] * mul)}-${Math.round(b[2] * mul)}`);
      if (bands.length > 12) break;
    }
    out.push({ name, url, bands: bands.join(',') || '0-30000000' });
  }
  return out;
}

async function getKiwi() {
  return cached('kiwi', 10 * 60e3, async () => {
    const errors = [];
    try {
      const raw = parseKiwiPublicHtml(await fetchText('http://kiwisdr.com/public/', { timeout: 20000 }));
      if (raw.length > 20 && raw.filter(r => r.name && r.gps).length > raw.length / 2) return { source: 'kiwisdr.com/public (live)', live: true, stations: raw.map(r => normRx(r, 'kiwisdr')) };
      errors.push('kiwisdr.com/public parsed 0 entries');
    } catch (e) { errors.push('kiwisdr.com/public: ' + e.message); }
    for (const mirror of ['https://rx.skywavelinux.com/kiwisdr_com.js', 'https://rx.linkfanel.net/kiwisdr_com.js']) {
      try {
        const raw = parseDyatlovJs(await fetchText(mirror, { timeout: 20000 }))
          .filter(r => r.url && r.offline !== 'yes' && r.status !== 'offline');
        if (raw.length > 20) return { source: `${new URL(mirror).host} mirror of kiwisdr.com/public (live)`, live: true, errors, stations: raw.map(r => normRx(r, 'kiwisdr')) };
      } catch (e) { errors.push(mirror + ': ' + e.message); }
    }
    return { source: 'bundled snapshot (data/fallback-kiwisdr.json)', live: false, errors, stations: readData('fallback-kiwisdr.json') };
  });
}
async function getWebsdr() {
  return cached('websdr', 10 * 60e3, async () => {
    const errors = [];
    const curated = readData('curated-receivers.json').map(r => normRx(r, 'websdr'));
    let live = [], source = '';
    try {
      const raw = parseWebsdrOrgHtml(await fetchText('http://websdr.org/', { timeout: 20000 }));
      if (raw.length > 10) { live = raw.map(r => normRx(r, 'websdr')); source = 'websdr.org (live)'; }
      else errors.push('websdr.org parsed too few entries');
    } catch (e) { errors.push('websdr.org: ' + e.message); }
    try {
      const raw = parseDyatlovJs(await fetchText('https://rx.skywavelinux.com/static_rx.js'));
      live = live.concat(raw.filter(r => r.url && r.offline !== 'yes').map(r => normRx(r, 'websdr')));
      source = (source ? source + ' + ' : '') + 'rx.skywavelinux.com WebSDR/UberSDR/OpenWebRX list (live)';
    } catch (e) { errors.push('static_rx: ' + e.message); }
    let stations = live.length ? live : readData('fallback-websdr.json');
    if (!live.length) source = 'bundled snapshot (data/fallback-websdr.json)';
    // merge curated, de-dupe by base URL
    const seen = new Set(stations.map(s => s.url));
    for (const c of curated) if (!seen.has(c.url)) { stations.push(c); seen.add(c.url); }
    return { source: source + ' + curated list', live: live.length > 0, errors, stations };
  });
}

// ---------- receiverbook.de (OpenWebRX directory, also lists WebSDR + KiwiSDR) ----------
const TAG_RULES = [
  ['airband', /air ?band|aviation|\batc\b|aeronautical|118-137|vhf air/i],
  ['adsb', /ads-?b|1090|dump1090|readsb|\bmlat\b/i],
  ['acars', /acars|vdl|hfdl/i],
  ['aprs', /\baprs\b/i],
  ['marine', /marine|\bais\b|navtex|maritime/i],
  ['sat', /satellite|meteor|\bnoaa\b|\bapt\b|\blrpt\b|\biss\b|qo-?100|goes/i],
  ['wx', /weather|wefax|volmet/i],
  ['vhf', /\bvhf\b|\buhf\b|\b2 ?m\b|70 ?cm|144|430|446|pmr/i],
  ['hf', /\bhf\b|shortwave|short wave|0-30|0 - 30|30 ?mhz/i],
];
function tagText(text) { return TAG_RULES.filter(([, re]) => re.test(text)).map(([t]) => t); }
function parseReceiverbookHtml(html) {
  const m = html.match(/var receivers = (\[[\s\S]*?\]);\s*\n/);
  if (!m) throw new Error('receivers array not found');
  const out = [];
  for (const site of JSON.parse(m[1])) {
    const [lon, lat] = site.location?.coordinates || [];
    for (const r of site.receivers || []) {
      if (!r.url) continue;
      const network = r.type === 'KiwiSDR' ? 'kiwisdr' : r.type === 'WebSDR' ? 'websdr' : 'openwebrx';
      const name = String(r.label || site.label || r.url).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const bands = [];
      for (const b of name.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(kHz|MHz|GHz)/gi)) {
        const mul = { khz: 1e3, mhz: 1e6, ghz: 1e9 }[b[3].toLowerCase()];
        if (+b[2] > +b[1]) bands.push([Math.round(b[1] * mul), Math.round(b[2] * mul)]);
      }
      out.push({ id: 'rb:' + r.url, name: name.slice(0, 160), url: r.url.replace(/[?#].*$/, ''), kind: network, network,
        loc: String(site.label || '').trim(), lat: lat ?? null, lon: lon ?? null, bands: bands.length ? bands : null,
        users: null, usersMax: null, antenna: '', hw: r.version ? `${r.type} ${r.version}` : r.type, src: 'receiverbook' });
    }
  }
  return out;
}
async function getReceiverbook() {
  return cached('rb', 15 * 60e3, async () => {
    try {
      const st = parseReceiverbookHtml(await fetchText('https://www.receiverbook.de/map', { timeout: 20000 }));
      if (st.length > 50) return { source: 'receiverbook.de (live)', live: true, stations: st };
    } catch (e) { return { source: 'bundled snapshot (data/fallback-receiverbook.json)', live: false, errors: [e.message], stations: readData('fallback-receiverbook.json') }; }
    return { source: 'bundled snapshot (data/fallback-receiverbook.json)', live: false, stations: readData('fallback-receiverbook.json') };
  });
}
const hostKey = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + ':' + (x.port || (x.protocol === 'https:' ? 443 : 80))).toLowerCase(); } catch { return String(u).toLowerCase(); } };
// Merge every directory into one de-duplicated list with category tags.
async function getAllReceivers() {
  return cached('all', 60e3, async () => {
    const [k, w, rb] = await Promise.all([getKiwi(), getWebsdr(), getReceiverbook()]);
    const out = [], seen = new Set(), kiwiPts = [];
    const push = r => {
      const key = hostKey(r.url); if (seen.has(key)) return false;
      seen.add(key);
      out.push({ ...r, tags: tagText(`${r.name} ${r.antenna} ${r.hw}`) });
      return true;
    };
    for (const r of k.stations) { if (push(r) && r.lat != null) kiwiPts.push([r.lat, r.lon]); }
    for (const r of w.stations) push(r);
    let added = 0;
    for (const r of rb.stations) {
      // receiverbook's KiwiSDR entries use direct URLs while kiwisdr.com uses proxy URLs; drop any within ~1 km of a known Kiwi
      if (r.network === 'kiwisdr' && r.lat != null && kiwiPts.some(([a, b]) => Math.abs(a - r.lat) < 0.01 && Math.abs(b - r.lon) < 0.015)) continue;
      if (push(r)) added++;
    }
    const counts = {}; for (const r of out) counts[r.network] = (counts[r.network] || 0) + 1;
    return { total: out.length, counts, sources: [
      { name: 'KiwiSDR', count: k.stations.length, source: k.source, live: k.live },
      { name: 'WebSDR / UberSDR / NovaSDR', count: w.stations.length, source: w.source, live: w.live },
      { name: 'receiverbook.de (OpenWebRX + extra WebSDR/Kiwi)', count: added, source: rb.source, live: rb.live },
    ], stations: out };
  });
}

// ---------- ADS-B ----------
function normAc(a) {
  return {
    hex: a.hex, flight: (a.flight || '').trim(), reg: a.r || '', type: a.t || '', desc: a.desc || '',
    lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, track: a.track, vr: a.baro_rate ?? a.geom_rate,
    squawk: a.squawk || '', category: a.category || '', emergency: a.emergency || 'none',
    dst: a.dst, seen: a.seen,
  };
}
async function getAdsb(lat, lon, dist) {
  const key = `adsb:${lat.toFixed(2)}:${lon.toFixed(2)}:${dist}`;
  return cached(key, 5000, async () => {
    const errors = [];
    try {
      const j = await fetchJSON(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`, { timeout: 12000 });
      return { source: 'adsb.fi', now: j.now, aircraft: (j.aircraft || j.ac || []).filter(a => a.lat != null).map(normAc) };
    } catch (e) { errors.push('adsb.fi: ' + e.message); }
    try {
      const j = await fetchJSON(`https://api.adsb.lol/v2/point/${lat}/${lon}/${dist}`, { timeout: 12000 });
      return { source: 'adsb.lol', now: j.now, errors, aircraft: (j.ac || []).filter(a => a.lat != null).map(normAc) };
    } catch (e) { errors.push('adsb.lol: ' + e.message); }
    const err = new Error('All ADS-B sources failed'); err.details = errors; throw err;
  });
}

// ---------- cameras ----------
const CAM_SOURCES = {
  drivebc: { label: 'DriveBC — British Columbia highway cams', needsKey: false },
  caltrans: { label: 'Caltrans — California highway cams (districts 1–12)', needsKey: false },
  imagery: { label: 'Weather & space imagery (NOAA / NASA)', needsKey: false },
  ns511: { label: '511 Nova Scotia (free key)', needsKey: 'ns511', base: 'https://511.novascotia.ca' },
  nb511: { label: '511 New Brunswick (free key)', needsKey: 'nb511', base: 'https://511.gnb.ca' },
  on511: { label: '511 Ontario (free key)', needsKey: 'on511', base: 'https://511on.ca' },
  ab511: { label: '511 Alberta (free key)', needsKey: 'ab511', base: 'https://511.alberta.ca' },
  windy: { label: 'Windy Webcams — public webcams near you (free key)', needsKey: 'windy' },
};
async function getCameras(source, opts) {
  const src = CAM_SOURCES[source];
  if (!src) throw new Error('unknown source');
  if (src.needsKey && !CONFIG.keys[src.needsKey]) {
    return { source, label: src.label, needsKey: src.needsKey, cameras: [], message: `Add a free API key as keys.${src.needsKey} in config.json to enable this source.` };
  }
  if (source === 'drivebc') {
    return cached('cam:drivebc', 5 * 60e3, async () => {
      const j = await fetchJSON('https://www.drivebc.ca/api/webcams/', { timeout: 25000 });
      const cams = j.filter(c => c.is_on && c.should_appear !== false).map(c => ({
        id: 'dbc-' + c.id, name: c.name, caption: c.caption, region: c.region_name || '', road: c.highway_description || '',
        lat: c.location?.coordinates?.[1], lon: c.location?.coordinates?.[0],
        image: 'https://www.drivebc.ca' + String(c.links?.imageDisplay || `/images/${c.id}.jpg`).replace(/\?.*$/, ''),
        refreshSec: Math.max(60, Math.round(c.update_period_mean || 300)), stream: null,
        credit: 'DriveBC / BC Ministry of Transportation', page: `https://www.drivebc.ca/cameras/${c.id}`,
      }));
      return { source, label: src.label, cameras: cams };
    });
  }
  if (source === 'caltrans') {
    const d = Math.min(12, Math.max(1, parseInt(opts.district || '4', 10)));
    const dd = String(d).padStart(2, '0');
    return cached('cam:caltrans:' + d, 5 * 60e3, async () => {
      const j = await fetchJSON(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, { timeout: 25000 });
      const cams = (j.data || []).map(x => x.cctv).filter(c => c && c.inService === 'true' && c.imageData?.static?.currentImageURL).map(c => ({
        id: 'ct-' + d + '-' + c.index, name: c.location.locationName, caption: `${c.location.route} · ${c.location.direction || ''}`,
        region: `${c.location.nearbyPlace || ''}, ${c.location.county || ''} Co.`, road: c.location.route,
        lat: parseFloat(c.location.latitude), lon: parseFloat(c.location.longitude),
        image: c.imageData.static.currentImageURL,
        refreshSec: Math.max(60, parseInt(c.imageData.static.currentImageUpdateFrequency || '5', 10) * 60),
        stream: c.imageData.streamingVideoURL || null, credit: 'Caltrans (California DOT)', page: 'https://cwwp2.dot.ca.gov/',
      }));
      return { source, label: src.label + ` — District ${d}`, district: d, cameras: cams };
    });
  }
  if (source === 'imagery') {
    return { source, label: src.label, cameras: readData('public-imagery.json') };
  }
  if (source === 'windy') {
    const { lat, lon } = opts;
    return cached(`cam:windy:${lat}:${lon}`, 10 * 60e3, async () => {
      const j = await fetchJSON(`https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},150&include=images,location,player,urls&limit=50`,
        { headers: { 'x-windy-api-key': CONFIG.keys.windy } });
      const cams = (j.webcams || []).map(w => ({
        id: 'windy-' + w.webcamId, name: w.title, caption: w.location?.city || '', region: [w.location?.region, w.location?.country].filter(Boolean).join(', '),
        lat: w.location?.latitude, lon: w.location?.longitude,
        image: w.images?.current?.preview || w.images?.current?.thumbnail, refreshSec: 600,
        stream: null, player: w.player?.day || w.player?.live || null, credit: 'Windy.com Webcams', page: w.urls?.detail || 'https://www.windy.com/webcams',
      }));
      return { source, label: src.label, cameras: cams };
    });
  }
  // IBI-platform 511 sites (NS, NB, ON, AB) share the same v2 API
  return cached('cam:' + source, 5 * 60e3, async () => {
    const j = await fetchJSON(`${src.base}/api/v2/get/cameras?key=${encodeURIComponent(CONFIG.keys[src.needsKey])}&format=json`, { timeout: 25000 });
    const cams = [];
    for (const c of j) {
      const views = c.Views || (c.Url ? [{ Url: c.Url, Description: '' }] : []);
      views.forEach((v, i) => {
        if (v.Status && /disabled/i.test(v.Status)) return;
        cams.push({ id: `${source}-${c.Id}-${i}`, name: c.Location || c.Name || c.Roadway, caption: [c.Roadway, c.Direction, v.Description].filter(Boolean).join(' · '),
          region: c.Organization || '', lat: c.Latitude, lon: c.Longitude, image: v.Url, refreshSec: 120, stream: null, credit: src.label.replace(/ \(.*/, ''), page: src.base });
      });
    }
    return { source, label: src.label, cameras: cams };
  });
}

// ---------- local receiver probe (honest reachability check only) ----------
function isPrivateHost(h) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|[a-z0-9-]+\.local$)/i.test(h);
}
function probeRtlTcp(hostport) {
  return new Promise(resolve => {
    const [host, port] = hostport.split(':');
    if (!isPrivateHost(host)) return resolve({ ok: false, error: 'Only local/LAN addresses can be probed.' });
    const sock = net.connect({ host, port: parseInt(port || '1234', 10), timeout: 3000 });
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 12) {
        const magic = buf.slice(0, 4).toString('ascii');
        const tuner = ['unknown', 'E4000', 'FC0012', 'FC0013', 'FC2580', 'R820T', 'R828D'][buf.readUInt32BE(4)] || 'unknown';
        sock.destroy();
        resolve({ ok: magic === 'RTL0', magic, tuner, gainCount: buf.readUInt32BE(8) });
      }
    });
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'timeout (is rtl_tcp running?)' }); });
    sock.on('error', e => resolve({ ok: false, error: e.message }));
  });
}
async function probeHttp(u) {
  let url;
  try { url = new URL(u); } catch { return { ok: false, error: 'invalid URL' }; }
  if (!isPrivateHost(url.hostname)) return { ok: false, error: 'Only local/LAN addresses can be probed.' };
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(url, { signal: ctl.signal });
    const t = (await r.text()).slice(0, 4000);
    const kind = /openwebrx/i.test(t) ? 'OpenWebRX' : /kiwi/i.test(t) ? 'KiwiSDR' : /websdr/i.test(t) ? 'WebSDR' : 'web page';
    return { ok: r.ok, status: r.status, detected: kind };
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
}


// ---------- translation (best-effort, no API key) ----------
// Uses the public MyMemory endpoint (no key, rate-limited). Auto-detects the
// source language and returns English. Fails gracefully: if it can't translate,
// the caller still shows the original transcript.
async function translateToEnglish(text) {
  const q = String(text || '').trim();
  if (!q) return { ok: false, note: 'nothing to translate' };
  if (q.length > 500) return { ok: false, note: 'line too long to translate', original: q };
  return cached('tr:' + q.toLowerCase(), 60 * 60e3, async () => {
    try {
      const j = await fetchJSON(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent('autodetect|en')}`,
        { timeout: 8000 });
      const out = j.responseData && j.responseData.translatedText;
      const detected = (j.responseData && j.responseData.detectedLanguage) || null;
      if (j.responseStatus !== 200 || !out || /PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(out)) {
        // happens when the text is already English (source == target)
        return { ok: true, original: q, translated: q, detected: detected || 'en', alreadyEnglish: true, source: 'mymemory.translated.net' };
      }
      return { ok: true, original: q, translated: out, detected, source: 'mymemory.translated.net' };
    } catch (e) {
      return { ok: false, note: 'translation unavailable', original: q, error: e.message };
    }
  });
}

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function serveStatic(req, res, pathname) {
  let p = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
const num = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = Object.fromEntries(u.searchParams);
  try {
    switch (u.pathname) {
      case '/api/health': return send(res, 200, { ok: true, time: new Date().toISOString() });
      case '/api/config': CONFIG = loadConfig(); return send(res, 200, {
        defaultLocation: CONFIG.defaultLocation, localReceiver: CONFIG.localReceiver,
        camSources: Object.entries(CAM_SOURCES).map(([id, s]) => ({ id, label: s.label, needsKey: s.needsKey || null, hasKey: !s.needsKey || !!CONFIG.keys[s.needsKey] })),
      });
      case '/api/receivers/kiwisdr': return send(res, 200, await getKiwi());
      case '/api/receivers/websdr': return send(res, 200, await getWebsdr());
      case '/api/receivers/all': return send(res, 200, await getAllReceivers());
      case '/api/receivers/receiverbook': return send(res, 200, await getReceiverbook());
      case '/api/presets': return send(res, 200, readData('presets.json'));
      case '/api/translate': {
        const text = (q.text || '').slice(0, 500);
        if (!text) return send(res, 200, { ok: false, note: 'pass ?text=' });
        return send(res, 200, await translateToEnglish(text));
      }
      case '/api/adsb': {
        const d = CONFIG.defaultLocation;
        return send(res, 200, await getAdsb(num(q.lat, d.lat, -90, 90), num(q.lon, d.lon, -180, 180), Math.round(num(q.dist, 150, 5, 250))));
      }
      case '/api/cameras': {
        const d = CONFIG.defaultLocation;
        return send(res, 200, await getCameras(q.source || 'drivebc', { district: q.district, lat: num(q.lat, d.lat, -90, 90), lon: num(q.lon, d.lon, -180, 180) }));
      }
      case '/api/local/probe': {
        if (q.rtltcp) return send(res, 200, await probeRtlTcp(q.rtltcp));
        if (q.url) return send(res, 200, await probeHttp(q.url));
        return send(res, 400, { ok: false, error: 'pass ?url= or ?rtltcp=host:port' });
      }
    }
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    console.error(u.pathname, e.message, e.details || '');
    return send(res, 502, { error: e.message, details: e.details || null });
  }
});

module.exports = { parseReceiverbookHtml, tagText, parseDyatlovJs, normRx, parseKiwiPublicHtml, parseWebsdrOrgHtml };
if (require.main === module) server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  SIGNAL//SCANNER is running');
  console.log(`  Laptop:  http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  iPhone (same Wi-Fi):  http://${ip}:${PORT}`));
  console.log('  Press Ctrl+C to stop.\n');
});
