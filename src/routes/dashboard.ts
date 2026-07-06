import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { Bindings } from "../index";

const dashboard = new Hono<{ Bindings: Bindings }>();
const DEFAULT_PUBLIC_PROFILE_SLUG = "rider";
const DEFAULT_PUBLIC_PROFILE_NAME = "Gaspool Rider";
const DEFAULT_PUBLIC_PROFILE_AVATAR = "/assets/profile.webp";

const escapeHTML = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizePublicProfileSlug = (value?: string) => {
  const slug = String(value || DEFAULT_PUBLIC_PROFILE_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);

  return slug || DEFAULT_PUBLIC_PROFILE_SLUG;
};

const normalizePublicProfileAvatar = (value?: string) => {
  const avatar = String(value || DEFAULT_PUBLIC_PROFILE_AVATAR)
    .trim()
    .slice(0, 240);

  if (avatar.startsWith("/assets/") || avatar.startsWith("https://")) {
    return avatar;
  }

  return DEFAULT_PUBLIC_PROFILE_AVATAR;
};

const getPublicProfile = (env: Bindings) => ({
  slug: normalizePublicProfileSlug(env.PUBLIC_PROFILE_SLUG),
  name: escapeHTML(
    String(env.PUBLIC_PROFILE_NAME || DEFAULT_PUBLIC_PROFILE_NAME)
      .trim()
      .slice(0, 80) || DEFAULT_PUBLIC_PROFILE_NAME,
  ),
  avatar: escapeHTML(normalizePublicProfileAvatar(env.PUBLIC_PROFILE_AVATAR)),
});

// ==========================================
// 1. DASHBOARD UTAMA (Pusat Komando PWA)
// ==========================================
dashboard.get("/", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  try {
    const payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as {
      email: string;
    };
    const captainName = payload.email.split("@")[0].toUpperCase();

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

          .best-section { margin-bottom: 25px; }
          .section-title { color: #fff; font-size: 0.85rem; font-weight: 950; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 12px 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
          .section-title span { color: #94a3b8; font-size: 0.62rem; font-weight: 900; letter-spacing: 0.8px; }
          .best-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .best-card { background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 14px; cursor: pointer; min-height: 118px; display: flex; flex-direction: column; justify-content: space-between; transition: 0.2s; }
          .best-card:hover { border-color: rgba(255,95,0,0.45); background: rgba(255,95,0,0.06); }
          .best-label { color: #94a3b8; font-size: 0.62rem; font-weight: 950; letter-spacing: 0.8px; text-transform: uppercase; line-height: 1.3; }
          .best-value { color: var(--primary); font-size: 1.32rem; line-height: 1; font-weight: 950; font-style: italic; margin: 10px 0 6px; }
          .best-value small { color: #94a3b8; font-size: 0.62rem; font-style: normal; margin-left: 3px; }
          .best-meta { color: #cbd5e1; font-size: 0.68rem; font-weight: 800; line-height: 1.35; opacity: 0.88; }
          .best-empty { color: #94a3b8; border: 1px dashed rgba(255,255,255,0.12); border-radius: 18px; padding: 16px; font-size: 0.76rem; font-weight: 800; text-align: center; }

          .period-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: -8px 0 25px; }
          .period-card { background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 14px; }
          .period-title { color: #fff; font-size: 0.72rem; font-weight: 950; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 10px; }
          .period-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
          .period-value { color: var(--primary); font-size: 1rem; font-weight: 950; font-style: italic; line-height: 1.1; }
          .period-label { color: #94a3b8; font-size: 0.54rem; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase; margin-top: 3px; }

          .filter-search-row { margin-bottom: 20px; }
          .filter-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .search-input { grid-column: 1 / -1; background: var(--card); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; width: 100%; outline: none; font-weight: 900; font-size: 13px; backdrop-filter: blur(10px); }
          .search-input::placeholder { color: #64748b; }
          select.dropdown { background: var(--card); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 15px; border-radius: 12px; width: 100%; outline: none; font-weight: 900; font-size: 13px; cursor: pointer; backdrop-filter: blur(10px); -webkit-appearance: none; text-align: center; }
          select.dropdown option { background: #0a0a12; }
          
          .rides-container { background: var(--card); border-radius: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
          table { width: 100%; border-collapse: collapse; }
          tr { border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s; }
          tr:hover { background: rgba(255,95,0,0.05); }
          td { padding: 18px 15px; }
          .ride-name { font-weight: 900; font-size: 0.95rem; margin-bottom: 4px; color: #fff; }
          .ride-meta { font-size: 0.75rem; color: #888; font-weight: bold; }
          .visibility-badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 7px; margin-left: 6px; font-size: 0.62rem; font-weight: 900; letter-spacing: 0.6px; vertical-align: middle; }
          .visibility-public { color: #2ecc71; background: rgba(46,204,113,0.12); border: 1px solid rgba(46,204,113,0.35); }
          .visibility-private { color: #94a3b8; background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.25); }
          
          .modal { display: none; position: fixed; z-index: 2000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); backdrop-filter: blur(10px); justify-content: center; align-items: center; padding: 20px; }
          .modal-content { background: #16161d; border-radius: 30px; width: 100%; max-width: 500px; border: 1px solid rgba(255,255,255,0.1); padding: 25px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); }
          #map-modal { height: 350px; width: 100%; border-radius: 20px; margin: 15px 0; background: #e5e7eb; border: 1px solid rgba(255,255,255,0.1); }
          
          #btnLoadMore { display: none; width: 100%; background: transparent; color: var(--primary); border: 2px solid var(--primary); padding: 18px; border-radius: 15px; font-weight: 900; font-style: italic; cursor: pointer; margin-top: 20px; text-transform: uppercase; transition: 0.3s; }
          #btnLoadMore:hover { background: var(--primary); color: #fff; }
		  
		  #bunker-alert { position: fixed; bottom: 25px; left: 50%; transform: translateX(-50%); background: rgba(231,76,60,0.9); color: white; padding: 12px 25px; border-radius: 30px; font-weight: 900; font-size: 0.8rem; z-index: 9999; box-shadow: 0 10px 20px rgba(0,0,0,0.5); display: none; align-items: center; gap: 10px; border: 2px solid #c0392b; animation: pulseBunker 2s infinite; backdrop-filter: blur(10px); }
		  @keyframes pulseBunker { 0% { box-shadow: 0 0 0 0 rgba(231,76,60,0.7); } 70% { box-shadow: 0 0 0 10px rgba(231,76,60,0); } 100% { box-shadow: 0 0 0 0 rgba(231,76,60,0); } }
          @media (max-width: 560px) {
            .period-grid { grid-template-columns: 1fr; }
            .filter-grid { grid-template-columns: 1fr; }
          }
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
            <button class="btn btn-outline" style="grid-column: span 2; border-color: var(--primary); color: var(--primary);" onclick="window.location.href='/route_plan'">🧭 RUTE PLAN</button>
            <button class="btn btn-outline" style="grid-column: span 2; border-color: #3498db; color: #3498db;" onclick="window.location.href='/routes'">🗺️ RUTE TERSIMPAN</button>
            <button class="btn btn-outline" style="grid-column: span 2; border-color: #f1c40f; color: #f1c40f;" onclick="window.location.href='/segments'">🏁 PERSONAL SEGMENTS</button>
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

          <div class="period-grid">
            <div class="period-card">
              <div class="period-title">BULAN INI</div>
              <div class="period-row">
                <div><div class="period-value" id="month-dist">0.0</div><div class="period-label">KM</div></div>
                <div><div class="period-value" id="month-count">0</div><div class="period-label">SESI</div></div>
                <div><div class="period-value" id="month-time">0</div><div class="period-label">JAM</div></div>
              </div>
            </div>
            <div class="period-card">
              <div class="period-title">TAHUN INI</div>
              <div class="period-row">
                <div><div class="period-value" id="year-dist">0.0</div><div class="period-label">KM</div></div>
                <div><div class="period-value" id="year-count">0</div><div class="period-label">SESI</div></div>
                <div><div class="period-value" id="year-time">0</div><div class="period-label">JAM</div></div>
              </div>
            </div>
          </div>

          <section class="best-section">
            <h2 class="section-title">🏆 REKOR PRIBADI <span>PERSONAL BEST</span></h2>
            <div id="best-grid" class="best-grid">
              <div class="best-empty" style="grid-column:1 / -1;">Memuat rekor pribadi...</div>
            </div>
          </section>

          <div class="filter-search-row">
            <div class="filter-grid">
              <input id="searchInput" class="search-input" type="search" placeholder="CARI AKTIVITAS..." oninput="scheduleFilterChange()">
              <select id="filterSelect" class="dropdown" onchange="changeFilter()">
                <option value="all">🌐 SHOW ALL ACTIVITIES</option>
                <option value="ride">🚴 CYCLING (RIDE)</option>
                <option value="run">🏃 RUNNING (RUN)</option>
                <option value="walk">🚶 WALKING (WALK)</option>
                <option value="hike">⛰️ HIKING (HIKE)</option>
              </select>
              <select id="visibilitySelect" class="dropdown" onchange="changeFilter()">
                <option value="all">SEMUA STATUS</option>
                <option value="public">PUBLIC SAJA</option>
                <option value="private">PRIVATE SAJA</option>
              </select>
              <select id="periodSelect" class="dropdown" onchange="changeFilter()">
                <option value="all">SEMUA WAKTU</option>
                <option value="month">BULAN INI</option>
                <option value="year">TAHUN INI</option>
              </select>
              <select id="sortSelect" class="dropdown" onchange="changeFilter()">
                <option value="latest">TERBARU</option>
                <option value="oldest">TERLAMA</option>
                <option value="distance_desc">JARAK TERJAUH</option>
                <option value="duration_desc">DURASI TERLAMA</option>
                <option value="speed_desc">TERCEPAT</option>
                <option value="elev_desc">ELEVASI TERTINGGI</option>
              </select>
            </div>
          </div>

          <div class="rides-container">
            <table id="rides-table">
              <tbody id="rides-tbody"></tbody>
            </table>
          </div>
          
          <button id="btnLoadMore" onclick="loadMore()">▼ LOAD MORE DATA</button>
		  <div id="bunker-alert">📡 MENGUNGGAH DARI BUNKER... <span id="bunker-count"></span></div>
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
                <p id="mNotes" style="display:none; color:#cbd5e1; font-size:0.78rem; line-height:1.5; margin:8px 0 0; font-weight:700; white-space:pre-wrap;"></p>
                
                <div id="map-modal"></div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:10px;">
                    <button class="btn btn-orange" style="font-size: 0.65rem;" id="btn-detail-link">🔍 STUDIO</button>
                    <button class="btn" style="background:#2ecc71; color:white; font-size: 0.65rem;" id="btn-visibility-link">🌐 PUBLIC</button>
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
          let curVisibility = 'all';
          let curPeriod = 'all';
          let curSort = 'latest';
          let curSearch = '';
          let searchTimer = null;
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
            // FIX: Hapus backtick
            const text = 'Ayo gabung Radar Peleton Gaspool!\\nRoom ID: *' + room + '*\\n\\nKlik link ini untuk join ikut merekam:\\n' + url;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
          }

          function shareRadar() {
            let val = document.getElementById('roomName').value.trim();
            if (!val) { alert("Isi nama room dulu Kapten!"); return; }
            const room = val.replace(/[^A-Z0-9_]/ig, '').toUpperCase();
            const url = window.location.origin + '/radar/' + room;
            // FIX: Hapus backtick
            const text = 'Pantau pergerakan gowes Peleton secara live!\\nRoom: *' + room + '*\\n\\nBuka satelit radar di sini:\\n' + url;
            window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
          }
          
          function renderPeriodStats(periodStats) {
             const month = periodStats && periodStats.month ? periodStats.month : {};
             const year = periodStats && periodStats.year ? periodStats.year : {};
             document.getElementById('month-dist').innerText = parseFloat(month.total_dist || 0).toFixed(1);
             document.getElementById('month-count').innerText = month.total_count || 0;
             document.getElementById('month-time').innerText = Math.floor((month.total_time || 0) / 3600);
             document.getElementById('year-dist').innerText = parseFloat(year.total_dist || 0).toFixed(1);
             document.getElementById('year-count').innerText = year.total_count || 0;
             document.getElementById('year-time').innerText = Math.floor((year.total_time || 0) / 3600);
          }

          async function fetchRides(append) {
             const params = new URLSearchParams({
               filter: curF,
               page: String(curP),
               visibility: curVisibility,
               period: curPeriod,
               sort: curSort
             });
             if (curSearch) params.set('q', curSearch);
             const res = await fetch('/api/rides?' + params.toString()); 
             const data = await res.json();

             if (!res.ok || data.success === false) {
               throw new Error(data.error || 'Gagal memuat aktivitas.');
             }
             
             const stats = data.stats || {};
             document.getElementById('stat-dist').innerText = parseFloat(stats.total_dist || 0).toFixed(1);
             document.getElementById('stat-count').innerText = stats.total_count || 0;
             document.getElementById('stat-time').innerText = Math.floor((stats.total_time || 0) / 3600);
             document.getElementById('stat-elev').innerText = Math.round(stats.total_elev || 0);
             renderPeriodStats(data.period_stats);

             const tb = document.getElementById('rides-tbody'); 
             if(!append) tb.innerHTML = '';

             const rides = Array.isArray(data.rides) ? data.rides : [];

             if (!append && rides.length === 0) {
               tb.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#94a3b8; font-weight:900; padding:24px;">Tidak ada aktivitas yang cocok.</td></tr>';
             }

             rides.forEach(r => {
               const tr = document.createElement('tr');
               const icon = r.activity_type === 'run' ? '🏃' : (r.activity_type === 'walk' ? '🚶' : (r.activity_type === 'hike' ? '⛰️' : '🚴'));
               
               tr.onclick = () => bukaPeta(r.polyline, r.name, r.distance, r.id, Number(r.is_public || 0) === 1, r.notes || '');
               const visibilityBadge = Number(r.is_public || 0) === 1
                 ? '<span class="visibility-badge visibility-public">PUBLIC</span>'
                 : '<span class="visibility-badge visibility-private">PRIVATE</span>';
               
               tr.innerHTML = '<td><div style="font-size:1.5rem;">' + icon + '</div></td>' +
                            '<td><div class="ride-name">' + escapeHTML(r.name) + visibilityBadge + '</div>' +
                            '<div class="ride-meta">' + parseFloat(r.distance).toFixed(2) + ' KM • ' + new Date(r.start_date).toLocaleDateString('id-ID') + '</div></td>' +
                            '<td style="text-align:right; color:' + primaryColor + '; font-weight:bold;">❯</td>';
               tb.appendChild(tr);
             });
             
             document.getElementById('btnLoadMore').style.display = rides.length < 10 ? 'none' : 'block';
          }

          async function fetchPersonalBests() {
            const grid = document.getElementById('best-grid');
            if (!grid) return;

            try {
              const res = await fetch('/api/personal_bests');
              const data = await res.json();
              const records = Array.isArray(data.records) ? data.records : [];

              if (!res.ok || !data.success) {
                throw new Error(data.message || 'Gagal memuat rekor pribadi.');
              }

              if (records.length === 0) {
                grid.innerHTML = '<div class="best-empty" style="grid-column:1 / -1;">Belum ada rekor. Selesaikan beberapa aktivitas dulu.</div>';
                return;
              }

              grid.innerHTML = records.map(function(record) {
                const unit = record.unit ? '<small>' + escapeHTML(record.unit) + '</small>' : '';
                const id = record.ride_id ? String(record.ride_id).replace(/[^0-9]/g, '') : '';
                const click = id ? ' onclick="window.location.href=\\'/detail/' + id + '\\'"' : '';

                return '<article class="best-card"' + click + '>' +
                  '<div class="best-label">' + escapeHTML(record.label) + '</div>' +
                  '<div class="best-value">' + escapeHTML(record.value) + unit + '</div>' +
                  '<div class="best-meta">' + escapeHTML(record.meta || '') + '</div>' +
                '</article>';
              }).join('');
            } catch (err) {
              console.error(err);
              grid.innerHTML = '<div class="best-empty" style="grid-column:1 / -1;">Rekor pribadi belum bisa dimuat.</div>';
            }
          }

function escapeHTML(str) {

  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

}

          function changeFilter() {
            curF = document.getElementById('filterSelect').value;
            curVisibility = document.getElementById('visibilitySelect').value;
            curPeriod = document.getElementById('periodSelect').value;
            curSort = document.getElementById('sortSelect').value;
            curSearch = String(document.getElementById('searchInput').value || '').trim();
            curP = 1;
            fetchRides(false).catch(function(err) {
              console.error(err);
              document.getElementById('rides-tbody').innerHTML = '<tr><td colspan="3" style="text-align:center; color:#e74c3c; font-weight:900; padding:24px;">' + escapeHTML(err.message || 'Gagal memuat aktivitas.') + '</td></tr>';
            });
          }

          function scheduleFilterChange() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(changeFilter, 300);
          }

          function loadMore() {
            curP++;
            fetchRides(true).catch(function(err) {
              console.error(err);
              curP = Math.max(1, curP - 1);
              alert(err.message || 'Gagal memuat aktivitas berikutnya.');
            });
          }
          
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

          function extractCoordinateList(value) {
              if (Array.isArray(value)) return value;
              if (!value || typeof value !== 'object') return [];
              if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
                  return value.features.flatMap(extractCoordinateList);
              }
              if (value.type === 'Feature') return extractCoordinateList(value.geometry);
              if (value.type === 'LineString' && Array.isArray(value.coordinates)) return value.coordinates;
              if (value.type === 'MultiLineString' && Array.isArray(value.coordinates)) return value.coordinates.flat();
              if (value.geometry) return extractCoordinateList(value.geometry);
              if (value.path) return extractCoordinateList(value.path);
              if (value.data) return extractCoordinateList(value.data);
              if (value.polyline) return extractCoordinateList(value.polyline);
              if (value.coordinates) return extractCoordinateList(value.coordinates);
              return [];
          }

          function normalizeRoutePoints(value) {
              return extractCoordinateList(value).map(function(p) {
                  if (Array.isArray(p)) {
                      const first = parseFloat(p[0]);
                      const second = parseFloat(p[1]);
                      if (Math.abs(first) > 90 && Math.abs(second) <= 90) return [second, first];
                      return [first, second];
                  }
                  if (p && p.lat !== undefined) {
                      return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                  }
                  return null;
              }).filter(function(p) {
                  return p !== null && !isNaN(p[0]) && !isNaN(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
              });
          }

          function setVisibilityButton(isPublic) {
            const btn = document.getElementById('btn-visibility-link');
            btn.innerText = isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE';
            btn.style.background = isPublic ? '#2ecc71' : '#555';
          }

          async function bukaPeta(url, name, dist, id, isPublic, notes) {
            openModal('mapModal');
            document.getElementById('mTitle').innerText = name;
            document.getElementById('mDist').innerText = parseFloat(dist).toFixed(2) + ' KM';
            const notesEl = document.getElementById('mNotes');
            const currentNotes = String(notes || '').trim();
            notesEl.style.display = currentNotes ? 'block' : 'none';
            notesEl.innerText = currentNotes ? currentNotes : '';
            document.getElementById('btn-detail-link').onclick = () => window.location.href = '/detail/' + id;
            setVisibilityButton(isPublic);
            document.getElementById('btn-visibility-link').onclick = async () => {
                const nextPublic = !isPublic;
                const label = nextPublic ? 'publik' : 'private';
                if(!confirm('Ubah aktivitas ini menjadi ' + label + '?')) return;

                const res = await fetch('/api/ride_visibility/' + id, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_public: nextPublic ? 1 : 0 })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    alert(data.message || 'Gagal mengubah status publik.');
                    return;
                }

                isPublic = nextPublic;
                setVisibilityButton(isPublic);
                closeModal('mapModal');
                changeFilter();
            };
            
            document.getElementById('btn-edit-link').onclick = async () => {
                const n = prompt('Rename Activity:', name);
                if (n === null) return;
                const nextNotes = prompt('Catatan aktivitas:', currentNotes);
                if (nextNotes === null) return;

                const payload = {
                    name: String(n || '').trim() || name,
                    notes: String(nextNotes || '').trim()
                };

                const res = await fetch('/api/edit_ride/' + id, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    alert(data.message || 'Gagal menyimpan aktivitas.');
                    return;
                }

                closeModal('mapModal'); changeFilter();
            };
            
            document.getElementById('btn-delete-link').onclick = async () => {
                if(confirm('Permanently delete this track?')) {
                    await fetch('/api/delete_ride/' + id, { method: 'DELETE' });
                    window.location.reload();
                }
            };

            if(!modalMap) {
              modalMap = L.map('map-modal', { zoomControl: false });
              L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
              }).addTo(modalMap);
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
              
              pts = normalizeRoutePoints(pts);
              
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
          
          window.onload = () => {
            fetchRides(false).catch(function(err) {
              console.error(err);
              document.getElementById('rides-tbody').innerHTML = '<tr><td colspan="3" style="text-align:center; color:#e74c3c; font-weight:900; padding:24px;">' + escapeHTML(err.message || 'Gagal memuat aktivitas.') + '</td></tr>';
            });
            fetchPersonalBests();
          };
		  
		  // --- BUNKER MODE SYNC ENGINE ---
          let bunkerDB;
let bunkerSyncRunning = false;
          const reqBunker = indexedDB.open("GaspoolDB_TS", 2);
          reqBunker.onupgradeneeded = (e) => {
              bunkerDB = e.target.result;
              if (!bunkerDB.objectStoreNames.contains("gaspool_points")) bunkerDB.createObjectStore("gaspool_points", { autoIncrement: true });
              if (!bunkerDB.objectStoreNames.contains("sync_queue")) bunkerDB.createObjectStore("sync_queue", { keyPath: "id" });
          };
          reqBunker.onsuccess = (e) => { 
              bunkerDB = e.target.result; 
              if (navigator.onLine) processBunker();
          };

          async function processBunker() {

    if (!bunkerDB) return;

    if (bunkerSyncRunning) return;

    bunkerSyncRunning = true;

    try {

        const tx =
          bunkerDB.transaction(
            "sync_queue",
            "readonly",
          );

        const allReq =
          tx.objectStore(
            "sync_queue",
          ).getAll();

        allReq.onsuccess =
          async (e) => {

            const items =
              e.target.result;

            if(items.length > 0) {

              document.getElementById(
                'bunker-alert'
              ).style.display = 'flex';

              document.getElementById(
                'bunker-count'
              ).innerText =
                '(' +
                items.length +
                ' Antrean)';

              let anySuccess =
                false;

              for (
                let i = 0;
                i < items.length;
                i++
              ) {

                let item =
                  items[i];

                let success =
                  true;

                for (
                  let j = 0;
                  j < item.payloads.length;
                  j++
                ) {

                  try {

                    const res =
                      await fetch(
                        '/api/save_ride',
                        {
                          method:
                            'POST',
                          body:
                            JSON.stringify(
                              item.payloads[j]
                            ),
                          headers:
                            {
                              'Content-Type':
                                'application/json'
                            }
                        }
                      );

                    if (!res.ok)
                      success =
                        false;

                  } catch {

                    success =
                      false;

                  }

                }

                if(success) {

                  const delTx =
                    bunkerDB.transaction(
                      "sync_queue",
                      "readwrite",
                    );

                  delTx
                    .objectStore(
                      "sync_queue",
                    )
                    .delete(
                      item.id,
                    );

                  anySuccess =
                    true;

                }

              }

              document.getElementById(
                'bunker-alert'
              ).style.display =
                'none';

              bunkerSyncRunning =
                false;

              if(anySuccess) {

                window.location.reload();

              }

            } else {

              bunkerSyncRunning =
                false;

            }

          };

        allReq.onerror =
          () => {

            bunkerSyncRunning =
              false;

          };

    } catch {

        bunkerSyncRunning =
          false;

    }

}
          // Pantau jika HP tiba-tiba dapat sinyal dari mode Pesawat / No Service
          window.addEventListener('online', processBunker);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    deleteCookie(c, "gaspool_session");
    return c.redirect("/login");
  }
});

// ==========================================
// 2. FITUR: ROUTE PLAN BUILDER
// ==========================================
dashboard.get("/route_plan", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");
  const routeId = (c.req.query("route") || "").replace(/[^0-9]/g, "");

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Route Plan - Gaspool</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            :root { --primary: #FF5F00; --bg: #0a0a12; --panel: rgba(10,10,18,0.9); --muted: #94a3b8; --line: rgba(255,255,255,0.1); --route: #3498db; }
            * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
            html, body { margin: 0; height: 100%; background: #000; color: #fff; font-family: 'Inter', sans-serif; overflow: hidden; }
            #map { position: fixed; inset: 0; z-index: 1; background: #000; }
            .topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; pointer-events: none; }
            .brand, .back-btn { pointer-events: auto; background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(14px); border-radius: 14px; }
            .brand { padding: 12px 14px; min-width: 0; }
            .brand h1 { margin: 0; color: var(--primary); font-style: italic; font-size: 1.2rem; line-height: 1; font-weight: 900; }
            .brand div { margin-top: 4px; color: var(--muted); font-size: 0.68rem; font-weight: 900; letter-spacing: 1px; }
            .back-btn { color: #fff; text-decoration: none; padding: 12px 14px; font-weight: 900; font-size: 0.78rem; }
            .panel { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 1000; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 14px; backdrop-filter: blur(18px); box-shadow: 0 20px 50px rgba(0,0,0,0.55); max-height: 58vh; overflow: auto; }
            .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            .input, .select { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid var(--line); color: #fff; border-radius: 12px; padding: 12px; font-size: 0.85rem; font-weight: 800; outline: none; }
            .select option { background: #0a0a12; color: #fff; }
            .search-box { display: grid; grid-template-columns: 1fr 84px; gap: 8px; margin-bottom: 8px; }
            .search-results { display: none; flex-direction: column; gap: 6px; max-height: 172px; overflow: auto; margin: 0 0 10px; }
            .search-item { width: 100%; text-align: left; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,0.06); color: #fff; padding: 10px; cursor: pointer; }
            .search-item:active { transform: scale(0.99); }
            .search-title { font-size: 0.78rem; font-weight: 900; line-height: 1.25; }
            .search-meta { color: var(--muted); font-size: 0.66rem; font-weight: 800; margin-top: 4px; line-height: 1.3; }
            .btn { border: none; border-radius: 12px; padding: 12px 10px; font-size: 0.75rem; font-weight: 900; cursor: pointer; color: #fff; background: rgba(255,255,255,0.08); text-transform: uppercase; }
            .btn:active { transform: scale(0.97); }
            .btn-primary { background: var(--primary); }
            .btn-route { background: var(--route); }
            .btn-danger { background: rgba(231,76,60,0.85); }
            .btn:disabled { opacity: 0.45; cursor: not-allowed; }
            .summary { display: none; border-top: 1px solid var(--line); margin-top: 10px; padding-top: 12px; }
            .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
            .stat { background: rgba(255,255,255,0.06); border: 1px solid var(--line); border-radius: 12px; padding: 10px; text-align: center; }
            .stat-val { color: var(--primary); font-size: 1.2rem; font-weight: 900; font-style: italic; }
            .stat-lbl { color: var(--muted); font-size: 0.62rem; font-weight: 900; letter-spacing: 1px; margin-top: 3px; }
            .points { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 10px; min-height: 28px; }
            .point-pill { border: 1px solid var(--line); background: rgba(255,255,255,0.06); color: #fff; border-radius: 12px; padding: 6px 7px; font-size: 0.68rem; font-weight: 900; display: flex; align-items: center; gap: 5px; cursor: pointer; }
            .point-label { min-width: 48px; }
            .point-action { border: 1px solid var(--line); background: rgba(0,0,0,0.2); color: #fff; border-radius: 8px; min-width: 24px; height: 24px; font-size: 0.7rem; font-weight: 900; cursor: pointer; }
            .point-action:disabled { opacity: 0.32; cursor: not-allowed; }
            .planner-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            .hint { color: var(--muted); font-size: 0.72rem; line-height: 1.35; font-weight: 700; margin: 7px 2px 10px; }
            .status { color: var(--muted); font-size: 0.75rem; font-weight: 800; min-height: 18px; margin: 2px 2px 9px; }
            .gps-control { position: fixed; right: 14px; top: 84px; z-index: 1000; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: #fff; backdrop-filter: blur(14px); padding: 12px 14px; font-size: 0.72rem; font-weight: 900; cursor: pointer; pointer-events: auto; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
            .gps-control.is-following { color: var(--primary); border-color: rgba(255,95,0,0.75); }
            .gps-control:disabled { opacity: 0.42; cursor: not-allowed; }
            .leaflet-control-attribution { display: none; }
            @media (min-width: 720px) {
                .panel { left: auto; right: 20px; bottom: 20px; width: 430px; max-height: calc(100vh - 40px); }
                .topbar { padding: 20px; }
                .gps-control { top: 96px; right: 20px; }
            }
        </style>
    </head>
    <body>
        <div id="map"></div>

        <div class="topbar">
            <div class="brand">
                <h1>ROUTE PLAN</h1>
                <div>GASPOOL NAVIGATOR</div>
            </div>
            <a class="back-btn" href="/">KEMBALI</a>
        </div>
        <button id="btnRecenter" class="gps-control" onclick="recenterToUser()" disabled>GPS</button>

        <div class="panel">
            <input id="routeName" class="input" value="Gowes Route Plan" maxlength="80" style="margin-bottom:8px;">
            <div class="search-box">
                <input id="locationSearch" class="input" placeholder="Cari lokasi, misal: alun-alun mojokerto">
                <button class="btn btn-primary" id="btnSearch" onclick="searchLocation()">CARI</button>
            </div>
            <div id="searchResults" class="search-results"></div>
            <div class="row">
                <select id="routeProfile" class="select">
                    <option value="cycling-regular">RIDE REGULAR</option>
                    <option value="cycling-road">ROAD BIKE</option>
                    <option value="cycling-mountain">MTB</option>
                    <option value="cycling-electric">E-BIKE</option>
                    <option value="foot-walking">WALK / RUN</option>
                    <option value="foot-hiking">HIKE</option>
                </select>
                <button class="btn" onclick="useCurrentLocation()">PAKAI LOKASI</button>
            </div>

            <div class="hint">Ketuk peta untuk menambah titik. Titik pertama menjadi start, titik terakhir menjadi tujuan, titik di tengah menjadi waypoint.</div>
            <div id="status" class="status">Belum ada titik rute.</div>
            <div id="points" class="points"></div>
            <div class="planner-tools">
                <button class="btn" id="btnUndoPoint" onclick="undoPoint()" disabled>UNDO TITIK</button>
                <button class="btn" id="btnFitMap" onclick="fitRouteView()" disabled>FIT MAP</button>
            </div>

            <div class="row-3">
                <button class="btn btn-primary" id="btnGenerate" onclick="generateRoute()">GENERATE</button>
                <button class="btn btn-danger" onclick="resetPlan()">RESET</button>
                <button class="btn btn-route" id="btnStart" onclick="startRoute()" disabled>MULAI</button>
            </div>

            <div id="summary" class="summary">
                <div class="summary-grid">
                    <div class="stat">
                        <div class="stat-val" id="statDist">0.0</div>
                        <div class="stat-lbl">KM</div>
                    </div>
                    <div class="stat">
                        <div class="stat-val" id="statTime">0</div>
                        <div class="stat-lbl">MENIT</div>
                    </div>
                    <div class="stat">
                        <div class="stat-val" id="statTurns">0</div>
                        <div class="stat-lbl">ARAHAN</div>
                    </div>
                </div>
                <div class="hint" id="routeInfo">Rute siap dipakai.</div>
            </div>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            let map;
            let points = [];
            let markers = [];
            let guideLine = null;
            let routeLine = null;
            let savedRoute = null;
            let searchAbort = null;
            let userMarker = null;
            let userAccuracyCircle = null;
            let userPosition = null;
            let userWatchId = null;
            let followUser = false;
            let centeredOnUserOnce = false;
            const preloadRouteId = "${routeId}";

            const primaryColor = '#FF5F00';
            const routeColor = '#3498db';
            const userColor = '#38bdf8';

            function initMap() {
                map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(map);

                map.on('click', function(e) {
                    addPoint(e.latlng.lat, e.latlng.lng);
                });

                map.on('dragstart', function() {
                    if (userPosition) {
                        followUser = false;
                        updateRecenterButton();
                    }
                });

                startUserTracking();

                document.getElementById('locationSearch').addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        searchLocation();
                    }
                });

                if (preloadRouteId) {
                    loadExistingRoute(preloadRouteId);
                }
            }

            function setStatus(text, isError) {
                const el = document.getElementById('status');
                el.innerText = text;
                el.style.color = isError ? '#e74c3c' : '#94a3b8';
            }

            function updateRecenterButton() {
                const btn = document.getElementById('btnRecenter');
                btn.disabled = !userPosition;
                btn.classList.toggle('is-following', Boolean(userPosition && followUser));
                btn.innerText = followUser ? 'GPS ON' : 'GPS';
            }

            function startUserTracking() {
                if (!navigator.geolocation) {
                    updateRecenterButton();
                    return;
                }

                userWatchId = navigator.geolocation.watchPosition(function(pos) {
                    updateUserPosition(pos);
                }, function() {
                    updateRecenterButton();
                }, {
                    enableHighAccuracy: true,
                    maximumAge: 5000,
                    timeout: 12000
                });
            }

            function updateUserPosition(pos) {
                const lat = Number(pos.coords.latitude);
                const lng = Number(pos.coords.longitude);
                const accuracy = Math.max(5, Number(pos.coords.accuracy || 0));
                const latlng = [lat, lng];

                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

                userPosition = { lat: lat, lng: lng, accuracy: accuracy };

                if (!userAccuracyCircle) {
                    userAccuracyCircle = L.circle(latlng, {
                        radius: accuracy,
                        color: userColor,
                        weight: 1,
                        opacity: 0.35,
                        fillColor: userColor,
                        fillOpacity: 0.12,
                        interactive: false
                    }).addTo(map);
                } else {
                    userAccuracyCircle.setLatLng(latlng);
                    userAccuracyCircle.setRadius(accuracy);
                }

                if (!userMarker) {
                    userMarker = L.circleMarker(latlng, {
                        radius: 8,
                        color: '#fff',
                        weight: 3,
                        fillColor: userColor,
                        fillOpacity: 1,
                        interactive: false
                    }).addTo(map);
                } else {
                    userMarker.setLatLng(latlng);
                }

                if (!centeredOnUserOnce || followUser) {
                    map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
                    centeredOnUserOnce = true;
                }

                updateRecenterButton();
            }

            function recenterToUser() {
                if (!userPosition) {
                    setStatus('Lokasi GPS belum tersedia.', true);
                    return;
                }

                followUser = true;
                map.setView([userPosition.lat, userPosition.lng], Math.max(map.getZoom(), 16), { animate: true });
                updateRecenterButton();
                setStatus('Peta kembali ke posisi kamu.', false);
            }

            function setSearchResultsVisible(visible) {
                document.getElementById('searchResults').style.display = visible ? 'flex' : 'none';
            }

            function clearSearchResults() {
                const list = document.getElementById('searchResults');
                list.innerHTML = '';
                setSearchResultsVisible(false);
            }

            async function searchLocation() {
                const input = document.getElementById('locationSearch');
                const btn = document.getElementById('btnSearch');
                const query = input.value.trim();

                if (query.length < 2) {
                    setStatus('Ketik minimal 2 karakter untuk mencari lokasi.', true);
                    clearSearchResults();
                    return;
                }

                if (searchAbort) searchAbort.abort();
                searchAbort = new AbortController();

                btn.disabled = true;
                btn.innerText = '...';
                setStatus('Mencari lokasi...', false);

                try {
                    const center = map.getCenter();
                    const url = '/api/geocode?q=' + encodeURIComponent(query)
                        + '&lat=' + encodeURIComponent(center.lat)
                        + '&lng=' + encodeURIComponent(center.lng);
                    const res = await fetch(url, { signal: searchAbort.signal });
                    const data = await res.json();

                    if (!res.ok || !data.success) {
                        throw new Error(data.message || 'Pencarian lokasi gagal.');
                    }

                    renderSearchResults(data.results || []);
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error(err);
                    setStatus(err.message || 'Gagal mencari lokasi.', true);
                    clearSearchResults();
                } finally {
                    btn.disabled = false;
                    btn.innerText = 'CARI';
                }
            }

            function renderSearchResults(results) {
                const list = document.getElementById('searchResults');
                list.innerHTML = '';

                if (!results.length) {
                    setStatus('Lokasi tidak ditemukan. Coba kata kunci lain.', true);
                    setSearchResultsVisible(false);
                    return;
                }

                results.forEach(function(result) {
                    const item = document.createElement('button');
                    const title = document.createElement('div');
                    const meta = document.createElement('div');
                    const area = [result.locality, result.region, result.country].filter(Boolean).join(', ');

                    item.type = 'button';
                    item.className = 'search-item';
                    title.className = 'search-title';
                    meta.className = 'search-meta';
                    title.innerText = result.label || result.name || 'Lokasi';
                    meta.innerText = area || (Number(result.lat).toFixed(5) + ', ' + Number(result.lng).toFixed(5));

                    item.appendChild(title);
                    item.appendChild(meta);
                    item.onclick = function() {
                        selectSearchResult(result);
                    };
                    list.appendChild(item);
                });

                setSearchResultsVisible(true);
                setStatus(results.length + ' hasil ditemukan. Pilih salah satu untuk menambah titik.', false);
            }

            function selectSearchResult(result) {
                const lat = Number(result.lat);
                const lng = Number(result.lng);
                const wasEmpty = points.length === 0;

                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                    setStatus('Koordinat hasil pencarian tidak valid.', true);
                    return;
                }

                addPoint(lat, lng);
                map.setView([lat, lng], 16);
                document.getElementById('locationSearch').value = result.name || result.label || '';
                clearSearchResults();

                const routeName = document.getElementById('routeName');
                if (!wasEmpty && routeName.value === 'Gowes Route Plan') {
                    routeName.value = 'Route ke ' + (result.name || result.label || 'Tujuan');
                }
            }

            function invalidateGeneratedRoute() {
                savedRoute = null;
                document.getElementById('btnStart').disabled = true;
                document.getElementById('summary').style.display = 'none';

                if (routeLine) {
                    map.removeLayer(routeLine);
                    routeLine = null;
                }
            }

            function updatePlannerControls() {
                const undoBtn = document.getElementById('btnUndoPoint');
                const fitBtn = document.getElementById('btnFitMap');

                undoBtn.disabled = points.length === 0;
                fitBtn.disabled = points.length === 0 && !routeLine;
            }

            function addPoint(lat, lng) {
                points.push({ lat: lat, lng: lng });
                invalidateGeneratedRoute();
                drawPoints();
            }

            function undoPoint() {
                if (points.length === 0) return;

                points.pop();
                invalidateGeneratedRoute();
                drawPoints();
                setStatus(points.length ? 'Titik terakhir dihapus.' : 'Semua titik rute sudah kosong.', false);
            }

            function removePoint(index) {
                if (index < 0 || index >= points.length) return;

                points.splice(index, 1);
                invalidateGeneratedRoute();
                drawPoints();
                setStatus('Titik rute dihapus.', false);
            }

            function movePoint(index, direction) {
                const target = index + direction;

                if (index < 0 || index >= points.length || target < 0 || target >= points.length) return;

                const current = points[index];
                points[index] = points[target];
                points[target] = current;
                invalidateGeneratedRoute();
                drawPoints();
                setStatus('Urutan titik rute diperbarui.', false);
            }

            function focusPoint(index) {
                const point = points[index];

                if (!point) return;

                map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: true });
            }

            function fitRouteView() {
                if (routeLine) {
                    map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });
                    return;
                }

                if (guideLine) {
                    map.fitBounds(guideLine.getBounds(), { padding: [45, 45] });
                    return;
                }

                if (points.length === 1) {
                    focusPoint(0);
                }
            }

            async function loadExistingRoute(routeId) {
                setStatus('Memuat rute tersimpan #' + routeId + '...', false);

                try {
                    const res = await fetch('/api/route_plan/' + encodeURIComponent(routeId));
                    const data = await res.json();

                    if (!res.ok || !data.success || !data.route) {
                        throw new Error(data.message || 'Rute tersimpan gagal dimuat.');
                    }

                    const route = data.route;
                    const routeData = route.data || {};
                    const waypoints = Array.isArray(routeData.waypoints) ? routeData.waypoints : [];

                    points = waypoints.map(function(point) {
                        return {
                            lat: Number(point.lat),
                            lng: Number(point.lng !== undefined ? point.lng : point.lon)
                        };
                    }).filter(function(point) {
                        return Number.isFinite(point.lat) && Number.isFinite(point.lng);
                    });

                    savedRoute = route;
                    document.getElementById('routeName').value = route.name || routeData.name || 'Gowes Route Plan';
                    if (route.profile || routeData.profile) {
                        document.getElementById('routeProfile').value = route.profile || routeData.profile;
                    }

                    drawPoints();
                    drawRoute(routeData.coordinates || []);
                    document.getElementById('statDist').innerText = Number(route.distance || routeData.distance_km || 0).toFixed(1);
                    document.getElementById('statTime').innerText = Math.max(1, Math.round(Number(route.duration || routeData.duration_s || 0) / 60));
                    document.getElementById('statTurns').innerText = Array.isArray(routeData.instructions) ? routeData.instructions.length : 0;
                    document.getElementById('routeInfo').innerText = 'Route ID #' + route.id + ' dimuat dari library.';
                    document.getElementById('summary').style.display = 'block';
                    document.getElementById('btnStart').disabled = false;
                    setStatus('Rute tersimpan berhasil dimuat.', false);
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || 'Gagal memuat rute tersimpan.', true);
                }
            }

            function drawPoints() {
                markers.forEach(function(marker) { map.removeLayer(marker); });
                markers = [];

                if (guideLine) {
                    map.removeLayer(guideLine);
                    guideLine = null;
                }

                if (routeLine) {
                    map.removeLayer(routeLine);
                    routeLine = null;
                }

                const list = document.getElementById('points');
                list.innerHTML = '';

                points.forEach(function(point, index) {
                    const label = index === 0 ? 'START' : (index === points.length - 1 ? 'TUJUAN' : 'VIA ' + index);
                    const marker = L.circleMarker([point.lat, point.lng], {
                        radius: 8,
                        color: '#fff',
                        fillColor: index === 0 ? '#2ecc71' : (index === points.length - 1 ? '#e74c3c' : primaryColor),
                        fillOpacity: 1
                    }).addTo(map).bindTooltip(label, { permanent: true, direction: 'top' });
                    marker.on('click', function() { focusPoint(index); });
                    markers.push(marker);

                    const pill = document.createElement('div');
                    const pillLabel = document.createElement('span');
                    const btnUp = document.createElement('button');
                    const btnDown = document.createElement('button');
                    const btnRemove = document.createElement('button');

                    pill.className = 'point-pill';
                    pill.title = Number(point.lat).toFixed(5) + ', ' + Number(point.lng).toFixed(5);
                    pill.onclick = function() { focusPoint(index); };

                    pillLabel.className = 'point-label';
                    pillLabel.innerText = label;

                    btnUp.type = 'button';
                    btnUp.className = 'point-action';
                    btnUp.innerText = '↑';
                    btnUp.disabled = index === 0;
                    btnUp.onclick = function(e) {
                        e.stopPropagation();
                        movePoint(index, -1);
                    };

                    btnDown.type = 'button';
                    btnDown.className = 'point-action';
                    btnDown.innerText = '↓';
                    btnDown.disabled = index === points.length - 1;
                    btnDown.onclick = function(e) {
                        e.stopPropagation();
                        movePoint(index, 1);
                    };

                    btnRemove.type = 'button';
                    btnRemove.className = 'point-action';
                    btnRemove.innerText = '×';
                    btnRemove.onclick = function(e) {
                        e.stopPropagation();
                        removePoint(index);
                    };

                    pill.appendChild(pillLabel);
                    pill.appendChild(btnUp);
                    pill.appendChild(btnDown);
                    pill.appendChild(btnRemove);
                    list.appendChild(pill);
                });

                if (points.length > 1) {
                    guideLine = L.polyline(points.map(function(p) { return [p.lat, p.lng]; }), {
                        color: primaryColor,
                        weight: 3,
                        opacity: 0.45,
                        dashArray: '6, 10'
                    }).addTo(map);
                    map.fitBounds(guideLine.getBounds(), { padding: [40, 40] });
                }

                if (points.length === 0) setStatus('Belum ada titik rute.', false);
                else if (points.length === 1) setStatus('Start sudah dipasang. Ketuk peta untuk menambah tujuan.', false);
                else setStatus(points.length + ' titik siap digenerate.', false);

                updatePlannerControls();
            }

            function useCurrentLocation() {
                if (!navigator.geolocation) {
                    setStatus('Browser tidak mendukung GPS.', true);
                    return;
                }

                if (userPosition) {
                    addPoint(userPosition.lat, userPosition.lng);
                    map.setView([userPosition.lat, userPosition.lng], Math.max(map.getZoom(), 16), { animate: true });
                    setStatus('Lokasi GPS dipasang sebagai titik rute.', false);
                    return;
                }

                setStatus('Mengambil lokasi GPS...', false);
                navigator.geolocation.getCurrentPosition(function(pos) {
                    updateUserPosition(pos);
                    addPoint(pos.coords.latitude, pos.coords.longitude);
                    map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                }, function() {
                    setStatus('Gagal mengambil lokasi. Pastikan izin GPS aktif.', true);
                }, { enableHighAccuracy: true, timeout: 12000 });
            }

            function resetPlan() {
                points = [];
                invalidateGeneratedRoute();
                drawPoints();
            }

            async function generateRoute() {
                if (points.length < 2) {
                    setStatus('Minimal butuh start dan tujuan.', true);
                    return;
                }

                const btn = document.getElementById('btnGenerate');
                btn.disabled = true;
                btn.innerText = 'MEMPROSES...';
                setStatus('Meminta rute ke satelit ORS...', false);

                try {
                    const res = await fetch('/api/route_plan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: document.getElementById('routeName').value,
                            profile: document.getElementById('routeProfile').value,
                            waypoints: points
                        })
                    });

                    const data = await res.json();

                    if (!res.ok || !data.success) {
                        throw new Error(data.message || 'Route planner gagal.');
                    }

                    savedRoute = data.route;
                    drawRoute(data.route.data.coordinates || []);

                    document.getElementById('statDist').innerText = Number(data.route.distance || 0).toFixed(1);
                    document.getElementById('statTime').innerText = Math.max(1, Math.round((data.route.duration || 0) / 60));
                    document.getElementById('statTurns').innerText = data.route.instructions_count || 0;
                    document.getElementById('routeInfo').innerText = 'Route ID #' + data.route.id + ' siap. Sprint berikutnya akan memuat rute ini di tracker.';
                    document.getElementById('summary').style.display = 'block';
                    document.getElementById('btnStart').disabled = false;
                    setStatus('Rute berhasil dibuat dan disimpan.', false);
                } catch (err) {
                    console.error(err);
                    setStatus(err.message || 'Gagal generate rute.', true);
                } finally {
                    btn.disabled = false;
                    btn.innerText = 'GENERATE';
                }
            }

            function drawRoute(coords) {
                if (guideLine) {
                    map.removeLayer(guideLine);
                    guideLine = null;
                }
                if (routeLine) {
                    map.removeLayer(routeLine);
                    routeLine = null;
                }

                const latlngs = coords.map(function(p) {
                    return [Number(p.lat), Number(p.lng)];
                }).filter(function(p) {
                    return !isNaN(p[0]) && !isNaN(p[1]);
                });

                if (latlngs.length > 1) {
                    routeLine = L.polyline(latlngs, {
                        color: routeColor,
                        weight: 6,
                        opacity: 0.95
                    }).addTo(map);
                    map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });
                }
            }

            function profileToActivityType(profile) {
                if (profile === 'foot-running') return 'run';
                if (profile === 'foot-hiking') return 'hike';
                if (profile === 'foot-walking') return 'walk';
                return 'ride';
            }

            function startRoute() {
                if (!savedRoute || !savedRoute.id) return;
                const profile = savedRoute.profile || (savedRoute.data ? savedRoute.data.profile : '');
                window.location.href = '/record?type=' + profileToActivityType(profile) + '&route=' + encodeURIComponent(savedRoute.id);
            }

            window.onload = initMap;
        </script>
    </body>
    </html>
  `);
});

// ==========================================
// 3. FITUR: ROUTE LIBRARY
// ==========================================
dashboard.get("/routes", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rute Tersimpan - Gaspool</title>
        <style>
          :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.06); --line: rgba(255,255,255,0.1); --muted: #94a3b8; --route: #3498db; }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { margin: 0; min-height: 100vh; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, rgba(52,152,219,0.18) 0%, #0a0a12 70%); color: #fff; font-family: 'Inter', sans-serif; padding: 18px; }
          .wrap { max-width: 720px; margin: 0 auto; }
          .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
          h1 { margin: 0; color: var(--primary); font-style: italic; font-size: 1.8rem; font-weight: 900; letter-spacing: -1px; }
          .subtitle { color: var(--muted); font-size: 0.75rem; font-weight: 800; margin-top: 4px; }
          .back { color: #fff; text-decoration: none; border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 12px 14px; font-weight: 900; font-size: 0.76rem; }
          .toolbar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
          .btn { border: none; border-radius: 12px; padding: 12px 10px; font-size: 0.75rem; font-weight: 900; cursor: pointer; color: #fff; background: rgba(255,255,255,0.08); text-transform: uppercase; }
          .btn:active { transform: scale(0.97); }
          .btn-primary { background: var(--primary); }
          .btn-route { background: var(--route); }
          .btn-danger { background: rgba(231,76,60,0.85); }
          .btn-outline { border: 1px solid var(--line); }
          .btn:disabled { opacity: 0.45; cursor: not-allowed; }
          .status { color: var(--muted); font-size: 0.78rem; font-weight: 800; min-height: 20px; margin: 8px 2px 12px; }
          .routes { display: grid; gap: 10px; }
          .route-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px; box-shadow: 0 14px 35px rgba(0,0,0,0.22); }
          .route-card.favorite { border-color: rgba(241,196,15,0.55); background: rgba(241,196,15,0.07); }
          .route-title { font-size: 1rem; font-weight: 900; line-height: 1.25; margin-bottom: 8px; }
          .route-meta { color: var(--muted); font-size: 0.72rem; font-weight: 800; line-height: 1.45; margin-bottom: 12px; }
          .route-actions { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
          .empty { border: 1px dashed var(--line); border-radius: 16px; padding: 26px 18px; text-align: center; color: var(--muted); font-weight: 800; }
          #btnMore { width: 100%; margin-top: 14px; display: none; }
          @media (max-width: 560px) {
            .route-actions { grid-template-columns: 1fr 1fr; }
            .toolbar { grid-template-columns: 1fr; }
          }
        </style>
    </head>
    <body>
      <div class="wrap">
        <div class="topbar">
          <div>
            <h1>RUTE TERSIMPAN</h1>
            <div class="subtitle">Library route plan Gaspool</div>
          </div>
          <a class="back" href="/">KEMBALI</a>
        </div>

        <div class="toolbar">
          <button class="btn btn-primary" onclick="window.location.href='/route_plan'">BUAT RUTE BARU</button>
          <button class="btn btn-route" onclick="window.location.href='/route_import'">IMPORT GPX</button>
          <button class="btn btn-outline" onclick="reloadRoutes()">REFRESH</button>
        </div>

        <div id="status" class="status">Memuat rute tersimpan...</div>
        <div id="routes" class="routes"></div>
        <button id="btnMore" class="btn btn-outline" onclick="loadRoutes()">LOAD MORE</button>
      </div>

      <script>
        let offset = 0;
        const limit = 20;
        let loading = false;

        function escapeHTML(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function setStatus(text, isError) {
          const el = document.getElementById('status');
          el.innerText = text;
          el.style.color = isError ? '#e74c3c' : '#94a3b8';
        }

        function formatDuration(seconds) {
          const min = Math.max(1, Math.round(Number(seconds || 0) / 60));
          if (min < 60) return min + ' menit';
          return Math.floor(min / 60) + ' jam ' + (min % 60) + ' menit';
        }

        function formatDate(value) {
          if (!value) return '-';
          const d = new Date(value);
          if (isNaN(d.getTime())) return String(value);
          return d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        }

        function profileToActivityType(profile) {
          if (profile === 'foot-running') return 'run';
          if (profile === 'foot-hiking') return 'hike';
          if (profile === 'foot-walking') return 'walk';
          return 'ride';
        }

        function renderRoute(route) {
          const card = document.createElement('div');
          const title = document.createElement('div');
          const meta = document.createElement('div');
          const actions = document.createElement('div');
          const startBtn = document.createElement('button');
          const openBtn = document.createElement('button');
          const exportBtn = document.createElement('button');
          const favoriteBtn = document.createElement('button');
          const renameBtn = document.createElement('button');
          const deleteBtn = document.createElement('button');

          card.className = 'route-card';
          card.dataset.id = route.id;
          title.className = 'route-title';
          meta.className = 'route-meta';
          actions.className = 'route-actions';

          function updateFavoriteState() {
            const isFavorite = Number(route.is_favorite || 0) === 1;
            card.classList.toggle('favorite', isFavorite);
            title.innerText = (isFavorite ? '★ ' : '') + (route.name || 'Route Plan #' + route.id);
            favoriteBtn.innerText = isFavorite ? 'UNPIN' : 'PIN';
            favoriteBtn.className = isFavorite ? 'btn btn-primary' : 'btn btn-outline';
          }

          updateFavoriteState();
          meta.innerText =
            Number(route.distance || 0).toFixed(1) + ' KM • ' +
            formatDuration(route.duration) + ' • ' +
            (route.profile || 'cycling-regular') + ' • ' +
            formatDate(route.created_at);

          startBtn.className = 'btn btn-route';
          startBtn.innerText = 'MULAI';
          startBtn.onclick = function() {
            window.location.href = '/record?type=' + profileToActivityType(route.profile) + '&route=' + encodeURIComponent(route.id);
          };

          openBtn.className = 'btn btn-outline';
          openBtn.innerText = 'BUKA';
          openBtn.onclick = function() {
            window.location.href = '/route_plan?route=' + encodeURIComponent(route.id);
          };

          exportBtn.className = 'btn btn-outline';
          exportBtn.innerText = 'GPX';
          exportBtn.onclick = function() {
            exportRouteGPX(route, exportBtn);
          };

          favoriteBtn.onclick = function() {
            toggleFavorite(route, favoriteBtn);
          };

          renameBtn.className = 'btn btn-outline';
          renameBtn.innerText = 'RENAME';
          renameBtn.onclick = function() {
            renameRoute(route, title, updateFavoriteState);
          };

          deleteBtn.className = 'btn btn-danger';
          deleteBtn.innerText = 'HAPUS';
          deleteBtn.onclick = function() {
            deleteRoute(route, card);
          };

          actions.appendChild(startBtn);
          actions.appendChild(openBtn);
          actions.appendChild(exportBtn);
          actions.appendChild(favoriteBtn);
          actions.appendChild(renameBtn);
          actions.appendChild(deleteBtn);
          card.appendChild(title);
          card.appendChild(meta);
          card.appendChild(actions);

          return card;
        }

        async function loadRoutes() {
          if (loading) return;

          loading = true;
          document.getElementById('btnMore').disabled = true;
          setStatus(offset === 0 ? 'Memuat rute tersimpan...' : 'Memuat rute berikutnya...', false);

          try {
            const res = await fetch('/api/route_plans?limit=' + limit + '&offset=' + offset);
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal memuat route library.');
            }

            const list = document.getElementById('routes');
            const routes = data.routes || [];

            if (offset === 0) list.innerHTML = '';

            routes.forEach(function(route) {
              list.appendChild(renderRoute(route));
            });

            offset += routes.length;
            document.getElementById('btnMore').style.display = routes.length === limit ? 'block' : 'none';
            setStatus(routes.length ? offset + ' rute termuat.' : 'Belum ada rute tersimpan.', false);

            if (offset === 0) {
              list.innerHTML = '<div class="empty">Belum ada rute. Buat route plan dulu dari tombol di atas.</div>';
            }
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal memuat rute.', true);
          } finally {
            loading = false;
            document.getElementById('btnMore').disabled = false;
          }
        }

        function reloadRoutes() {
          offset = 0;
          loadRoutes();
        }

        function getRouteFileName(route) {
          return (String(route.name || ('route-' + route.id))
            .trim()
            .replace(/[^a-z0-9_-]+/ig, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 70) || 'gaspool-route') + '.gpx';
        }

        async function exportRouteGPX(route, button) {
          const originalText = button.innerText;
          button.disabled = true;
          button.innerText = 'EXPORT...';

          try {
            const res = await fetch('/api/route_plan/' + encodeURIComponent(route.id) + '/gpx');

            if (!res.ok) {
              let message = 'Gagal export GPX.';
              try {
                const data = await res.json();
                message = data.message || message;
              } catch {}
              throw new Error(message);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = getRouteFileName(route);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setStatus('GPX rute berhasil diexport.', false);
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal export GPX.', true);
          } finally {
            button.disabled = false;
            button.innerText = originalText;
          }
        }

        async function toggleFavorite(route, button) {
          const nextFavorite = Number(route.is_favorite || 0) === 1 ? 0 : 1;
          button.disabled = true;

          try {
            const res = await fetch('/api/route_plan/' + encodeURIComponent(route.id) + '/favorite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_favorite: nextFavorite })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal mengubah favorit rute.');
            }

            route.is_favorite = nextFavorite;
            setStatus(nextFavorite ? 'Rute dipin ke atas library.' : 'Pin rute dilepas.', false);
            reloadRoutes();
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal mengubah favorit rute.', true);
          } finally {
            button.disabled = false;
          }
        }

        async function renameRoute(route, titleEl, afterRename) {
          const name = prompt('Nama baru rute:', route.name || '');
          const nextName = String(name || '').trim();

          if (!nextName) return;

          try {
            const res = await fetch('/api/route_plan/' + encodeURIComponent(route.id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: nextName })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal rename rute.');
            }

            route.name = nextName;
            if (typeof afterRename === 'function') afterRename();
            else titleEl.innerText = nextName;
            setStatus('Rute berhasil direname.', false);
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal rename rute.', true);
          }
        }

        async function deleteRoute(route, card) {
          if (!confirm('Hapus rute "' + (route.name || ('#' + route.id)) + '"?')) return;

          try {
            const res = await fetch('/api/route_plan/' + encodeURIComponent(route.id), {
              method: 'DELETE'
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal menghapus rute.');
            }

            card.remove();
            setStatus('Rute berhasil dihapus.', false);
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal menghapus rute.', true);
          }
        }

        window.onload = loadRoutes;
      </script>
    </body>
    </html>
  `);
});

dashboard.get("/segments", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Personal Segments - Gaspool</title>
        <style>
          :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.06); --line: rgba(255,255,255,0.1); --muted: #94a3b8; --gold: #f1c40f; --green: #2ecc71; --blue: #3498db; }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { margin: 0; min-height: 100vh; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, rgba(241,196,15,0.16) 0%, #0a0a12 70%); color: #fff; font-family: 'Inter', sans-serif; padding: 18px; }
          .wrap { max-width: 780px; margin: 0 auto; }
          .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
          h1 { margin: 0; color: var(--gold); font-style: italic; font-size: 1.8rem; font-weight: 950; letter-spacing: -1px; }
          .subtitle { color: var(--muted); font-size: 0.75rem; font-weight: 800; margin-top: 4px; line-height: 1.45; }
          .back { color: #fff; text-decoration: none; border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 12px 14px; font-weight: 900; font-size: 0.76rem; white-space: nowrap; }
          .toolbar { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 14px; }
          select { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 13px 12px; color: #fff; background: rgba(255,255,255,0.07); font-weight: 900; outline: none; text-transform: uppercase; }
          select option { background: #0a0a12; }
          .btn { border: none; border-radius: 12px; padding: 12px 10px; font-size: 0.72rem; font-weight: 950; cursor: pointer; color: #fff; background: rgba(255,255,255,0.08); text-transform: uppercase; }
          .btn:active { transform: scale(0.97); }
          .btn-primary { background: var(--gold); color: #111; }
          .btn-blue { background: var(--blue); }
          .btn-danger { background: rgba(231,76,60,0.85); }
          .btn-outline { border: 1px solid var(--line); }
          .btn:disabled { opacity: 0.45; cursor: not-allowed; }
          .status { color: var(--muted); font-size: 0.78rem; font-weight: 800; min-height: 20px; margin: 8px 2px 12px; }
          .segments { display: grid; gap: 10px; }
          .segment-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px; box-shadow: 0 14px 35px rgba(0,0,0,0.22); }
          .segment-head { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; margin-bottom: 10px; }
          .segment-title { font-size: 1rem; font-weight: 950; line-height: 1.25; }
          .segment-type { color: #111; background: var(--gold); border-radius: 999px; padding: 5px 8px; font-size: 0.62rem; font-weight: 950; letter-spacing: 0.6px; text-transform: uppercase; }
          .segment-meta { color: var(--muted); font-size: 0.72rem; font-weight: 800; line-height: 1.55; margin-bottom: 12px; }
          .segment-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
          .efforts { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; display: none; }
          .effort-row { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer; }
          .effort-row:last-child { border-bottom: none; }
          .rank { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: rgba(241,196,15,0.16); color: var(--gold); font-size: 0.76rem; font-weight: 950; }
          .effort-name { font-size: 0.82rem; font-weight: 900; line-height: 1.3; }
          .effort-meta { color: var(--muted); font-size: 0.66rem; font-weight: 800; margin-top: 2px; }
          .effort-time { color: var(--primary); font-size: 0.82rem; font-weight: 950; font-style: italic; white-space: nowrap; }
          .empty { border: 1px dashed var(--line); border-radius: 16px; padding: 26px 18px; text-align: center; color: var(--muted); font-weight: 800; line-height: 1.5; }
          @media (max-width: 600px) {
            .topbar { align-items: flex-start; }
            .toolbar { grid-template-columns: 1fr; }
            .segment-head { grid-template-columns: 1fr; }
            .segment-type { width: fit-content; }
            .segment-actions { grid-template-columns: 1fr 1fr; }
          }
        </style>
    </head>
    <body>
      <div class="wrap">
        <div class="topbar">
          <div>
            <h1>PERSONAL SEGMENTS</h1>
            <div class="subtitle">Kelola tanjakan, sprint pendek, loop favorit, dan leaderboard pribadi dari aktivitasmu sendiri.</div>
          </div>
          <a class="back" href="/">KEMBALI</a>
        </div>

        <div class="toolbar">
          <select id="activityFilter" onchange="reloadSegments()">
            <option value="">SEMUA JENIS AKTIVITAS</option>
            <option value="ride">GOWES</option>
            <option value="run">LARI</option>
            <option value="walk">JALAN</option>
            <option value="hike">HIKE</option>
          </select>
          <button class="btn btn-primary" onclick="reloadSegments()">REFRESH</button>
        </div>

        <div id="status" class="status">Memuat personal segment...</div>
        <div id="segments" class="segments"></div>
      </div>

      <script>
        const activityLabels = {
          ride: 'GOWES',
          run: 'LARI',
          walk: 'JALAN',
          hike: 'HIKE'
        };

        function escapeHTML(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function setStatus(text, isError) {
          const el = document.getElementById('status');
          el.innerText = text;
          el.style.color = isError ? '#e74c3c' : '#94a3b8';
        }

        function formatDate(value) {
          if (!value) return '-';
          const d = new Date(value);
          if (isNaN(d.getTime())) return String(value);
          return d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        }

        function formatSpeed(value) {
          const speed = Number(value || 0);
          return Number.isFinite(speed) && speed > 0 ? speed.toFixed(1) + ' km/jam' : '-';
        }

        function renderSegment(segment) {
          const card = document.createElement('article');
          const head = document.createElement('div');
          const title = document.createElement('div');
          const badge = document.createElement('div');
          const meta = document.createElement('div');
          const actions = document.createElement('div');
          const efforts = document.createElement('div');
          const leaderboardBtn = document.createElement('button');
          const sourceBtn = document.createElement('button');
          const renameBtn = document.createElement('button');
          const deleteBtn = document.createElement('button');
          const sourceName = segment.source_ride_name || ('Aktivitas #' + (segment.source_ride_id || '-'));

          card.className = 'segment-card';
          card.dataset.id = segment.id;
          head.className = 'segment-head';
          title.className = 'segment-title';
          badge.className = 'segment-type';
          meta.className = 'segment-meta';
          actions.className = 'segment-actions';
          efforts.className = 'efforts';
          efforts.id = 'efforts-' + segment.id;

          title.innerText = segment.name || ('Personal Segment #' + segment.id);
          badge.innerText = activityLabels[segment.activity_type] || String(segment.activity_type || 'AKTIVITAS').toUpperCase();
          meta.innerText =
            Number(segment.distance_km || 0).toFixed(2) + ' KM • sumber: ' +
            sourceName + ' • dibuat ' + formatDate(segment.created_at || segment.source_start_date);

          leaderboardBtn.className = 'btn btn-primary';
          leaderboardBtn.innerText = 'LEADERBOARD';
          leaderboardBtn.onclick = function() {
            toggleEfforts(segment, efforts, leaderboardBtn);
          };

          sourceBtn.className = 'btn btn-blue';
          sourceBtn.innerText = 'SUMBER';
          sourceBtn.disabled = !segment.source_ride_id;
          sourceBtn.onclick = function() {
            if (segment.source_ride_id) window.location.href = '/detail/' + encodeURIComponent(segment.source_ride_id);
          };

          renameBtn.className = 'btn btn-outline';
          renameBtn.innerText = 'RENAME';
          renameBtn.onclick = function() {
            renameSegment(segment, title);
          };

          deleteBtn.className = 'btn btn-danger';
          deleteBtn.innerText = 'HAPUS';
          deleteBtn.onclick = function() {
            deleteSegment(segment, card);
          };

          head.appendChild(title);
          head.appendChild(badge);
          actions.appendChild(leaderboardBtn);
          actions.appendChild(sourceBtn);
          actions.appendChild(renameBtn);
          actions.appendChild(deleteBtn);
          card.appendChild(head);
          card.appendChild(meta);
          card.appendChild(actions);
          card.appendChild(efforts);
          return card;
        }

        function renderEfforts(target, efforts) {
          if (!efforts.length) {
            target.innerHTML = '<div class="empty">Belum ada aktivitas yang cocok dengan segment ini.</div>';
            return;
          }

          target.innerHTML = efforts.map(function(effort, index) {
            return '<div class="effort-row" onclick="window.location.href=\\'/detail/' + encodeURIComponent(effort.ride_id) + '\\'">' +
              '<div class="rank">' + (index + 1) + '</div>' +
              '<div>' +
                '<div class="effort-name">' + escapeHTML(effort.ride_name || 'Aktivitas') + (effort.is_source ? ' · SUMBER' : '') + '</div>' +
                '<div class="effort-meta">' + Number(effort.distance_km || 0).toFixed(2) + ' KM • ' + formatSpeed(effort.average_speed) + ' • ' + formatDate(effort.start_date) + '</div>' +
              '</div>' +
              '<div class="effort-time">' + escapeHTML(effort.elapsed_label || (effort.elapsed_seconds + ' dtk')) + '</div>' +
            '</div>';
          }).join('');
        }

        async function toggleEfforts(segment, target, button) {
          if (target.style.display === 'block') {
            target.style.display = 'none';
            button.innerText = 'LEADERBOARD';
            return;
          }

          target.style.display = 'block';
          button.innerText = 'MEMUAT...';

          try {
            const res = await fetch('/api/segments/' + encodeURIComponent(segment.id) + '/efforts');
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal memuat leaderboard segment.');
            }

            renderEfforts(target, Array.isArray(data.efforts) ? data.efforts : []);
            button.innerText = 'TUTUP';
          } catch (err) {
            console.error(err);
            target.innerHTML = '<div class="empty">Leaderboard belum bisa dimuat.</div>';
            button.innerText = 'LEADERBOARD';
          }
        }

        async function loadSegments() {
          const list = document.getElementById('segments');
          const filter = document.getElementById('activityFilter').value;
          const query = filter ? '?activity_type=' + encodeURIComponent(filter) : '';
          setStatus('Memuat personal segment...', false);
          list.innerHTML = '';

          try {
            const res = await fetch('/api/segments' + query);
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal memuat personal segment.');
            }

            const segments = Array.isArray(data.segments) ? data.segments : [];
            if (!segments.length) {
              list.innerHTML = '<div class="empty">Belum ada personal segment. Buka detail aktivitas, lalu buat segment dari potongan track favoritmu.</div>';
              setStatus('0 segment termuat.', false);
              return;
            }

            segments.forEach(function(segment) {
              list.appendChild(renderSegment(segment));
            });
            setStatus(segments.length + ' segment termuat.', false);
          } catch (err) {
            console.error(err);
            list.innerHTML = '<div class="empty">Personal segment belum bisa dimuat.</div>';
            setStatus(err.message || 'Gagal memuat personal segment.', true);
          }
        }

        function reloadSegments() {
          loadSegments();
        }

        async function renameSegment(segment, titleEl) {
          const name = prompt('Nama baru personal segment:', segment.name || '');
          const nextName = String(name || '').trim();
          if (!nextName) return;

          try {
            const res = await fetch('/api/segments/' + encodeURIComponent(segment.id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: nextName })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal rename personal segment.');
            }

            segment.name = nextName;
            titleEl.innerText = nextName;
            setStatus('Personal segment berhasil direname.', false);
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal rename personal segment.', true);
          }
        }

        async function deleteSegment(segment, card) {
          if (!confirm('Hapus personal segment "' + (segment.name || ('#' + segment.id)) + '"?')) return;

          try {
            const res = await fetch('/api/segments/' + encodeURIComponent(segment.id), {
              method: 'DELETE'
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal menghapus personal segment.');
            }

            card.remove();
            setStatus('Personal segment berhasil dihapus.', false);
            if (!document.querySelector('.segment-card')) {
              document.getElementById('segments').innerHTML = '<div class="empty">Belum ada personal segment untuk filter ini.</div>';
            }
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal menghapus personal segment.', true);
          }
        }

        window.onload = loadSegments;
      </script>
    </body>
    </html>
  `);
});

dashboard.get("/route_import", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <title>Import GPX Route - Gaspool</title>
      <style>
        :root {
          --bg: #0a0a12;
          --card: #171821;
          --line: rgba(255,255,255,0.1);
          --primary: #FF5F00;
          --route: #3498db;
          --muted: #94a3b8;
          --success: #2ecc71;
          --danger: #e74c3c;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg); color: #fff; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 18px; min-height: 100vh; }
        .wrap { max-width: 720px; margin: 0 auto; }
        .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
        h1 { margin: 0; color: var(--primary); font-style: italic; font-size: 1.8rem; font-weight: 900; letter-spacing: -1px; }
        .subtitle { color: var(--muted); font-size: 0.76rem; font-weight: 800; margin-top: 4px; line-height: 1.45; }
        .back { color: #fff; text-decoration: none; border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 12px 14px; font-weight: 900; font-size: 0.76rem; }
        .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; box-shadow: 0 18px 45px rgba(0,0,0,0.28); }
        .grid { display: grid; grid-template-columns: 1fr 180px; gap: 10px; margin-bottom: 10px; }
        label { display: block; color: var(--muted); font-size: 0.7rem; font-weight: 900; text-transform: uppercase; margin-bottom: 7px; }
        input, select {
          width: 100%; border: 1px solid var(--line); background: rgba(255,255,255,0.05); color: #fff;
          border-radius: 12px; padding: 13px 14px; font-weight: 850; outline: none;
        }
        input[type="file"] { padding: 11px; color: var(--muted); }
        .hint { color: var(--muted); font-size: 0.78rem; font-weight: 750; line-height: 1.55; margin: 10px 0 14px; }
        .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
        .stat { border: 1px solid var(--line); border-radius: 14px; padding: 14px 12px; text-align: center; background: rgba(255,255,255,0.035); }
        .stat strong { display: block; color: var(--primary); font-size: 1.25rem; font-style: italic; font-weight: 950; }
        .stat span { display: block; color: var(--muted); font-size: 0.68rem; font-weight: 900; letter-spacing: 1px; margin-top: 5px; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        .btn { border: none; border-radius: 12px; padding: 13px 12px; color: #fff; font-size: 0.78rem; font-weight: 950; cursor: pointer; text-transform: uppercase; }
        .btn:active { transform: scale(0.98); }
        .btn-primary { background: var(--primary); }
        .btn-route { background: var(--route); }
        .btn-outline { background: rgba(255,255,255,0.06); border: 1px solid var(--line); }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        #status { min-height: 21px; color: var(--muted); font-size: 0.8rem; font-weight: 850; margin-top: 12px; line-height: 1.45; }
        .result { display: none; margin-top: 14px; border: 1px solid rgba(46,204,113,0.35); background: rgba(46,204,113,0.09); border-radius: 14px; padding: 14px; color: #d9ffe8; font-weight: 850; line-height: 1.5; }
        .result-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        @media (max-width: 620px) {
          body { padding: 14px; }
          .topbar { align-items: flex-start; }
          .grid, .summary, .actions, .result-actions { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="topbar">
          <div>
            <h1>IMPORT GPX ROUTE</h1>
            <div class="subtitle">Ubah file GPX menjadi rute tersimpan yang bisa dipakai di tracker.</div>
          </div>
          <a class="back" href="/routes">KEMBALI</a>
        </div>

        <div class="panel">
          <div class="grid">
            <div>
              <label for="routeName">Nama Rute</label>
              <input id="routeName" placeholder="Misal: Loop Mojokerto pagi" maxlength="80" />
            </div>
            <div>
              <label for="activityType">Mode</label>
              <select id="activityType">
                <option value="ride">Gowes</option>
                <option value="run">Lari</option>
                <option value="walk">Jalan</option>
                <option value="hike">Hiking</option>
              </select>
            </div>
          </div>

          <label for="gpxFile">File GPX</label>
          <input id="gpxFile" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" />
          <div class="hint">Pilih GPX dari Komoot, Garmin, Strava, OSM, atau editor rute lain. Gaspool akan mengambil track/route point, menghitung jarak, lalu menyimpannya sebagai route plan.</div>

          <div class="summary">
            <div class="stat"><strong id="statDistance">0.0</strong><span>KM</span></div>
            <div class="stat"><strong id="statPoints">0</strong><span>TITIK</span></div>
            <div class="stat"><strong id="statDuration">0</strong><span>MENIT</span></div>
          </div>

          <div class="actions">
            <button id="btnImport" class="btn btn-primary" disabled>IMPORT KE ROUTE LIBRARY</button>
            <button class="btn btn-outline" onclick="resetImport()">RESET</button>
          </div>
          <div id="status">Belum ada file GPX dipilih.</div>

          <div id="result" class="result">
            <div id="resultText"></div>
            <div class="result-actions">
              <button id="btnOpenRoutes" class="btn btn-outline">BUKA ROUTE LIBRARY</button>
              <button id="btnStartRoute" class="btn btn-route">MULAI RUTE</button>
            </div>
          </div>
        </div>
      </div>

      <script>
        let parsedPoints = [];
        let parsedDistanceM = 0;
        let savedRouteId = null;

        const fileInput = document.getElementById('gpxFile');
        const nameInput = document.getElementById('routeName');
        const typeInput = document.getElementById('activityType');
        const btnImport = document.getElementById('btnImport');

        function setStatus(text, isError) {
          const el = document.getElementById('status');
          el.innerText = text;
          el.style.color = isError ? '#e74c3c' : '#94a3b8';
        }

        function toRad(value) {
          return value * Math.PI / 180;
        }

        function distanceMeters(a, b) {
          const earth = 6371000;
          const dLat = toRad(b.lat - a.lat);
          const dLng = toRad(b.lng - a.lng);
          const lat1 = toRad(a.lat);
          const lat2 = toRad(b.lat);
          const hav =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          return earth * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
        }

        function calculateDistance(points) {
          let total = 0;
          for (let i = 1; i < points.length; i++) {
            total += distanceMeters(points[i - 1], points[i]);
          }
          return total;
        }

        function estimatedMinutes(distanceM) {
          const type = typeInput.value;
          const speedKmh = type === 'hike' ? 3.5 : type === 'run' ? 9.5 : type === 'walk' ? 5 : 18;
          return Math.max(1, Math.round((distanceM / 1000 / speedKmh) * 60));
        }

        function textContent(doc, selector) {
          const el = doc.querySelector(selector);
          return el ? String(el.textContent || '').trim() : '';
        }

        function pointFromNode(node) {
          const lat = Number(node.getAttribute('lat'));
          const lon = Number(node.getAttribute('lon'));
          const eleEl = node.querySelector('ele');
          const timeEl = node.querySelector('time');
          const point = { lat: lat, lng: lon };

          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
          if (eleEl && Number.isFinite(Number(eleEl.textContent))) point.ele = Number(eleEl.textContent);
          if (timeEl && String(timeEl.textContent || '').trim()) point.time = String(timeEl.textContent || '').trim();

          return point;
        }

        function parseGPX(text) {
          const doc = new DOMParser().parseFromString(text, 'application/xml');
          const parserError = doc.querySelector('parsererror');

          if (parserError) {
            throw new Error('File GPX tidak valid atau gagal dibaca.');
          }

          let nodes = Array.from(doc.querySelectorAll('trkpt'));
          if (!nodes.length) nodes = Array.from(doc.querySelectorAll('rtept'));
          if (!nodes.length) nodes = Array.from(doc.querySelectorAll('wpt'));

          const points = nodes.map(pointFromNode).filter(Boolean).filter(function(point, index, list) {
            if (index === 0) return true;
            const prev = list[index - 1];
            return point.lat !== prev.lat || point.lng !== prev.lng;
          });

          if (points.length < 2) {
            throw new Error('GPX harus punya minimal dua titik track atau route.');
          }

          if (points.length > 25000) {
            throw new Error('GPX terlalu besar. Maksimal 25.000 titik.');
          }

          const name =
            textContent(doc, 'trk > name') ||
            textContent(doc, 'rte > name') ||
            textContent(doc, 'metadata > name') ||
            '';

          return { name: name, points: points };
        }

        function updateStats() {
          parsedDistanceM = calculateDistance(parsedPoints);
          document.getElementById('statDistance').innerText = (parsedDistanceM / 1000).toFixed(1);
          document.getElementById('statPoints').innerText = String(parsedPoints.length);
          document.getElementById('statDuration').innerText = String(estimatedMinutes(parsedDistanceM));
        }

        function resetImport() {
          parsedPoints = [];
          parsedDistanceM = 0;
          savedRouteId = null;
          fileInput.value = '';
          nameInput.value = '';
          btnImport.disabled = true;
          document.getElementById('result').style.display = 'none';
          document.getElementById('statDistance').innerText = '0.0';
          document.getElementById('statPoints').innerText = '0';
          document.getElementById('statDuration').innerText = '0';
          setStatus('Belum ada file GPX dipilih.', false);
        }

        async function readSelectedFile(file) {
          const text = await file.text();
          const parsed = parseGPX(text);
          parsedPoints = parsed.points;

          if (!String(nameInput.value || '').trim()) {
            nameInput.value = parsed.name || file.name.replace(/\\.gpx$/i, '');
          }

          updateStats();
          btnImport.disabled = false;
          document.getElementById('result').style.display = 'none';
          setStatus('GPX siap diimport: ' + parsedPoints.length + ' titik ditemukan.', false);
        }

        async function importRoute() {
          if (parsedPoints.length < 2) return;

          const name = String(nameInput.value || '').trim() || 'Import GPX Route';
          btnImport.disabled = true;
          setStatus('Menyimpan route plan ke Gaspool...', false);

          try {
            const res = await fetch('/api/route_plan_gpx', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: name,
                activity_type: typeInput.value,
                points: parsedPoints
              })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.message || 'Gagal import GPX.');
            }

            savedRouteId = data.route.id;
            document.getElementById('resultText').innerText =
              'Route #' + savedRouteId + ' tersimpan: ' +
              Number(data.route.distance || 0).toFixed(1) + ' km, ' +
              data.route.coordinates_count + ' titik.';
            document.getElementById('result').style.display = 'block';
            setStatus('GPX berhasil dijadikan route plan.', false);
          } catch (err) {
            console.error(err);
            setStatus(err.message || 'Gagal import GPX.', true);
          } finally {
            btnImport.disabled = parsedPoints.length < 2;
          }
        }

        fileInput.addEventListener('change', async function() {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;

          try {
            setStatus('Membaca file GPX...', false);
            await readSelectedFile(file);
          } catch (err) {
            console.error(err);
            resetImport();
            setStatus(err.message || 'Gagal membaca GPX.', true);
          }
        });

        typeInput.addEventListener('change', function() {
          if (parsedPoints.length) updateStats();
        });

        btnImport.addEventListener('click', importRoute);
        document.getElementById('btnOpenRoutes').onclick = function() {
          window.location.href = '/routes';
        };
        document.getElementById('btnStartRoute').onclick = function() {
          if (!savedRouteId) return;
          window.location.href = '/record?type=' + encodeURIComponent(typeInput.value) + '&route=' + encodeURIComponent(savedRouteId);
        };
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 4. FITUR: HEATMAP OMNI-TRACKER
// ==========================================
dashboard.get("/heatmap", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  try {
    const { results } = await c.env.DB.prepare(
      "SELECT polyline FROM rides WHERE polyline IS NOT NULL AND polyline != ''",
    ).all();
    const allPolylines = results.map((r: any) => r.polyline);

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

          function extractCoordinateList(value) {
              if (Array.isArray(value)) return value;
              if (!value || typeof value !== 'object') return [];
              if (value.type === 'FeatureCollection' && Array.isArray(value.features)) return value.features.flatMap(extractCoordinateList);
              if (value.type === 'Feature') return extractCoordinateList(value.geometry);
              if (value.type === 'LineString' && Array.isArray(value.coordinates)) return value.coordinates;
              if (value.type === 'MultiLineString' && Array.isArray(value.coordinates)) return value.coordinates.flat();
              if (value.geometry) return extractCoordinateList(value.geometry);
              if (value.path) return extractCoordinateList(value.path);
              if (value.data) return extractCoordinateList(value.data);
              if (value.polyline) return extractCoordinateList(value.polyline);
              if (value.coordinates) return extractCoordinateList(value.coordinates);
              return [];
          }

          function normalizeRoutePoints(value) {
              return extractCoordinateList(value).map(function(p) {
                  if (Array.isArray(p)) {
                      const first = parseFloat(p[0]);
                      const second = parseFloat(p[1]);
                      if (Math.abs(first) > 90 && Math.abs(second) <= 90) return [second, first];
                      return [first, second];
                  }
                  if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                  return null;
              }).filter(function(p) {
                  return p !== null && !isNaN(p[0]) && !isNaN(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
              });
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
                          
                          return normalizeRoutePoints(pts);
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
    `);
  } catch (err) {
    return c.redirect("/login");
  }
});

// ==========================================
// 3. FITUR: CLIENT-SIDE GPX IMPORTER
// ==========================================
dashboard.get("/gpx_import", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

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
            const btn = document.getElementById('btn-submit'); btn.textContent = "⏳ MEMBEDAH FILE..."; btn.style.opacity = "0.7"; btn.style.pointerEvents = "none";
            try {
                const text = await file.text(); const parser = new DOMParser(); const xml = parser.parseFromString(text, "text/xml");
                let trkpts = xml.getElementsByTagName("trkpt"); if(trkpts.length === 0) trkpts = xml.getElementsByTagNameNS("*", "trkpt"); if(trkpts.length === 0) trkpts = xml.getElementsByTagName("rtept");
                
                let points = []; let totalDistance = 0; let totalElevation = 0; 
                let lastLat = null, lastLon = null, lastEle = null;
                let startTime = null, endTime = null;

                // EKSTRAK DATA: LAT, LON, ELEVASI, DAN WAKTU
                for(let i=0; i<trkpts.length; i++) {
                    const pt = trkpts[i];
                    const lat = parseFloat(pt.getAttribute("lat")); 
                    const lon = parseFloat(pt.getAttribute("lon")); 
                    
                    let ele = null;
                    const eleNode = pt.querySelector("ele");
                    if(eleNode) {
                        ele = parseFloat(eleNode.textContent);
                        if (lastEle !== null) {
                            let diff = ele - lastEle;
                            if (diff > 3 && diff < 50) totalElevation += diff;
                        }
                        if (lastEle === null || Math.abs(ele - lastEle) > 2) lastEle = ele;
                    }

                    let time = null;
                    const timeNode = pt.querySelector("time");
                    if(timeNode) {
                        time = timeNode.textContent;
                        const dTime = new Date(time);
                        if(!startTime) startTime = dTime;
                        endTime = dTime;
                    }

                    points.push({lat: lat, lng: lon, ele: ele || 0, time: time});
                    
                    if(lastLat !== null) { totalDistance += haversineDist(lastLat, lastLon, lat, lon); }
                    lastLat = lat; lastLon = lon;
                }
                
                // KALKULASI DURASI OTOMATIS DARI TAG <TIME>
                let duration = 0;
                if(startTime && endTime) { duration = Math.floor((endTime - startTime) / 1000); }

                let activityType = 'ride'; const typeNode = xml.querySelector("type");
                if(typeNode) { const t = typeNode.textContent.toLowerCase(); if (t === '9' || t.includes('run')) activityType = 'run'; else if (t.includes('walk')) activityType = 'walk'; else if (t.includes('hike')) activityType = 'hike'; }
                
                const nameNode = xml.querySelector("name"); 
                const rideName = nameNode ? nameNode.textContent : "Import GPX " + new Date().toLocaleDateString('id-ID');

                // --- PROSES CHUNKING KE API (SINKRON DENGAN BACKEND BARU) ---
                const CHUNK_SIZE = 500;
                const totalChunks = Math.ceil(points.length / CHUNK_SIZE);
                const rideUUID = "GPX_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
                let uploadSuccess = true;

                for (let i = 0; i < totalChunks; i++) {
                    const chunk = points.slice(i * CHUNK_SIZE, (i * CHUNK_SIZE) + CHUNK_SIZE);
                    
                    const payload = {
                        uuid: rideUUID,
                        chunk_index: i,
                        total_chunks: totalChunks,
                        points: chunk,
                        name: rideName,
                        distance: totalDistance,
                        duration: duration,
                        activity_type: activityType,
                        source: 'GASPOOL_GPX_IMPORT',
                        total_elevation: Math.round(totalElevation),
                        avg_temp: 0 // Suhu dikosongkan karena GPX eksternal jarang punya data suhu global
                    };

                    const res = await fetch('/api/save_ride', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if(!res.ok) { uploadSuccess = false; break; }
                    // FIX: Hapus backtick
                    btn.textContent = "🚀 MENGUNGGAH... (" + Math.round(((i+1)/totalChunks)*100) + "%)";
                }

                if(uploadSuccess) { 
                    alert("Data GPX berhasil mendarat di Markas Awan!"); 
                    window.location.href = '/'; 
                } else { 
                    alert("Gagal mengunggah beberapa potongan data. Sinyal jelek?"); 
                    btn.textContent = "🚀 EKSTRAK SEKARANG"; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; 
                }

            } catch(err) { 
                console.error(err);
                alert("Error membedah file XML GPX!"); 
                btn.textContent = "🚀 EKSTRAK SEKARANG"; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; 
            }
        });
    </script>
    </body>
    </html>
  `);
});

// ==========================================
// 4. FITUR: STRAVA SYNC (OAuth 2.0 FULL)
// ==========================================
dashboard.get("/sync_strava", async (c) => {
  const token = getCookie(c, "gaspool_session");
  if (!token) return c.redirect("/login");

  if (c.req.query("reset_api")) {
    deleteCookie(c, "strava_creds");
    return c.redirect("/sync_strava");
  }

  const credsStr = getCookie(c, "strava_creds");
  const creds = credsStr ? JSON.parse(credsStr) : null;

  if (c.req.query("code") && creds) {
    const code = c.req.query("code") as string;
    try {
      const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          code: code,
          grant_type: "authorization_code",
        }),
      });
      const data: any = await res.json();
      if (data.access_token) {
        creds.token = data.access_token;
        setCookie(c, "strava_creds", JSON.stringify(creds), {
          httpOnly: true,
          secure: true,
        });
        return c.redirect("/sync_strava?status=success");
      }
    } catch (e) {}
  }

  const isSuccess = c.req.query("status") === "success";

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

            ${isSuccess ? '<div class="alert alert-success">Akses Strava berhasil diberikan!</div>' : ""}
            <div id="statusDiv"></div>

            ${
              !creds
                ? `
                <form method="POST" action="/sync_strava">
                    <div class="form-group"><label>STRAVA CLIENT ID</label><input type="text" name="client_id" required></div>
                    <div class="form-group"><label>STRAVA CLIENT SECRET</label><input type="password" name="client_secret" required></div>
                    <input type="hidden" name="action" value="setup">
                    <button type="submit" class="btn">SIMPAN KONFIGURASI</button>
                </form>
            `
                : !creds.token
                  ? `
                <p style="font-size: 0.85rem; color: #aaa;">Koneksi API siap. Berikan akses baca aktivitas Strava Anda.</p>
                <a id="stravaLink" href="#" class="btn" style="background:#FC4C02;">HUBUNGKAN STRAVA</a>
                <a href="?reset_api=1" class="btn btn-secondary">RESET API KEY</a>
                <script>
                    const redirectUri = window.location.origin + window.location.pathname;
                    document.getElementById('stravaLink').href = 'https://www.strava.com/oauth/authorize?client_id=${creds.client_id}&redirect_uri=' + encodeURIComponent(redirectUri) + '&response_type=code&scope=activity:read_all';
                </script>
            `
                  : `
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 15px; margin-bottom: 20px;">
                    <div style="font-size: 0.8rem; color: #2ecc71; font-weight: bold; margin-bottom: 5px;">KONEKSI AKTIF ✅</div>
                </div>
                <form method="POST" action="/sync_strava" onsubmit="document.getElementById('btnPull').innerText='⏳ MENARIK DATA...'">
                    <input type="hidden" name="action" value="pull">
                    <button type="submit" id="btnPull" class="btn" style="background:#FC4C02;">🚀 TARIK DATA BARU</button>
                </form>
                <a href="?reset_api=1" class="btn btn-secondary">PUTUSKAN KONEKSI</a>
            `
            }
            <a href="/" class="link-back">‹ KEMBALI KE MARKAS</a>
        </div>
    </div>
    </body>
    </html>
  `);
});

dashboard.post("/sync_strava", async (c) => {
  const body = await c.req.parseBody();

  if (body["action"] === "setup") {
    setCookie(
      c,
      "strava_creds",
      JSON.stringify({
        client_id: body["client_id"],
        client_secret: body["client_secret"],
      }),
      { secure: true, httpOnly: true },
    );
    return c.redirect("/sync_strava");
  }

  if (body["action"] === "pull") {
    const credsStr = getCookie(c, "strava_creds");
    const creds = credsStr ? JSON.parse(credsStr) : null;

    if (creds && creds.token) {
      let page = 1;
      let newCount = 0;
      try {
        while (true) {
          const res = await fetch(
            `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=30`,
            {
              headers: { Authorization: `Bearer ${creds.token}` },
            },
          );
          const activities: any = await res.json();
          if (!Array.isArray(activities) || activities.length === 0) break;

          for (const act of activities) {
            const stravaSourceId = "strava_" + act.id;
            const existing = await c.env.DB.prepare(
              "SELECT id FROM rides WHERE source = ?",
            )
              .bind(stravaSourceId)
              .first();
            if (existing) continue;

            let gaspoolType = "ride";
            if (act.type === "Run" || act.type === "VirtualRun")
              gaspoolType = "run";
            if (act.type === "Walk") gaspoolType = "walk";
            if (act.type === "Hike") gaspoolType = "hike";

            const distanceKm = (act.distance || 0) / 1000;
            const movingTime = act.moving_time || 0;
            const avgSpeed = (act.average_speed || 0) * 3.6;
            let startDate = act.start_date_local || new Date().toISOString();
            startDate = startDate.replace("T", " ").replace("Z", "");
            const polyline = act.map?.summary_polyline || "";

            await c.env.DB.prepare(
              `
                        INSERT INTO rides (name, distance, moving_time, average_speed, start_date, polyline, source, activity_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `,
            )
              .bind(
                act.name || "Aktivitas Strava",
                distanceKm,
                movingTime,
                avgSpeed,
                startDate,
                polyline,
                stravaSourceId,
                gaspoolType,
              )
              .run();
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
        return c.html(
          `<body style="background:#0a0a12; color:#fff; text-align:center; padding-top:100px;"><h2 style="color:red;">Error: ${e.message}</h2><a href="/sync_strava" style="color:#FF5F00;">Kembali</a></body>`,
        );
      }
    }
  }
  return c.redirect("/sync_strava");
});

// ==========================================
// 5. FITUR: PUBLIC TIMELINE (single-owner showcase)
// ==========================================
dashboard.get("/:username", async (c, next) => {
  const username = normalizePublicProfileSlug(c.req.param("username"));
  const publicProfile = getPublicProfile(c.env);
  const reserved = [
    "login",
    "logout",
    "api",
    "assets",
    "record",
    "detail",
    "video_flex",
    "routes",
    "segments",
    "route_plan",
    "route_import",
    "heatmap",
    "gpx_import",
    "sync_strava",
  ];
  if (reserved.includes(username)) return next();
  if (username !== publicProfile.slug)
    return c.text("Satelit tidak menemukan agen ini.", 404);

  try {
    const stats: any = await c.env.DB.prepare(
      `
  SELECT
    COUNT(*) as count,
    COALESCE(SUM(distance),0) as dist,
    COALESCE(SUM(total_elevation_gain),0) as elev,
    COALESCE(SUM(moving_time),0) as moving_time
  FROM rides
  WHERE is_public = 1
  `,
    ).first();
    const { results: rides } = await c.env.DB.prepare(
      "SELECT * FROM rides WHERE is_public = 1 ORDER BY start_date DESC LIMIT 10",
    ).all();

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${publicProfile.name} on Gaspool</title>
        <link rel="icon" type="image/png" sizes="192x192" href="/assets/android-chrome-192x192.png">
        <link rel="icon" type="image/png" sizes="512x512" href="/assets/android-chrome-512x512.png">
        <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
        <style>
          :root { --primary: #FF5F00; --bg: #0a0a12; --card: rgba(255,255,255,0.05); }
          * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          body { font-family: 'Inter', sans-serif; background: var(--bg); background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 80%); color: #fff; margin: 0; padding: 20px; min-height: 100vh; }
          .container { max-width: 500px; margin: 0 auto; }
          .profile-header { text-align: center; margin-bottom: 30px; padding: 30px 20px; background: var(--card); border-radius: 24px; border: 1px solid rgba(255,95,0,0.3); box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); }
          .profile-img { width: 100px; height: 100px; border-radius: 20px; object-fit: cover; margin-bottom: 15px; border: 3px solid var(--primary); box-shadow: 0 0 20px rgba(255,95,0,0.4); }
          .username { font-size: 1.8rem; font-weight: 900; font-style: italic; margin: 0; color: #fff; letter-spacing: -1px;}
          .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 25px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; }
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
          .modal { display: none; position: fixed; z-index: 2000; inset: 0; background: rgba(0,0,0,0.82); backdrop-filter: blur(10px); justify-content: center; align-items: center; padding: 18px; }
          .modal-content { width: 100%; max-width: 560px; background: #16161d; border: 1px solid rgba(255,255,255,0.12); border-radius: 22px; padding: 18px; box-shadow: 0 25px 60px rgba(0,0,0,0.55); }
          .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
          .modal-title { margin: 0; color: var(--primary); font-size: 1.15rem; font-weight: 900; font-style: italic; line-height: 1.2; }
          .modal-meta { margin: 4px 0 0; color: #aaa; font-size: 0.78rem; font-weight: 800; }
          .modal-close { border: none; background: transparent; color: #777; font-size: 28px; font-weight: 900; cursor: pointer; line-height: 1; }
          #public-map-modal { height: 340px; width: 100%; border-radius: 16px; background: #ddd; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
          .modal-actions { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 12px; }
          .modal-btn { display: block; text-align: center; background: var(--primary); color: #fff; border: none; border-radius: 12px; padding: 13px; font-weight: 900; text-decoration: none; text-transform: uppercase; font-size: 0.78rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="profile-header">
            <img src="${publicProfile.avatar}" alt="${publicProfile.name}" class="profile-img">
            <h1 class="username">${publicProfile.name}</h1>
            <div class="stats-grid">
  <div class="stat-item">
    <div class="stat-val">
      ${parseFloat(stats.dist || 0).toFixed(1)}
    </div>
    <div class="stat-lbl">KM DIST</div>
  </div>

  <div class="stat-item">
    <div class="stat-val">
      ${stats.count || 0}
    </div>
    <div class="stat-lbl">SESSIONS</div>
  </div>

  <div class="stat-item">
    <div class="stat-val">
      ${Math.round(stats.elev || 0)}
    </div>
    <div class="stat-lbl">M ELEV</div>
  </div>

  <div class="stat-item">
    <div class="stat-val">
      ${Math.floor((stats.moving_time || 0) / 3600)}
    </div>
    <div class="stat-lbl">HOURS</div>
  </div>
</div>
          </div>

          <div class="timeline-title">SPORTS LOG</div>
          <div id="rides-list"></div>
          <button id="btnLoadMore" onclick="loadMore()">▼ LOAD MORE MISI</button>
          
          <div style="text-align: center; margin-top: 40px;"><img src="/assets/gaspool.png" style="height: 40px; opacity: 0.5;"></div>
        </div>

        <div id="publicMapModal" class="modal">
          <div class="modal-content">
            <div class="modal-head">
              <div>
                <h3 id="publicModalTitle" class="modal-title">Aktivitas</h3>
                <p id="publicModalMeta" class="modal-meta"></p>
              </div>
              <button class="modal-close" onclick="closePublicMapModal()">&times;</button>
            </div>
            <div id="public-map-modal"></div>
            <div class="modal-actions">
              <a id="publicModalDetail" class="modal-btn" href="#">BUKA DETAIL</a>
            </div>
          </div>
        </div>

        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
          let curP = 1;
          let publicMap = null;
          let publicMapLayers = [];
		  function escapeHTML(str) {

  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

}

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

          function extractCoordinateList(value) {
              if (Array.isArray(value)) return value;
              if (!value || typeof value !== 'object') return [];
              if (value.type === 'FeatureCollection' && Array.isArray(value.features)) return value.features.flatMap(extractCoordinateList);
              if (value.type === 'Feature') return extractCoordinateList(value.geometry);
              if (value.type === 'LineString' && Array.isArray(value.coordinates)) return value.coordinates;
              if (value.type === 'MultiLineString' && Array.isArray(value.coordinates)) return value.coordinates.flat();
              if (value.geometry) return extractCoordinateList(value.geometry);
              if (value.path) return extractCoordinateList(value.path);
              if (value.data) return extractCoordinateList(value.data);
              if (value.polyline) return extractCoordinateList(value.polyline);
              if (value.coordinates) return extractCoordinateList(value.coordinates);
              return [];
          }

          function normalizeRoutePoints(value) {
              return extractCoordinateList(value).map(function(p) {
                  if (Array.isArray(p)) {
                      const first = parseFloat(p[0]);
                      const second = parseFloat(p[1]);
                      if (Math.abs(first) > 90 && Math.abs(second) <= 90) return [second, first];
                      return [first, second];
                  }
                  if (p && p.lat !== undefined) return [parseFloat(p.lat), parseFloat(p.lng !== undefined ? p.lng : p.lon)];
                  return null;
              }).filter(function(p) {
                  return p !== null && !isNaN(p[0]) && !isNaN(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
              });
          }

          async function readRoutePoints(raw) {
              let pts = [];
              let urlStr = typeof raw === 'string' ? raw.trim() : '';
              if (!urlStr) return [];
              if (urlStr.startsWith('"')) {
                  try { urlStr = JSON.parse(urlStr); }
                  catch { urlStr = urlStr.slice(1, -1).replace(/\\"/g, '"'); }
              }
              if (urlStr.startsWith('[') || urlStr.startsWith('{')) pts = JSON.parse(urlStr);
              else if (urlStr.startsWith('http')) {
                  const res = await fetch(urlStr, { cache: 'no-store' });
                  pts = await res.json();
              } else pts = decodePolyline(urlStr);
              return normalizeRoutePoints(pts);
          }

          function closePublicMapModal() {
              document.getElementById('publicMapModal').style.display = 'none';
          }

          async function openPublicMapModal(ride) {
              document.getElementById('publicMapModal').style.display = 'flex';
              document.getElementById('publicModalTitle').innerText = ride.name || 'Aktivitas';
              document.getElementById('publicModalMeta').innerText = parseFloat(ride.distance || 0).toFixed(2) + ' KM • ' + new Date(ride.start_date).toLocaleDateString('id-ID');
              document.getElementById('publicModalDetail').href = '/detail/' + encodeURIComponent(ride.id);

              if (!publicMap) {
                  publicMap = L.map('public-map-modal', { zoomControl: false });
                  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                      maxZoom: 19,
                      attribution: '&copy; OpenStreetMap contributors'
                  }).addTo(publicMap);
              }

              publicMapLayers.forEach(function(layer) { publicMap.removeLayer(layer); });
              publicMapLayers = [];

              try {
                  const pts = await readRoutePoints(ride.polyline || '');
                  if (pts.length > 1) {
                      const line = L.polyline(pts, { color: '#FF5F00', weight: 5 }).addTo(publicMap);
                      publicMapLayers.push(line);
                      setTimeout(function() {
                          publicMap.invalidateSize();
                          publicMap.fitBounds(line.getBounds(), { padding: [24, 24] });
                      }, 100);
                  } else {
                      setTimeout(function() { publicMap.invalidateSize(); }, 100);
                  }
              } catch (err) {
                  console.error('Gagal memuat peta public:', err);
                  setTimeout(function() { publicMap.invalidateSize(); }, 100);
              }
          }

          async function loadMore() {
            const res = await fetch('/api/public_rides/${publicProfile.slug}?page=' + curP);
            const data = await res.json();
            if(data.rides.length > 0) {
              const list = document.getElementById('rides-list');
              data.rides.forEach(r => {
                const icon = r.activity_type === 'run' ? '🏃' : (r.activity_type === 'walk' ? '🚶' : (r.activity_type === 'hike' ? '⛰️' : '🚴'));
                const div = document.createElement('div');
                div.className = 'ride-card';
                div.onclick = () => openPublicMapModal(r);
                
                // FIX: Hapus backtick, gunakan string concatenation murni
                div.innerHTML = '<div class="ride-icon">' + icon + '</div>' +
                                '<div class="ride-info"><div class="ride-name">' + escapeHTML(r.name) + '</div>' +
                                '<div class="ride-meta">' + parseFloat(r.distance).toFixed(2) + ' KM • ' + new Date(r.start_date).toLocaleDateString('id-ID') + '</div></div>' +
                                '<div class="ride-arrow">❯</div>';
                                
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
    `);
  } catch (err) {
    return c.text("Gagal memuat timeline.", 500);
  }
});

export default dashboard;
