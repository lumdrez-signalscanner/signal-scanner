// Starts the server on a spare port and checks every endpoint returns real data.
// Usage: node scripts/smoke-test.js
const { spawn } = require('child_process');
const path = require('path');
const PORT = 18080 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const check = async (name, url, test) => {
  try {
    const r = await fetch(base + url); const ct = r.headers.get('content-type') || '';
    const body = ct.includes('json') ? await r.json() : await r.text();
    const info = test(body, r);
    results.push([r.ok && info !== false ? 'PASS' : 'FAIL', name, typeof info === 'string' ? info : '']);
  } catch (e) { results.push(['FAIL', name, e.message]); }
};
srv.stdout.on('data', async d => {
  if (!String(d).includes('running')) return;
  srv.stdout.removeAllListeners('data');
  await check('index.html', '/', b => b.includes('SIGNAL<span class="slash">//</span>SCANNER') && 'page served');
  await check('app.js', '/js/app.js', b => b.length > 1000 && `${b.length} bytes`);
  await check('app.css', '/css/app.css', b => b.includes('--accent') && `${b.length} bytes`);
  await check('leaflet', '/vendor/leaflet.js', b => b.length > 100000 && 'vendored');
  await check('health', '/api/health', b => b.ok);
  await check('config', '/api/config', b => `default ${b.defaultLocation.label}; cam sources ${b.camSources.map(s => s.id + (s.hasKey ? '' : '(no key)')).join(', ')}`);
  await check('signal categories', '/api/presets', b => b.categories.length >= 12 && `${b.categories.length} categories, ${b.categories.reduce((n, c) => n + c.presets.length, 0)} presets: ${b.categories.map(c => c.id).join(', ')}`);
  await check('learning path', '/learn/path.json', b => { const j = typeof b === 'string' ? JSON.parse(b) : b; const m = j.levels.flatMap(l => l.modules); return m.length >= 10 && m.every(x => x.quiz && x.quiz.opts[x.quiz.ans]) && `${j.levels.length} levels, ${m.length} lessons, all quizzes valid`; });
  await check('all receivers (merged)', '/api/receivers/all', b => b.total > 500 && b.stations.every(s => s.url && s.network) && `${b.total} unique: ${Object.entries(b.counts).map(([k, v]) => k + ' ' + v).join(', ')}; ${b.stations.filter(s => s.lat != null).length} mappable`);
  await check('ADS-B', '/api/adsb?lat=46.2382&lon=-63.1311&dist=250', b => b.aircraft.length >= 0 && `${b.aircraft.length} aircraft via ${b.source}; e.g. ${b.aircraft.slice(0, 3).map(a => (a.flight || a.hex) + ' ' + a.alt + 'ft').join(', ')}`);
  await check('KiwiSDR directory', '/api/receivers/kiwisdr', b => b.stations.length > 50 && `${b.stations.length} receivers via ${b.source}`);
  await check('WebSDR directory', '/api/receivers/websdr', b => b.stations.length > 10 && `${b.stations.length} receivers via ${b.source}${b.errors?.length ? ' [' + b.errors.join('; ') + ']' : ''}`);
  await check('Cameras: DriveBC', '/api/cameras?source=drivebc', b => b.cameras.length > 0 && `${b.cameras.length} cams, e.g. ${b.cameras[0].image}`);
  await check('Cameras: Caltrans D4', '/api/cameras?source=caltrans&district=4', b => b.cameras.length > 0 && `${b.cameras.length} cams, e.g. ${b.cameras[0].image}`);
  await check('Cameras: imagery', '/api/cameras?source=imagery', b => b.cameras.length > 0 && `${b.cameras.length} images`);
  await check('Cameras: 511 NS (key gate)', '/api/cameras?source=ns511', b => (b.needsKey ? 'correctly asks for key' : `${b.cameras.length} cams`));
  await check('Local probe (nothing running)', '/api/local/probe?rtltcp=127.0.0.1:1234', b => b.ok === false && `honest: ${b.error}`);
  await check('Local probe blocks public hosts', '/api/local/probe?url=http://example.com', b => b.ok === false && b.error);
  for (const [s, n, i] of results) console.log(`${s}  ${n.padEnd(32)} ${i}`);
  srv.kill();
  process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
});
setTimeout(() => { console.error('timeout'); srv.kill(); process.exit(1); }, 120000);
