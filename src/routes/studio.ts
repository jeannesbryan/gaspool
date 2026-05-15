import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Bindings } from '../index'

const studio = new Hono<{ Bindings: Bindings }>()

// ==========================================
// 1. STUDIO FLEXING (SHARE MAP, STATS & GPX)
// ==========================================
studio.get('/detail/:id', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  const isGuest = !token // Status Tamu

  const id = c.req.param('id')
  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?").bind(id).first()
    if (!ride) return c.text("Aktivitas tidak ditemukan!", 404)

    const type = ride.activity_type || 'ride'
    const isPace = (type === 'run' || type === 'walk' || type === 'hike')
    
    let barengLabel = "Gowes Bareng"
    if (type === 'run') barengLabel = "Lari Bareng"
    else if (type === 'walk') barengLabel = "Jalan Bareng"
    else if (type === 'hike') barengLabel = "Mendaki Bareng"

    const startDateIso = ride.start_date ? new Date(ride.start_date).toISOString() : new Date().toISOString()
    
    let labelAvg = isPace ? "Pace Rata-Rata" : "Kecepatan Rata-Rata"
    let unitAvg = isPace ? "Min/Km" : "Km/h"
    let valAvg = "0.0"

    if (isPace) {
      if (ride.distance > 0 && ride.moving_time > 0) {
        const paceSec = ride.moving_time / ride.distance;
        const pM = Math.floor(paceSec / 60);
        const pS = Math.floor(paceSec % 60);
        valAvg = `${pM}:${pS.toString().padStart(2, '0')}`
      } else {
        valAvg = "0:00"
      }
    } else {
      valAvg = ride.average_speed ? parseFloat(ride.average_speed).toFixed(1) : "0.0"
    }

    const mTime = ride.moving_time || 0
    const h = Math.floor(mTime / 3600).toString().padStart(2, '0')
    const m = Math.floor((mTime % 3600) / 60).toString().padStart(2, '0')
    const s = (mTime % 60).toString().padStart(2, '0')
    const timeStr = `${h}:${m}:${s}`

    let participantsText = ""
    if (ride.participants && ride.participants !== '[]') {
      try {
        const arr = JSON.parse(ride.participants)
        if (Array.isArray(arr)) participantsText = arr.join(', ')
      } catch(e) {}
    }

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>Detail Aktivitas - Gaspool</title>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"></script>
          <style>
              * { box-sizing: border-box; }
              :root { --primary: #FF5F00; --bg-body: #0a0a12; --text-main: #ecf0f1; --text-muted: #94a3b8; --card-bg: rgba(255,255,255,0.05); --card-border: rgba(255,255,255,0.1); --map-bg: #000000; }
              body { font-family: 'Inter', sans-serif; background: var(--bg-body); color: var(--text-main); margin: 0; padding-bottom: 50px; background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 70%); min-height: 100vh;}
              .container { max-width: 600px; margin: auto; padding: 15px; }
              .header { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
              .back-btn { text-decoration: none; color: var(--text-main); font-size: 1.5rem; background: var(--card-bg); border: 1px solid var(--card-border); width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: 0.2s; }
              #capture-area { background: var(--bg-body); border-radius: 24px; overflow: hidden; border: 1px solid var(--card-border); position: relative; }
              #map { height: 350px; width: 100%; z-index: 1; background: var(--map-bg); }
              .info-panel { padding: 25px 20px 20px 20px; background: var(--bg-body); position: relative; z-index: 10; border-top: 2px solid var(--primary); }
              .badge-type { background: var(--primary); color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: 900; text-transform: uppercase; margin-bottom: 12px; display: inline-block; }
              .title { font-size: 1.6rem; font-weight: 900; margin: 0 0 5px 0; font-style: italic; color: #ffffff; text-shadow: 0px 2px 4px rgba(0,0,0,0.5); }
              .date { color: var(--text-main); font-size: 0.85rem; margin-bottom: 25px; font-weight: bold; }
              .stat-box { background: var(--card-bg); padding: 15px; border-radius: 18px; border: 1px solid var(--card-border); text-align: center; }
              .stat-label { color: var(--text-muted); font-size: 0.65rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px; display: block; }
              .stat-value { font-size: 1.3rem; font-weight: 900; color: var(--primary); line-height: 1; }
              .stat-unit { font-size: 0.7rem; color: var(--text-muted); margin-left: 3px; font-weight: bold; }
              .btn-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
              .btn { border: none; padding: 15px; border-radius: 15px; font-weight: 900; cursor: pointer; transition: 0.2s; font-size: 0.75rem; text-align: center; color: #fff; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 5px; }
              
              /* KARTU MINIMALIS (TRANSPARAN UNTUK FLEXING) */
              #minimalist-card { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 550px; padding: 40px 20px; color: var(--text-main); background: transparent; position: absolute; left: -9999px; top: 0; }
              .minimal-item { display: flex; flex-direction: column; justify-content: center; align-items: center; }
              .minimal-label { font-size: 13px; color: var(--text-main); opacity: 0.8; font-weight: 600; margin-bottom: 5px; white-space: nowrap; }
              .minimal-value { font-size: 26px; font-weight: 900; color: var(--primary); letter-spacing: -1px; line-height: 1.2; }
              .minimal-value small { font-size: 14px; }
              #minimal-map { width: 500px !important; height: 250px !important; background: transparent !important; margin: 0 auto 15px auto !important; border: none; display: block; }
              ${isGuest ? '.btn-group { display: none !important; } .back-btn { display: none !important; }' : ''}
          </style>
      </head>
      <body>
      <div class="container">
        ${isGuest ? '<div style="margin-bottom:15px;"><a href="/YOUR_USERNAME_HERE" style="color:var(--primary); text-decoration:none; font-weight:bold; font-size:0.8rem;">‹ KEMBALI KE TIMELINE</a></div>' : `
            <div class="header">
                <a href="/" class="back-btn">‹</a>
                <h2 style="margin:0; font-style: italic; color: var(--primary);">Detail Aktivitas</h2>
            </div>`}
          <div id="capture-area">
              <div id="map"></div>
              <div class="info-panel">
                  <span class="badge-type">${type}</span>
                  <h1 class="title">${ride.name || 'Aktivitas'}</h1>
                  <div class="date" id="display-date"></div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                      <div class="stat-box" style="padding: 12px 5px;"><span class="stat-label" style="font-size: 0.6rem;">JARAK</span><span class="stat-value" style="font-size: 1.15rem;">${parseFloat(ride.distance || 0).toFixed(2)}</span><span class="stat-unit">KM</span></div>
                      <div class="stat-box" style="padding: 12px 5px;"><span class="stat-label" style="font-size: 0.6rem;">${labelAvg}</span><span class="stat-value" style="font-size: 1.15rem;">${valAvg}</span><span class="stat-unit">${unitAvg}</span></div>
                      <div class="stat-box" style="padding: 12px 5px;"><span class="stat-label" style="font-size: 0.6rem;">WAKTU</span><span class="stat-value" style="font-size: 1.15rem;">${timeStr}</span></div>
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                      <div class="stat-box"><span class="stat-label">TOTAL ELEVASI</span><span class="stat-value">${Math.round(ride.total_elevation_gain || 0)}</span><span class="stat-unit">M</span></div>
                      <div class="stat-box"><span class="stat-label">SUHU RATA-RATA</span><span class="stat-value">${ride.avg_temp ? parseFloat(ride.avg_temp).toFixed(1) : '--'}</span><span class="stat-unit">°C</span></div>
                  </div>
                  ${participantsText !== "" ? `
                      <div style="display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 10px;">
                          <div class="stat-box" style="background: rgba(255, 95, 0, 0.1); border-color: rgba(255, 95, 0, 0.3);">
                              <span class="stat-label" style="color: var(--primary);">👥 ${barengLabel.toUpperCase()}</span>
                              <span style="font-size: 14px; font-weight: bold; margin-top: 5px; display: block; line-height: 1.5; color: var(--text-main);">${participantsText}</span>
                          </div>
                      </div>
                  ` : ''}
                  <div style="text-align: center; margin-top: 30px;"><img src="/assets/gaspool.png" alt="Gaspool" style="height: 90px; opacity: 0.9;"></div>
              </div>
          </div>
            <div class="btn-group">
                <button onclick="takeScreenshot('standard')" class="btn" style="background: var(--primary);">📸 SHARE MAP</button>
                <button onclick="takeScreenshot('minimalist')" class="btn" style="background: #333;">✨ SHARE STATS</button>
                <a href="/video_flex/${id}" class="btn" style="background: #8e44ad;">🎬 BUAT VIDEO</a>
                <button onclick="downloadGPX()" class="btn" style="background: #27ae60;">📥 EXPORT GPX</button>
            </div>
      </div>
      <div id="minimalist-card">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; width: 100%; margin-bottom: 25px;">
              <div class="minimal-item"><div class="minimal-label">Jarak Tempuh</div><div class="minimal-value">${parseFloat(ride.distance || 0).toFixed(2)} <small>km</small></div></div>
              <div class="minimal-item"><div class="minimal-label">${labelAvg}</div><div class="minimal-value">${valAvg.replace('.', ',')} <small>${unitAvg.toLowerCase()}</small></div></div>
              <div class="minimal-item"><div class="minimal-label">Moving Time</div><div class="minimal-value">${timeStr}</div></div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 80%; margin: 0 auto 25px auto;">
              <div class="minimal-item"><div class="minimal-label">Total Elevasi</div><div class="minimal-value">${Math.round(ride.total_elevation_gain || 0)} <small>m</small></div></div>
              <div class="minimal-item"><div class="minimal-label">Suhu Rata-Rata</div><div class="minimal-value">${ride.avg_temp ? parseFloat(ride.avg_temp).toFixed(1).replace('.', ',') + ' <small>&deg;C</small>' : '-- <small>&deg;C</small>'}</div></div>
          </div>
          ${participantsText !== "" ? `
          <div style="width: 100%; margin-bottom: 25px;">
              <div class="minimal-item"><div class="minimal-label">${barengLabel}</div><div class="minimal-value" style="font-size: 20px; line-height: 1.4;">${participantsText}</div></div>
          </div>
          ` : ''}
          <div id="minimal-map"></div>
          <img src="/assets/gaspool.png" alt="Gaspool" style="height: 60px; margin-top: 15px;">
      </div>
      <script>
          const d = new Date("${startDateIso}");
          const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
          document.getElementById('display-date').innerText = d.toLocaleDateString('id-ID', options);
      
          const tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
          const map = L.map('map', { zoomControl: false, attributionControl: false });
          L.tileLayer(tileUrl, { crossOrigin: 'anonymous', maxZoom: 19 }).addTo(map);
      
          const mapMin = L.map('minimal-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
          const rawUrl = ${JSON.stringify(ride.polyline || '')};

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

          async function getCoordinates() { // Atau loadRouteData()
              if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') return [];
              try {
                  let pts = [];
                  let urlStr = rawUrl.trim();
                  
                  // 1. Hapus kutip ganda 
                  if (urlStr.startsWith('"')) urlStr = urlStr.slice(1, -1).replace(/\\"/g, '"');

                  // 2. Deteksi format
                  if (urlStr.startsWith('[') || urlStr.startsWith('{')) { 
                      pts = JSON.parse(urlStr); 
                  } else if (urlStr.startsWith('http')) {
                      const res = await fetch(urlStr);
                      pts = await res.json();
                  } else { 
                      pts = decodePolyline(urlStr); 
                  }
                  
                  // 3. Ekstrak jika bentuknya Objek
                  if (!Array.isArray(pts)) pts = pts.path || pts.data || pts.polyline || pts.coordinates || [];
                  
                  // 4. Universal Normalizer
                  return pts.map(p => {
                      if (Array.isArray(p)) return [parseFloat(p[0]), parseFloat(p[1])];
                      if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                      return null;
                  }).filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
              } catch(e) { return []; }
          }
          
          async function drawMap() {
              try {
                  let coords = await getCoordinates();
                  coords = coords.filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
                  if (coords.length > 1) {
                      let dashStyle = ('${type}' === 'run' || '${type}' === 'walk' || '${type}' === 'hike') ? '5, 10' : null;
                      const outlinePath = L.polyline(coords, { color: '#ffffff', weight: 8, dashArray: dashStyle }).addTo(map);
                      L.polyline(coords, { color: '#FF5F00', weight: 4, dashArray: dashStyle }).addTo(map);
                      L.circleMarker(coords[0], { radius: 6, color: '#2ecc71', fillOpacity: 1 }).addTo(map);
                      L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#e74c3c', fillOpacity: 1 }).addTo(map);
      
                      const pathMin = L.polyline(coords, { color: '#FF5F00', weight: 6, dashArray: dashStyle }).addTo(mapMin);
                      map.fitBounds(outlinePath.getBounds(), { padding: [30, 30] }); 
                      mapMin.fitBounds(pathMin.getBounds(), { padding: [60, 60], animate: false }); 
                      setTimeout(() => { map.invalidateSize(); map.fitBounds(outlinePath.getBounds(), { padding: [30, 30] }); }, 500);
                  }
              } catch(e) {}
          }
          drawMap();
      
          function takeScreenshot(mode) {
              const target = (mode === 'standard') ? document.getElementById('capture-area') : document.getElementById('minimalist-card');
              const originalScrollY = window.scrollY; window.scrollTo(0, 0);
              let infoPanel = null; 
              if (mode === 'standard') {
                  target.style.background = 'transparent'; target.style.border = 'none';
                  infoPanel = target.querySelector('.info-panel');
                  if (infoPanel) { infoPanel.style.background = 'transparent'; infoPanel.style.borderTop = 'none'; }
                  map.invalidateSize(true);
              }
              if (mode === 'minimalist') {
                  target.style.position = 'relative'; target.style.left = '0';
                  setTimeout(() => {
                      mapMin.invalidateSize(true); 
                      const layers = Object.values(mapMin._layers).filter(l => l._latlngs);
                      if (layers.length > 0) mapMin.fitBounds(layers[0].getBounds(), {padding: [60, 60], animate: false});
                  }, 50); 
              }
              setTimeout(() => {
                  html2canvas(target, { backgroundColor: null, scale: 2, useCORS: true, scrollX: 0, scrollY: 0 }).then(canvas => {
                      if (mode === 'minimalist') { target.style.position = 'absolute'; target.style.left = '-9999px'; }
                      if (mode === 'standard') { target.style.background = ''; target.style.border = ''; if (infoPanel) { infoPanel.style.background = ''; infoPanel.style.borderTop = ''; } }
                      window.scrollTo(0, originalScrollY);
                      const link = document.createElement('a'); link.download = \`Gaspool_\${mode}_\${Date.now()}.png\`; link.href = canvas.toDataURL(); link.click();
                  });
              }, 1000);
          }
          
          async function downloadGPX() {
              try {
                  let coords = await getCoordinates();
                  coords = coords.filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
                  if (coords.length === 0) return;
                  
                  let g = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Gaspool"><trk><name>${ride.name}</name><trkseg>' + 
                           coords.map(p => '<trkpt lat="'+p[0]+'" lon="'+p[1]+'"></trkpt>').join('') + 
                           '</trkseg></trk></gpx>';
                  const b = new Blob([g], {type:'application/gpx+xml'});
                  const u = URL.createObjectURL(b); const a = document.createElement('a'); a.download = 'Gaspool_Route.gpx'; a.href = u; a.click();
              } catch(e) {}
          }
      </script>
      </body>
      </html>
    `)
  } catch(e) { return c.redirect('/') }
})

// ==========================================
// 2. VIDEO FLEXING (Satelit Sinematik FULL)
// ==========================================
studio.get('/video_flex/:id', async (c) => {
  const token = getCookie(c, 'gaspool_session')
  if (!token) return c.redirect('/login')

  const id = c.req.param('id')
  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?").bind(id).first()
    if (!ride) return c.text("Aktivitas tidak ditemukan!", 404)

    const type = ride.activity_type || 'ride'
    const isPace = (type === 'run' || type === 'walk' || type === 'hike')
    let participants = []
    if (ride.participants && ride.participants !== '[]') { try { participants = JSON.parse(ride.participants) } catch(e) {} }
    const startHour = new Date(ride.start_date || new Date()).getHours()

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>Gaspool Cinema: ${ride.name}</title>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <style>
              * { box-sizing: border-box; }
              :root { --primary: #FF5F00; --bg-color: #0a0a12; --bg-overlay: rgba(0, 0, 0, 0.95); --text-pure: #ffffff; }
              body, html { margin: 0; padding: 0; height: 100%; width: 100%; background: var(--bg-color); font-family: 'Inter', sans-serif; overflow: hidden; user-select: none; }
              #video-container { position: relative; width: 100vw; height: 100vh; margin: 0 auto; background: var(--bg-color); overflow: hidden; }
              #map { width: 100%; height: 100%; background: #000000; z-index: 1; }
              .stat-overlay-top { position: absolute; top: 20px; left: 20px; right: 20px; background: transparent; border: none; z-index: 1000; transition: 0.3s; }
              .stat-overlay-top h2 { margin: 0 0 15px 0; font-size: 1.5rem; font-weight: 900; font-style: italic; color: var(--text-pure); text-align: center; letter-spacing: 1px; text-shadow: 0px 4px 10px rgba(0,0,0,1), 0px 0px 5px rgba(0,0,0,1); }
              .grid-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center; }
              .stat-item { background: transparent; padding: 5px; }
              .stat-item label { display: block; font-size: 0.7rem; font-weight: 900; margin-bottom: 5px; letter-spacing: 2px; color: var(--text-pure); text-shadow: 0px 3px 8px rgba(0,0,0,1), 0px 0px 4px rgba(0,0,0,1); }
              .stat-item span { font-size: 2.2rem; font-weight: 900; color: var(--text-pure); text-shadow: 0px 4px 10px rgba(0,0,0,1), 0px 0px 5px rgba(0,0,0,1); }
              .stat-item small { font-size: 0.8rem; font-weight: 900; color: var(--primary); margin-left: 3px; text-shadow: 0px 2px 5px rgba(0,0,0,1); }
              .rider-label { text-align: center; white-space: nowrap; }
              .rider-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; margin: 0 auto; box-shadow: 0 0 15px rgba(0,0,0,0.8); }
              .rider-name { font-size: 10px; font-weight: 900; color: #fff; margin-top: 4px; background: rgba(0,0,0,0.7); padding: 3px 8px; border-radius: 5px; }
              .brand-badge { position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); background: transparent; z-index: 1000; transition: opacity 0.5s; height: 120px; filter: drop-shadow(0 5px 15px rgba(0,0,0,0.8)); }
              #ending-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-overlay); z-index: 3000; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--text-pure); }
              #controls { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-overlay); z-index: 2000; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
              .btn-play { background: var(--primary); color: #fff; border: none; padding: 18px 40px; border-radius: 15px; font-size: 1.1rem; font-weight: 900; font-style: italic; cursor: pointer; box-shadow: 0 10px 30px rgba(255,95,0,0.4); transition: 0.3s; width: 100%; max-width: 300px; margin-bottom: 15px; }
              .btn-play:disabled { cursor: not-allowed; opacity: 0.5; box-shadow: none; }
              .btn-cancel { background: #333; box-shadow: none; }
              .instructions { color: var(--text-pure); text-align: center; margin-top: 20px; font-size: 0.9rem; font-weight: bold; opacity: 0.8; }
              #countdown { display: none; font-size: 120px; color: var(--primary); font-weight: 900; font-style: italic; text-shadow: 0 0 40px var(--primary); }
          </style>
      </head>
      <body>
      <div id="video-container">
          <div id="map"></div>
          <div class="stat-overlay-top">
              <h2>${ride.name || 'Aktivitas'}</h2>
              <div class="grid-stats">
                  <div class="stat-item" style="grid-column: span 2;"><label>JARAK TEMPUH</label><span id="v-dist">0.00</span> <small>KM</small></div>
                  <div class="stat-item"><label id="label-speed-pace">${isPace ? 'PACE' : 'SPEED'}</label><span id="v-speed">0.0</span> <small id="unit-speed-pace">${isPace ? 'MIN/KM' : 'KM/H'}</small></div>
                  <div class="stat-item"><label>ELEVASI</label><span id="v-elev">0</span> <small>M</small></div>
                  <div class="stat-item"><label>WAKTU BERGERAK</label><span id="v-time">00:00:00</span></div>
                  <div class="stat-item"><label>SUHU RATA-RATA</label><span id="v-temp">--</span> <small>&deg;C</small></div>
              </div>
          </div>
          <img src="/assets/gaspool.png" class="brand-badge" id="watermark">
          <div id="ending-overlay">
              <img src="/assets/gaspool.png" style="height: 90px; margin-bottom: 20px;">
              <p style="margin-top:10px; font-weight:bold; letter-spacing:1px; color:#cccccc;">REKAMAN SELESAI</p>
              <button class="btn-play" style="margin-top:30px;" onclick="window.location='/detail/${id}'">KEMBALI KE STUDIO</button>
          </div>
          <div id="controls">
              <div id="countdown">3</div>
              <button id="btn-start" class="btn-play" onclick="prepareStudio()" disabled>⏳ MEMUAT RUTE...</button>
              <button id="btn-cancel" class="btn-play btn-cancel" onclick="window.location='/detail/${id}'">BATAL</button>
              <p id="inst-text" class="instructions">Nyalakan fitur <b>Perekam Layar (Screen Record)</b> HP Anda sebelum menekan tombol mulai!</p>
          </div>
      </div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
          const rawUrl = ${JSON.stringify(ride.polyline || '')};
          const totalDistTarget = ${parseFloat(ride.distance || 0)};
          const totalElevTarget = ${Math.round(ride.total_elevation_gain || 0)};
          const movingTimeTarget = ${parseInt(ride.moving_time || 0)};
          const tempTarget = ${parseFloat(ride.avg_temp || 0)};
          const activityType = '${type}'; const startHour = ${startHour};
          const ridersList = ${JSON.stringify(participants)}; const isPeleton = ridersList.length > 0; const isPace = ${isPace};
      
          const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-2.5489, 118.0149], 4);
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: 'anonymous' }).addTo(map);
          
          const outlineLine = L.polyline([], { color: '#ffffff', weight: 10, opacity: 0.9 }).addTo(map);
          const animatedLine = L.polyline([], { color: '#FF5F00', weight: 6, opacity: 1.0 }).addTo(map);
          let fullPath = []; let markers = [];

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
      
          async function loadRouteData() {
              if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') return [];
              try {
                  let pts = [];
                  let urlStr = rawUrl.trim();
                  if (urlStr.startsWith('[')) { pts = JSON.parse(urlStr); }
                  else if (urlStr.startsWith('http')) {
                      const res = await fetch(urlStr); pts = await res.json();
                  } else { pts = decodePolyline(urlStr); }
                  
                  // --- UNIVERSAL NORMALIZER ---
                  return pts.map(p => {
                      if (Array.isArray(p)) return [parseFloat(p[0]), parseFloat(p[1])];
                      if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng || p.lon)];
                      return null;
                  }).filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
              } catch(e) { return []; }
          }
      
          loadRouteData().then(path => {
              fullPath = path;
              if (fullPath.length > 0) {
                  const startCoord = fullPath[0]; map.setView(startCoord, 14);
                  const pelotonColors = ['#FF5F00', '#2ecc71', '#3498db', '#f1c40f', '#9b59b6', '#e74c3c'];
                  if (!isPeleton) {
                      const iconSymbol = (activityType === 'run') ? '🏃‍♂️' : ((activityType === 'walk' || activityType === 'hike') ? '🚶‍♂️' : '🚴‍♂️');
                      const soloIcon = L.divIcon({ className: 'custom-icon', html: \`<div style="font-size: 28px; text-shadow: 0 0 15px var(--primary); text-align: center;">\${iconSymbol}</div>\`, iconSize: [30, 30], iconAnchor: [15, 15] });
                      markers.push(L.marker(startCoord, { icon: soloIcon }).addTo(map));
                  } else {
                      ridersList.forEach((name, i) => {
                          const color = pelotonColors[i % pelotonColors.length];
                          const dotIcon = L.divIcon({ className: 'rider-label', html: \`<div class="rider-dot" style="background:\${color}; border-color:\${color}"></div><div class="rider-name">\${name.replace(/[<>]/g, '')}</div>\`, iconSize: [60, 40], iconAnchor: [30, 6] });
                          markers.push(L.marker(startCoord, { icon: dotIcon }).addTo(map));
                      });
                  }
                  document.getElementById('btn-start').disabled = false; document.getElementById('btn-start').innerText = "🎬 MULAI REKAMAN";
              } else { document.getElementById('btn-start').innerText = "❌ DATA RUTE KOSONG"; }
          });
      
          const duration = 20000; let startTime = null; let frameCount = 0;
          function getPaceFormat(secondsPerKm) { if (secondsPerKm <= 0) return "0:00"; let m = Math.floor(secondsPerKm / 60); let s = Math.floor(secondsPerKm % 60); return m + ":" + (s < 10 ? "0" : "") + s; }
      
          function prepareStudio() {
              if (fullPath.length <= 1) return;
              const elem = document.documentElement;
              if (elem.requestFullscreen) elem.requestFullscreen().catch(() => {});
              else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
              
              document.getElementById('btn-start').style.display = 'none'; document.getElementById('btn-cancel').style.display = 'none';
              document.getElementById('inst-text').innerText = "Bersiaplah..."; document.getElementById('countdown').style.display = 'block';
      
              let count = 3;
              let interval = setInterval(() => {
                  count--;
                  if (count > 0) { document.getElementById('countdown').innerText = count; } 
                  else {
                      clearInterval(interval); document.getElementById('controls').style.display = 'none';
                      map.invalidateSize(); map.fitBounds(L.polyline(fullPath).getBounds(), { padding: [40, 40] });
                      requestAnimationFrame((timestamp) => { startTime = timestamp; animate(timestamp); });
                  }
              }, 1000);
          }
      
          function animate(currentTime) {
              if (!startTime) startTime = currentTime;
              const elapsed = currentTime - startTime; const progress = Math.min(elapsed / duration, 1); frameCount++; 
              const currentIndex = Math.floor(progress * (fullPath.length - 1));
              const currentPath = fullPath.slice(0, currentIndex + 1);
              outlineLine.setLatLngs(currentPath); animatedLine.setLatLngs(currentPath);
              const lastPoint = fullPath[currentIndex];
              markers.forEach((m, i) => { const offset = isPeleton ? (i * 0.00005) : 0; m.setLatLng([lastPoint[0] + offset, lastPoint[1] + offset]); });
              if (frameCount % 4 === 0 || progress >= 1) { const latOffset = (map.getBounds().getNorth() - map.getBounds().getSouth()) * 0.1; map.panTo([lastPoint[0] + latOffset, lastPoint[1]], { animate: true, duration: 0.25 }); }
              document.getElementById('v-dist').innerText = (progress * totalDistTarget).toFixed(2);
              let elevProgress = progress - 0.05 * Math.sin(progress * Math.PI * 4); if (elevProgress < 0) elevProgress = 0; if (elevProgress > 1) elevProgress = 1;
              document.getElementById('v-elev').innerText = Math.floor(elevProgress * totalElevTarget);
      
              if (isPace) {
                  let basePaceSec = totalDistTarget > 0 ? (movingTimeTarget / totalDistTarget) : 0;
                  let fluctuationSec = Math.sin(progress * 25) * 12; 
                  document.getElementById('v-speed').innerText = getPaceFormat(Math.max(0, basePaceSec + fluctuationSec));
              } else {
                  const speedBase = movingTimeTarget > 0 ? (totalDistTarget / (movingTimeTarget / 3600)) : 0;
                  const speedFluctuation = Math.sin(progress * 20) * 3; document.getElementById('v-speed').innerText = Math.max(0, speedBase + speedFluctuation).toFixed(1);
              }
      
              const currentSecs = Math.floor(progress * movingTimeTarget);
              const h = Math.floor(currentSecs / 3600).toString().padStart(2, '0'); const m = Math.floor((currentSecs % 3600) / 60).toString().padStart(2, '0'); const s = (currentSecs % 60).toString().padStart(2, '0');
              document.getElementById('v-time').innerText = \`\${h}:\${m}:\${s}\`;
              
              if (tempTarget > 0) {
                  let baseTemp = tempTarget;
                  if (startHour >= 5 && startHour < 11) baseTemp = tempTarget - 1.5 + (progress * 3.0); else if (startHour >= 11 && startHour < 15) baseTemp = tempTarget - 0.5 + Math.sin(progress * Math.PI) * 1.5; else if (startHour >= 15 && startHour < 19) baseTemp = tempTarget + 1.5 - (progress * 3.0); else baseTemp = tempTarget + 0.5 - (progress * 1.0);
                  let tempFluctuation = Math.sin(progress * 40) * 0.2; document.getElementById('v-temp').innerText = (baseTemp + tempFluctuation).toFixed(1);
              } else { document.getElementById('v-temp').innerText = '--'; }
      
              if (progress < 1) { requestAnimationFrame(animate); } 
              else { setTimeout(() => { document.getElementById('watermark').style.opacity = '0'; document.getElementById('ending-overlay').style.display = 'flex'; if (document.exitFullscreen) document.exitFullscreen().catch(() => {}); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }, 2000); }
          }
      </script>
      </body>
      </html>
    `)
  } catch (err) { return c.redirect('/') }
})

export default studio