# SIGNAL//SCANNER

A legal, public-sources-only signals dashboard for a laptop and an iPhone. You don't need any radio hardware: everything here comes from receivers, feeds and cameras that their owners publish for the public. There's a clearly marked hook for adding your own RTL-SDR later.

- **Radio**: 1,500+ live public web receivers merged from three directories: KiwiSDR (kiwisdr.com, via the rx.skywavelinux.com mirror), WebSDR/UberSDR/NovaSDR (websdr.org plus skywave), and OpenWebRX (receiverbook.de). Duplicates are removed.
  - 13 signal categories, grouped as Voice / Broadcast / Weather & time / Data / Reference:
    - Airband
    - Marine
    - Ham/HF
    - Shortwave
    - AM
    - FM
    - Weather/NOAA
    - Time signals
    - ADS-B
    - ACARS/HFDL
    - APRS
    - Satellites
    - Numbers-station references
  - 107 one-tap frequency presets, plus manual tuning.
  - You can filter by network (KiwiSDR, WebSDR or OpenWebRX). You can sort by distance, free slots, widest coverage, name or network. You can also limit the list to receivers whose coverage is confirmed.
  - Tapping a receiver opens it already tuned, either in-app or in a new tab.
  - Public live audio links: LiveATC (CYHZ, CYQM, CYQX) and Broadcastify.
- **Map**: every receiver (coloured by network and filterable by category), live aircraft for the area you're looking at, and road cameras on one Leaflet map, with layer toggles.
- **Flights**: live ADS-B around any lat/lon. The default is Charlottetown, PEI. Data comes from adsb.fi, with adsb.lol as fallback.
- **Cameras**: public DOT and traffic cameras (DriveBC, Caltrans) and public NOAA/NASA imagery. Province 511 feeds and Windy are optional and need free keys.
- **Learn**: a 15-lesson path in three levels (Listener → Operator → Engineer). Each lesson has a key idea, "try it live" buttons that jump into the tools, and a one-question check. Your progress is saved on the device.
- **Local RX**: a stub for your future RTL-SDR (rtl_tcp, SDR++, OpenWebRX). It only probes your own LAN and never fakes data.
- **Themes**: Phosphor (the default hacker look) and other presets, plus custom accent colours. They're saved in the browser.

## Run it on the Windows laptop

1. Install **Node.js LTS** (v20 or newer) from https://nodejs.org. There are **no npm packages** to install.
2. Copy this folder to the laptop, then double-click **`start.bat`**, or in a terminal run:
   ```
   cd signal-scanner
   node server.js        (or: npm start)
   ```
3. Open http://localhost:8080.

On macOS or Linux, run `./start.sh`. To use a different port: `set PORT=9000` (Windows) or `PORT=9000 node server.js`.

## Open it on your iPhone (same Wi-Fi)

1. When the server starts, it prints LAN addresses such as `http://192.168.1.23:8080`. You can also run `ipconfig` and use the laptop's IPv4 address.
2. The first time Node runs, Windows asks about the firewall. Tick **Private networks** and click Allow. If you missed it, go to Windows Security → Firewall → Allow an app → Node.js → Private.
3. On the iPhone, open that address in Safari. To use it like an app, tap Share → **Add to Home Screen**. On a phone the layout switches to a bottom tab bar.

The laptop must stay on and running the server. Only devices on your home network can reach it.

## Legal boundaries (please read)

This app only shows things that are **published for the public**:

- It **does not** decode, record or decrypt private or encrypted communications. In Canada, the *Radiocommunication Act* s.9 forbids divulging or using non-broadcast radio content you overhear, and decrypting encrypted signals. In the US, 47 U.S.C. §605 and the ECPA are similar.
- **ACARS/HFDL:** listening to aviation data is common hobby practice. Even so, the app warns you not to share or use message contents, because they are private correspondence.
- **Cameras:** only official public feeds (government DOT/511 and NOAA/NASA) and Windy's public webcam API. It never scans for or opens unsecured or private cameras. Unauthorized computer access is a crime (Criminal Code s.342.1).
- Web receivers belong to volunteers. Respect their user limits, and close tabs you're not using.

## Optional free API keys

Copy `config.example.json` to `config.json` and fill in any keys you want:

| key | for | get it |
|---|---|---|
| `windy` | worldwide public webcams | https://api.windy.com/keys (free tier) |
| `ns511` | Nova Scotia 511 cameras | https://511.novascotia.ca/developers |
| `nb511` | New Brunswick 511 cameras | https://511.gnb.ca/developers |
| `on511` | Ontario 511 cameras | https://511on.ca/developers |
| `ab511` | Alberta 511 cameras | https://511.alberta.ca/developers |

These work without a key: ADS-B, all receiver directories, DriveBC, Caltrans and NOAA/NASA imagery. Sources that need a key say so in the app, rather than failing silently.

## When you buy an RTL-SDR

The **Local RX** tab explains each setup and probes it on your LAN:

- **rtl_tcp**: `rtl_tcp -a 0.0.0.0`, then set `localReceiver.rtlTcp` to `127.0.0.1:1234`. The probe checks that the dongle answers with the RTL0 header.
- **SDR++ server mode** or **OpenWebRX**: run it, then set `localReceiver.url`, for example `http://127.0.0.1:8073`. OpenWebRX opens in the app's viewer.
- **readsb/dump1090** for ADS-B from your own antenna: a planned extension. Point the Flights tab at your local `aircraft.json`.

The probe refuses non-LAN addresses.

## Live monitor, activity scan & plain-language labels

- **Plain-language labels** — every band, category and preset now has a one-line, jargon-free explanation (e.g. *ACARS = short text messages airliners send to their airline*). It sits on top of the existing deeper write-ups.
- **Live monitor (best-effort)** — open a receiver, then open the 🎧 Live monitor under the viewer. Browsers can't reach the audio inside the cross-origin receiver window, so the monitor listens through **your microphone** — play the receiver aloud through your speakers. It shows a live level meter and an ACTIVE/quiet voice-activity indicator (Web Audio `AnalyserNode`).
- **Live captions** — use the browser's Web Speech API, so they only work on a **Chromium-based desktop browser** (Chrome/Edge/Opera); iOS Safari and Firefox get a clear in-UI fallback message. Captions are a rough guide, not a transcript — radio is noisy.
- **Translate → English** — each caption line is sent to `/api/translate`, a keyless server proxy to MyMemory that auto-detects the language and returns English. No API key is stored anywhere. If translation is unavailable, the original transcript still shows.
- **Scan for activity** — samples the first ~12 receivers of the current category/band a few seconds each (it can't poll all ~1,500 at once), flags which sound active right now, and floats "talking now" to the top; filter with the *talking now* checkbox. Depends on audio playing aloud for the mic to hear.

## Notes and limits

- Most KiwiSDR and WebSDR sites are plain **http**. The app opens them in the in-app viewer, which works locally. If a site refuses to be framed, use the ↗ button to open it in a new tab.
- Receiver directories are fetched live and cached. If a directory is down, bundled snapshots in `data/` are used instead. Run `npm run snapshots` to refresh them.
- Free ADS-B aggregators rate-limit, so the app refreshes every 15 s per view.
- Map tiles © OpenStreetMap contributors. The dark themes invert them with CSS.

## Development

```
npm test            # starts the server on a spare port and checks every endpoint (live data)
npm run snapshots   # refresh bundled receiver-directory fallbacks
```

Stack: Node's built-in `http` and `fetch` (zero dependencies), vanilla JS/CSS, and vendored Leaflet 1.9.4 and hls.js.

Data sources:
- adsb.fi and adsb.lol open data
- kiwisdr.com/public, rx.skywavelinux.com, websdr.org and receiverbook.de
- DriveBC
- Caltrans CWWP2
- NOAA GOES and NASA
- LiveATC and Broadcastify links
- Priyom and sigidwiki references
