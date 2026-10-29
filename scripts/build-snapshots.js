// Refresh the bundled offline fallback lists from the live public directories.
// Usage: node scripts/build-snapshots.js
const fs = require('fs'), path = require('path');
const { parseDyatlovJs, normRx, parseReceiverbookHtml } = require('../server.js');
(async () => {
  const get = async u => (await fetch(u, { headers: { 'User-Agent': 'SignalScanner/1.0' } })).text();
  const k = parseDyatlovJs(await get('https://rx.skywavelinux.com/kiwisdr_com.js')).filter(r => r.url && r.offline !== 'yes').map(r => normRx(r, 'kiwisdr'));
  const s = parseDyatlovJs(await get('https://rx.skywavelinux.com/static_rx.js')).filter(r => r.url).map(r => normRx(r, 'websdr'));
  fs.writeFileSync(path.join(__dirname, '../data/fallback-kiwisdr.json'), JSON.stringify(k));
  fs.writeFileSync(path.join(__dirname, '../data/fallback-websdr.json'), JSON.stringify(s));
  const rb = parseReceiverbookHtml(await get('https://www.receiverbook.de/map'));
  fs.writeFileSync(path.join(__dirname, '../data/fallback-receiverbook.json'), JSON.stringify(rb));
  console.log(`snapshot: ${k.length} KiwiSDR, ${s.length} WebSDR/UberSDR/OpenWebRX, ${rb.length} receiverbook.de`);
})().catch(e => { console.error(e); process.exit(1); });
