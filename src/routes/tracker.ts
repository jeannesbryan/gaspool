import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { Bindings } from '../index'

const tracker = new Hono<{ Bindings: Bindings }>()

// ==========================================
// 1. RADAR OMNI-TRACKER (With Guest, Blackbox, Auto-Pause & Temp Tracker)
// ==========================================
tracker.get('/record', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  let isCaptain = false
  let userEmail = "Tamu Peleton"
  
  if (token) {
    try {
      const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as { email: string }
      userEmail = payload.email
      isCaptain = true
    } catch(e) {}
  }

  const captainName = userEmail.split('@')[0].toUpperCase()
  const type = c.req.query('type') || 'ride'
  const room = (c.req.query('room') || 'SINGLE_MODE').toUpperCase()
  const isPeleton = room !== 'SINGLE_MODE'

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <title>Gaspool Record: ${type.toUpperCase()}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
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
            .btn-cancel { background: rgba(231,76,60,0.8); width: auto; padding: 10px 15px; font-size: 10px; color: #fff; border-radius: 10px; border: none; cursor: pointer; pointer-events: auto; }
            
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
            
            .join-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.9); z-index:9000; display: ${isCaptain ? 'none' : 'flex'}; flex-direction: column; justify-content: center; align-items: center; padding: 20px;}
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
            <p style="color:#aaa; font-weight:bold; margin-bottom:30px; font-size:14px;">Ditemukan sesi gowes yang belum tersimpan.<br>Lanjutkan misi atau buang data?</p>
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
            <div class="stat-card" style="border-left: 4px solid ${isPeleton ? '#8e44ad' : '#2ecc71'};">
                <div class="label">${type.toUpperCase()} MODE</div>
                <div style="font-size: 11px; font-weight: 900; color: ${isPeleton ? '#8e44ad' : '#2ecc71'};">
                    ● ${isPeleton ? 'PELETON: ' + room : 'SATELLITE ACTIVE'}
                </div>
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
            <div class="val-main" id="main-val">0.00</div>
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
                <button class="btn" style="background:rgba(255,255,255,0.1); padding:10px; font-size:10px; color:#fff;" onclick="enableStealth()">🔒 STEALTH</button>
                ${isPeleton ? `<button class="btn" style="background:rgba(37, 211, 102, 0.2); border: 1px solid #25D366; padding:10px; font-size:10px; color:#2ecc71;" onclick="shareSpectator()">📡 SHARE RADAR</button>` : ''}
            </div>

            <button class="btn btn-start" id="btn-start" onclick="mulai()">▶️ INITIATE TRACKING</button>
            <button class="btn btn-stop" id="btn-stop" onclick="selesai()">⬜ TERMINATE & SAVE</button>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let map, path = [], dist = 0, startT = 0, rec = false, watchId, radarInt;
            let clockInt, movingTime = 0, lastTick = Date.now(), isPaused = false, lastAnnouncedKm = 0;
            
            // Variabel Suhu & Audio
            let tempReadings = [], lastTempCheck = 0;
            let playedAudioUrls = new Set();
            
            const isCap = ${isCaptain};
            const key = 'gaspool_blackbox_session';
            const roomID = "${room}";
            let userName = "${captainName}";

            map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 15);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            const line = L.polyline([], { color: '#FF5F00', weight: 6 }).addTo(map);
            const marker = L.circleMarker([0,0], { radius: 8, color: '#fff', fillColor: '#FF5F00', fillOpacity: 1 }).addTo(map);

            function startAsGuest() {
                const name = document.getElementById('guest-name').value.trim();
                if(!name) return alert('Nama harus diisi!');
                userName = name;
                document.getElementById('join-overlay').style.display = 'none';
                checkBlackbox();
            }

            function checkBlackbox() {
                const s = localStorage.getItem(key);
                if(s) { const d = JSON.parse(s); if(d.path && d.path.length > 5) document.getElementById('safeMode').style.display = 'flex'; }
                if(${isPeleton}) document.getElementById('radioPanel').style.display = 'block';
            }

            if(isCap) checkBlackbox();

            // SATELLITE WEATHER SYSTEM ⛅
            async function recordTemperature(lat, lng) {
                try {
                    const res = await fetch('/api/weather?lat=' + lat + '&lng=' + lng);
                    const data = await res.json();
                    if(data.temp !== null) {
                        tempReadings.push(data.temp);
                        console.log("Suhu terekam:", data.temp, "°C");
                    }
                } catch(e) {}
            }

            function resumeSession() {
                const d = JSON.parse(localStorage.getItem(key));
                path = d.path || []; 
                dist = d.dist || 0; 
                movingTime = d.movingTime || 0;
                lastAnnouncedKm = d.lastAnnouncedKm || 0;
                tempReadings = d.tempReadings || [];
                lastTempCheck = d.lastTempCheck || 0;
                
                document.getElementById('safeMode').style.display = 'none';
                line.setLatLngs(path.map(p => [p.lat, p.lng]));
                mulai(true);
            }

            function discardSession() { localStorage.removeItem(key); window.location.reload(); }

            function mulai(isResume = false) {
                rec = true; 
                if(!isResume) { startT = Date.now(); path = []; dist = 0; movingTime = 0; lastAnnouncedKm = 0; tempReadings = []; lastTempCheck = 0; }
                lastTick = Date.now();
                
                document.getElementById('btn-start').style.display = 'none';
                document.getElementById('btn-stop').style.display = 'block';

                // --- ⏱️ ENGINE SMART TIMER & INTERVAL SUHU ---
                clockInt = setInterval(() => {
                    let now = Date.now();
                    let delta = (now - lastTick) / 1000;
                    lastTick = now;
                    
                    if (rec && !isPaused) movingTime += delta;
                    
                    let s = Math.floor(movingTime);
                    document.getElementById('val-time').innerText = new Date(s * 1000).toISOString().substr(11, 8);
                    
                    // Interval Tembak Suhu (setiap 900 detik / 15 Menit)
                    if (s > 0 && s % 900 === 0 && (s - lastTempCheck > 10)) {
                        lastTempCheck = s;
                        if (path.length > 0) {
                            const p = path[path.length-1];
                            recordTemperature(p.lat, p.lng);
                        }
                    }
                }, 1000);

                // --- 🛰️ ENGINE GPS & SENSOR ---
                watchId = navigator.geolocation.watchPosition(p => {
                    const { latitude:lat, longitude:lng, speed, accuracy, altitude } = p.coords;
                    if(accuracy > 80) return;
                    
                    let speedKmh = (speed || 0) * 3.6;

                    // 🛑 SMART AUTO-PAUSE LOGIC
                    if (speedKmh < 2.0) {
                        isPaused = true;
                        const topLabel = document.querySelector('.ui.top .stat-card .label').nextElementSibling;
                        topLabel.innerHTML = '⏸️ AUTO-PAUSE';
                        topLabel.style.color = '#f1c40f';
                    } else {
                        isPaused = false;
                        const topLabel = document.querySelector('.ui.top .stat-card .label').nextElementSibling;
                        topLabel.innerHTML = '● ' + (${isPeleton} ? 'PELETON: ' + roomID : 'SATELLITE ACTIVE');
                        topLabel.style.color = ${isPeleton} ? '#8e44ad' : '#2ecc71';
                    }

                    const cur = [lat, lng];

                    if(path.length > 0) {
                        const last = path[path.length-1];
                        const d = map.distance([last.lat, last.lng], cur) / 1000;
                        if(d > 0.003 && d < 0.2) { dist += d; path.push({lat, lng, ele: altitude || 0}); line.addLatLng(cur); }
                    } else { 
                        path.push({lat, lng, ele: altitude || 0}); line.addLatLng(cur);
                        // Tembak suhu pertama kali saat GPS didapat
                        if (tempReadings.length === 0) recordTemperature(lat, lng);
                    }

                    marker.setLatLng(cur); map.panTo(cur);
                    document.getElementById('main-val').innerText = dist.toFixed(2);
                    document.getElementById('val-speed').innerText = speedKmh.toFixed(1);

                    // 📢 VOICE COACH PER KILOMETER
                    let currentKm = Math.floor(dist);
                    if (currentKm > lastAnnouncedKm && currentKm >= 1) {
                        lastAnnouncedKm = currentKm;
                        if ('speechSynthesis' in window) {
                            let avgSpeedVoice = movingTime > 0 ? (dist / (movingTime / 3600)).toFixed(1) : "0.0";
                            let text = 'Jarak tempuh ' + currentKm + ' kilometer. Kecepatan rata-rata ' + avgSpeedVoice + ' kilometer per jam.';
                            let utt = new SpeechSynthesisUtterance(text);
                            utt.lang = 'id-ID';
                            window.speechSynthesis.speak(utt);
                        }
                    }

                    // Simpan Blackbox (Termasuk Data Suhu)
                    localStorage.setItem(key, JSON.stringify({path, dist, startT, movingTime, lastAnnouncedKm, tempReadings, lastTempCheck}));
                }, null, { enableHighAccuracy: true });

                // --- 📡 ENGINE RADAR SYNC ---
                radarInt = setInterval(() => {
                    if(roomID !== "SINGLE_MODE" && path.length > 0) {
                        const lastP = path[path.length-1];
                        fetch('/api/radar_sync', {
                            method: 'POST',
                            body: JSON.stringify({ room: roomID, user: userName, lat: lastP.lat, lng: lastP.lng, speed: ((lastP.speed||0)*3.6) })
                        }).then(r => r.json()).then(res => { 
                            if(res.participants) syncRadar(res.participants, res.radios); 
                        });
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
                            const audio = new Audio(r.url);
                            audio.play().catch(e => console.log("Gagal auto-play:", e));

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
                rec = false; navigator.geolocation.clearWatch(watchId); clearInterval(radarInt); clearInterval(clockInt);
                
                const dur = Math.floor(movingTime);
                
                // Kalkulasi Rata-rata Suhu
                if (path.length > 0) await recordTemperature(path[path.length-1].lat, path[path.length-1].lng); // Tembak terakhir sebelum selesai
                let finalAvgTemp = 0;
                if (tempReadings.length > 0) {
                    const sum = tempReadings.reduce((a, b) => a + b, 0);
                    finalAvgTemp = sum / tempReadings.length;
                }
                
                if(isCap) {
                    document.getElementById('btn-stop').innerText = "MEMPROSES...";
                    document.getElementById('btn-stop').disabled = true;
                    
                    const res = await fetch('/api/save_ride', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            name: '${type.toUpperCase()} ' + new Date().toLocaleDateString('id-ID'), 
                            distance: dist, 
                            duration: dur, 
                            polyline: path, 
                            activity_type: '${type}', 
                            room: roomID,
                            avg_temp: finalAvgTemp 
                        })
                    });
                    if(res.ok) { localStorage.removeItem(key); window.location.href = '/'; }
                    else { alert("Gagal menyimpan ke awan!"); document.getElementById('btn-stop').innerText = "COBA LAGI"; document.getElementById('btn-stop').disabled = false; }
                } else {
                    document.getElementById('fin-dist').innerText = dist.toFixed(2);
                    document.getElementById('fin-time').innerText = document.getElementById('val-time').innerText;
                    document.getElementById('fin-spd').innerText = (dist / (dur/3600) || 0).toFixed(1);
                    document.getElementById('guestFinish').style.display = 'flex';
                    localStorage.removeItem(key);
                }
            }

            function cancelRec() { if(confirm('Batalkan dan hapus rute?')) { localStorage.removeItem(key); window.location.href='/'; } }
            function enableStealth() { document.getElementById('stealthOverlay').style.display = 'flex'; }
            function disableStealth() { document.getElementById('stealthOverlay').style.display = 'none'; }
            
            function shareSpectator() {
                const url = window.location.origin + '/radar/' + roomID;
                const text = 'Pantau pergerakan gowes ' + userName + ' secara live di sini:\\n' + url; // <-- DISANITASI!
                window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
            }

            function exportStats() {
                html2canvas(document.getElementById('souvenir-card'), {backgroundColor:'#000', scale:2}).then(c => {
                    const a = document.createElement('a'); a.download = 'Gaspool_Guest_Stats.png'; a.href = c.toDataURL(); a.click();
                });
            }
            function exportGPX() {
                let g = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Gaspool"><trk><trkseg>' + 
                         path.map(p => '<trkpt lat="'+p.lat+'" lon="'+p.lng+'"></trkpt>').join('') + 
                         '</trkseg></trk></gpx>';
                const b = new Blob([g], {type:'application/gpx+xml'});
                const u = URL.createObjectURL(b); const a = document.createElement('a'); a.download = 'Gaspool_Route.gpx'; a.href = u; a.click();
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
  `)
})

// ==========================================
// 2. RADAR SPECTATOR (Mode Keluarga / Pantau)
// ==========================================
tracker.get('/radar/:room', async (c) => {
    const room = c.req.param('room').toUpperCase()
    return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <title>Radar Peleton: ${room}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
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

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            
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
    `)
})

export default tracker