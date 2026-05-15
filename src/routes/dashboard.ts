import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { Bindings } from '../index'

const dashboard = new Hono<{ Bindings: Bindings }>()

// ==========================================
// 1. DASHBOARD UTAMA (Pusat Komando PWA)
// ==========================================
dashboard.get('/', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.redirect('/login')

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as { email: string }
    const captainName = payload.email.split('@')[0].toUpperCase()

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Markas Gaspool</title>
        <link rel="manifest" href="/manifest.json">
        <meta name="theme-color" content="#FF5F00">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
          :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.05); --accent: #8e44ad; }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { font-family: 'Inter', sans-serif; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 80%); color: #fff; margin: 0; padding: 20px; min-height: 100vh; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 25px; }
          .header h1 { color: var(--primary); font-style: italic; margin: 0; letter-spacing: -2px; font-size: 2.8rem; font-weight: 900; }
          .header p { font-size: 0.8rem; color: #aaa; margin-top: 5px; font-weight: bold; }
          
          .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 25px; }
          .btn { padding: 18px; border: none; border-radius: 14px; font-weight: 900; cursor: pointer; text-transform: uppercase; font-style: italic; color: #fff; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; gap: 10px; transition: 0.3s; }
          .btn:active { transform: scale(0.95); }
          .btn-orange { background: var(--primary); box-shadow: 0 4px 20px rgba(255,95,0,0.3); }
          .btn-accent { background: var(--accent); box-shadow: 0 4px 20px rgba(142, 68, 173, 0.3); }
          .btn-outline { background: var(--card); border: 1px solid rgba(255,255,255,0.1); }
          
          .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 25px; }
          .stat-card { background: var(--card); padding: 20px 15px; border-radius: 20px; text-align: center; border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(15px); position: relative; overflow: hidden; }
          .stat-card::after { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--primary); }
          .stat-value { font-size: 26px; font-weight: 900; color: var(--primary); margin: 5px 0; font-style: italic; }
          .stat-label { font-size: 9px; color: #94a3b8; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; }

          .filter-search-row { margin-bottom: 20px; }
          select.dropdown { background: var(--card); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; width: 100%; outline: none; font-weight: 900; font-size: 13px; cursor: pointer; backdrop-filter: blur(10px); -webkit-appearance: none; text-align: center; }
          select.dropdown option { background: #0a0a12; }
          
          .rides-container { background: var(--card); border-radius: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
          table { width: 100%; border-collapse: collapse; }
          tr { border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s; }
          tr:hover { background: rgba(255,95,0,0.05); }
          td { padding: 18px 15px; }
          .ride-name { font-weight: 900; font-size: 0.95rem; margin-bottom: 4px; color: #fff; }
          .ride-meta { font-size: 0.75rem; color: #888; font-weight: bold; }
          
          .modal { display: none; position: fixed; z-index: 2000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); backdrop-filter: blur(10px); justify-content: center; align-items: center; padding: 20px; }
          .modal-content { background: #16161d; border-radius: 30px; width: 100%; max-width: 500px; border: 1px solid rgba(255,255,255,0.1); padding: 25px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); }
          #map-modal { height: 350px; width: 100%; border-radius: 20px; margin: 15px 0; background: #000; border: 1px solid rgba(255,255,255,0.1); }
          
          #btnLoadMore { display: none; width: 100%; background: transparent; color: var(--primary); border: 2px solid var(--primary); padding: 18px; border-radius: 15px; font-weight: 900; font-style: italic; cursor: pointer; margin-top: 20px; text-transform: uppercase; transition: 0.3s; }
          #btnLoadMore:hover { background: var(--primary); color: #fff; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
             <h1>GASPOOL</h1>
             <p>UNIT: ${captainName} | <a href="/logout" style="color:#ff4444; text-decoration:none;">TERMINATE SESSION</a></p>
          </div>

          <div class="btn-grid">
            <button class="btn btn-orange" onclick="window.location.href='/record?type=ride'">🚴 GOWES SOLO</button>
            <button class="btn btn-accent" onclick="openModal('peletonModal')">👥 GOWES PELETON</button>
            <button class="btn btn-orange" style="grid-column: span 2;" onclick="openModal('runModal')">🏃 PACE MODE</button>
            <button class="btn btn-outline" onclick="window.location.href='/sync_strava'">🧡 STRAVA SYNC</button>
            <button class="btn btn-outline" onclick="window.location.href='/gpx_import'">📥 GPX IMPORT</button>
            <button class="btn btn-outline" style="grid-column: span 2;" onclick="window.location.href='/heatmap'">🔥 HEATMAP</button>
          </div>

          <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">TOTAL DISTANCE</div>
                <div class="stat-value" id="stat-dist">0.0</div>
                <div class="stat-label">KILOMETERS</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">TOTAL ACTIVITIES</div>
                <div class="stat-value" id="stat-count">0</div>
                <div class="stat-label">SESSIONS</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">MOVING TIME</div>
                <div class="stat-value" id="stat-time">0</div>
                <div class="stat-label">HOURS</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">ELEVATION GAIN</div>
                <div class="stat-value" id="stat-elev">0</div>
                <div class="stat-label">METERS</div>
            </div>
          </div>

          <div class="filter-search-row">
            <select id="filterSelect" class="dropdown" onchange="changeFilter()">
                <option value="all">🌐 SHOW ALL ACTIVITIES</option>
                <option value="ride">🚴 CYCLING (RIDE)</option>
                <option value="run">🏃 RUNNING (RUN)</option>
                <option value="walk">🚶 WALKING (WALK)</option>
                <option value="hike">⛰️ HIKING (HIKE)</option>
            </select>
          </div>

          <div class="rides-container">
            <table id="rides-table">
              <tbody id="rides-tbody"></tbody>
            </table>
          </div>
          
          <button id="btnLoadMore" onclick="loadMore()">▼ LOAD MORE DATA</button>
        </div>

        <div id="runModal" class="modal">
            <div class="modal-content">
                <h2 style="color:var(--primary); font-style:italic; text-align:center; margin-top:0;">SELECT ACTIVITY</h2>
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <button class="btn btn-outline" onclick="window.location.href='/record?type=run'">🏃 RUNNING</button>
                    <button class="btn btn-outline" onclick="window.location.href='/record?type=walk'">🚶 WALKING</button>
                    <button class="btn btn-outline" onclick="window.location.href='/record?type=hike'">⛰️ HIKING</button>
                    <button class="btn" style="color:#aaa; background:transparent;" onclick="closeModal('runModal')">CANCEL</button>
                </div>
            </div>
        </div>

        <div id="peletonModal" class="modal">
          <div class="modal-content" style="text-align: center;">
            <h2 style="color: #8e44ad; font-style: italic; margin-top: 0;">👥 MODE PELETON</h2>
            <input type="text" id="roomName" placeholder="NAMA ROOM (OPSIONAL)" style="width: 100%; padding: 15px; background: #000; border: 1px solid #444; border-radius: 12px; color: #fff; text-align: center; margin-bottom: 15px; font-weight: bold; text-transform: uppercase; outline: none;">
            <button class="btn btn-accent" style="width: 100%; margin-bottom: 15px;" onclick="startPeleton()">🚀 BENTUK PELETON</button>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <button class="btn" style="background:#2ecc71; color:white; font-size: 0.7rem; padding: 12px;" onclick="shareRoom()">🚴‍♂️ INVITE ANGGOTA</button>
                <button class="btn" style="background:#3498db; color:white; font-size: 0.7rem; padding: 12px;" onclick="shareRadar()">📡 SHARE KELUARGA</button>
            </div>

            <button class="btn" style="color: #aaa; background: transparent; margin-top: 15px;" onclick="closeModal('peletonModal')">BATAL</button>
          </div>
        </div>

        <div id="mapModal" class="modal">
            <div class="modal-content" style="max-width:600px; padding:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 id="mTitle" style="color:var(--primary); font-style:italic; margin:0; font-size:1.4rem;">Activity</h3>
                    <span onclick="closeModal('mapModal')" style="font-size:28px; color:#666; cursor:pointer; font-weight:bold;">&times;</span>
                </div>
                <p id="mDist" style="color:#aaa; font-size:0.9rem; margin:5px 0; font-weight:900;"></p>
                
                <div id="map-modal"></div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:10px;">
                    <button class="btn btn-orange" style="font-size: 0.65rem;" id="btn-detail-link">🔍 STUDIO</button>
                    <button class="btn" style="background:#3498db; color:white; font-size: 0.65rem;" id="btn-edit-link">✏️ EDIT</button>
                    <button class="btn" style="background:#e74c3c; color:white; font-size: 0.65rem;" id="btn-delete-link">🗑️ HAPUS</button>
                </div>
            </div>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
          let modalMap = null;
          let activeL = [];
          let curP = 1;
          let curF = 'all';
          const primaryColor = '#FF5F00';

          function openModal(id) { document.getElementById(id).style.display = 'flex'; }
          function closeModal(id) { document.getElementById(id).style.display = 'none'; }
          
          function startPeleton() { 
            let val = document.getElementById('roomName').value.trim(); 
            const room = val ? val.replace(/[^A-Z0-9_]/ig, '').toUpperCase() : 'PLTN_' + Math.random().toString(36).substring(2,8).toUpperCase(); 
            window.location.href = '/record?type=ride&room=' + room; 
          }

          function shareRoom() {
            let val = document.getElementById('roomName').value.trim();
            if (!val) { alert("Isi nama room dulu Kapten!"); return; }
            const room = val.replace(/[^A-Z0-9_]/ig, '').toUpperCase();
            const url = window.location.origin + '/record?type=ride&room=' + room;
            const text = \`Ayo gabung Radar Peleton Gaspool!\\nRoom ID: *\${room}*\\n\\nKlik link ini untuk join ikut merekam:\\n\${url}\`;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
          }

          function shareRadar() {
            let val = document.getElementById('roomName').value.trim();
            if (!val) { alert("Isi nama room dulu Kapten!"); return; }
            const room = val.replace(/[^A-Z0-9_]/ig, '').toUpperCase();
            const url = window.location.origin + '/radar/' + room;
            const text = \`Pantau pergerakan gowes Peleton secara live!\\nRoom: *\${room}*\\n\\nBuka satelit radar di sini:\\n\${url}\`;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
          }
          
          async function fetchRides(append) {
             const res = await fetch('/api/rides?filter=' + curF + '&page=' + curP); 
             const data = await res.json();
             
             document.getElementById('stat-dist').innerText = parseFloat(data.stats.total_dist || 0).toFixed(1);
             document.getElementById('stat-count').innerText = data.stats.total_count || 0;
             document.getElementById('stat-time').innerText = Math.floor((data.stats.total_time || 0) / 3600);
             document.getElementById('stat-elev').innerText = Math.round(data.stats.total_elev || 0);

             const tb = document.getElementById('rides-tbody'); 
             if(!append) tb.innerHTML = '';
             
             data.rides.forEach(r => {
               const tr = document.createElement('tr');
               const icon = r.activity_type === 'run' ? '🏃' : (r.activity_type === 'walk' ? '🚶' : (r.activity_type === 'hike' ? '⛰️' : '🚴'));
               
               tr.onclick = () => bukaPeta(r.polyline, r.name, r.distance, r.id);
               
               tr.innerHTML = '<td><div style="font-size:1.5rem;">' + icon + '</div></td>' +
                            '<td><div class="ride-name">' + r.name + '</div>' +
                            '<div class="ride-meta">' + parseFloat(r.distance).toFixed(2) + ' KM • ' + new Date(r.start_date).toLocaleDateString('id-ID') + '</div></td>' +
                            '<td style="text-align:right; color:' + primaryColor + '; font-weight:bold;">❯</td>';
               tb.appendChild(tr);
             });
             
             document.getElementById('btnLoadMore').style.display = data.rides.length < 10 ? 'none' : 'block';
          }

          function changeFilter() { curF = document.getElementById('filterSelect').value; curP = 1; fetchRides(false); }
          function loadMore() { curP++; fetchRides(true); }
          
          // ALAT PENERJEMAH SANDI STRAVA
          function decodePolyline(str, precision = 5) {
              let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, factor = Math.pow(10, precision);
              while (index < str.length) {
                  byte = null; shift = 0; result = 0;
                  do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
                  let lat_change = ((result & 1) ? ~(result >> 1) : (result >> 1)); shift = result = 0;
                  do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
                  let lng_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
                  lat += lat_change; lng += lng_change;
                  coordinates.push([lat / factor, lng / factor]);
              }
              return coordinates;
          }

          async function bukaPeta(url, name, dist, id) {
            openModal('mapModal');
            document.getElementById('mTitle').innerText = name;
            document.getElementById('mDist').innerText = parseFloat(dist).toFixed(2) + ' KM';
            document.getElementById('btn-detail-link').onclick = () => window.location.href = '/detail/' + id;
            
            document.getElementById('btn-edit-link').onclick = async () => {
                const n = prompt('Rename Activity:', name);
                if (n && n !== name) {
                    await fetch('/api/edit_ride/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
                    closeModal('mapModal'); changeFilter();
                }
            };
            
            document.getElementById('btn-delete-link').onclick = async () => {
                if(confirm('Permanently delete this track?')) {
                    await fetch('/api/delete_ride/' + id, { method: 'DELETE' });
                    window.location.reload();
                }
            };

            if(!modalMap) {
              modalMap = L.map('map-modal', { zoomControl: false });
              L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(modalMap);
            }
            activeL.forEach(l => modalMap.removeLayer(l)); activeL = [];
            
            try {
              let pts = [];
              let urlStr = typeof url === 'string' ? url.trim() : '';
              
              // 1. Hapus kutip ganda jika tersangkut dari Database
              if (urlStr.startsWith('"')) urlStr = urlStr.slice(1, -1).replace(/\\"/g, '"');
              
              // 2. Deteksi format
              if (urlStr.startsWith('[') || urlStr.startsWith('{')) {
                  pts = JSON.parse(urlStr);
              } else if (urlStr.startsWith('http')) {
                  const res = await fetch(urlStr); 
                  pts = await res.json();
              } else if (urlStr.length > 0) {
                  pts = decodePolyline(urlStr);
              }
              
              // 3. Normalisasi jika bentuknya Objek { path: [...] }
              if (!Array.isArray(pts)) pts = pts.path || pts.data || pts.polyline || pts.coordinates || [];
              
              // 4. Universal Normalizer
              pts = pts.map(p => {
                  if (Array.isArray(p)) return [parseFloat(p[0]), parseFloat(p[1])];
                  if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                  return null;
              }).filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
              
              if (pts.length > 0) {
                  const l = L.polyline(pts, { color: primaryColor, weight: 5 }).addTo(modalMap);
                  activeL.push(l);
                  setTimeout(() => {
                      modalMap.invalidateSize();
                      modalMap.fitBounds(l.getBounds(), { padding: [25, 25] });
                  }, 100);
              }
            } catch(e) { console.error("Gagal load peta:", e); }
          }
          
          window.onload = () => fetchRides(false);
        </script>
      </body>
      </html>
    `)
  } catch (err) { 
    deleteCookie(c, 'gaspool_session')
    return c.redirect('/login') 
  }
})

// ==========================================
// 2. FITUR: HEATMAP OMNI-TRACKER
// ==========================================
dashboard.get('/heatmap', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.redirect('/login')

  try {
    const { results } = await c.env.DB.prepare("SELECT polyline FROM rides WHERE polyline IS NOT NULL AND polyline != ''").all()
    const allPolylines = results.map((r: any) => r.polyline)

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>Heatmap - Gaspool</title>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <style>
              :root { --primary: #FF5F00; --hm-bg: #0a0a12; --hm-panel: rgba(10, 10, 18, 0.85); }
              * { box-sizing: border-box; }
              body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #000; font-family: 'Inter', sans-serif;}
              #map { height: 100vh; width: 100vw; background: #000; z-index: 1;}
              .heatmap-header { position: absolute; top: 20px; left: 20px; z-index: 1000; background: var(--hm-panel); backdrop-filter: blur(15px); padding: 20px; border-radius: 20px; border: 1px solid rgba(255,95,0,0.3); color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 90vw; min-width: 250px; }
              .heatmap-header h2 { margin: 0; font-size: 1.2rem; font-style: italic; font-weight: 900; color: var(--primary); letter-spacing: -0.5px; }
              .heatmap-header p { margin: 5px 0 0 0; font-size: 0.8rem; opacity: 0.8; font-weight: bold; }
              .btn-back { display: inline-block; margin-top: 15px; padding: 10px 15px; width: 100%; text-align: center; background: #222; color: white; text-decoration: none; text-transform: uppercase; border-radius: 12px; font-size: 0.8rem; font-weight: 900; transition: 0.3s; }
              .btn-back:hover { background: var(--primary); color: #000; }
              #loader { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(10, 10, 18, 0.95); backdrop-filter: blur(10px); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--primary); transition: opacity 0.5s; }
              .progress-bar { width: 60%; max-width: 300px; background: rgba(255,255,255,0.1); height: 10px; border-radius: 5px; margin-top: 20px; overflow: hidden; border: 1px solid rgba(255,95,0,0.2); }
              #progressFill { width: 0%; height: 100%; background: var(--primary); transition: width 0.1s; box-shadow: 0 0 10px var(--primary); }
              .loader-title { font-size: 1.5rem; font-weight: 900; font-style: italic; letter-spacing: 2px; margin-bottom: 5px; }
          </style>
      </head>
      <body>
      <div id="loader">
          <div style="font-size: 50px; margin-bottom: 15px;">🛰️</div>
          <div class="loader-title">GASPOOL ENGINE</div>
          <div id="loader-text" style="font-weight: bold; font-size: 0.85rem; color: #aaa;">Memindai Satelit...</div>
          <div class="progress-bar"><div id="progressFill"></div></div>
      </div>
      <div class="heatmap-header">
          <h2>OMNI HEATMAP</h2>
          <p>Total Jejak: <b style="color: var(--primary);">${allPolylines.length} Aktivitas</b></p>
          <a href="/" class="btn-back">‹ KEMBALI KE MARKAS</a>
      </div>
      <div id="map"></div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
          // ALAT PENERJEMAH SANDI STRAVA
          function decodePolyline(str, precision = 5) {
              let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, factor = Math.pow(10, precision);
              while (index < str.length) {
                  byte = null; shift = 0; result = 0;
                  do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
                  let lat_change = ((result & 1) ? ~(result >> 1) : (result >> 1)); shift = result = 0;
                  do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
                  let lng_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
                  lat += lat_change; lng += lng_change;
                  coordinates.push([lat / factor, lng / factor]);
              }
              return coordinates;
          }

          const polylines = ${JSON.stringify(allPolylines)};
          const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-2.5489, 118.0149], 5);
          const tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
          L.tileLayer(tileUrl, { maxZoom: 19, crossOrigin: 'anonymous' }).addTo(map);

          async function drawHeatmap() {
              let allCoords = [];
              let total = polylines.length;
              let loaded = 0;
              const batchSize = 20; 

              for (let i = 0; i < total; i += batchSize) {
                  const batch = polylines.slice(i, i + batchSize);
                  const promises = batch.map(async (str) => {
                      try {
                          let pts = [];
                          let urlStr = str ? str.trim() : '';
                          if (urlStr.startsWith('"')) urlStr = urlStr.slice(1, -1).replace(/\\"/g, '"');
                          
                          if (urlStr.startsWith('[') || urlStr.startsWith('{')) {
                              pts = JSON.parse(urlStr);
                          } else if (urlStr.startsWith('http')) {
                              let res = await fetch(urlStr);
                              pts = await res.json();
                          } else if (urlStr.length > 0) {
                              pts = decodePolyline(urlStr);
                          }
                          
                          if (!Array.isArray(pts)) pts = pts.path || pts.data || pts.polyline || pts.coordinates || [];
                          
                          return pts.map(p => {
                              if (Array.isArray(p)) return [parseFloat(p[0]), parseFloat(p[1])];
                              if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                              return null;
                          }).filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
                      } catch (e) { return []; }
                  });

                  const batchResults = await Promise.all(promises);

                  for (let coords of batchResults) {
                      if (coords.length > 1) {
                          allCoords.push(coords);
                          L.polyline(coords, { color: '#FF5F00', weight: 4, opacity: 0.15, smoothFactor: 1.5, interactive: false }).addTo(map);
                      }
                      loaded++;
                      document.getElementById('progressFill').style.width = (loaded / total * 100) + '%';
                      document.getElementById('loader-text').innerText = 'Membakar Jejak... (' + loaded + '/' + total + ')';
                  }
              }

              if (allCoords.length > 0) {
                  const bounds = L.polyline(allCoords.flat()).getBounds();
                  setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [30, 30] }); }, 100);
              }
              
              setTimeout(() => { 
                  const loader = document.getElementById('loader');
                  loader.style.opacity = '0';
                  setTimeout(() => { loader.style.display = 'none'; }, 500);
              }, 800);
          }
          window.onload = () => { drawHeatmap(); };
      </script>
      </body>
      </html>
    `)
  } catch (err) { return c.redirect('/login') }
})

// ==========================================
// 3. FITUR: CLIENT-SIDE GPX IMPORTER
// ==========================================
dashboard.get('/gpx_import', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.redirect('/login')

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>GPX Importer - Gaspool</title>
        <style>
            :root { --primary: #FF5F00; --bg-dark: #0a0a12; --card-bg: rgba(255, 255, 255, 0.05); --card-border: rgba(255, 255, 255, 0.1); --text-dim: #aaa; }
            * { box-sizing: border-box; }
            body { font-family: 'Inter', sans-serif; background: var(--bg-dark); background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 70%); color: #fff; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
            .container { width: 100%; max-width: 450px; padding: 20px; }
            .card { background: var(--card-bg); backdrop-filter: blur(15px); border: 1px solid var(--card-border); border-radius: 24px; padding: 40px 30px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .logo-text { font-size: 2.2rem; font-weight: 900; font-style: italic; letter-spacing: -2px; color: var(--primary); margin: 0 0 10px 0; }
            .subtitle { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 30px; font-weight: bold; letter-spacing: 1px;}
            .custom-file-upload { display: flex; align-items: center; justify-content: center; width: 100%; padding: 20px; border: 2px dashed var(--text-dim); border-radius: 15px; cursor: pointer; color: var(--primary); font-weight: bold; transition: 0.3s; margin-bottom: 15px; background: rgba(0,0,0,0.3); }
            .custom-file-upload:hover { border-color: var(--primary); background: rgba(255, 95, 0, 0.1); }
            input[type="file"] { display: none; }
            #file-name { display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 25px; word-break: break-all; padding: 0 10px; }
            .btn-submit { background: var(--primary); color: white; border: none; width: 100%; padding: 16px; border-radius: 15px; font-weight: 900; font-size: 1rem; cursor: pointer; transition: 0.3s; display: none; text-transform: uppercase; }
            .link-back { display: block; margin-top: 30px; color: var(--text-dim); text-decoration: none; font-size: 0.8rem; font-weight: bold; transition: 0.2s;}
            .link-back:hover { color: var(--primary); }
        </style>
    </head>
    <body>
    <div class="container">
        <div class="card">
            <h1 class="logo-text">GASPOOL</h1>
            <div class="subtitle">UNIVERSAL GPX IMPORTER</div>
            <form id="uploadForm">
                <label for="gpx_file" class="custom-file-upload">📁 BROWSE FILE GPX</label>
                <input type="file" id="gpx_file" accept=".gpx" onchange="updateFileName()">
                <span id="file-name">Belum ada file dipilih</span>
                <button type="submit" id="btn-submit" class="btn-submit">🚀 EKSTRAK SEKARANG</button>
            </form>
            <a href="/" class="link-back">‹ KEMBALI KE MARKAS</a>
        </div>
    </div>
    <script>
        function updateFileName() {
            const input = document.getElementById('gpx_file');
            const display = document.getElementById('file-name');
            const btnSubmit = document.getElementById('btn-submit');
            if (input.files && input.files.length > 0) { display.textContent = input.files[0].name; btnSubmit.style.display = 'block'; } 
            else { display.textContent = 'Belum ada file dipilih'; btnSubmit.style.display = 'none'; }
        }
        function haversineDist(lat1, lon1, lat2, lon2) {
            const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }
        document.getElementById('uploadForm').addEventListener('submit', async function(e) {
            e.preventDefault(); const file = document.getElementById('gpx_file').files[0]; if(!file) return;
            const btn = document.getElementById('btn-submit'); btn.textContent = "⏳ MENGEKSTRAK DI HP..."; btn.style.opacity = "0.7"; btn.style.cursor = "wait";
            try {
                const text = await file.text(); const parser = new DOMParser(); const xml = parser.parseFromString(text, "text/xml");
                let trkpts = xml.getElementsByTagName("trkpt"); if(trkpts.length === 0) trkpts = xml.getElementsByTagNameNS("*", "trkpt"); if(trkpts.length === 0) trkpts = xml.getElementsByTagName("rtept");
                let points = []; let totalDistance = 0; let lastLat = null, lastLon = null;
                for(let i=0; i<trkpts.length; i++) {
                    const lat = parseFloat(trkpts[i].getAttribute("lat")); const lon = parseFloat(trkpts[i].getAttribute("lon")); points.push([lat, lon]);
                    if(lastLat !== null) { totalDistance += haversineDist(lastLat, lastLon, lat, lon); }
                    lastLat = lat; lastLon = lon;
                }
                let activityType = 'ride'; const typeNode = xml.querySelector("type");
                if(typeNode) { const t = typeNode.textContent.toLowerCase(); if (t === '9' || t.includes('run')) activityType = 'run'; else if (t.includes('walk')) activityType = 'walk'; else if (t.includes('hike')) activityType = 'hike'; }
                const nameNode = xml.querySelector("name"); const rideName = nameNode ? nameNode.textContent : "Import GPX " + new Date().toLocaleDateString('id-ID');
                const res = await fetch('/api/save_ride', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: rideName, distance: totalDistance, duration: 0, polyline: points, activity_type: activityType, source: 'GASPOOL_GPX_IMPORT' }) });
                if(res.ok) { alert("Data berhasil diimport ke Markas Awan!"); window.location.href = '/'; } 
                else { const err = await res.json(); alert("Gagal: " + err.message); btn.textContent = "🚀 EKSTRAK SEKARANG"; btn.style.opacity = "1"; btn.style.cursor = "pointer"; }
            } catch(err) { alert("Error membedah file XML GPX!"); btn.textContent = "🚀 EKSTRAK SEKARANG"; btn.style.opacity = "1"; btn.style.cursor = "pointer"; }
        });
    </script>
    </body>
    </html>
  `)
})

// ==========================================
// 4. FITUR: STRAVA SYNC (OAuth 2.0 FULL)
// ==========================================
dashboard.get('/sync_strava', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.redirect('/login')

  if (c.req.query('reset_api')) {
    deleteCookie(c, 'strava_creds')
    return c.redirect('/sync_strava')
  }

  const credsStr = getCookie(c, 'strava_creds')
  const creds = credsStr ? JSON.parse(credsStr) : null

  if (c.req.query('code') && creds) {
    const code = c.req.query('code') as string
    try {
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            code: code,
            grant_type: 'authorization_code'
        })
      });
      const data: any = await res.json();
      if (data.access_token) {
          creds.token = data.access_token;
          setCookie(c, 'strava_creds', JSON.stringify(creds), { httpOnly: true, secure: true });
          return c.redirect('/sync_strava?status=success');
      }
    } catch(e) {}
  }

  const isSuccess = c.req.query('status') === 'success';

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Strava Sync - Gaspool</title>
        <style>
            :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.05); }
            body { font-family: 'Inter', sans-serif; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 70%); color: #fff; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
            .container { width: 100%; max-width: 400px; padding: 20px; }
            .card { background: var(--card); backdrop-filter: blur(15px); border: 1px solid rgba(255,255,255,0.1); padding: 35px; border-radius: 24px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            .logo-text { font-size: 2.2rem; font-weight: 900; font-style: italic; letter-spacing: -2px; color: var(--primary); margin: 0 0 5px 0; }
            .subtitle { color: #888; font-size: 0.8rem; margin-bottom: 30px; text-transform: uppercase; font-weight: 800; letter-spacing: 1px; }
            .alert { padding: 15px; border-radius: 12px; margin-bottom: 25px; font-size: 0.85rem; font-weight: bold; }
            .alert-success { background: rgba(46, 204, 113, 0.2); border: 1px solid #2ecc71; color: #55efc4; }
            .form-group { text-align: left; margin-bottom: 15px; }
            label { display: block; font-size: 0.7rem; color: var(--primary); font-weight: bold; margin-bottom: 5px; }
            input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #333; background: #000; color: #fff; outline: none; }
            .btn { background: var(--primary); color: white; border: none; width: 100%; padding: 16px; border-radius: 15px; font-weight: 900; font-size: 0.9rem; cursor: pointer; text-transform: uppercase; margin-top: 10px; display: inline-block; text-decoration: none; box-sizing: border-box; }
            .btn-secondary { background: #333; margin-top: 15px; font-size: 0.75rem; }
            .link-back { display: block; margin-top: 25px; color: #666; text-decoration: none; font-size: 0.8rem; font-weight: bold; }
        </style>
    </head>
    <body>
    <div class="container">
        <div class="card">
            <h1 class="logo-text">GASPOOL</h1>
            <div class="subtitle">Strava Bridge API</div>

            ${isSuccess ? '<div class="alert alert-success">Akses Strava berhasil diberikan!</div>' : ''}
            <div id="statusDiv"></div>

            ${!creds ? `
                <form method="POST" action="/sync_strava">
                    <div class="form-group"><label>STRAVA CLIENT ID</label><input type="text" name="client_id" required></div>
                    <div class="form-group"><label>STRAVA CLIENT SECRET</label><input type="password" name="client_secret" required></div>
                    <input type="hidden" name="action" value="setup">
                    <button type="submit" class="btn">SIMPAN KONFIGURASI</button>
                </form>
            ` : (!creds.token ? `
                <p style="font-size: 0.85rem; color: #aaa;">Koneksi API siap. Berikan akses baca aktivitas Strava Anda.</p>
                <a id="stravaLink" href="#" class="btn" style="background:#FC4C02;">HUBUNGKAN STRAVA</a>
                <a href="?reset_api=1" class="btn btn-secondary">RESET API KEY</a>
                <script>
                    const redirectUri = window.location.origin + window.location.pathname;
                    document.getElementById('stravaLink').href = 'https://www.strava.com/oauth/authorize?client_id=${creds.client_id}&redirect_uri=' + encodeURIComponent(redirectUri) + '&response_type=code&scope=activity:read_all';
                </script>
            ` : `
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 15px; margin-bottom: 20px;">
                    <div style="font-size: 0.8rem; color: #2ecc71; font-weight: bold; margin-bottom: 5px;">KONEKSI AKTIF ✅</div>
                </div>
                <form method="POST" action="/sync_strava" onsubmit="document.getElementById('btnPull').innerText='⏳ MENARIK DATA...'">
                    <input type="hidden" name="action" value="pull">
                    <button type="submit" id="btnPull" class="btn" style="background:#FC4C02;">🚀 TARIK DATA BARU</button>
                </form>
                <a href="?reset_api=1" class="btn btn-secondary">PUTUSKAN KONEKSI</a>
            `)}
            <a href="/" class="link-back">‹ KEMBALI KE MARKAS</a>
        </div>
    </div>
    </body>
    </html>
  `)
})

dashboard.post('/sync_strava', async (c) => {
  const body = await c.req.parseBody()
  
  if (body['action'] === 'setup') {
    setCookie(c, 'strava_creds', JSON.stringify({ client_id: body['client_id'], client_secret: body['client_secret'] }), { secure: true, httpOnly: true })
    return c.redirect('/sync_strava')
  }

  if (body['action'] === 'pull') {
    const credsStr = getCookie(c, 'strava_creds')
    const creds = credsStr ? JSON.parse(credsStr) : null
    
    if (creds && creds.token) {
        let page = 1; let newCount = 0;
        try {
            while (true) {
                const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=30`, {
                    headers: { 'Authorization': `Bearer ${creds.token}` }
                });
                const activities: any = await res.json();
                if (!Array.isArray(activities) || activities.length === 0) break;

                for (const act of activities) {
                    const stravaSourceId = 'strava_' + act.id;
                    const existing = await c.env.DB.prepare("SELECT id FROM rides WHERE source = ?").bind(stravaSourceId).first();
                    if (existing) continue;

                    let gaspoolType = 'ride';
                    if (act.type === 'Run' || act.type === 'VirtualRun') gaspoolType = 'run';
                    if (act.type === 'Walk') gaspoolType = 'walk';
                    if (act.type === 'Hike') gaspoolType = 'hike';

                    const distanceKm = (act.distance || 0) / 1000;
                    const movingTime = act.moving_time || 0;
                    const avgSpeed = (act.average_speed || 0) * 3.6;
                    let startDate = act.start_date_local || new Date().toISOString();
                    startDate = startDate.replace('T', ' ').replace('Z', '');
                    const polyline = act.map?.summary_polyline || '';

                    await c.env.DB.prepare(`
                        INSERT INTO rides (name, distance, moving_time, average_speed, start_date, polyline, source, activity_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                        act.name || 'Aktivitas Strava', distanceKm, movingTime, avgSpeed, startDate, polyline, stravaSourceId, gaspoolType
                    ).run();
                    newCount++;
                }
                if (activities.length < 30) break;
                page++;
            }
            return c.html(`
              <body style="background:#0a0a12; color:#fff; font-family:sans-serif; text-align:center; padding-top:100px;">
                <h2 style="color:#2ecc71;">Berhasil! ${newCount} aktivitas ditarik.</h2>
                <a href="/" style="color:#FF5F00; text-decoration:none; font-weight:bold;">KEMBALI KE MARKAS</a>
              </body>
            `);
        } catch (e: any) {
            return c.html(`<body style="background:#0a0a12; color:#fff; text-align:center; padding-top:100px;"><h2 style="color:red;">Error: ${e.message}</h2><a href="/sync_strava" style="color:#FF5F00;">Kembali</a></body>`);
        }
    }
  }
  return c.redirect('/sync_strava')
})

// ==========================================
// 5. FITUR: PUBLIC TIMELINE (ELITE SHOWCASE)
// ==========================================
dashboard.get('/:username', async (c, next) => {
  const username = c.req.param('username').toLowerCase()
  const reserved = ['login', 'logout', 'api', 'assets', 'record', 'detail', 'video_flex', 'heatmap', 'gpx_import', 'sync_strava']
  if (reserved.includes(username)) return next()
  
  // USERNAME TELAH DISANITASI
  if (username !== 'YOUR_USERNAME_HERE') return c.text("Satelit tidak menemukan agen ini.", 404)

  try {
    const stats: any = await c.env.DB.prepare("SELECT COUNT(*) as count, COALESCE(SUM(distance),0) as dist, COALESCE(SUM(total_elevation_gain),0) as elev FROM rides").first()
    const { results: rides } = await c.env.DB.prepare("SELECT * FROM rides ORDER BY start_date DESC LIMIT 10").all()

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YOUR_NAME_HERE on Gaspool</title>
        <link rel="icon" type="image/png" sizes="192x192" href="/assets/android-chrome-192x192.png">
        <link rel="icon" type="image/png" sizes="512x512" href="/assets/android-chrome-512x512.png">
        <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
        <style>
          :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.05); }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { font-family: 'Inter', sans-serif; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 80%); color: #fff; margin: 0; padding: 20px; min-height: 100vh; }
          .container { max-width: 500px; margin: 0 auto; }
          .profile-header { text-align: center; margin-bottom: 30px; padding: 30px 20px; background: var(--card); border-radius: 24px; border: 1px solid rgba(255,95,0,0.3); box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
          .profile-img { width: 100px; height: 100px; border-radius: 20px; object-fit: cover; margin-bottom: 15px; border: 3px solid var(--primary); box-shadow: 0 0 20px rgba(255,95,0,0.4); }
          .username { font-size: 1.8rem; font-weight: 900; font-style: italic; margin: 0; color: #fff; letter-spacing: -1px;}
          .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 25px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; }
          .stat-item { text-align: center; }
          .stat-val { font-size: 1.4rem; font-weight: 900; color: #fff; }
          .stat-lbl { font-size: 0.65rem; color: #aaa; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
          .timeline-title { font-size: 1rem; font-weight: 900; font-style: italic; color: #fff; margin: 25px 0 15px 0; display: flex; align-items: center; gap: 10px; }
          .timeline-title::after { content: ''; flex-grow: 1; height: 1px; background: rgba(255,255,255,0.1); }
          .ride-card { background: var(--card); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 15px; margin-bottom: 12px; display: flex; align-items: center; cursor: pointer; transition: 0.2s; }
          .ride-card:hover { border-color: var(--primary); background: rgba(255,95,0,0.05); }
          .ride-icon { font-size: 1.8rem; margin-right: 15px; background: #000; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); }
          .ride-info { flex-grow: 1; }
          .ride-name { font-weight: 900; font-size: 0.95rem; margin-bottom: 4px; color: #fff; }
          .ride-meta { font-size: 0.75rem; color: #aaa; font-weight: bold; }
          .ride-arrow { color: var(--primary); font-weight: bold; font-size: 1.2rem; }
          #btnLoadMore { width: 100%; background: transparent; color: var(--primary); border: 2px solid var(--primary); padding: 18px; border-radius: 15px; font-weight: 900; font-style: italic; cursor: pointer; margin-top: 20px; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="profile-header">
            <img src="/assets/YOUR_PHOTO.webp" class="profile-img">
            
            <h1 class="username">YOUR_NAME_HERE</h1>
            
            <div class="stats-grid">
              <div class="stat-item"><div class="stat-val">${parseFloat(stats.dist || 0).toFixed(1)}</div><div class="stat-lbl">KM DIST</div></div>
              <div class="stat-item"><div class="stat-val">${stats.count || 0}</div><div class="stat-lbl">SESSIONS</div></div>
              <div class="stat-item"><div class="stat-val">${Math.round(stats.elev || 0)}</div><div class="stat-lbl">M ELEV</div></div>
            </div>
          </div>

          <div class="timeline-title">SPORTS LOG</div>
          <div id="rides-list"></div>
          <button id="btnLoadMore" onclick="loadMore()">▼ LOAD MORE MISI</button>
          
          <div style="text-align: center; margin-top: 40px;"><img src="/assets/gaspool.png" style="height: 40px; opacity: 0.5;"></div>
        </div>

        <script>
          let curP = 1;
          async function loadMore() {
            const res = await fetch(\`/api/public_rides/\${username}?page=\` + curP);
            const data = await res.json();
            if(data.rides.length > 0) {
              const list = document.getElementById('rides-list');
              data.rides.forEach(r => {
                const icon = r.activity_type === 'run' ? '🏃' : (r.activity_type === 'walk' ? '🚶' : (r.activity_type === 'hike' ? '⛰️' : '🚴'));
                const div = document.createElement('div');
                div.className = 'ride-card';
                div.onclick = () => window.location.href = '/detail/' + r.id;
                div.innerHTML = \`<div class=\"ride-icon\">\${icon}</div>
                  <div class=\"ride-info\"><div class=\"ride-name\">\${r.name}</div>
                  <div class=\"ride-meta\">\${parseFloat(r.distance).toFixed(2)} KM • \${new Date(r.start_date).toLocaleDateString('id-ID')}</div></div>
                  <div class=\"ride-arrow\">❯</div>\`;
                list.appendChild(div);
              });
              if(data.rides.length < 10) document.getElementById('btnLoadMore').style.display = 'none';
              curP++;
            } else { document.getElementById('btnLoadMore').style.display = 'none'; }
          }
          window.onload = loadMore;
        </script>
      </body>
      </html>
    `)
  } catch (err) { return c.text("Gagal memuat timeline.", 500) }
})

export default dashboard