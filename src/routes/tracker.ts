import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { Bindings } from "../index";

const tracker = new Hono<{ Bindings: Bindings }>();

// ==========================================
// 1. RADAR OMNI-TRACKER (With Guest, Blackbox, Auto-Pause & Temp Tracker)
// ==========================================
tracker.get("/record", async (c) => {
  const token = getCookie(c, "gaspool_session");
  let isCaptain = false;
  let userEmail = "Tamu Peleton";

  if (token) {
    try {
      const payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as {
        email: string;
      };
      userEmail = payload.email;
      isCaptain = true;
    } catch (e) {}
  }

  const captainName = userEmail.split("@")[0].toUpperCase();
  const type = c.req.query("type") || "ride";
  const room = (c.req.query("room") || "SINGLE_MODE").toUpperCase();
  const routeId = (c.req.query("route") || "").replace(/[^0-9]/g, "");
  const isPeleton = room !== "SINGLE_MODE";

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <title>Gaspool Record: ${type.toUpperCase()}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
        <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
        <style>
            * { box-sizing: border-box; }
            :root { --primary: #FF5F00; --bg: #000; --card: rgba(255, 255, 255, 0.1); }
            body { font-family: 'Inter', sans-serif; background: #000; color: #fff; margin: 0; overflow: hidden; }
            #map { height: 100vh; width: 100%; position: absolute; z-index: 1; }
            .ui { position: absolute; left: 0; width: 100%; z-index: 100; pointer-events: none; }
            .top { top: 0; padding: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
            .bottom { bottom: 0; padding: 25px; background: linear-gradient(0deg, #000 0%, transparent 100%); pointer-events: auto; }
            
            .stat-card { background: rgba(0,0,0,0.6); backdrop-filter: blur(20px); border-radius: 18px; border: 1px solid rgba(255,255,255,0.1); padding: 15px; pointer-events: auto; }
            .label { font-size: 9px; font-weight: 900; color: #aaa; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px; transition: 0.3s;}
            .val { font-size: 20px; font-weight: 900; color: #fff; }
            .val-main { font-size: 4rem; font-weight: 900; color: var(--primary); font-style: italic; text-align: center; margin: 5px 0; text-shadow: 0 0 20px rgba(255,95,0,0.4); }
            
            .btn { padding: 20px; border-radius: 15px; border: none; font-weight: 900; cursor: pointer; text-transform: uppercase; font-style: italic; width: 100%; pointer-events: auto; transition: 0.3s; }
            .btn:active { transform: scale(0.95); }
            .btn-start { background: var(--primary); color: #fff; }
            .btn-stop { background: #e74c3c; color: #fff; display: none; }
            .btn-cancel { background: rgba(231,76,60,0.8); width: auto; padding: 10px 15px; font-size: 10px; color: #fff; border-radius: 10px; border: none; cursor: pointer; pointer-events: auto; position: relative; /* Menyelamatkan interaksi klik di iOS/Mobile */ z-index: 101; }
            
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }

            #safeMode { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 1000; flex-direction: column; justify-content: center; align-items: center; padding: 30px; text-align: center; }
            #guestFinish { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 999; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
            #souvenir-card { background: #000; border: 1px solid var(--primary); padding: 40px 20px; border-radius: 30px; width: 100%; max-width: 400px; text-align: center; margin-bottom: 20px; position: relative; }
            
            .radio-panel { position: fixed; bottom: 320px; right: 15px; width: 200px; background: rgba(10, 10, 18, 0.85); border-radius: 12px; padding: 10px; z-index: 1050; border: 1px solid rgba(255,95,0,0.3); display: none; pointer-events: auto; backdrop-filter: blur(10px); }
            .radio-feed { max-height: 120px; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 5px; }
            .radio-item { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 5px; cursor: pointer; }
            .btn-ptt { width: 100%; background: #e74c3c; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 900; font-size: 11px; cursor: pointer; transition: 0.2s; }
            .btn-ptt.recording { background: #c0392b; box-shadow: 0 0 15px #e74c3c; }
            
            #stealthOverlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 99999; display: none; flex-direction: column; justify-content: center; align-items: center; color: #333; user-select: none; }
            .peleton-label { background: rgba(142, 68, 173, 0.8); color: white; padding: 2px 8px; border-radius: 5px; font-size: 10px; font-weight: bold; border: 1px solid #fff; white-space: nowrap; }
            .route-status { display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.12); color: #3498db; font-size: 10px; line-height: 1.35; font-weight: 900; max-width: 230px; }
            .route-status span { display: block; color: #aaa; font-size: 9px; margin-top: 2px; }
            .btn-reroute { display:none; background:rgba(231,76,60,0.2); border:1px solid #e74c3c; padding:10px; font-size:10px; color:#e74c3c; }
            .btn-repeat-nav { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); padding:10px; font-size:10px; color:#fff; }
            .btn-repeat-nav:disabled { opacity: 0.42; cursor: not-allowed; }
            .nav-voice-status { margin-top:-4px; margin-bottom:10px; color:#94a3b8; font-size:9px; font-weight:900; letter-spacing:1px; text-transform:uppercase; pointer-events:none; }
            .privacy-row { display: grid; grid-template-columns: 140px 1fr; gap: 10px; align-items: center; margin-bottom: 10px; pointer-events:auto; }
            .privacy-hint { color: #94a3b8; font-size: 9px; font-weight: 900; line-height: 1.35; text-transform: uppercase; letter-spacing: 0.8px; }
            .resume-summary { width: 100%; max-width: 380px; margin: 0 auto 18px; padding: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; text-align: left; }
            .resume-title { color: #fff; font-size: 12px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
            .resume-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .resume-item { padding: 9px; border-radius: 11px; background: rgba(0,0,0,0.28); }
            .resume-label { color: #94a3b8; font-size: 8px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
            .resume-value { color: #fff; font-size: 12px; font-weight: 900; line-height: 1.3; word-break: break-word; }
            .resume-warning { display:none; margin-top: 10px; color: #f1c40f; font-size: 10px; font-weight: 900; line-height: 1.35; }
            
            .join-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.9); z-index:9000; display: ${isCaptain ? "none" : "flex"}; flex-direction: column; justify-content: center; align-items: center; padding: 20px;}
            .join-input { width: 100%; padding: 15px; margin: 15px 0; background: #000; border: 1px solid #333; color: white; border-radius: 12px; font-size: 16px; text-align: center; outline: none; max-width: 300px;}
        </style>
    </head>
    <body>
        <div id="join-overlay" class="join-overlay">
            <h2 style="color:var(--primary); font-style:italic; margin-top:0;">RADAR TAMU</h2>
            <input type="text" id="guest-name" class="join-input" placeholder="Nama Anda (Max 15 Karakter)" maxlength="15">
            <button onclick="startAsGuest()" class="btn btn-start" style="max-width: 300px;">GABUNG PELETON</button>
            <button onclick="window.location='/'" class="btn" style="background:transparent; color:#aaa; max-width: 300px; margin-top:10px;">BATAL</button>
        </div>

        <div id="safeMode">
            <h2 style="color:var(--primary); font-style:italic; font-size: 2.5rem; margin-top:0;">⚠️ BANTING SESI!</h2>
            <p id="resume-copy" style="color:#aaa; font-weight:bold; margin-bottom:16px; font-size:14px;">Ditemukan sesi gowes yang belum tersimpan.<br>Lanjutkan misi atau buang data?</p>
            <div id="resume-summary" class="resume-summary">
                <div class="resume-title">Ringkasan Blackbox</div>
                <div class="resume-grid">
                    <div class="resume-item"><div class="resume-label">Jarak</div><div class="resume-value" id="resume-distance">-</div></div>
                    <div class="resume-item"><div class="resume-label">Durasi</div><div class="resume-value" id="resume-duration">-</div></div>
                    <div class="resume-item"><div class="resume-label">Mulai</div><div class="resume-value" id="resume-started">-</div></div>
                    <div class="resume-item"><div class="resume-label">Update</div><div class="resume-value" id="resume-saved">-</div></div>
                    <div class="resume-item"><div class="resume-label">Titik GPS</div><div class="resume-value" id="resume-points">-</div></div>
                    <div class="resume-item"><div class="resume-label">Status</div><div class="resume-value" id="resume-privacy">PRIVATE</div></div>
                    <div class="resume-item" style="grid-column:1 / -1;"><div class="resume-label">Rute</div><div class="resume-value" id="resume-route">Tanpa route plan</div></div>
                </div>
                <div id="resume-warning" class="resume-warning">Data mungkin tidak lengkap. Cek jarak dan titik GPS sebelum lanjut.</div>
            </div>
            <button class="btn" style="background:#2ecc71; color:#000; margin-bottom:12px;" onclick="resumeSession()">▶️ RESUME MISSION</button>
            <button class="btn" style="background:#e74c3c; color:#fff;" onclick="discardSession()">🗑️ ABORT & DELETE</button>
        </div>

        <div id="guestFinish">
            <div id="souvenir-card">
                <div style="font-size:11px; font-weight:900; color:#666; letter-spacing:3px; margin-bottom:10px;">MISSION DEBRIEF</div>
                <div id="fin-dist" style="font-size:4.5rem; font-weight:900; color:#fff; line-height:1;">0.00</div>
                <div style="font-size:14px; font-weight:900; color:var(--primary); margin-bottom:20px;">KILOMETERS</div>
                
                <div style="display:flex; justify-content:space-around; border-top:1px solid #222; padding-top:20px;">
                    <div><div class="label">TIME</div><div id="fin-time" style="font-weight:900; color:#fff; font-size:18px;">00:00</div></div>
                    <div><div class="label">AVG SPEED</div><div id="fin-spd" style="font-weight:900; color:#fff; font-size:18px;">0.0</div></div>
                </div>
                <img src="/assets/gaspool.png" alt="Gaspool" style="height:80px; margin-top:40px; opacity: 0.9;">
            </div>
            
            <button class="btn" style="background:#27ae60; margin-bottom:12px;" onclick="exportStats()">📸 SAVE STATS IMAGE</button>
            <button class="btn" style="background:#2980b9; margin-bottom:12px;" onclick="exportGPX()">📥 DOWNLOAD GPX</button>
            <button class="btn" style="background:#333;" onclick="window.location='/'">BACK TO BASE</button>
        </div>

        <div id="stealthOverlay" ondblclick="disableStealth()">
            <div style="font-size: 60px; filter: grayscale(1); opacity: 0.1; margin-bottom: 20px;">🚴‍♂️</div>
            <div style="font-size: 10px; letter-spacing: 2px; opacity: 0.3; font-weight: 900;">STEALTH MODE ACTIVE</div>
            <div style="font-size: 9px; margin-top: 10px; opacity: 0.2;">Ketuk 2x untuk membuka</div>
        </div>

        <div id="map"></div>
        
        <div class="ui top">
            <div class="stat-card" style="border-left: 4px solid ${isPeleton ? "#8e44ad" : "#2ecc71"};">
                <div class="label">${type.toUpperCase()} MODE</div>
                <div
  id="gps-status"
  style="
    font-size:11px;
    font-weight:900;
    color:${isPeleton ? "#8e44ad" : "#2ecc71"};
  "
>
  ● ${isPeleton ? "PELETON: " + room : "SATELLITE ACTIVE"}
</div>
                <div id="route-status" class="route-status"></div>
            </div>
            <button class="btn-cancel" onclick="cancelRec()">🛑 ABORT</button>
        </div>

        <div id="radioPanel" class="radio-panel">
            <div style="font-size: 11px; font-weight: 900; color: var(--primary); margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">🎙️ RADIO PELETON</div>
            <div class="radio-feed" id="radioFeed"></div>
            <button class="btn-ptt" id="btnPTT" onmousedown="startPTT(event)" onmouseup="stopPTT(event)" onmouseleave="stopPTT(event)" ontouchstart="startPTT(event)" ontouchend="stopPTT(event)">
                🎤 TAHAN BICARA
            </button>
        </div>

        <div class="ui bottom">
            <div
  style="
    text-align:center;
    margin-bottom:8px;
  "
>
  <div
    style="
      font-size:10px;
      font-weight:900;
      letter-spacing:2px;
      color:#aaa;
    "
  >
    DISTANCE
  </div>

  <div
    class="val-main"
    id="main-val"
  >
    0.00
  </div>

  <div
    style="
      font-size:14px;
      font-weight:900;
      color:var(--primary);
      margin-top:-8px;
    "
  >
    KM
  </div>
</div>
            <div class="grid-2">
                <div class="stat-card">
                    <div class="label">MOVING TIME</div>
                    <div class="val" id="val-time">00:00:00</div>
                </div>
                <div class="stat-card">
                    <div class="label">SPEED KM/H</div>
                    <div class="val" id="val-speed">0.0</div>
                </div>
            </div>
            
            <div style="display:flex; gap:10px; margin-bottom:10px; pointer-events:auto;">
			<button id="btn-recenter" class="btn" style="background:rgba(52,152,219,0.2); border:1px solid #3498db; padding:10px; font-size:10px; color:#3498db; display:none; position:relative; z-index:101;" onclick="recenterMap()">📍 RECENTER</button>
            <button id="btn-stealth" class="btn" style="background:rgba(255,255,255,0.1); padding:10px; font-size:10px; color:#fff;" onclick="enableStealth()">🔒 STEALTH</button>
            <button id="btn-nav-voice" class="btn" style="background:rgba(52,152,219,0.2); border:1px solid #3498db; padding:10px; font-size:10px; color:#3498db;" onclick="toggleNavVoice()">🔊 SUARA</button>
            <button id="btn-repeat-nav" class="btn btn-repeat-nav" onclick="repeatLastRouteInstruction()" disabled>ULANGI</button>
                ${isCaptain ? `<button id="btn-reroute" class="btn btn-reroute" onclick="rerouteToDestination()">↻ REROUTE</button>` : ""}
                ${isPeleton ? `<button class="btn" style="background:rgba(37, 211, 102, 0.2); border: 1px solid #25D366; padding:10px; font-size:10px; color:#2ecc71;" onclick="shareSpectator()">📡 SHARE RADAR</button>` : ""}
            </div>
            <div id="nav-voice-status" class="nav-voice-status">SUARA NAV SIAP</div>
            <div class="privacy-row">
                <button id="btn-privacy" class="btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.14); padding:10px; font-size:10px; color:#fff;" onclick="toggleRidePrivacy()">🔒 PRIVATE</button>
                <div id="privacy-hint" class="privacy-hint">Tidak tampil di profil publik.</div>
            </div>

            <button class="btn btn-start" id="btn-start" onclick="mulai()">▶️ INITIATE TRACKING</button>
            <button class="btn btn-stop" id="btn-stop" onclick="selesai()">⬜ TERMINATE & SAVE</button>
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
        <script>
            let map, path = [], dist = 0, startT = 0, rec = false, watchId, radarInt;
			let clockInt, movingTime = 0, lastTick = Date.now(), isPaused = false, lastAnnouncedKm = 0, lastSave = 0;
			let skippedClockGapSeconds = 0;

			// Variabel Elevasi (Tanjakan)
			let totalElevation = 0, lastAlt = null;

			// Variabel Suhu & Audio
			let tempReadings = [], lastTempCheck = 0;
			let playedAudioUrls = new Set();
			let radarTick = 0; // Untuk hitung throttle radar
			let autoFollow = true;
			let isStealthMode = false;
			let lastVisualUpdate = 0;
			let lastStealthVoiceHint = 0;
			let rideIsPublic = false;
			const NORMAL_MAX_CLOCK_DELTA_SECONDS = 10;
			const STEALTH_MAX_CLOCK_DELTA_SECONDS = 30;
			const REST_CLOCK_GAP_SECONDS = 120;

			const isCap = ${isCaptain};
			const key = 'gaspool_blackbox_session';
			const roomID = "${room}";
			const plannedRouteId = "${routeId}";
			let activePlannedRouteId = plannedRouteId;
			let userName = "${captainName}";
			let plannedRouteData = null;
			let plannedRouteLine = null;
			let plannedRouteInstructions = [];
			let plannedRouteCoords = [];
			let routeNextInstructionIndex = 0;
			let routeInstructionMarks = {};
			let routeVoiceEnabled = true;
			let routeVoiceReady = false;
			let lastRouteSpeech = 0;
			let routeSpeechQueue = [];
			let routeSpeechBusy = false;
			let lastSpokenRouteText = '';
			let lastInstructionSpeechText = '';
			let latestPosition = null;
			let rerouteInProgress = false;
			let offRouteState = {
				active: false,
				warned: false,
				lastWarn: 0,
				lastDistance: null
			};

			const OFF_ROUTE_WARN_M = 80;
			const OFF_ROUTE_M = 120;
			const BACK_ON_ROUTE_M = 60;
			const ROUTE_SPEECH_COOLDOWN = 6500;
			const STEALTH_VISUAL_INTERVAL = 15000;
			const NORMAL_VISUAL_INTERVAL = 1000;

			// --- INISIALISASI INDEXEDDB (ANTI NGE-LAG & BUNKER MODE) ---
			const DB_NAME = "GaspoolDB_TS";
			const STORE_NAME = "gaspool_points";
			const BUNKER_STORE = "sync_queue";
			let db;
			
			async function waitDB() {

  let tries = 0;

  while (!db && tries < 20) {

    await new Promise(
      r => setTimeout(r, 250)
    );

    tries++;

  }

  return !!db;

}

			// Naikkan versi ke 2 agar browser membuat tabel brankas baru
			try {
    // Cek dulu apakah browser mendukung dan mengizinkan IndexedDB
    const request = window.indexedDB ? indexedDB.open(DB_NAME, 2) : null;
    
    if (request) {
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { autoIncrement: true });
            if (!db.objectStoreNames.contains(BUNKER_STORE)) db.createObjectStore(BUNKER_STORE, { keyPath: "id" });
        };
        request.onsuccess = (e) => { db = e.target.result; };
        request.onerror = (e) => { console.warn("Akses database lokal ditolak oleh browser."); };
    }
} catch (error) {
    console.warn("IndexedDB dimatikan atau tidak tersedia. Menjalankan radar tanpa mode brankas/bunker.");
}

function savePointDB(point) {
    try {
        // Pastikan db eksis dan tabelnya sudah terbuat sebelum menyimpan
        if (db && db.objectStoreNames.contains(STORE_NAME)) {
            db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).add(point);
        }
    } catch(e) {
        console.warn("Gagal menyimpan titik koordinat ke memori lokal", e);
    }
}

function clearDB() {
    try {
        // Pastikan db eksis sebelum mencoba menghapus data (mencegah error saat tombol Abort ditekan)
        if (db && db.objectStoreNames.contains(STORE_NAME)) {
            db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
        }
    } catch(e) { 
        console.warn("Gagal membersihkan cache koordinat", e); 
    }
}
			// ----------------------------------------------

			map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 15);
			map.on(
  'dragstart',
  () => {

    autoFollow = false;

    document
      .getElementById(
        'btn-recenter'
      )
      .style.display =
      'block';

  }
);
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; OpenStreetMap contributors'
			}).addTo(map);
			const line = L.polyline([], { color: '#FF5F00', weight: 6 }).addTo(map);
			const marker = L.circleMarker([0,0], { radius: 8, color: '#fff', fillColor: '#FF5F00', fillOpacity: 1 }).addTo(map);

			function escapeHTML(str) {
				return String(str || '')
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#39;');
			}

			function setRouteStatus(title, detail, isError = false) {
				const el = document.getElementById('route-status');
				if (!el) return;
				el.style.display = 'block';
				el.style.color = isError ? '#e74c3c' : '#3498db';
				el.innerHTML = escapeHTML(title) + (detail ? '<span>' + escapeHTML(detail) + '</span>' : '');
			}

			function shouldUpdateVisuals(force = false) {
				if (force) return true;
				const now = Date.now();
				const interval = isStealthMode ? STEALTH_VISUAL_INTERVAL : NORMAL_VISUAL_INTERVAL;

				if (now - lastVisualUpdate < interval) return false;
				lastVisualUpdate = now;
				return true;
			}

			function addTrackPointToMap(latlng) {
				if (!isStealthMode) line.addLatLng(latlng);
			}

			function refreshTrackVisuals() {
				line.setLatLngs(path.map(function(point) {
					return [point.lat, point.lng];
				}));

				if (path.length > 0) {
					const last = path[path.length - 1];
					marker.setLatLng([last.lat, last.lng]);
				}

				lastVisualUpdate = Date.now();
			}

			function updateStealthButton() {
				const btn = document.getElementById('btn-stealth');
				if (!btn) return;
				btn.innerText = isStealthMode ? '🔓 BUKA' : '🔒 STEALTH';
				btn.style.color = isStealthMode ? '#f1c40f' : '#fff';
				btn.style.border = isStealthMode ? '1px solid #f1c40f' : 'none';
			}

			function updatePrivacyButton() {
				const btn = document.getElementById('btn-privacy');
				const hint = document.getElementById('privacy-hint');

				if (!btn || !hint) return;

				btn.innerText = rideIsPublic ? '🌐 PUBLIC' : '🔒 PRIVATE';
				btn.style.color = rideIsPublic ? '#2ecc71' : '#fff';
				btn.style.borderColor = rideIsPublic ? '#2ecc71' : 'rgba(255,255,255,0.14)';
				hint.innerText = rideIsPublic ? 'Tampil di profil publik.' : 'Tidak tampil di profil publik.';
			}

			function toggleRidePrivacy() {
				rideIsPublic = !rideIsPublic;
				updatePrivacyButton();
			}

			function setText(id, value) {
				const el = document.getElementById(id);
				if (el) el.innerText = value;
			}

			function formatResumeDuration(seconds) {
				const total = Math.max(0, Math.floor(Number(seconds || 0)));
				const hours = Math.floor(total / 3600);
				const minutes = Math.floor((total % 3600) / 60);
				const secs = total % 60;

				if (hours > 0) return hours + ' jam ' + minutes + ' menit';
				if (minutes > 0) return minutes + ' menit ' + secs + ' detik';
				return secs + ' detik';
			}

			function formatResumeDate(ts) {
				const value = Number(ts || 0);
				if (!value) return 'Tidak diketahui';

				try {
					return new Date(value).toLocaleString('id-ID', {
						day: '2-digit',
						month: 'short',
						hour: '2-digit',
						minute: '2-digit'
					});
				} catch(e) {
					return 'Tidak diketahui';
				}
			}

			function formatResumeAge(ts) {
				const value = Number(ts || 0);
				if (!value) return 'Tidak diketahui';

				const diff = Math.max(0, Date.now() - value);
				const minutes = Math.floor(diff / 60000);
				const hours = Math.floor(minutes / 60);
				const days = Math.floor(hours / 24);

				if (days > 0) return days + ' hari lalu';
				if (hours > 0) return hours + ' jam lalu';
				if (minutes > 0) return minutes + ' menit lalu';
				return 'Baru saja';
			}

			function renderResumeSummary(data, isCorrupt = false) {
				const d = data || {};
				const distance = Number(d.dist || 0);
				const moving = Number(d.movingTime || 0);
				const points = Number(d.trackPointCount || 0);
				const routeName = d.plannedRouteName || (d.plannedRouteId ? 'Route ID #' + d.plannedRouteId : 'Tanpa route plan');
				const privacy = d.isPublic ? 'PUBLIC' : 'PRIVATE';
				const warning = document.getElementById('resume-warning');
				const copy = document.getElementById('resume-copy');

				if (copy) {
					copy.innerHTML = isCorrupt
						? 'Sesi lama terdeteksi, tapi metadata blackbox tidak lengkap.<br>Pilih lanjut hanya kalau yakin.'
						: 'Ditemukan sesi gowes yang belum tersimpan.<br>Cek ringkasannya sebelum lanjut atau buang data.';
				}

				setText('resume-distance', distance.toFixed(2) + ' km');
				setText('resume-duration', formatResumeDuration(moving));
				setText('resume-started', formatResumeDate(d.startT));
				setText('resume-saved', formatResumeAge(d.savedAt));
				setText('resume-points', points > 0 ? points + ' titik' : 'Belum terbaca');
				setText('resume-privacy', privacy);
				setText('resume-route', routeName);

				if (warning) {
					const looksIncomplete = isCorrupt || points === 0 || distance === 0 || moving === 0;
					warning.style.display = looksIncomplete ? 'block' : 'none';
				}
			}

			function normalizeRouteCoords(coords) {
				if (!Array.isArray(coords)) return [];

				return coords.map(p => {
					if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
					if (p && p.lat !== undefined) return [Number(p.lat), Number(p.lng !== undefined ? p.lng : p.lon)];
					return null;
				}).filter(p => p && !isNaN(p[0]) && !isNaN(p[1]));
			}

			function cleanInstructionText(text) {
				let out = String(text || 'lanjutkan rute').trim();

				out = out
					.replace(/^Head\\s+/i, 'lurus ke arah ')
					.replace(/^Continue straight/i, 'lurus terus')
					.replace(/^Continue/i, 'lanjutkan')
					.replace(/^Turn left/i, 'belok kiri')
					.replace(/^Turn right/i, 'belok kanan')
					.replace(/^Slight left/i, 'agak kiri')
					.replace(/^Slight right/i, 'agak kanan')
					.replace(/^Sharp left/i, 'belok tajam kiri')
					.replace(/^Sharp right/i, 'belok tajam kanan')
					.replace(/^Keep left/i, 'tetap di kiri')
					.replace(/^Keep right/i, 'tetap di kanan')
					.replace(/^Arrive at/i, 'tiba di')
					.replace(/^Destination/i, 'tujuan')
					.replace(/\\s+onto\\s+/i, ' ke ')
					.replace(/\\s+on\\s+/i, ' di ');

				return out;
			}

			function roundDistanceMeters(distance) {
				if (distance >= 1000) return (distance / 1000).toFixed(1) + ' kilometer';
				if (distance >= 100) return Math.round(distance / 50) * 50 + ' meter';
				return Math.max(10, Math.round(distance / 10) * 10) + ' meter';
			}

			function projectPointMeters(lat, lng, originLat) {
				const latRad = originLat * Math.PI / 180;
				return {
					x: lng * 111320 * Math.cos(latRad),
					y: lat * 110540
				};
			}

			function distanceToSegmentMeters(point, start, end) {
				const originLat = point[0];
				const p = projectPointMeters(point[0], point[1], originLat);
				const a = projectPointMeters(start[0], start[1], originLat);
				const b = projectPointMeters(end[0], end[1], originLat);
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const lenSq = dx * dx + dy * dy;

				if (lenSq === 0) {
					const ax = p.x - a.x;
					const ay = p.y - a.y;
					return Math.sqrt(ax * ax + ay * ay);
				}

				const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
				const closest = {
					x: a.x + t * dx,
					y: a.y + t * dy
				};
				const px = p.x - closest.x;
				const py = p.y - closest.y;

				return Math.sqrt(px * px + py * py);
			}

			function distanceToPlannedRouteMeters(lat, lng) {
				if (!plannedRouteCoords || plannedRouteCoords.length < 2) return null;

				let minDistance = Infinity;
				const point = [lat, lng];

				for (let i = 1; i < plannedRouteCoords.length; i++) {
					const distance = distanceToSegmentMeters(point, plannedRouteCoords[i - 1], plannedRouteCoords[i]);
					if (distance < minDistance) minDistance = distance;
				}

				return Number.isFinite(minDistance) ? minDistance : null;
			}

			function setRerouteButtonVisible(visible) {
				const btn = document.getElementById('btn-reroute');
				if (btn) btn.style.display = visible ? 'block' : 'none';
			}

			function setPlannedRouteAlertStyle(isOffRoute) {
				if (!plannedRouteLine) return;

				plannedRouteLine.setStyle({
					color: isOffRoute ? '#e74c3c' : '#3498db',
					weight: isOffRoute ? 6 : 5,
					opacity: isOffRoute ? 1 : 0.9,
					dashArray: isOffRoute ? '4, 10' : '12, 8'
				});
			}

			function updateOffRouteStatus(lat, lng, accuracy) {
				if (!rec || !plannedRouteCoords || plannedRouteCoords.length < 2) return;

				const distanceM = distanceToPlannedRouteMeters(lat, lng);
				if (distanceM === null) return;

				const now = Date.now();
				const warnThreshold = Math.max(OFF_ROUTE_WARN_M, Number(accuracy || 0) * 1.5);
				const offThreshold = Math.max(OFF_ROUTE_M, Number(accuracy || 0) * 2);
				const backThreshold = Math.max(BACK_ON_ROUTE_M, Number(accuracy || 0) + 25);
				offRouteState.lastDistance = distanceM;

				if (distanceM >= offThreshold) {
					offRouteState.active = true;
					offRouteState.warned = true;
					setPlannedRouteAlertStyle(true);
					setRerouteButtonVisible(true);
					setRouteStatus(
						'⚠️ KELUAR RUTE',
						'Jarak dari jalur sekitar ' + roundDistanceMeters(distanceM) + '. ' +
							(isCap ? 'Kembali ke garis biru atau tekan REROUTE.' : 'Kembali ke garis biru.'),
						true
					);

					if (now - offRouteState.lastWarn > 45000) {
						speakRoute(
							isCap
								? 'Kamu keluar dari rute. Kembali ke jalur, atau tekan reroute jika ingin membuat rute baru ke tujuan.'
								: 'Kamu keluar dari rute. Kembali ke jalur.',
							true
						);
						offRouteState.lastWarn = now;
					}

					return;
				}

				if (distanceM >= warnThreshold) {
					setPlannedRouteAlertStyle(false);
					setRerouteButtonVisible(false);
					setRouteStatus('⚠️ MENJAUH DARI RUTE', 'Jarak dari jalur sekitar ' + roundDistanceMeters(distanceM) + '.', true);

					if (!offRouteState.warned && now - offRouteState.lastWarn > 60000) {
						speakRoute('Kamu mulai menjauh dari rute.', false);
						offRouteState.warned = true;
						offRouteState.lastWarn = now;
					}

					return;
				}

				if (offRouteState.active && distanceM <= backThreshold) {
					speakRoute('Kamu kembali ke rute.', true);
					setRouteStatus('🧭 KEMBALI KE RUTE', 'Lanjut ikuti jalur biru.');
				}

				offRouteState.active = false;
				offRouteState.warned = false;
				setPlannedRouteAlertStyle(false);
				setRerouteButtonVisible(false);
			}

			function pickIndonesianVoice() {
				if (!('speechSynthesis' in window)) return null;
				const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
				return voices.find(v => (v.lang || '').toLowerCase().startsWith('id')) ||
					voices.find(v => (v.lang || '').toLowerCase().startsWith('ms')) ||
					null;
			}

			function setNavVoiceStatus(text, isError = false) {
				const el = document.getElementById('nav-voice-status');
				if (!el) return;
				el.innerText = text;
				el.style.color = isError ? '#e74c3c' : '#94a3b8';
			}

			function updateNavVoiceControls() {
				const btn = document.getElementById('btn-nav-voice');
				const repeatBtn = document.getElementById('btn-repeat-nav');
				const supported = 'speechSynthesis' in window;

				if (btn) {
					btn.innerText = routeVoiceEnabled ? '🔊 SUARA' : '🔇 SUARA';
					btn.style.color = routeVoiceEnabled ? '#3498db' : '#aaa';
					btn.style.borderColor = routeVoiceEnabled ? '#3498db' : '#555';
				}

				if (repeatBtn) {
					repeatBtn.disabled = !supported || !routeVoiceEnabled || !lastInstructionSpeechText;
				}

				if (!supported) {
					setNavVoiceStatus('TTS TIDAK DIDUKUNG BROWSER', true);
				} else if (!routeVoiceEnabled) {
					setNavVoiceStatus('SUARA NAV MATI');
				} else if (routeSpeechQueue.length > 0) {
					setNavVoiceStatus('SUARA NAV ANTRE ' + routeSpeechQueue.length);
				} else {
					setNavVoiceStatus(routeVoiceReady ? 'SUARA NAV AKTIF' : 'SUARA NAV SIAP');
				}
			}

			function speakRouteNow(text) {
				try {
					const utterance = new SpeechSynthesisUtterance(text);
					const voice = pickIndonesianVoice();

					utterance.lang = voice ? voice.lang : 'id-ID';
					if (voice) utterance.voice = voice;
					utterance.rate = 1;
					utterance.pitch = 1;
					utterance.volume = 1;
					utterance.onend = function() {
						routeSpeechBusy = false;
						speakNextRouteQueue();
					};
					utterance.onerror = function() {
						routeSpeechBusy = false;
						speakNextRouteQueue();
					};

					routeSpeechBusy = true;
					lastRouteSpeech = Date.now();
					lastSpokenRouteText = text;
					routeVoiceReady = true;
					window.speechSynthesis.speak(utterance);
					updateNavVoiceControls();
				} catch (err) {
					routeSpeechBusy = false;
					console.warn('TTS navigator gagal:', err);
					setNavVoiceStatus('TTS NAV GAGAL', true);
				}
			}

			function speakNextRouteQueue() {
				if (!routeVoiceEnabled || !('speechSynthesis' in window)) {
					routeSpeechQueue = [];
					updateNavVoiceControls();
					return;
				}

				if (routeSpeechQueue.length === 0) {
					updateNavVoiceControls();
					return;
				}

				const next = routeSpeechQueue.shift();
				speakRouteNow(next.text);
			}

			function speakRoute(text, force = false) {
				if (!routeVoiceEnabled || !('speechSynthesis' in window)) {
					updateNavVoiceControls();
					return;
				}

				const phrase = String(text || '').trim();
				if (!phrase) return;
				const now = Date.now();
				if (!force && now - lastRouteSpeech < ROUTE_SPEECH_COOLDOWN) return;

				if (force) {
					routeSpeechQueue = [];
					routeSpeechBusy = false;
					window.speechSynthesis.cancel();
					speakRouteNow(phrase);
					return;
				}

				if (routeSpeechBusy || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
					if (lastSpokenRouteText !== phrase && !routeSpeechQueue.some(item => item.text === phrase)) {
						routeSpeechQueue.push({ text: phrase });
						lastRouteSpeech = now;
					}
					updateNavVoiceControls();
					return;
				}

				speakRouteNow(phrase);
			}

			function unlockRouteVoice() {
				if (!('speechSynthesis' in window)) {
					updateNavVoiceControls();
					return;
				}

				if (routeVoiceReady) {
					updateNavVoiceControls();
					return;
				}

				const utterance = new SpeechSynthesisUtterance('');
				utterance.lang = 'id-ID';
				window.speechSynthesis.speak(utterance);
				routeVoiceReady = true;
				updateNavVoiceControls();
			}

			function toggleNavVoice() {
				routeVoiceEnabled = !routeVoiceEnabled;

				if (routeVoiceEnabled) {
					speakRoute('Navigasi suara aktif.', true);
				} else if ('speechSynthesis' in window) {
					routeSpeechQueue = [];
					routeSpeechBusy = false;
					window.speechSynthesis.cancel();
				}

				updateNavVoiceControls();
			}

			function repeatLastRouteInstruction() {
				if (!lastInstructionSpeechText) {
					setNavVoiceStatus('BELUM ADA INSTRUKSI UNTUK DIULANG');
					return;
				}

				speakRoute('Ulangi instruksi. ' + lastInstructionSpeechText + '.', true);
			}

			function getInstructionPoint(instruction) {
				if (instruction && instruction.point && instruction.point.lat !== undefined) {
					const lat = Number(instruction.point.lat);
					const lng = Number(instruction.point.lng !== undefined ? instruction.point.lng : instruction.point.lon);
					if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
				}

				if (instruction && Array.isArray(instruction.way_points) && plannedRouteCoords.length > 0) {
					const idx = Number(instruction.way_points[0]);
					if (!isNaN(idx) && plannedRouteCoords[idx]) return plannedRouteCoords[idx];
				}

				return null;
			}

			function updateRouteNavigator(lat, lng) {
				if (!plannedRouteInstructions.length || !rec) return;

				while (routeNextInstructionIndex < plannedRouteInstructions.length) {
					const instruction = plannedRouteInstructions[routeNextInstructionIndex];
					const target = getInstructionPoint(instruction);

					if (!target) {
						routeNextInstructionIndex++;
						continue;
					}

					const distM = map.distance([lat, lng], target);
					const key = String(routeNextInstructionIndex);
					if (!routeInstructionMarks[key]) routeInstructionMarks[key] = {};

					const phrase = cleanInstructionText(instruction.text);
					lastInstructionSpeechText = phrase;
					updateNavVoiceControls();
					setRouteStatus('🧭 NEXT ' + roundDistanceMeters(distM), phrase);

					if (distM <= 25) {
						if (!routeInstructionMarks[key].now) {
							speakRoute('Sekarang, ' + phrase + '.', true);
							routeInstructionMarks[key].now = true;
						}
						routeNextInstructionIndex++;
						continue;
					}

					if (distM <= 80 && !routeInstructionMarks[key].m80) {
						speakRoute('Sebentar lagi, ' + phrase + '.', true);
						routeInstructionMarks[key].m80 = true;
					} else if (distM <= 300 && !routeInstructionMarks[key].m300) {
						speakRoute('Dalam ' + roundDistanceMeters(distM) + ', ' + phrase + '.', false);
						routeInstructionMarks[key].m300 = true;
					}

					break;
				}

				if (routeNextInstructionIndex >= plannedRouteInstructions.length && plannedRouteInstructions.length > 0) {
					setRouteStatus('🧭 RUTE SELESAI', 'Semua arahan route plan sudah dilewati.');
				}
			}

			function applyPlannedRoute(route) {
				plannedRouteData = route.data;
				plannedRouteInstructions = Array.isArray(plannedRouteData.instructions) ? plannedRouteData.instructions : [];
				const coords = normalizeRouteCoords(plannedRouteData.coordinates);
				plannedRouteCoords = coords;
				routeNextInstructionIndex = 0;
				routeInstructionMarks = {};
				offRouteState = {
					active: false,
					warned: false,
					lastWarn: 0,
					lastDistance: null
				};
				setRerouteButtonVisible(false);

				if (coords.length < 2) {
					throw new Error('Koordinat route plan kosong.');
				}

				if (plannedRouteLine) map.removeLayer(plannedRouteLine);

				plannedRouteLine = L.polyline(coords, {
					color: '#3498db',
					weight: 5,
					opacity: 0.9,
					dashArray: '12, 8',
					interactive: false
				}).addTo(map);

				plannedRouteLine.bringToBack();
				line.bringToFront();
				marker.bringToFront();

				const routeName = route.name || plannedRouteData.name || 'Route Plan';
				const routeDistance = Number(route.distance || plannedRouteData.distance_km || 0).toFixed(1);
				setRouteStatus('🧭 ' + routeName, routeDistance + ' KM • ' + plannedRouteInstructions.length + ' arahan siap');
			}

			async function loadPlannedRoute() {
				if (!activePlannedRouteId) return;

				setRouteStatus('🧭 MEMUAT RUTE PLAN', 'Route ID #' + activePlannedRouteId);

				try {
					const res = await fetch('/api/route_plan/' + encodeURIComponent(activePlannedRouteId));
					const payload = await res.json();

					if (!res.ok || !payload.success || !payload.route || !payload.route.data) {
						throw new Error(payload.message || 'Route plan gagal dimuat.');
					}

					applyPlannedRoute(payload.route);

					setTimeout(() => {
						map.fitBounds(plannedRouteLine.getBounds(), { padding: [35, 35] });
					}, 200);
				} catch (err) {
					console.warn('Gagal memuat route plan:', err);
					setRouteStatus('🧭 RUTE PLAN GAGAL DIMUAT', 'Tracking tetap bisa berjalan normal.', true);
				}
			}

			async function rerouteToDestination() {
				if (rerouteInProgress) return;

				const btn = document.getElementById('btn-reroute');
				const destination =
					plannedRouteData &&
					Array.isArray(plannedRouteData.waypoints) &&
					plannedRouteData.waypoints.length > 0
						? plannedRouteData.waypoints[plannedRouteData.waypoints.length - 1]
						: plannedRouteCoords[plannedRouteCoords.length - 1];

				if (!latestPosition || !destination) {
					setRouteStatus('↻ REROUTE BELUM SIAP', 'GPS atau tujuan rute belum tersedia.', true);
					return;
				}

				rerouteInProgress = true;
				if (btn) {
					btn.disabled = true;
					btn.innerText = '...';
				}
				setRouteStatus('↻ MEMBUAT RUTE BARU', 'Tujuan tetap sama, start memakai posisi GPS sekarang.');
				speakRoute('Membuat rute baru ke tujuan yang sama.', true);

				try {
					const res = await fetch('/api/route_plan', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							name: 'Reroute - ' + (plannedRouteData.name || 'Route Plan'),
							profile: plannedRouteData.profile || 'cycling-regular',
							waypoints: [
								{ lat: latestPosition.lat, lng: latestPosition.lng },
								{ lat: Number(destination.lat !== undefined ? destination.lat : destination[0]), lng: Number(destination.lng !== undefined ? destination.lng : destination[1]) }
							]
						})
					});
					const payload = await res.json();

					if (!res.ok || !payload.success || !payload.route || !payload.route.data) {
						throw new Error(payload.message || 'Reroute gagal.');
					}

					activePlannedRouteId = String(payload.route.id || activePlannedRouteId || '');
					applyPlannedRoute(payload.route);
					setRouteStatus('↻ REROUTE SIAP', 'Route ID #' + activePlannedRouteId + ' menggantikan rute lama.');
					speakRoute('Rute baru siap. Lanjutkan perjalanan.', true);
				} catch (err) {
					console.warn('Reroute gagal:', err);
					setRouteStatus('↻ REROUTE GAGAL', err.message || 'Coba lagi beberapa saat.', true);
					speakRoute('Reroute gagal. Kembali ke jalur jika memungkinkan.', true);
				} finally {
					rerouteInProgress = false;
					if (btn) {
						btn.disabled = false;
						btn.innerText = '↻ REROUTE';
					}
				}
			}

			loadPlannedRoute();
			updateNavVoiceControls();
			updatePrivacyButton();
			if ('speechSynthesis' in window) {
				window.speechSynthesis.onvoiceschanged = updateNavVoiceControls;
			}

			if(navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(p => {
					const curLoc = [p.coords.latitude, p.coords.longitude];
					latestPosition = {
						lat: p.coords.latitude,
						lng: p.coords.longitude,
						accuracy: p.coords.accuracy || 0,
						speed: (p.coords.speed || 0) * 3.6
					};
					map.setView(curLoc, 16);
					marker.setLatLng(curLoc);
					lastVisualUpdate = Date.now();
				}, () => console.log("Menunggu akurasi GPS..."), { enableHighAccuracy: true });
			}

			function startAsGuest() {
				const name =
document.getElementById(
  'guest-name'
).value
.trim()
.replace(
  /[^a-zA-Z0-9 _-]/g,
  ''
)
.substring(0, 15);
				if(!name) return alert('Nama harus diisi!');
				userName = name;
				document.getElementById('join-overlay').style.display = 'none';
				checkBlackbox();
			}

			function checkBlackbox() {

  const s =
    localStorage.getItem(key);

  if (s) {

    try {

      const d =
        JSON.parse(s);

      renderResumeSummary(d);

      document.getElementById(
        'main-val'
      ).innerText =
        (d.dist || 0).toFixed(2);

      let secs =
        Math.floor(
          d.movingTime || 0
        );

      document.getElementById(
        'val-time'
      ).innerText =
        new Date(
          secs * 1000
        )
        .toISOString()
        .substr(11, 8);

    } catch(e) {

      console.warn(
        'Blackbox corrupt'
      );

      renderResumeSummary(null, true);

    }

    document.getElementById(
      'safeMode'
    ).style.display =
      'flex';

  }

  if (${isPeleton}) {

    document.getElementById(
      'radioPanel'
    ).style.display =
      'block';

  }

}

			if(isCap) checkBlackbox();

			async function recordTemperature(lat, lng) {
				try {
					const res = await fetch('/api/weather?lat=' + lat + '&lng=' + lng);
					const data = await res.json();
					if(data && data.temp !== undefined && data.temp !== null) {
						tempReadings.push(data.temp);
						console.log("Suhu terekam:", data.temp, "°C");
					}
				} catch(e) {
					console.warn("Gagal mengambil suhu:", e.message);
				}
			}

			async function resumeSession() {
				try {
					const rawData = localStorage.getItem(key);
					if (!rawData) throw new Error("Data Blackbox kosong");

					// Parse data dengan aman. Kalau JSON-nya kepotong/korup, 
					// JS akan langsung lompat ke blok catch() di bawah.
					const d = JSON.parse(rawData);
					
					dist = d.dist || 0; 
					movingTime = d.movingTime || 0;
					skippedClockGapSeconds = d.skippedClockGapSeconds || 0;
					lastAnnouncedKm = d.lastAnnouncedKm || 0;
					tempReadings = d.tempReadings || [];
					lastTempCheck = d.lastTempCheck || 0;
					totalElevation = d.totalElevation || 0;
					lastAlt = d.lastAlt || null;
					rideIsPublic = Boolean(d.isPublic);
					updatePrivacyButton();
					if (d.plannedRouteId) {
						activePlannedRouteId = String(d.plannedRouteId);
						await loadPlannedRoute();
					}
					
					document.getElementById('safeMode').style.display = 'none';
					
					// Proteksi tambahan: Jaga-jaga kalau IndexedDB belum selesai loading 
					// saat kapten memencet tombol Resume terlalu cepat
					if (!db) {

  console.warn(
    "Menunggu satelit database bersiap..."
  );

  const ready =
    await waitDB();

  if (!ready) {

    throw new Error(
      "IndexedDB gagal dimuat"
    );

  }

}
					
					// Tarik jalur koordinat dari IndexedDB
					if (db) {
						const tx = db.transaction(STORE_NAME, "readonly");
						const allPoints = await new Promise((resolve, reject) => {
							const req = tx.objectStore(STORE_NAME).getAll();
							req.onsuccess = (e) => resolve(e.target.result);
							req.onerror = () => reject("Gagal membaca memori rute");
						});
						
						path = allPoints || [];
						line.setLatLngs(path.map(p => [p.lat, p.lng]));
					} else {
						console.warn("IndexedDB gagal dimuat, rute visual mungkin tidak terlihat tapi pencatatan jalan terus.");
					}
					
					mulai(true); // Lanjut gowes

				} catch (error) {
					console.error("Gagal resume sesi (Data Korup/Rusak):", error.message);
					alert("Peringatan Sistem: Sesi gowes sebelumnya rusak akibat HP mati mendadak. Membuka sesi baru...");
					
					// Eksekusi pembersihan paksa agar aplikasi bisa terbuka normal lagi
					discardSession(); 
				}
			}

function gpsQuality(acc) {

  if (acc <= 5) {

    return '🟢 GPS ±' +
      Math.round(acc) +
      'm';

  }

  if (acc <= 15) {

    return '🟡 GPS ±' +
      Math.round(acc) +
      'm';

  }

  return '🔴 GPS ±' +
    Math.round(acc) +
    'm';

}

			function discardSession() { localStorage.removeItem(key); clearDB(); window.location.reload(); }

			let wakeLock = null;
			async function requestWakeLock() {
				try {
					if ('wakeLock' in navigator && wakeLock === null) {
						wakeLock = await navigator.wakeLock.request('screen');
						wakeLock.addEventListener('release', () => {
							wakeLock = null;
						});
					}
				} 
				catch (err) {}
			}
			function releaseWakeLock() {
				if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
			}
			document.addEventListener('visibilitychange', async () => {
				if (rec && document.visibilityState === 'visible') await requestWakeLock();
			});

			function mulai(isResume = false) {
				rec = true;
				requestWakeLock();				
				if(!isResume) { 
					startT = Date.now(); path = []; dist = 0; movingTime = 0; lastAnnouncedKm = 0; 
					skippedClockGapSeconds = 0;
					tempReadings = []; lastTempCheck = 0; totalElevation = 0; lastAlt = null; clearDB();
				}
				lastTick = Date.now();
				
				document.getElementById('btn-start').style.display = 'none';
				document.getElementById('btn-stop').style.display = 'block';
				unlockRouteVoice();

				if (plannedRouteData && plannedRouteInstructions.length > 0) {
					speakRoute('Navigasi rute dimulai.', true);
				}

				clockInt = setInterval(() => {
					let now = Date.now();
					let delta = (now - lastTick) / 1000;
					lastTick = now;

					if (!Number.isFinite(delta) || delta < 0) delta = 0;
					if (delta > REST_CLOCK_GAP_SECONDS) {
						skippedClockGapSeconds += delta;
						delta = 0;
					} else {
						const maxDelta = isStealthMode ? STEALTH_MAX_CLOCK_DELTA_SECONDS : NORMAL_MAX_CLOCK_DELTA_SECONDS;
						delta = Math.min(delta, maxDelta);
					}
					
					if (rec && !isPaused) movingTime += delta;
					
					let s = Math.floor(movingTime);
					document.getElementById('val-time').innerText = new Date(s * 1000).toISOString().substr(11, 8);
					
					if (s > 0 && s % 900 === 0 && (s - lastTempCheck > 10)) {
						lastTempCheck = s;
						if (path.length > 0) {
							const p = path[path.length-1];
							recordTemperature(p.lat, p.lng);
						}
					}
				}, 1000);

				watchId = navigator.geolocation.watchPosition(p => {
					const { latitude:lat, longitude:lng, speed, accuracy, altitude } = p.coords;
					if(accuracy > 80) return;
					
					let speedKmh = (speed || 0) * 3.6;
					const gpsStatus =
  document.getElementById(
    'gps-status'
  );

if (!gpsStatus) return;

					if (speedKmh < 2.0) {

  isPaused = true;

  gpsStatus.innerHTML =
    '⏸️ AUTO-PAUSE • ' +
    gpsQuality(accuracy);

  gpsStatus.style.color =
    '#f1c40f';

} else {

  isPaused = false;

  const statusText =
    ${isPeleton ? `"● PELETON: ${room}"` : `"● SATELLITE ACTIVE"`};

  const statusColor =
    ${isPeleton ? `"#8e44ad"` : `"#2ecc71"`};

  gpsStatus.innerHTML =
    statusText +
    ' • ' +
    gpsQuality(accuracy);

  gpsStatus.style.color =
    statusColor;

}

					const cur = [lat, lng];
					latestPosition = { lat, lng, accuracy, speed: speedKmh };

					if(path.length > 0) {
						const last = path[path.length-1];
						const d = map.distance([last.lat, last.lng], cur) / 1000;
						
						if(d > 0.003 && d < 1.5) { 
    // Jarak normal, catat semuanya
    dist += d; 
    
    // Kalkulasi Elevasi
    if (lastAlt !== null && altitude !== null) {
        let altDiff = altitude - lastAlt;
        if (altDiff > 3 && altDiff < 50) totalElevation += altDiff;
    }
    if (lastAlt === null || Math.abs(altitude - (lastAlt||0)) > 2) lastAlt = altitude;

    let pt = { lat, lng, speed: speedKmh, ele: altitude || 0, time: new Date().toISOString() };
    path.push(pt); 
    savePointDB(pt); 
    addTrackPointToMap(cur); 
    
} else if (d >= 1.5) {
    console.warn("Lonjakan Sinyal (Blank Spot). Jangkar dipindah, jarak tempuh tidak ditambahkan.");
    
    // TETAP rekam koordinatnya sebagai pijakan baru agar tracker tidak lumpuh
    let pt = { lat, lng, speed: speedKmh, ele: altitude || 0, time: new Date().toISOString() };
    path.push(pt); 
    savePointDB(pt); 
    addTrackPointToMap(cur); 
    lastAlt = altitude; // Reset acuan elevasi juga
}
					} else { 
						let pt = { lat, lng, speed: speedKmh, ele: altitude || 0, time: new Date().toISOString() };
						path.push(pt); 
						savePointDB(pt);
						addTrackPointToMap(cur);
						lastAlt = altitude;
						if (tempReadings.length === 0) recordTemperature(lat, lng);
					}

					if (shouldUpdateVisuals()) {
						if (!isStealthMode) marker.setLatLng(cur);
						document.getElementById('main-val').innerText = dist.toFixed(2);
						document.getElementById('val-speed').innerText = speedKmh.toFixed(1);
					}

					// Jangan paksa kamera geser kalau Stealth lagi aktif (bikin berat)
					if (!isStealthMode) {
						if (autoFollow) {

  map.panTo(cur);

}
					}
					
					updateRouteNavigator(lat, lng);
					updateOffRouteStatus(lat, lng, accuracy);

					let currentKm = Math.floor(dist);
					if (currentKm > lastAnnouncedKm && currentKm >= 1 && plannedRouteInstructions.length === 0) {
						lastAnnouncedKm = currentKm;
						let avgSpeedVoice = movingTime > 0 ? (dist / (movingTime / 3600)).toFixed(1) : "0.0";
						speakRoute('Jarak tempuh ' + currentKm + ' kilometer. Kecepatan rata-rata ' + avgSpeedVoice + ' kilometer per jam.', false);
					}

					// Simpan Blackbox (Metadata saja, path di-skip karena sudah masuk IndexedDB)
					let nowTime = Date.now();
					if (nowTime - lastSave > 10000) { 
						localStorage.setItem(key, JSON.stringify({dist,
  startT,
  movingTime,
  lastAnnouncedKm,
  tempReadings,
  lastTempCheck,
  totalElevation,
  lastAlt,
  skippedClockGapSeconds,

  roomID,
  plannedRouteId: activePlannedRouteId,
  plannedRouteName:
    plannedRouteData && plannedRouteData.name
      ? plannedRouteData.name
      : '',
  isPublic: rideIsPublic,
  userName,
  trackPointCount:
    path.length,
  lastPosition:
    latestPosition
      ? {
        lat: latestPosition.lat,
        lng: latestPosition.lng,
        accuracy: latestPosition.accuracy || 0
      }
      : null,

  activityType:
    '${type}',

  savedAt:
    Date.now()}));
						lastSave = nowTime;
					}
				},

(err) => {

  console.warn(
    'GPS ERROR',
    err
  );

  const gpsStatus =
  document.getElementById(
    'gps-status'
  );

if (!gpsStatus) return;

  if (gpsStatus) {

    gpsStatus.innerHTML =
      '🔴 GPS ERROR';

    gpsStatus.style.color =
      '#e74c3c';

  }

},

{
  enableHighAccuracy: true
});

				// --- THROTTLE RADAR SYNC ---
				radarInt = setInterval(() => {
					radarTick += 4;
					let threshold = isStealthMode ? 16 : 4; // Sync tiap 16 detik di Stealth, 4 detik saat normal
					
					if(radarTick >= threshold && roomID !== "SINGLE_MODE" && path.length > 0) {
						radarTick = 0;
						const lastP = path[path.length-1];
						fetch('/api/radar_sync', {
							method: 'POST',
							body: JSON.stringify({ room: roomID, user: userName, lat: lastP.lat, lng: lastP.lng, speed: lastP.speed || 0 })
						}).then(r => r.json()).then(res => { 
							if(res.participants) syncRadar(res.participants, res.radios); 
						}).catch(e => {});
					}
				}, 4000);
			}

			const others = {};
			function syncRadar(list, radios) {
				list.forEach(p => {
					if(p.user === userName) return;
					if(!others[p.user]) {
						others[p.user] = L.circleMarker([p.lat, p.lng], {radius:7, color:'#fff', fillColor:'#8e44ad', fillOpacity:1}).addTo(map)
							.bindTooltip(p.user, {permanent:true, className:'peleton-label'}).openTooltip();
					} else { others[p.user].setLatLng([p.lat, p.lng]); }
				});

				if(radios && radios.length > 0) {
					radios.forEach(r => {
						if(r.user !== userName && r.url && !playedAudioUrls.has(r.url)) {
							playedAudioUrls.add(r.url);
							setTimeout(() => { playedAudioUrls.delete( r.url ); }, 600000);
							const audio = new Audio(r.url);
							audio.play().catch(e => console.log("Gagal play:", e));

							const feed = document.getElementById('radioFeed');
							const item = document.createElement('div');
							item.className = 'radio-item';
							item.innerHTML = '<span style="font-size:16px;">🔊</span><span style="font-size:10px; font-weight:bold; color:white;">' + r.user.replace(/[^a-zA-Z0-9 ]/g, '') + '</span>';
							feed.appendChild(item);
							
							if(feed.children.length > 3) feed.removeChild(feed.firstChild);
						}
					});
				}
			}

			async function selesai() {
				if (isStealthMode) disableStealth();
				rec = false; releaseWakeLock(); navigator.geolocation.clearWatch(watchId); clearInterval(radarInt); clearInterval(clockInt);
				
				const dur = Math.floor(movingTime);
				
				if (path.length > 0) await recordTemperature(path[path.length-1].lat, path[path.length-1].lng);
				let finalAvgTemp = 0;
				if (tempReadings.length > 0) {
					const sum = tempReadings.reduce((a, b) => a + b, 0);
					finalAvgTemp = sum / tempReadings.length;
				}
				
				if(isCap) {
					document.getElementById('btn-stop').innerText = "MEMPROSES...";
					document.getElementById('btn-stop').disabled = true;

					// AMBIL DATA DARI INDEXEDDB UNTUK DI CHUNK
					const tx = db.transaction(STORE_NAME, "readonly");
					const allPoints = await new Promise(resolve => tx.objectStore(STORE_NAME).getAll().onsuccess = (e) => resolve(e.target.result));
					
					const CHUNK_SIZE = 500;
					const totalChunks = Math.ceil(allPoints.length / CHUNK_SIZE);
					const rideUUID = Date.now() + "_" + Math.floor(Math.random() * 1000);
					
					// Siapkan semua paket (payloads)
					const payloads = [];
					for (let i = 0; i < totalChunks; i++) {
						payloads.push({
							uuid: rideUUID,
							chunk_index: i,
							total_chunks: totalChunks,
							points: allPoints.slice(i * CHUNK_SIZE, (i * CHUNK_SIZE) + CHUNK_SIZE),
							name: '${type.toUpperCase()} ' + new Date().toLocaleDateString('id-ID'),
							distance: dist,
							duration: dur,
							activity_type: '${type}',
							room: roomID,
							planned_route_id: activePlannedRouteId ? Number(activePlannedRouteId) : null,
							is_public: rideIsPublic ? 1 : 0,
							avg_temp: finalAvgTemp,
							total_elevation: Math.round(totalElevation)
						});
					}

					let uploadSuccess = true;

					// Coba upload langsung HANYA JIKA indikator browser sedang Online
					if (navigator.onLine) {
						for (let i = 0; i < payloads.length; i++) {
							try {
								const res = await fetch('/api/save_ride', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify(payloads[i])
								});
								if(!res.ok) uploadSuccess = false;
							} catch(err) {
								uploadSuccess = false;
							}
						}
					} else {
						uploadSuccess = false;
					}

					await cleanupPeletonAudio();
					
					if (uploadSuccess) { 
						// Sukses langsung mendarat di awan
						localStorage.removeItem(key); clearDB(); window.location.href = '/'; 
					} else { 
						// --- BUNKER MODE AKTIF (OFFLINE / SINYAL JELEK) ---
						const txBunker = db.transaction(BUNKER_STORE, "readwrite");
						txBunker.objectStore(BUNKER_STORE).put({ id: rideUUID, payloads: payloads, time: Date.now() });
						
						alert("Sinyal terputus! Data diamankan di Brankas Bunker dan akan diunggah otomatis saat internet kembali.");
						
						localStorage.removeItem(key); 
						clearDB(); // Hanya clear titik koordinat tracker, Bunker tetap aman
						window.location.href = '/'; 
					}
				} else {
					document.getElementById('fin-dist').innerText = dist.toFixed(2);
					document.getElementById('fin-time').innerText = document.getElementById('val-time').innerText;
					document.getElementById('fin-spd').innerText = (dist / (dur/3600) || 0).toFixed(1);
					document.getElementById('guestFinish').style.display = 'flex';
					localStorage.removeItem(key); clearDB();
				}
			}

			async function cleanupPeletonAudio() {
				if (!isCap || roomID === "SINGLE_MODE") return;

				try {
					await fetch('/api/radio_cleanup', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ room: roomID }),
						keepalive: true
					});
				} catch(e) {
					console.warn('Gagal membersihkan audio peleton:', e);
				}
			}

			async function cancelRec() {
				if(confirm('Batalkan dan hapus rute?')) {
					await cleanupPeletonAudio();
					localStorage.removeItem(key);
					clearDB();
					window.location.href='/';
				}
			}
			function enableStealth() {
				isStealthMode = true;
				autoFollow = false;
				lastVisualUpdate = 0;
				document.getElementById('stealthOverlay').style.display = 'flex';
				document.getElementById('btn-recenter').style.display = 'block';
				updateStealthButton();

				const now = Date.now();
				if (now - lastStealthVoiceHint > 120000) {
					speakRoute('Stealth mode aktif. Layar dibuat hemat, navigasi suara tetap berjalan.', false);
					lastStealthVoiceHint = now;
				}
			}

			function disableStealth() {
				isStealthMode = false;
				document.getElementById('stealthOverlay').style.display = 'none';
				refreshTrackVisuals();
				updateStealthButton();
			}
			function recenterMap() {
				autoFollow = true;
				document.getElementById('btn-recenter').style.display = 'none';

				// Ambil posisi satelit dari marker merah secara langsung
				const pos = marker.getLatLng();
				
				// Pastikan koordinat bukan titik nol (0,0) sebelum melempar kamera
				if (pos && pos.lat !== 0 && pos.lng !== 0) {
					map.setView(pos, map.getZoom());
				}
			}

			function shareSpectator() {
				const url = window.location.origin + '/radar/' + roomID;
				const text = 'Pantau pergerakan gowes peleton secara live di sini:\\n' + url;
				window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
			}

			function exportStats() {
				html2canvas(document.getElementById('souvenir-card'), {backgroundColor:'#000', scale:2}).then(c => {
					const a = document.createElement('a'); a.download = 'Gaspool_Guest_Stats.png'; a.href = c.toDataURL(); a.click();
				});
			}
			
			function exportGPX() {
    // 🟢 Perhatikan penambahan double-backslash (\\n) di bawah ini
    let g = '<?xml version="1.0" encoding="UTF-8"?>\\n' +
            '<gpx version="1.1" creator="Gaspool" xmlns="http://www.topografix.com/GPX/1/1">\\n<trk>\\n<trkseg>\\n';
            
    for (let i = 0; i < path.length; i++) {
        let p = path[i];
        let pt = '<trkpt lat="' + p.lat + '" lon="' + p.lng + '">';
        if (p.ele) pt += '<ele>' + p.ele + '</ele>';
        if (p.time) pt += '<time>' + p.time + '</time>';
        pt += '</trkpt>\\n';
        g += pt;
    }
            
    g += '</trkseg>\\n</trk>\\n</gpx>';
            
    const b = new Blob([g], {type:'application/gpx+xml'});
    const u = URL.createObjectURL(b); 
    const a = document.createElement('a'); 
    a.download = 'Gaspool_Route.gpx'; 
    a.href = u; 
    a.click();
}

			let isPttActive = false, mediaRecorder, audioChunks = [];
			async function startPTT(e) {
				if(e) e.preventDefault(); if(isPttActive) return;
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					mediaRecorder = new MediaRecorder(stream); audioChunks = [];
					mediaRecorder.ondataavailable = event => { if (event.data.size > 0) audioChunks.push(event.data); };
					mediaRecorder.onstop = () => { uploadVoice(); stream.getTracks().forEach(t => t.stop()); };
					isPttActive = true; mediaRecorder.start();
					document.getElementById('btnPTT').innerText = "🔴 MEREKAM..."; document.getElementById('btnPTT').classList.add('recording');
				} catch(e) { alert("Mic ditolak atau tidak tersedia!"); }
			}
			function stopPTT(e) {
				if(e) e.preventDefault(); if(!isPttActive) return;
				isPttActive = false; mediaRecorder.stop();
				document.getElementById('btnPTT').innerText = "⏳ MENGIRIM..."; document.getElementById('btnPTT').classList.remove('recording');
			}
			function uploadVoice() {
				const fd = new FormData(); fd.append('room', roomID); fd.append('user', userName); fd.append('audio', new Blob(audioChunks, {type:'audio/webm'}));
				fetch('/api/radio', {method: 'POST', body: fd}).then(() => { document.getElementById('btnPTT').innerText = "🎤 TAHAN BICARA"; });
			}
        </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. RADAR SPECTATOR (Mode Keluarga / Pantau)
// ==========================================
tracker.get("/radar/:room", async (c) => {
  const room = c.req.param("room").toUpperCase();
  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <title>Radar Peleton: ${room}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
        <style>
            :root { --primary: #FF5F00; --bg: #000; }
            body { font-family: 'Inter', sans-serif; background: var(--bg); margin: 0; overflow: hidden; color: #fff; }
            #map { height: 100vh; width: 100vw; z-index: 1; }
            .header { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); z-index: 1000; background: rgba(10,10,18,0.85); backdrop-filter: blur(10px); padding: 15px 25px; border-radius: 20px; border: 1px solid rgba(255,95,0,0.4); text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.8); min-width: 280px; }
            .title { font-size: 1.2rem; font-weight: 900; font-style: italic; color: var(--primary); margin: 0; letter-spacing: 1px;}
            .subtitle { font-size: 0.7rem; font-weight: bold; color: #aaa; margin-top: 5px; }
            .status-dot { display: inline-block; width: 8px; height: 8px; background: #2ecc71; border-radius: 50%; margin-right: 5px; box-shadow: 0 0 10px #2ecc71; animation: pulse 2s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
            .peleton-label { background: rgba(142, 68, 173, 0.9); color: white; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: bold; border: 1px solid #fff; white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
            .btn-share { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #25D366; color: white; border: none; padding: 12px 25px; border-radius: 12px; font-weight: bold; font-size: 12px; cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.5); text-decoration: none;}
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">RADAR PELETON</h1>
            <div class="subtitle"><span class="status-dot"></span>ROOM: ${room}</div>
        </div>
        <div id="map"></div>
        <button class="btn-share" onclick="shareWa()">💬 BAGIKAN KE KELUARGA</button>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
        <script>
            const map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);
            
            // ==============================================================
            // TAMBAHAN: AUTO-CENTER PENONTON SAAT PERTAMA KALI DIBUKA
            // ==============================================================
            map.locate({setView: true, maxZoom: 14});
            
            const markers = {};
            let bounds = L.latLngBounds();

            function shareWa() {
                const url = window.location.href;
                const text = 'Pantau pergerakan gowes peleton secara live!\\nRoom: *' + '${room}' + '*\\n\\nBuka radar: \\n' + url;
                window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
            }

            async function fetchRadar() {
                try {
                    const res = await fetch('/api/radar_view/' + '${room}');
                    const data = await res.json();
                    if(data.success && data.participants) {
                        let hasUpdate = false;
                        bounds = L.latLngBounds(); // reset area peta
                        data.participants.forEach(p => {
                            if(Date.now() - p.time > 120000) return; // Abaikan data basi > 2 menit
                            hasUpdate = true;
                            const latlng = [p.lat, p.lng];
                            bounds.extend(latlng);
                            if(!markers[p.user]) {
                                markers[p.user] = L.circleMarker(latlng, {radius: 8, color: '#fff', fillColor: '#FF5F00', fillOpacity: 1}).addTo(map)
                                    .bindTooltip(p.user + ' (' + Math.round(p.speed) + ' km/h)', {permanent: true, className: 'peleton-label', direction: 'top', offset: [0, -10]}).openTooltip();
                            } else {
                                markers[p.user].setLatLng(latlng);
                                markers[p.user].setTooltipContent(p.user + ' (' + Math.round(p.speed) + ' km/h)');
                            }
                        });
                        // Pusatkan peta dinamis mengikuti sebaran pesepeda
                        if(hasUpdate) {
                            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
                        }
                    }
                } catch(e) {}
            }

            fetchRadar();
            setInterval(fetchRadar, 5000); // Polling setiap 5 detik
        </script>
    </body>
    </html>
    `);
});

export default tracker;
