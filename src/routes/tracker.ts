import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { Bindings } from "../index";
import { FAVICON_LINKS } from "../favicon";
import { readLiveSession } from "../api/live-share";

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
      ${FAVICON_LINKS}
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
            .top { top: 0; padding: 20px; display: flex; justify-content: space-between; align-items: flex-start; z-index: 2400; pointer-events: none; }
            .bottom { bottom: 0; padding: 16px 18px calc(16px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.62) 72%, transparent 100%); pointer-events: none; z-index: 900; }
            .bottom button, .bottom .btn, .bottom .mode-btn, .bottom .tracking-mode-panel, .bottom .stage-panel, .bottom .nutrition-panel, .bottom .privacy-row { pointer-events: auto; }
            .bottom .stat-card, .bottom .tracker-distance, .bottom .signal-panel, .bottom .nav-voice-status { pointer-events: none; }
            
            .stat-card { background: rgba(0,0,0,0.6); backdrop-filter: blur(20px); border-radius: 18px; border: 1px solid rgba(255,255,255,0.1); padding: 15px; pointer-events: auto; }
            .label { font-size: 9px; font-weight: 900; color: #aaa; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px; transition: 0.3s;}
            .val { font-size: 20px; font-weight: 900; color: #fff; }
            .val-main { font-size: 4rem; font-weight: 900; color: var(--primary); font-style: italic; text-align: center; margin: 5px 0; text-shadow: 0 0 20px rgba(255,95,0,0.4); }
            
            /* Ukuran minimum target sentuh.
               Halaman ini dioperasikan sambil mengayuh, kadang dengan sarung
               tangan dan layar berembun, jadi tombol yang nyaman untuk tetikus
               belum tentu bisa ditekan dengan benar. 48px mengikuti panduan
               Material; 44px adalah batas bawah yang masih diterima (WCAG
               2.5.5). Sebelum ini tombol terkecil hanya 25px. */
            .btn { padding: 20px; border-radius: 15px; border: none; font-weight: 900; cursor: pointer; text-transform: uppercase; font-style: italic; width: 100%; pointer-events: auto; transition: 0.3s; min-height: 48px; touch-action: manipulation; }
            .btn:active { transform: scale(0.95); }
            .btn-start { background: var(--primary); color: #fff; }
            .btn-stop { background: #e74c3c; color: #fff; display: none; }
            .btn-cancel { background: rgba(231,76,60,0.88); width: auto; padding: 10px 15px; font-size: 10px; color: #fff; border-radius: 10px; border: none; cursor: pointer; pointer-events: auto; position: fixed; top: calc(env(safe-area-inset-top, 0px) + 16px); right: 16px; /* Selalu di atas panel bawah / card statistik pada layar kecil */ z-index: 10050; touch-action: manipulation; box-shadow: 0 10px 28px rgba(0,0,0,0.45); }
            
            .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
            .tracker-distance { text-align:center; margin-bottom: 8px; }
            .action-row { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:8px; margin-bottom:8px; pointer-events:auto; }
            .action-row .btn { padding:10px 6px !important; font-size:11px !important; min-height:48px; }
            .btn-panel-toggle { display:none; margin:0 0 8px; padding:10px; font-size:10px; background:rgba(255,255,255,0.09); border:1px solid rgba(255,255,255,0.14); color:#fff; }
            .tracker-extra.is-collapsed { display:none; }

            /* Panel siaran live (gowes solo maupun peleton). */
            .live-panel { display:none; margin:0 0 8px; padding:10px 12px; border-radius:14px; background:rgba(37,211,102,0.10); border:1px solid rgba(37,211,102,0.45); pointer-events:auto; }
            .live-panel-head { display:flex; align-items:center; gap:7px; margin-bottom:6px; }
            .live-dot { width:8px; height:8px; border-radius:50%; background:#2ecc71; box-shadow:0 0 8px #2ecc71; animation:livePulse 1.6s infinite; }
            .live-dot.is-off { background:#e74c3c; box-shadow:none; animation:none; }
            @keyframes livePulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
            .live-label { font-size:9px; font-weight:900; letter-spacing:1.2px; text-transform:uppercase; color:#2ecc71; }
            .live-link { font-size:10px; color:#cfe9d9; word-break:break-all; margin-bottom:8px; line-height:1.4; }
            .live-actions { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; }
            .live-actions .btn { padding:10px 6px !important; font-size:11px !important; min-height:48px; }

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
            .nav-voice-status { margin-top:-4px; margin-bottom:10px; color:#cbd5e1; font-size:11px; font-weight:900; letter-spacing:1px; text-transform:uppercase; pointer-events:none; }
            .tracking-mode-panel { margin-bottom: 10px; padding: 10px; border-radius: 14px; background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.1); pointer-events:auto; }
            .tracking-mode-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; color:#94a3b8; font-size:9px; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
            .tracking-mode-options { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; }
            .mode-btn { border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25); color:#fff; border-radius:10px; padding:9px 6px; font-size:9px; font-weight:950; letter-spacing:0.8px; text-transform:uppercase; cursor:pointer; }
            .mode-btn.active { border-color:var(--primary); color:var(--primary); box-shadow:0 0 0 1px rgba(255,95,0,0.35) inset; background:rgba(255,95,0,0.1); }
            .stage-panel { display:grid; grid-template-columns:1fr 118px; gap:10px; align-items:center; margin-bottom:10px; padding:10px; border-radius:14px; background:rgba(255,95,0,0.08); border:1px solid rgba(255,95,0,0.22); pointer-events:auto; }
            .stage-title { color:#fff; font-size:10px; font-weight:950; letter-spacing:1px; text-transform:uppercase; margin-bottom:3px; }
            .stage-meta { color:#94a3b8; font-size:9px; line-height:1.35; font-weight:900; }
            .btn-stage { background:rgba(255,95,0,0.18); border:1px solid var(--primary); color:var(--primary); padding:10px; font-size:9px; }
            .stage-actions { display:grid; grid-template-columns:1fr; gap:7px; }
            .btn-overnight { background:rgba(52,152,219,0.13); border:1px solid rgba(52,152,219,0.5); color:#3498db; padding:10px; font-size:9px; }
            .signal-panel { display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; margin-bottom:10px; padding:9px 10px; border-radius:14px; background:rgba(241,196,15,0.08); border:1px solid rgba(241,196,15,0.18); pointer-events:none; }
            .signal-title { color:#fff; font-size:9px; font-weight:950; letter-spacing:1px; text-transform:uppercase; margin-bottom:3px; }
            .signal-meta { color:#94a3b8; font-size:9px; line-height:1.35; font-weight:900; }
            .signal-pill { color:#f1c40f; font-size:9px; font-weight:950; text-transform:uppercase; border:1px solid rgba(241,196,15,0.32); border-radius:999px; padding:5px 8px; background:rgba(0,0,0,0.22); white-space:nowrap; }
            .nutrition-panel { display:grid; grid-template-columns:1fr 94px; gap:10px; align-items:center; margin-bottom:10px; padding:9px 10px; border-radius:14px; background:rgba(46,204,113,0.08); border:1px solid rgba(46,204,113,0.2); pointer-events:auto; }
            .nutrition-title { color:#fff; font-size:9px; font-weight:950; letter-spacing:1px; text-transform:uppercase; margin-bottom:3px; }
            .nutrition-meta { color:#94a3b8; font-size:9px; line-height:1.35; font-weight:900; }
            .btn-nutrition { background:rgba(46,204,113,0.14); border:1px solid rgba(46,204,113,0.42); color:#2ecc71; padding:10px; font-size:9px; }
            .privacy-row { display: grid; grid-template-columns: 140px 1fr; gap: 10px; align-items: center; margin-bottom: 10px; pointer-events:auto; }
            .privacy-hint { color: #94a3b8; font-size: 9px; font-weight: 900; line-height: 1.35; text-transform: uppercase; letter-spacing: 0.8px; }
            .resume-summary { width: 100%; max-width: 380px; margin: 0 auto 18px; padding: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; text-align: left; }
            .resume-title { color: #fff; font-size: 12px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
            .resume-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .resume-item { padding: 9px; border-radius: 11px; background: rgba(0,0,0,0.28); }
            .resume-label { color: #94a3b8; font-size: 8px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
            .resume-value { color: #fff; font-size: 12px; font-weight: 900; line-height: 1.3; word-break: break-word; }
            .resume-warning { display:none; margin-top: 10px; color: #f1c40f; font-size: 10px; font-weight: 900; line-height: 1.35; }
            .finish-review-overlay { display:none; position: fixed; inset: 0; z-index: 9800; background: rgba(0,0,0,0.94); padding: 18px; overflow-y: auto; pointer-events: auto; }
            .finish-review-card { width:100%; max-width: 430px; margin: 18px auto; padding: 18px; border-radius: 22px; background: #0a0a12; border: 1px solid rgba(255,95,0,0.28); box-shadow: 0 20px 70px rgba(0,0,0,0.58); }
            .finish-kicker { color: var(--primary); font-size: 10px; font-weight: 950; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px; }
            .finish-review-card h2 { margin: 0 0 6px; font-size: 26px; font-weight: 950; font-style: italic; color: #fff; letter-spacing: -1px; }
            .finish-copy { color:#94a3b8; font-size: 12px; font-weight: 800; line-height: 1.45; margin-bottom: 14px; }
            .finish-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 12px; }
            .finish-stat { background: rgba(255,255,255,0.055); border:1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 11px; }
            .finish-label { color:#94a3b8; font-size:8px; font-weight:950; letter-spacing:1px; text-transform:uppercase; margin-bottom: 5px; }
            .finish-value { color:#fff; font-size:14px; font-weight:950; line-height:1.25; word-break: break-word; }
            .finish-section { margin-top: 12px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.045); border:1px solid rgba(255,255,255,0.08); }
            .finish-section-title { display:flex; justify-content:space-between; align-items:center; gap: 10px; color:#fff; font-size: 10px; font-weight: 950; letter-spacing:1px; text-transform:uppercase; margin-bottom: 9px; }
            .doctor-pill { display:inline-block; border-radius:999px; padding:5px 8px; font-size:8px; font-weight:950; letter-spacing:0.8px; text-transform:uppercase; background:rgba(46,204,113,0.14); color:#2ecc71; border:1px solid rgba(46,204,113,0.32); white-space:nowrap; }
            .doctor-pill.warn { background:rgba(241,196,15,0.12); color:#f1c40f; border-color:rgba(241,196,15,0.32); }
            .doctor-pill.danger { background:rgba(231,76,60,0.14); color:#e74c3c; border-color:rgba(231,76,60,0.32); }
            .finish-list { display:grid; gap:8px; }
            .finish-row { padding:9px; border-radius: 12px; background: rgba(0,0,0,0.26); color:#dce3ee; font-size: 10px; font-weight: 850; line-height: 1.35; border-left: 3px solid rgba(255,255,255,0.16); }
            .finish-row.warning { border-left-color:#f1c40f; }
            .finish-row.danger { border-left-color:#e74c3c; }
            .finish-row.info { border-left-color:#3498db; }
            /* Tabel SEBELUM -> SESUDAH. Tujuannya supaya keputusan "simpan apa
               adanya" atau "perbaiki dulu" diambil dengan angka di depan mata,
               bukan tebak-tebakan. */
            .finish-diff { display:grid; gap:7px; }
            .finish-diff-head,
            .finish-diff-row { display:grid; grid-template-columns: 1.15fr 1fr 1fr; gap:6px; align-items:center; }
            .finish-diff-head { color:#94a3b8; font-size:8px; font-weight:950; letter-spacing:0.9px; text-transform:uppercase; padding:0 2px 2px; }
            .finish-diff-head span:nth-child(2),
            .finish-diff-head span:nth-child(3) { text-align:right; }
            .finish-diff-row { padding:9px; border-radius:12px; background:rgba(0,0,0,0.26); border-left:3px solid rgba(255,255,255,0.16); }
            .finish-diff-row.changed { border-left-color: var(--primary); background: rgba(255,95,0,0.09); }
            .finish-diff-row.same { opacity: 0.72; }
            .finish-diff-name { color:#dce3ee; font-size:9px; font-weight:950; letter-spacing:0.6px; text-transform:uppercase; }
            .finish-diff-from { color:#94a3b8; font-size:11px; font-weight:900; text-align:right; text-decoration: line-through; text-decoration-color: rgba(148,163,184,0.55); }
            .finish-diff-row.same .finish-diff-from { text-decoration:none; color:#cbd5e1; }
            .finish-diff-to { color:#fff; font-size:11px; font-weight:950; text-align:right; }
            .finish-diff-row.changed .finish-diff-to { color: var(--primary); }
            .finish-diff-delta { color:#94a3b8; font-size:8px; font-weight:900; text-align:right; margin-top:2px; }
            .finish-diff-row.changed .finish-diff-delta { color:#f1c40f; }
            .finish-diff-note { margin-top:8px; color:#94a3b8; font-size:9px; font-weight:850; line-height:1.45; }
            .finish-diff-note b { color:#dce3ee; }
            .finish-actions { display:grid; gap:10px; margin-top: 14px; }
            .finish-actions .btn { font-size: 11px; padding: 15px; }
            .finish-small-actions { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
            .btn-finish-save { background:#2ecc71; color:#001b0b; }
            .btn-finish-repair { background:var(--primary); color:#fff; }
            .btn-finish-muted { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.14); color:#fff; }
            .btn-finish-danger { background:rgba(231,76,60,0.18); border:1px solid rgba(231,76,60,0.42); color:#e74c3c; }
            .btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
            
            .join-overlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.9); z-index:9000; display: ${isCaptain ? "none" : "flex"}; flex-direction: column; justify-content: center; align-items: center; padding: 20px;}
            .join-input { width: 100%; padding: 15px; margin: 15px 0; background: #000; border: 1px solid #333; color: white; border-radius: 12px; font-size: 16px; text-align: center; outline: none; max-width: 300px;}
            @media (max-width: 640px), (max-height: 740px) {
                .top { padding: calc(env(safe-area-inset-top, 0px) + 10px) 10px 0; }
                .top .stat-card { max-width: calc(100vw - 112px); padding: 9px 10px; border-radius: 14px; }
                .route-status { max-width: 180px; font-size: 9px; margin-top: 5px; padding-top: 5px; }
                .btn-cancel { top: calc(env(safe-area-inset-top, 0px) + 10px); right: 10px; padding: 12px 16px; font-size: 11px; min-height: 44px; border-radius: 999px; }
                .bottom { padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px)); max-height: 54vh; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
                .bottom::-webkit-scrollbar { display: none; }
                .tracker-distance { margin-bottom: 5px; }
                .tracker-distance > div:first-child { font-size: 8px !important; letter-spacing: 1.4px !important; }
                .tracker-distance > div:last-child { font-size: 10px !important; margin-top: -6px !important; }
                .val-main { font-size: clamp(2.15rem, 13vw, 3.1rem); line-height: 0.92; margin: 0; text-shadow: 0 0 14px rgba(255,95,0,0.36); }
                .grid-2 { gap: 7px; margin-bottom: 8px; }
                .bottom .grid-2 .stat-card { padding: 8px 10px; border-radius: 13px; background: rgba(0,0,0,0.58); }
                .label { font-size: 7px; letter-spacing: 1px; margin-bottom: 2px; }
                .val { font-size: 15px; line-height: 1.05; }
                .action-row { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 6px; }
                /* Layar kecil TIDAK boleh mengecilkan tombol di bawah ukuran
                   yang aman disentuh. Sebelumnya baris ini memaksa 34px, dan
                   itulah sebab tombol terkecil hanya 25px. Ruang yang sempit
                   diserap oleh panel bawah yang bisa digulir, bukan oleh jari. */
                .action-row .btn { padding: 10px 4px !important; min-height: 48px; border-radius: 11px; font-size: 11px !important; letter-spacing: 0.2px; }
                .nav-voice-status { margin: -2px 0 6px; font-size: 11px; letter-spacing: 0.6px; }
                .btn-panel-toggle { display:block; }
                .tracking-mode-panel, .stage-panel, .signal-panel, .nutrition-panel, .privacy-row { margin-bottom: 7px; padding: 8px; border-radius: 12px; }
                .signal-panel, .nutrition-panel { grid-template-columns: 1fr auto; gap: 7px; }
                .signal-title, .nutrition-title, .tracking-mode-head, .stage-title, .privacy-hint { font-size: 7px; letter-spacing: 0.7px; }
                .signal-meta, .nutrition-meta, .stage-meta { font-size: 8px; line-height: 1.25; }
                .signal-pill { font-size: 7px; padding: 4px 6px; }
                .mode-btn { padding: 10px 4px; border-radius: 10px; font-size: 10px; letter-spacing: 0.2px; min-height: 44px; }
                .stage-panel { grid-template-columns: 1fr 102px; gap: 7px; }
                .stage-actions { gap: 5px; }
                .btn-stage, .btn-overnight, .btn-nutrition { padding: 10px 5px; font-size: 10px; border-radius: 10px; min-height: 44px; }
                .privacy-row { grid-template-columns: 112px 1fr; gap: 8px; }
                .privacy-row .btn { padding: 10px 6px !important; font-size: 10px !important; border-radius: 10px; min-height: 44px; }
                .btn-start, .btn-stop { padding: 12px; border-radius: 13px; font-size: 11px; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
                .radio-panel { bottom: calc(155px + env(safe-area-inset-bottom, 0px)); right: 10px; width: min(200px, calc(100vw - 20px)); max-height: 42vh; overflow-y: auto; }
            }

            @media (max-height: 640px) {
                .bottom { max-height: 48vh; }
                .val-main { font-size: clamp(1.95rem, 10vw, 2.6rem); }
                .tracker-extra:not(.is-collapsed) { max-height: 30vh; overflow-y: auto; padding-right: 2px; }
            }

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
                    <div class="resume-item" style="grid-column:1 / -1;"><div class="resume-label">No Signal</div><div class="resume-value" id="resume-signal">Belum ada log</div></div>
                    <div class="resume-item" style="grid-column:1 / -1;"><div class="resume-label">Rute</div><div class="resume-value" id="resume-route">Tanpa route plan</div></div>
                </div>
                <div id="resume-warning" class="resume-warning">Data mungkin tidak lengkap. Cek jarak dan titik GPS sebelum lanjut.</div>
            </div>
            <button class="btn" style="background:#2ecc71; color:#000; margin-bottom:12px;" onclick="resumeSession()">▶️ RESUME MISSION</button>
            <button class="btn" style="background:#e74c3c; color:#fff;" onclick="discardSession()">🗑️ ABORT & DELETE</button>
        </div>

        <div id="finishReview" class="finish-review-overlay">
            <div class="finish-review-card">
                <div class="finish-kicker">FINISH REVIEW</div>
                <h2>Review Sebelum Save</h2>
                <div class="finish-copy" id="finish-copy">Gaspool mengecek aktivitas sebelum data dikirim ke server.</div>
                <div class="finish-grid">
                    <div class="finish-stat"><div class="finish-label">Jarak</div><div class="finish-value" id="finish-distance">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Moving Time</div><div class="finish-value" id="finish-moving">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Avg</div><div class="finish-value" id="finish-avg">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Titik GPS</div><div class="finish-value" id="finish-points">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Etape</div><div class="finish-value" id="finish-stages">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Rest Block</div><div class="finish-value" id="finish-rest">-</div></div>
                    <div class="finish-stat"><div class="finish-label">No Signal</div><div class="finish-value" id="finish-signal">-</div></div>
                    <div class="finish-stat"><div class="finish-label">Privacy</div><div class="finish-value" id="finish-privacy">-</div></div>
                </div>
                <div class="finish-section">
                    <div class="finish-section-title"><span>Data Check</span><span id="finish-status" class="doctor-pill">CHECKING</span></div>
                    <div id="finish-issues" class="finish-list"></div>
                </div>
                <div class="finish-section">
                    <div class="finish-section-title"><span>Auto Repair Plan</span><span id="finish-repair-status" class="doctor-pill warn">OPTIONAL</span></div>
                    <div id="finish-changes" class="finish-list"></div>
                </div>
                <div class="finish-section">
                    <div class="finish-section-title"><span>Sebelum → Sesudah</span><span id="finish-diff-status" class="doctor-pill">-</span></div>
                    <div id="finish-diff" class="finish-diff"></div>
                    <div id="finish-diff-note" class="finish-diff-note"></div>
                </div>
                <div class="finish-actions">
                    <button id="finish-save-btn" class="btn btn-finish-save" onclick="saveFinishReview(false)">SAVE FINAL</button>
                    <button id="finish-repair-btn" class="btn btn-finish-repair" onclick="saveFinishReview(true)">AUTO REPAIR & SAVE</button>
                    <div class="finish-small-actions">
                        <button id="finish-continue-btn" class="btn btn-finish-muted" onclick="resumeFromFinishReview()">LANJUTKAN</button>
                        <button id="finish-discard-btn" class="btn btn-finish-danger" onclick="discardFinishReview()">DISCARD</button>
                    </div>
                </div>
            </div>
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
  class="tracker-distance"
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
            
            <div class="action-row">
			<button id="btn-recenter" class="btn" style="background:rgba(52,152,219,0.2); border:1px solid #3498db; padding:10px; font-size:10px; color:#3498db; display:none; position:relative; z-index:101;" onclick="recenterMap()">📍 RECENTER</button>
            <button id="btn-stealth" class="btn" style="background:rgba(255,255,255,0.1); padding:10px; font-size:10px; color:#fff;" onclick="enableStealth()">🔒 STEALTH</button>
            <button id="btn-nav-voice" class="btn" style="background:rgba(52,152,219,0.2); border:1px solid #3498db; padding:10px; font-size:10px; color:#3498db;" onclick="toggleNavVoice()">🔊 SUARA</button>
            <button id="btn-nav-voice-pick" class="btn btn-repeat-nav" onclick="cycleNavVoice()">GANTI SUARA</button>
            <button id="btn-repeat-nav" class="btn btn-repeat-nav" onclick="repeatLastRouteInstruction()" disabled>ULANGI</button>
                ${isCaptain ? `<button id="btn-reroute" class="btn btn-reroute" onclick="rerouteToDestination()">↻ REROUTE</button>` : ""}
                <button id="btn-live" class="btn" style="background:rgba(37, 211, 102, 0.2); border: 1px solid #25D366; padding:10px; font-size:10px; color:#2ecc71;" onclick="shareLive()">${isPeleton ? "📡 SHARE RADAR" : "📡 BAGIKAN LIVE"}</button>
            </div>
            <div id="live-panel" class="live-panel">
                <div class="live-panel-head">
                    <span id="live-dot" class="live-dot"></span>
                    <span id="live-label" class="live-label">LIVE</span>
                </div>
                <div id="live-link" class="live-link">-</div>
                <div class="live-actions">
                    <button class="btn" style="background:rgba(255,255,255,0.12); color:#fff;" onclick="copyLiveLink()">SALIN</button>
                    <button class="btn" style="background:rgba(37,211,102,0.25); color:#2ecc71;" onclick="shareLive()">KIRIM</button>
                    <button class="btn" style="background:rgba(231,76,60,0.25); color:#e74c3c;" onclick="stopLiveShare()">HENTIKAN</button>
                </div>
            </div>
            <div id="nav-voice-status" class="nav-voice-status">SUARA NAV SIAP</div>
            <button id="btn-panel-toggle" class="btn btn-panel-toggle" onclick="toggleTrackerPanel()" aria-expanded="true">⚙️ PANEL KONTROL</button>
            <div id="tracker-extra" class="tracker-extra">
            <div class="signal-panel">
                <div>
                    <div class="signal-title">NO SIGNAL LOG</div>
                    <div class="signal-meta" id="signal-meta">Memantau GPS dan jaringan.</div>
                </div>
                <div class="signal-pill" id="signal-pill">OK</div>
            </div>
            <div class="nutrition-panel">
                <div>
                    <div class="nutrition-title">WATER & FOOD</div>
                    <div class="nutrition-meta" id="nutrition-meta">Reminder minum dan makan siap.</div>
                </div>
                <button id="btn-nutrition" class="btn btn-nutrition" onclick="toggleNutritionReminders()">ON</button>
            </div>
            <div class="tracking-mode-panel">
                <div class="tracking-mode-head">
                    <span>MODE GPS</span>
                    <span id="tracking-mode-hint">NORMAL</span>
                </div>
                <div class="tracking-mode-options">
                    <button id="mode-normal" class="mode-btn" onclick="setTrackingMode('normal')">NORMAL</button>
                    <button id="mode-hemat" class="mode-btn" onclick="setTrackingMode('hemat')">HEMAT</button>
                    <button id="mode-expedition" class="mode-btn" onclick="setTrackingMode('expedition')">EKSPEDISI</button>
                </div>
            </div>
            ${isCaptain ? `
            <div class="stage-panel">
                <div>
                    <div class="stage-title" id="stage-title">ETAPE 1</div>
                    <div class="stage-meta" id="stage-meta">Siap untuk perjalanan multi-day.</div>
                </div>
                <div class="stage-actions">
                    <button id="btn-stage" class="btn btn-stage" onclick="startManualStage()" disabled>ETAPE BARU</button>
                    <button id="btn-overnight" class="btn btn-overnight" onclick="pauseOvernight()" disabled>LANJUT NANTI</button>
                </div>
            </div>
            ` : ""}
            <div class="privacy-row">
                <button id="btn-privacy" class="btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.14); padding:10px; font-size:10px; color:#fff;" onclick="toggleRidePrivacy()">🔒 PRIVATE</button>
                <div id="privacy-hint" class="privacy-hint">Tidak tampil di profil publik.</div>
            </div>
            </div>

            <button class="btn btn-start" id="btn-start" onclick="mulai()">▶️ INITIATE TRACKING</button>
            <button class="btn btn-stop" id="btn-stop" onclick="selesai()">⬜ TERMINATE & SAVE</button>
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
        <script>
            let map, path = [], dist = 0, startT = 0, rec = false, watchId, radarInt, peletonRoutePollInt, restartGpsWatch = null;
			let clockInt, movingTime = 0, lastTick = Date.now(), isPaused = false, lastAnnouncedKm = 0, lastSave = 0;
			let skippedClockGapSeconds = 0;

			// --- Akuntansi jam ---------------------------------------------
			// Jam live dan jam hasil repair pernah berbeda 2:44 untuk gowes yang
			// sama. Sebagian sebabnya sudah diketahui (auto-pause pakai kecepatan
			// sesaat), tetapi sebagian lagi tidak terlihat sama sekali: setiap
			// tick yang datang terlambat dipotong diam-diam oleh
			// Math.min(delta, maxDelta), dan potongannya tidak pernah dijumlahkan
			// di mana pun. Penghitung ini mencatatnya TANPA mengubah perilaku:
			// moving time tetap dihitung seperti sebelumnya.
			//
			// Modulnya dimuat dari /assets/live-clock.js supaya berkas yang sama
			// juga dipakai tests/live-clock.mjs. Kalau gagal dimuat, tracker tetap
			// berjalan seperti biasa, hanya tanpa instrumentasi.
			let liveClockMod = null, liveClockAcc = null, liveClockLoadTried = false;

			async function loadLiveClock() {
				if (liveClockMod || liveClockLoadTried) return liveClockMod;
				liveClockLoadTried = true;
				try { liveClockMod = await import('/assets/live-clock.js'); } catch (e) { liveClockMod = null; }
				return liveClockMod;
			}

			function resetLiveClock() {
				if (!liveClockMod) return;
				const config = currentTrackingConfig();
				const maxDelta = isStealthMode ? config.stealthMaxClockDelta : config.maxClockDelta;
				liveClockAcc = liveClockMod.createLiveClockAccounting(maxDelta, REST_CLOCK_GAP_SECONDS);
			}

			function recordLiveClockSample(rawDelta, paused) {
				if (!liveClockMod || !liveClockAcc) return;
				const config = currentTrackingConfig();
				const maxDelta = isStealthMode ? config.stealthMaxClockDelta : config.maxClockDelta;
				liveClockMod.recordLiveClockTick(liveClockAcc, rawDelta, {
					paused: paused,
					maxDeltaSeconds: maxDelta,
					restGapSeconds: REST_CLOCK_GAP_SECONDS,
				});
			}

			// Ringkasan untuk layar: berapa detik yang lewat tetapi tidak dihitung
			// sebagai bergerak, dan berapa banyak tick yang terlambat.
			function liveClockSummary() {
				if (!liveClockMod || !liveClockAcc) return null;
				const a = liveClockAcc;
				if (!a.tick_count) return null;
				return {
					uncounted: liveClockMod.liveClockUncountedSeconds(a),
					clamped: Number(a.clamped_seconds.toFixed(1)),
					dropped: Number(a.dropped_seconds.toFixed(1)),
					lateTicks: a.clamped_tick_count,
					balance: liveClockMod.liveClockBalance(a),
				};
			}
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
			let lastPointSavedAt = 0;
			let startTimezoneOffsetMin = null;
			let startTimezoneName = '';
			let tripStages = [];
			let restBlocks = [];
			let overnightPause = null;
			let autoPauseStartedAt = 0;
			let finishReviewState = null;
			let finishReviewBusy = false;
			let nutritionReminderState = {
				enabled: true,
				waterCount: 0,
				foodCount: 0,
				nextWaterMovingTime: 0,
				nextFoodMovingTime: 0,
				nextWaterDistanceKm: 0,
				nextFoodDistanceKm: 0
			};
			let nutritionReminderEvents = [];
			let signalLogs = [];
			let signalState = {
				gpsErrorStartedAt: 0,
				poorAccuracyStartedAt: 0,
				networkOfflineStartedAt: 0,
				lastGpsOkAt: 0,
				lastSignalSpeechAt: 0
			};
			const NORMAL_MAX_CLOCK_DELTA_SECONDS = 10;
			const STEALTH_MAX_CLOCK_DELTA_SECONDS = 30;
			const REST_CLOCK_GAP_SECONDS = 120;
			const REST_BLOCK_MIN_SECONDS = 20 * 60;
			const MULTI_DAY_STAGE_GAP_MS = 4 * 60 * 60 * 1000;

			const isCap = ${isCaptain};
			const key = 'gaspool_blackbox_session';
			const trackingModeKey = 'gaspool_tracking_mode';
			const offlineRoutePackKey = 'gaspool_offline_route_packs_v1';
			const roomID = "${room}";
			const plannedRouteId = "${routeId}";
			let activePlannedRouteId = plannedRouteId;
			let peletonRouteVersion = 0;
			let lastPeletonRouteCheck = 0;
			let userName = "${captainName}";
			// Ruang siaran live dipisahkan dari roomID dengan sengaja.
			//
			// roomID menentukan identitas "gowes peleton" dan dipakai di banyak
			// tempat untuk memutuskan apakah rute peleton, radio, dan audio
			// peleton perlu dihidupkan. Mengisinya dengan token siaran solo akan
			// membangunkan seluruh mesin peleton itu. Jadi siaran solo memakai
			// variabelnya sendiri: Peleton mengisinya sejak awal, gowes solo
			// mengisinya saat siaran dimulai.
			//
			// CATATAN untuk yang mengedit berkas ini: seluruh halaman ini adalah
			// satu template literal TypeScript, jadi JANGAN memakai backtick di
			// dalam komentar — backtick menutup template-nya dan merusak halaman.
			// Halaman ini dirender di server, jadi peleton harus disimpulkan ulang
			// di sisi klien: variabel isPeleton milik server tidak ada di browser.
			const isPeletonMode = roomID !== "SINGLE_MODE";
			let liveRoom = isPeletonMode ? roomID : "";
			// Token siaran lama yang belum kedaluwarsa. Hanya disiapkan, tidak
			// dipakai sampai kapten menekan tombol bagikan lagi.
			let resumableLiveRoom = "";
			const liveShareKey = 'gaspool_live_room';
			// Link yang dibagikan tadi pagi masih masuk akal untuk dilanjutkan sore
			// ini, tetapi tidak untuk minggu depan: lokasi lama tidak boleh menempel
			// pada token yang sudah lama tidak dipakai.
			const LIVE_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
			let plannedRouteData = null;
			let plannedRouteLine = null;
			let plannedRouteInstructions = [];
			let plannedRouteCoords = [];
			let plannedRouteCumulativeM = [];
			let plannedRouteCheckpoints = [];
			let checkpointMarkers = [];
			let checkpointReminderMarks = {};
			let routeNextInstructionIndex = 0;
			let routeInstructionMarks = {};
			let routeVoiceEnabled = true;
			let routeVoiceReady = false;
			let lastRouteSpeech = 0;
			let routeSpeechQueue = [];
			let routeSpeechBusy = false;
			let lastSpokenRouteText = '';
			let lastInstructionSpeechText = '';
			let lastRouteEtaSpeechText = '';
			let latestPosition = null;
			let rerouteInProgress = false;
			let autoRerouteCount = 0;
			let lastAutoRerouteAt = 0;
			let offRouteState = {
				active: false,
				warned: false,
				lastWarn: 0,
				lastDistance: null,
				firstOffAt: 0,
				lastDiscoverySpeech: 0,
				lastDestinationM: null,
				peakDistanceM: 0,
				autoCandidateAt: 0
			};

			const OFF_ROUTE_WARN_M = 80;
			const OFF_ROUTE_M = 120;
			const BACK_ON_ROUTE_M = 60;
			const OFF_ROUTE_DISCOVERY_M = 220;
			const OFF_ROUTE_DISCOVERY_SECONDS = 45;
			const AUTO_REROUTE_M = 500;
			const AUTO_REROUTE_SECONDS = 180;
			const AUTO_REROUTE_COOLDOWN_MS = 15 * 60 * 1000;
			const AUTO_REROUTE_MAX_PER_ACTIVITY = 3;
			const AUTO_REROUTE_MAX_ACCURACY_M = 120;
			const ROUTE_SPEECH_COOLDOWN = 6500;
			const STEALTH_VISUAL_INTERVAL = 15000;
			const NORMAL_VISUAL_INTERVAL = 1000;
			const TRACKING_MODES = {
				normal: {
					label: 'NORMAL',
					hint: 'GPS akurat, cocok aktivitas pendek.',
					enableHighAccuracy: true,
					maximumAge: 0,
					timeout: 15000,
					accuracyLimit: 80,
					minPointMeters: 3,
					minPointSeconds: 0,
					visualInterval: 1000,
					stealthVisualInterval: 15000,
					radarSeconds: 4,
					stealthRadarSeconds: 16,
					maxClockDelta: NORMAL_MAX_CLOCK_DELTA_SECONDS,
					stealthMaxClockDelta: STEALTH_MAX_CLOCK_DELTA_SECONDS
				},
				hemat: {
					label: 'HEMAT',
					hint: 'Lebih irit, titik GPS diringkas ringan.',
					enableHighAccuracy: true,
					maximumAge: 5000,
					timeout: 20000,
					accuracyLimit: 100,
					minPointMeters: 7,
					minPointSeconds: 3,
					visualInterval: 3000,
					stealthVisualInterval: 22000,
					radarSeconds: 8,
					stealthRadarSeconds: 28,
					maxClockDelta: 12,
					stealthMaxClockDelta: 35
				},
				expedition: {
					label: 'EKSPEDISI',
					hint: 'Untuk multi-jam/hari, hemat daya dan tahan sinyal jelek.',
					enableHighAccuracy: false,
					maximumAge: 15000,
					timeout: 30000,
					accuracyLimit: 150,
					minPointMeters: 15,
					minPointSeconds: 8,
					visualInterval: 8000,
					stealthVisualInterval: 35000,
					radarSeconds: 20,
					stealthRadarSeconds: 60,
					maxClockDelta: 20,
					stealthMaxClockDelta: 50
				}
			};
			let trackingMode = sanitizeTrackingMode(localStorage.getItem(trackingModeKey));

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

			function readOfflineRoutePacks() {
				try {
					const raw = localStorage.getItem(offlineRoutePackKey);
					const parsed = raw ? JSON.parse(raw) : null;
					return parsed && typeof parsed === 'object' && parsed.routes ? parsed : { version: 1, routes: {} };
				} catch(e) {
					return { version: 1, routes: {} };
				}
			}

			function writeOfflineRoutePacks(store) {
				try {
					const routes = store && store.routes ? store.routes : {};
					const entries = Object.keys(routes)
						.map(function(id) {
							return [id, routes[id]];
						})
						.sort(function(a, b) {
							return Number(b[1].saved_at || 0) - Number(a[1].saved_at || 0);
						})
						.slice(0, 30);
					const nextStore = { version: 1, routes: {} };

					entries.forEach(function(entry) {
						nextStore.routes[entry[0]] = entry[1];
					});

					localStorage.setItem(offlineRoutePackKey, JSON.stringify(nextStore));
					return true;
				} catch(e) {
					console.warn('Offline route pack gagal disimpan:', e);
					return false;
				}
			}

			function saveOfflineRoutePack(route) {
				if (!route || !route.id || !route.data) return false;

				const store = readOfflineRoutePacks();
				const routeId = String(route.id);
				store.routes[routeId] = {
					saved_at: Date.now(),
					route: {
						id: route.id,
						name: route.name || route.data.name || 'Route Plan',
						distance: Number(route.distance || route.data.distance_km || 0),
						duration: Number(route.duration || route.data.duration_s || 0),
						profile: route.profile || route.data.profile || 'cycling-regular',
						provider: route.provider || route.data.provider || 'offline-pack',
						created_at: route.created_at || new Date().toISOString(),
						data: route.data
					}
				};

				return writeOfflineRoutePacks(store);
			}

			function loadOfflineRoutePack(routeId) {
				const id = String(routeId || '');
				if (!id) return null;

				const store = readOfflineRoutePacks();
				const pack = store.routes ? store.routes[id] : null;
				if (!pack || !pack.route || !pack.route.data) return null;
				return pack.route;
			}

			function shouldUpdateVisuals(force = false) {
				if (force) return true;
				const now = Date.now();
				const config = currentTrackingConfig();
				const interval = isStealthMode ? config.stealthVisualInterval : config.visualInterval;

				if (now - lastVisualUpdate < interval) return false;
				lastVisualUpdate = now;
				return true;
			}

			function sanitizeTrackingMode(mode) {
				return TRACKING_MODES[mode] ? mode : 'normal';
			}

			function currentTrackingConfig() {
				return TRACKING_MODES[sanitizeTrackingMode(trackingMode)];
			}

			function geolocationOptions() {
				const config = currentTrackingConfig();
				return {
					enableHighAccuracy: config.enableHighAccuracy,
					maximumAge: config.maximumAge,
					timeout: config.timeout
				};
			}

			function updateTrackingModeUI() {
				const config = currentTrackingConfig();
				const hint = document.getElementById('tracking-mode-hint');

				if (hint) hint.innerText = config.label + ' • ' + config.hint;

				Object.keys(TRACKING_MODES).forEach(function(mode) {
					const btn = document.getElementById('mode-' + mode);
					if (!btn) return;
					btn.classList.toggle('active', mode === trackingMode);
				});
			}

			function setTrackingMode(mode) {
				trackingMode = sanitizeTrackingMode(mode);
				localStorage.setItem(trackingModeKey, trackingMode);
				updateTrackingModeUI();

				if (rec && navigator.geolocation && watchId) {
					navigator.geolocation.clearWatch(watchId);
					if (typeof restartGpsWatch === 'function') restartGpsWatch();
				}
			}

			function activityAutoPauseSpeedKmh() {
				if ('${type}' === 'hike') return 0.7;
				if ('${type}' === 'walk') return 0.8;
				if ('${type}' === 'run') return 1.4;
				return 2.0;
			}

			function shouldStoreTrackPoint(distanceKm, speedKmh) {
				const config = currentTrackingConfig();
				const now = Date.now();
				const elapsedSeconds = lastPointSavedAt > 0 ? (now - lastPointSavedAt) / 1000 : Infinity;
				const minDistanceKm = Math.max(0.003, config.minPointMeters / 1000);

				if (distanceKm >= 0.05) return true;
				if (distanceKm < minDistanceKm) return false;
				if (elapsedSeconds < config.minPointSeconds && speedKmh < 8) return false;
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


			function isCompactTrackerViewport() {
				return window.matchMedia('(max-width: 640px), (max-height: 740px)').matches;
			}

			function setTrackerPanelCollapsed(collapsed) {
				const panel = document.getElementById('tracker-extra');
				const btn = document.getElementById('btn-panel-toggle');
				if (!panel || !btn) return;

				panel.classList.toggle('is-collapsed', Boolean(collapsed));
				btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
				btn.innerText = collapsed ? '⚙️ PANEL: TAMPILKAN KONTROL' : '🗺️ MAP: CIUTKAN PANEL';
			}

			function toggleTrackerPanel() {
				const panel = document.getElementById('tracker-extra');
				if (!panel) return;
				setTrackerPanelCollapsed(!panel.classList.contains('is-collapsed'));
			}

			function bootCompactTrackerPanel() {
				setTrackerPanelCollapsed(isCompactTrackerViewport());
				window.addEventListener('orientationchange', function() {
					setTimeout(function() {
						if (isCompactTrackerViewport()) setTrackerPanelCollapsed(true);
					}, 300);
				});
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

			function currentTimezoneOffsetMin() {
				return -new Date().getTimezoneOffset();
			}

			function currentTimezoneName() {
				try {
					return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
				} catch(e) {
					return '';
				}
			}

			function normalizeTimezoneOffset(value) {
				const offset = Number(value);
				if (Number.isFinite(offset) && Math.abs(offset) <= 14 * 60) {
					return Math.round(offset);
				}

				return currentTimezoneOffsetMin();
			}

			function normalizeTimezoneName(value) {
				return String(value || '').trim().slice(0, 80) || currentTimezoneName();
			}

			function captureStartTimezone() {
				startTimezoneOffsetMin = currentTimezoneOffsetMin();
				startTimezoneName = currentTimezoneName();
			}

			function activityTimeContext(finishMs) {
				const safeStart = Number(startT || Date.now());
				const safeFinish = Number(finishMs || Date.now());

				return {
					start_date: new Date(safeStart).toISOString(),
					finish_date: new Date(safeFinish).toISOString(),
					start_timezone_offset_min: normalizeTimezoneOffset(startTimezoneOffsetMin),
					finish_timezone_offset_min: currentTimezoneOffsetMin(),
					start_timezone_name: normalizeTimezoneName(startTimezoneName),
					finish_timezone_name: currentTimezoneName()
				};
			}

			function formatDateWithTimezoneOffset(ts, offsetMin) {
				const time = Number(ts || Date.now());
				const offset = normalizeTimezoneOffset(offsetMin);
				const local = new Date(time + (offset * 60000));
				const day = String(local.getUTCDate()).padStart(2, '0');
				const month = String(local.getUTCMonth() + 1).padStart(2, '0');
				const year = local.getUTCFullYear();

				return day + '/' + month + '/' + year;
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

			function formatStageDuration(seconds) {
				const total = Math.max(0, Math.floor(Number(seconds || 0)));
				const hours = Math.floor(total / 3600);
				const minutes = Math.floor((total % 3600) / 60);

				if (hours > 0 && minutes > 0) return hours + 'j ' + minutes + 'm';
				if (hours > 0) return hours + 'j';
				if (minutes > 0) return minutes + 'm';
				return '<1m';
			}

			function restBlockLabel(type) {
				const labels = {
					overnight_pause: 'Pause overnight',
					resume_gap: 'Jeda resume panjang',
					system_gap: 'Jeda sistem panjang',
					auto_pause: 'Auto-pause panjang'
				};

				return labels[type] || 'Rest block';
			}

			function normalizeRestBlocks(list) {
				if (!Array.isArray(list)) return [];

				return list.map(function(block) {
					const start = Number(block.start || 0);
					const end = Number(block.end || 0);
					const duration = Number(block.duration_s || ((end && start) ? (end - start) / 1000 : 0));
					const type = String(block.type || 'rest').slice(0, 40);

					return {
						type: type,
						label: String(block.label || restBlockLabel(type)).slice(0, 80),
						start: Number.isFinite(start) && start > 0 ? start : Date.now(),
						end: Number.isFinite(end) && end > 0 ? end : null,
						duration_s: Math.max(0, Math.floor(Number.isFinite(duration) ? duration : 0)),
						distance_km: Number(Number(block.distance_km || dist || 0).toFixed(3)),
						moving_time: Math.max(0, Math.floor(Number(block.moving_time || movingTime || 0))),
						note: String(block.note || '').slice(0, 160)
					};
				}).filter(function(block) {
					return block.duration_s >= REST_BLOCK_MIN_SECONDS;
				}).slice(-80);
			}

			function recordRestBlock(start, end, type, note) {
				const safeStart = Number(start || 0);
				const safeEnd = Number(end || Date.now());
				if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) return false;

				const duration = Math.floor((safeEnd - safeStart) / 1000);
				if (duration < REST_BLOCK_MIN_SECONDS) return false;

				restBlocks = normalizeRestBlocks(restBlocks.concat([{
					type: type || 'rest',
					label: restBlockLabel(type || 'rest'),
					start: safeStart,
					end: safeEnd,
					duration_s: duration,
					distance_km: Number((dist || 0).toFixed(3)),
					moving_time: Math.floor(movingTime || 0),
					note: note || ''
				}]));

				return true;
			}

			function serializeRestBlocks() {
				return normalizeRestBlocks(restBlocks);
			}

			function signalReasonLabel(type) {
				const labels = {
					network_offline: 'Jaringan offline',
					gps_error: 'GPS error',
					poor_accuracy: 'Akurasi GPS buruk',
					system_gap: 'Jeda sistem'
				};
				return labels[type] || 'No signal';
			}

			function normalizeSignalLogs(list) {
				if (!Array.isArray(list)) return [];

				return list.map(function(log) {
					const start = Number(log.start || 0);
					const end = Number(log.end || 0);
					const duration = Number(log.duration_s || ((end - start) / 1000) || 0);
					return {
						type: String(log.type || 'unknown').slice(0, 40),
						label: String(log.label || signalReasonLabel(log.type)).slice(0, 80),
						start: Number.isFinite(start) ? start : Date.now(),
						end: Number.isFinite(end) && end > 0 ? end : null,
						duration_s: Math.max(0, Math.floor(Number.isFinite(duration) ? duration : 0)),
						distance_km: Number(Number(log.distance_km || 0).toFixed(3)),
						moving_time: Math.max(0, Math.floor(Number(log.moving_time || 0))),
						detail: String(log.detail || '').slice(0, 160)
					};
				}).filter(function(log) {
					return log.type && log.start;
				}).slice(-120);
			}

			function serializeSignalLogs(includeOpen) {
				const logs = normalizeSignalLogs(signalLogs);
				const now = Date.now();

				if (includeOpen) {
					if (signalState.networkOfflineStartedAt) {
						logs.push(buildSignalLog('network_offline', signalState.networkOfflineStartedAt, now, 'Masih offline saat disimpan.'));
					}
					if (signalState.gpsErrorStartedAt) {
						logs.push(buildSignalLog('gps_error', signalState.gpsErrorStartedAt, now, 'GPS belum pulih saat disimpan.'));
					}
					if (signalState.poorAccuracyStartedAt) {
						logs.push(buildSignalLog('poor_accuracy', signalState.poorAccuracyStartedAt, now, 'Akurasi masih buruk saat disimpan.'));
					}
				}

				return normalizeSignalLogs(logs);
			}

			function buildSignalLog(type, start, end, detail) {
				const safeStart = Number(start || Date.now());
				const safeEnd = Number(end || Date.now());
				return {
					type: type,
					label: signalReasonLabel(type),
					start: safeStart,
					end: safeEnd,
					duration_s: Math.max(0, Math.floor((safeEnd - safeStart) / 1000)),
					distance_km: Number((dist || 0).toFixed(3)),
					moving_time: Math.floor(movingTime || 0),
					detail: String(detail || '').slice(0, 160)
				};
			}

			function pushSignalLog(type, start, end, detail) {
				const log = buildSignalLog(type, start, end, detail);
				if (log.duration_s < 5 && type !== 'network_offline') return;

				signalLogs = normalizeSignalLogs(signalLogs.concat([log]));
				updateSignalUI();
			}

			function startSignalEvent(type, detail) {
				const now = Date.now();

				if (type === 'network_offline' && !signalState.networkOfflineStartedAt) {
					signalState.networkOfflineStartedAt = now;
				}
				if (type === 'gps_error' && !signalState.gpsErrorStartedAt) {
					signalState.gpsErrorStartedAt = now;
				}
				if (type === 'poor_accuracy' && !signalState.poorAccuracyStartedAt) {
					signalState.poorAccuracyStartedAt = now;
				}

				if (rec && now - signalState.lastSignalSpeechAt > 120000) {
					signalState.lastSignalSpeechAt = now;
					speakRoute(detail || (signalReasonLabel(type) + ' terdeteksi.'), false);
				}

				updateSignalUI();
			}

			function closeSignalEvent(type, detail) {
				const now = Date.now();

				if (type === 'network_offline' && signalState.networkOfflineStartedAt) {
					pushSignalLog(type, signalState.networkOfflineStartedAt, now, detail || 'Jaringan kembali online.');
					signalState.networkOfflineStartedAt = 0;
				}
				if (type === 'gps_error' && signalState.gpsErrorStartedAt) {
					pushSignalLog(type, signalState.gpsErrorStartedAt, now, detail || 'GPS kembali menerima posisi.');
					signalState.gpsErrorStartedAt = 0;
				}
				if (type === 'poor_accuracy' && signalState.poorAccuracyStartedAt) {
					pushSignalLog(type, signalState.poorAccuracyStartedAt, now, detail || 'Akurasi GPS kembali masuk batas.');
					signalState.poorAccuracyStartedAt = 0;
				}

				updateSignalUI();
			}

			function signalSummary(logs) {
				const list = normalizeSignalLogs(logs);
				const totalSeconds = list.reduce(function(sum, log) {
					return sum + Number(log.duration_s || 0);
				}, 0);

				return {
					count: list.length,
					totalSeconds: totalSeconds,
					label: list.length + ' log • ' + formatStageDuration(totalSeconds)
				};
			}

			function updateSignalUI() {
				const meta = document.getElementById('signal-meta');
				const pill = document.getElementById('signal-pill');
				if (!meta || !pill) return;

				const open = [];
				if (signalState.networkOfflineStartedAt) open.push('jaringan offline');
				if (signalState.gpsErrorStartedAt) open.push('GPS error');
				if (signalState.poorAccuracyStartedAt) open.push('GPS buruk');

				const summary = signalSummary(signalLogs);
				if (open.length > 0) {
					pill.innerText = 'WARNING';
					pill.style.color = '#e74c3c';
					pill.style.borderColor = 'rgba(231,76,60,0.45)';
					meta.innerText = open.join(' • ') + ' aktif. ' + summary.label + ' tersimpan.';
				} else {
					pill.innerText = summary.count > 0 ? 'LOGGED' : 'OK';
					pill.style.color = summary.count > 0 ? '#f1c40f' : '#2ecc71';
					pill.style.borderColor = summary.count > 0 ? 'rgba(241,196,15,0.32)' : 'rgba(46,204,113,0.35)';
					meta.innerText = summary.count > 0 ? summary.label + ' no signal.' : 'GPS dan jaringan terpantau normal.';
				}
			}

			function nutritionConfig() {
				if ('${type}' === 'run') {
					return {
						waterSeconds: 20 * 60,
						foodSeconds: 45 * 60,
						waterKm: 4,
						foodKm: 10,
						label: 'lari'
					};
				}
				if ('${type}' === 'walk') {
					return {
						waterSeconds: 25 * 60,
						foodSeconds: 60 * 60,
						waterKm: 2.5,
						foodKm: 6,
						label: 'jalan'
					};
				}
				if ('${type}' === 'hike') {
					return {
						waterSeconds: 25 * 60,
						foodSeconds: 60 * 60,
						waterKm: 2,
						foodKm: 5,
						label: 'hiking'
					};
				}
				return {
					waterSeconds: 20 * 60,
					foodSeconds: 60 * 60,
					waterKm: 10,
					foodKm: 25,
					label: 'gowes'
				};
			}

			function defaultNutritionState() {
				const config = nutritionConfig();
				return {
					enabled: true,
					waterCount: 0,
					foodCount: 0,
					nextWaterMovingTime: config.waterSeconds,
					nextFoodMovingTime: config.foodSeconds,
					nextWaterDistanceKm: config.waterKm,
					nextFoodDistanceKm: config.foodKm
				};
			}

			function normalizeNutritionState(value) {
				const defaults = defaultNutritionState();
				const state = value && typeof value === 'object' ? value : {};

				return {
					enabled: state.enabled !== false,
					waterCount: Math.max(0, Math.floor(Number(state.waterCount || 0))),
					foodCount: Math.max(0, Math.floor(Number(state.foodCount || 0))),
					nextWaterMovingTime: Math.max(defaults.nextWaterMovingTime, Number(state.nextWaterMovingTime || defaults.nextWaterMovingTime)),
					nextFoodMovingTime: Math.max(defaults.nextFoodMovingTime, Number(state.nextFoodMovingTime || defaults.nextFoodMovingTime)),
					nextWaterDistanceKm: Math.max(defaults.nextWaterDistanceKm, Number(state.nextWaterDistanceKm || defaults.nextWaterDistanceKm)),
					nextFoodDistanceKm: Math.max(defaults.nextFoodDistanceKm, Number(state.nextFoodDistanceKm || defaults.nextFoodDistanceKm))
				};
			}

			function normalizeNutritionEvents(list) {
				if (!Array.isArray(list)) return [];

				return list.map(function(event) {
					return {
						type: String(event.type || 'water').slice(0, 20),
						time: Number(event.time || Date.now()),
						moving_time: Math.max(0, Math.floor(Number(event.moving_time || 0))),
						distance_km: Number(Number(event.distance_km || 0).toFixed(3))
					};
				}).filter(function(event) {
					return event.type === 'water' || event.type === 'food' || event.type === 'water_food';
				}).slice(-120);
			}

			function pushNutritionEvent(type) {
				nutritionReminderEvents = normalizeNutritionEvents(nutritionReminderEvents.concat([{
					type: type,
					time: Date.now(),
					moving_time: Math.floor(movingTime || 0),
					distance_km: Number((dist || 0).toFixed(3))
				}]));
			}

			function serializeNutritionSummary() {
				const state = normalizeNutritionState(nutritionReminderState);
				const events = normalizeNutritionEvents(nutritionReminderEvents);

				return {
					enabled: state.enabled,
					water_count: state.waterCount,
					food_count: state.foodCount,
					events: events
				};
			}

			function updateNutritionUI() {
				const meta = document.getElementById('nutrition-meta');
				const btn = document.getElementById('btn-nutrition');
				if (!meta || !btn) return;

				nutritionReminderState = normalizeNutritionState(nutritionReminderState);
				const config = nutritionConfig();

				btn.innerText = nutritionReminderState.enabled ? 'ON' : 'OFF';
				btn.style.color = nutritionReminderState.enabled ? '#2ecc71' : '#aaa';
				btn.style.borderColor = nutritionReminderState.enabled ? 'rgba(46,204,113,0.42)' : 'rgba(255,255,255,0.18)';

				if (!nutritionReminderState.enabled) {
					meta.innerText = 'Reminder asupan dimatikan.';
					return;
				}

				const waterMinutes = Math.max(0, Math.ceil((nutritionReminderState.nextWaterMovingTime - movingTime) / 60));
				const foodMinutes = Math.max(0, Math.ceil((nutritionReminderState.nextFoodMovingTime - movingTime) / 60));
				const waterKmLeft = Math.max(0, nutritionReminderState.nextWaterDistanceKm - dist);
				const foodKmLeft = Math.max(0, nutritionReminderState.nextFoodDistanceKm - dist);

				meta.innerText =
					'Minum ~' + waterMinutes + 'm / ' + waterKmLeft.toFixed(1) + 'km' +
					' • makan ~' + foodMinutes + 'm / ' + foodKmLeft.toFixed(1) + 'km' +
					' • ' + config.label;
			}

			function toggleNutritionReminders() {
				nutritionReminderState = normalizeNutritionState(nutritionReminderState);
				nutritionReminderState.enabled = !nutritionReminderState.enabled;
				updateNutritionUI();
				speakRoute(nutritionReminderState.enabled ? 'Reminder minum dan makan aktif.' : 'Reminder minum dan makan dimatikan.', true);
			}

			function advanceNutritionTargets(type) {
				const config = nutritionConfig();
				nutritionReminderState = normalizeNutritionState(nutritionReminderState);

				if (type === 'water' || type === 'water_food') {
					nutritionReminderState.waterCount += 1;
					while (nutritionReminderState.nextWaterMovingTime <= movingTime) {
						nutritionReminderState.nextWaterMovingTime += config.waterSeconds;
					}
					while (nutritionReminderState.nextWaterDistanceKm <= dist) {
						nutritionReminderState.nextWaterDistanceKm += config.waterKm;
					}
				}

				if (type === 'food' || type === 'water_food') {
					nutritionReminderState.foodCount += 1;
					while (nutritionReminderState.nextFoodMovingTime <= movingTime) {
						nutritionReminderState.nextFoodMovingTime += config.foodSeconds;
					}
					while (nutritionReminderState.nextFoodDistanceKm <= dist) {
						nutritionReminderState.nextFoodDistanceKm += config.foodKm;
					}
				}
			}

			function updateNutritionReminders() {
				if (!rec) {
					updateNutritionUI();
					return;
				}

				nutritionReminderState = normalizeNutritionState(nutritionReminderState);
				if (!nutritionReminderState.enabled) {
					updateNutritionUI();
					return;
				}

				const waterDue =
					movingTime >= nutritionReminderState.nextWaterMovingTime ||
					dist >= nutritionReminderState.nextWaterDistanceKm;
				const foodDue =
					movingTime >= nutritionReminderState.nextFoodMovingTime ||
					dist >= nutritionReminderState.nextFoodDistanceKm;

				if (waterDue && foodDue) {
					pushNutritionEvent('water_food');
					advanceNutritionTargets('water_food');
					speakRoute('Saatnya minum dan makan kecil. Isi tenaga sebelum kosong.', false);
				} else if (foodDue) {
					pushNutritionEvent('food');
					advanceNutritionTargets('food');
					speakRoute('Saatnya makan kecil. Ambil karbo atau snack ringan.', false);
				} else if (waterDue) {
					pushNutritionEvent('water');
					advanceNutritionTargets('water');
					speakRoute('Saatnya minum. Ambil beberapa teguk air.', false);
				}

				updateNutritionUI();
			}

			function normalizeTripStages(list) {
				if (!Array.isArray(list)) return [];

				return list.map(function(stage, index) {
					return {
						index: Math.max(1, Math.floor(Number(stage.index || index + 1))),
						name: String(stage.name || ('Etape ' + (index + 1))).slice(0, 80),
						reason: String(stage.reason || 'manual').slice(0, 40),
						start_time: String(stage.start_time || new Date().toISOString()).slice(0, 40),
						end_time: stage.end_time ? String(stage.end_time).slice(0, 40) : '',
						start_distance_km: Math.max(0, Number(stage.start_distance_km || 0)),
						end_distance_km: stage.end_distance_km === undefined || stage.end_distance_km === null ? null : Math.max(0, Number(stage.end_distance_km || 0)),
						start_moving_time: Math.max(0, Math.floor(Number(stage.start_moving_time || 0))),
						end_moving_time: stage.end_moving_time === undefined || stage.end_moving_time === null ? null : Math.max(0, Math.floor(Number(stage.end_moving_time || 0))),
						start_point_index: Math.max(0, Math.floor(Number(stage.start_point_index || 0))),
						end_point_index: stage.end_point_index === undefined || stage.end_point_index === null ? null : Math.max(0, Math.floor(Number(stage.end_point_index || 0)))
					};
				}).filter(function(stage) {
					return stage.name && Number.isFinite(stage.start_distance_km);
				}).slice(0, 100);
			}

			function serializeTripStages(includeLive) {
				return normalizeTripStages(tripStages).map(function(stage) {
					const copy = Object.assign({}, stage);

					if (includeLive && (!copy.end_time || copy.end_distance_km === null || copy.end_moving_time === null)) {
						copy.end_time = new Date().toISOString();
						copy.end_distance_km = dist;
						copy.end_moving_time = Math.floor(movingTime);
						copy.end_point_index = Math.max(0, path.length - 1);
					}

					if (copy.end_distance_km !== null) copy.end_distance_km = Number(copy.end_distance_km.toFixed(3));
					copy.start_distance_km = Number(copy.start_distance_km.toFixed(3));
					return copy;
				});
			}

			function updateStageUI() {
				const title = document.getElementById('stage-title');
				const meta = document.getElementById('stage-meta');
				const btn = document.getElementById('btn-stage');
				const overnightBtn = document.getElementById('btn-overnight');
				if (!title || !meta) return;

				const stages = normalizeTripStages(tripStages);
				const current = stages[stages.length - 1];
				const stageNumber = current ? current.index : 1;
				const stageDistance = current ? Math.max(0, dist - Number(current.start_distance_km || 0)) : 0;
				const stageMoving = current ? Math.max(0, movingTime - Number(current.start_moving_time || 0)) : 0;

				title.innerText = 'ETAPE ' + stageNumber;
				meta.innerText = stageDistance.toFixed(2) + ' km etape ini • ' + formatStageDuration(stageMoving) + ' moving';
				if (btn) btn.disabled = !rec || stageDistance < 0.2;
				if (overnightBtn) overnightBtn.disabled = !rec;
			}

			function ensureCurrentStage(reason) {
				tripStages = normalizeTripStages(tripStages);
				if (tripStages.length === 0) {
					tripStages.push({
						index: 1,
						name: 'Etape 1',
						reason: reason || 'start',
						start_time: new Date(startT || Date.now()).toISOString(),
						end_time: '',
						start_distance_km: Number((dist || 0).toFixed(3)),
						end_distance_km: null,
						start_moving_time: Math.floor(movingTime || 0),
						end_moving_time: null,
						start_point_index: Math.max(0, path.length - 1),
						end_point_index: null
					});
				}
				updateStageUI();
			}

			function closeCurrentStage(reason) {
				ensureCurrentStage(reason || 'manual');
				const current = tripStages[tripStages.length - 1];
				if (!current) return;

				current.end_time = new Date().toISOString();
				current.end_distance_km = Number((dist || 0).toFixed(3));
				current.end_moving_time = Math.floor(movingTime || 0);
				current.end_point_index = Math.max(0, path.length - 1);
				if (reason) current.reason = reason;
			}

			function beginNextStage(reason) {
				closeCurrentStage(reason || 'manual');
				const nextIndex = tripStages.length + 1;
				tripStages.push({
					index: nextIndex,
					name: 'Etape ' + nextIndex,
					reason: reason || 'manual',
					start_time: new Date().toISOString(),
					end_time: '',
					start_distance_km: Number((dist || 0).toFixed(3)),
					end_distance_km: null,
					start_moving_time: Math.floor(movingTime || 0),
					end_moving_time: null,
					start_point_index: Math.max(0, path.length - 1),
					end_point_index: null
				});
				updateStageUI();
			}

			function startManualStage() {
				if (!rec) return;
				beginNextStage('manual');
				speakRoute('Etape baru dimulai.', false);
			}

			function stopLiveEngines() {
				rec = false;
				try {
					if (watchId) navigator.geolocation.clearWatch(watchId);
				} catch(e) {}
				if (radarInt) clearInterval(radarInt);
				if (clockInt) clearInterval(clockInt);
				if (peletonRoutePollInt) clearInterval(peletonRoutePollInt);
				restartGpsWatch = null;
				releaseWakeLock();
				updateStageUI();
			}

			function pauseOvernight() {
				if (!rec) return;
				if (!confirm('Simpan sesi untuk dilanjutkan nanti? Aktivitas belum akan diupload.')) return;

				const pausedAt = Date.now();
				overnightPause = {
					active: true,
					paused_at: pausedAt,
					distance_km: Number((dist || 0).toFixed(3)),
					moving_time: Math.floor(movingTime || 0)
				};
				closeCurrentStage('overnight_pause');
				persistBlackboxSnapshot(pausedAt);
				stopLiveEngines();

				document.getElementById('btn-start').style.display = 'none';
				document.getElementById('btn-stop').style.display = 'none';
				renderResumeSummary(buildBlackboxSnapshot(pausedAt));
				document.getElementById('resume-copy').innerHTML = 'Sesi disimpan untuk dilanjutkan nanti.<br>Buka lagi saat siap berangkat.';
				document.getElementById('safeMode').style.display = 'flex';
				speakRoute('Sesi disimpan. Lanjutkan besok dari resume mission.', true);
			}

			function maybeStartResumeStage(savedAt) {
				const gap = Date.now() - Number(savedAt || 0);
				if (!Number.isFinite(gap) || gap < MULTI_DAY_STAGE_GAP_MS) return false;
				if (dist < 0.2 && path.length < 2) return false;

				recordRestBlock(Number(savedAt || 0), Date.now(), 'resume_gap', 'Sesi dilanjutkan setelah jeda panjang.');
				beginNextStage('resume_gap');
				speakRoute('Jeda panjang terdeteksi. Gaspool memulai etape baru.', true);
				return true;
			}

			function buildBlackboxSnapshot(savedAt) {
				return {
					dist,
					startT,
					startTimezoneOffsetMin:
						normalizeTimezoneOffset(
							startTimezoneOffsetMin
						),
					startTimezoneName:
						normalizeTimezoneName(
							startTimezoneName
						),
					movingTime,
					lastAnnouncedKm,
					tempReadings,
					lastTempCheck,
					totalElevation,
					lastAlt,
					skippedClockGapSeconds,
					trackingMode,
					tripStages:
						serializeTripStages(
							false
						),
					restBlocks:
						serializeRestBlocks(),
					overnightPause,
					nutritionReminderState,
					nutritionReminderEvents:
						normalizeNutritionEvents(
							nutritionReminderEvents
						),
					signalLogs:
						serializeSignalLogs(
							true
						),
					autoRerouteCount,
					lastAutoRerouteAt,
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
						Number(savedAt || Date.now())
				};
			}

			function persistBlackboxSnapshot(savedAt) {
				localStorage.setItem(key, JSON.stringify(buildBlackboxSnapshot(savedAt || Date.now())));
			}

			function renderResumeSummary(data, isCorrupt = false) {
				const d = data || {};
				const distance = Number(d.dist || 0);
				const moving = Number(d.movingTime || 0);
				const points = Number(d.trackPointCount || 0);
				const routeName = d.plannedRouteName || (d.plannedRouteId ? 'Route ID #' + d.plannedRouteId : 'Tanpa route plan');
				const privacy = d.isPublic ? 'PUBLIC' : 'PRIVATE';
				const signals = signalSummary(d.signalLogs || []);
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
				setText('resume-signal', signals.count > 0 ? signals.label : 'Belum ada log');
				setText('resume-route', routeName + (Array.isArray(d.tripStages) && d.tripStages.length > 1 ? ' • ' + d.tripStages.length + ' etape' : ''));

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

			function formatEtaDuration(seconds) {
				const total = Math.max(0, Math.round(Number(seconds || 0)));
				const hours = Math.floor(total / 3600);
				const minutes = Math.floor((total % 3600) / 60);

				if (hours > 0 && minutes > 0) return hours + 'j ' + minutes + 'm';
				if (hours > 0) return hours + 'j';
				if (minutes > 0) return minutes + 'm';
				return '<1m';
			}

			function formatEtaClock(seconds) {
				try {
					return new Date(Date.now() + (Number(seconds || 0) * 1000)).toLocaleTimeString('id-ID', {
						hour: '2-digit',
						minute: '2-digit'
					});
				} catch(e) {
					return '';
				}
			}

			function defaultEtaSpeedKmh() {
				if ('${type}' === 'hike') return 3.5;
				if ('${type}' === 'walk') return 4.5;
				if ('${type}' === 'run') return 8.5;
				return 16;
			}

			function effectiveEtaSpeedKmh(speedKmh) {
				const gpsSpeed = Number(speedKmh || 0);
				const avgSpeed = movingTime > 120 && dist > 0.2 ? dist / (movingTime / 3600) : 0;
				const minMoving = activityAutoPauseSpeedKmh();

				if (gpsSpeed >= minMoving && avgSpeed >= minMoving) {
					return Math.max(minMoving, (avgSpeed * 0.7) + (gpsSpeed * 0.3));
				}

				if (avgSpeed >= minMoving) return avgSpeed;
				if (gpsSpeed >= minMoving) return gpsSpeed;
				return defaultEtaSpeedKmh();
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

			function buildRouteCumulativeMeters(coords) {
				const out = [0];

				for (let i = 1; i < coords.length; i++) {
					out.push(out[i - 1] + map.distance(coords[i - 1], coords[i]));
				}

				return out;
			}

			function nearestRouteProgressMeters(lat, lng) {
				if (!plannedRouteCoords || plannedRouteCoords.length < 2) return null;

				let best = null;
				const originLat = lat;
				const p = projectPointMeters(lat, lng, originLat);

				for (let i = 1; i < plannedRouteCoords.length; i++) {
					const start = plannedRouteCoords[i - 1];
					const end = plannedRouteCoords[i];
					const a = projectPointMeters(start[0], start[1], originLat);
					const b = projectPointMeters(end[0], end[1], originLat);
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const lenSq = dx * dx + dy * dy;
					const ratio = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
					const closest = {
						x: a.x + ratio * dx,
						y: a.y + ratio * dy
					};
					const px = p.x - closest.x;
					const py = p.y - closest.y;
					const distanceM = Math.sqrt(px * px + py * py);
					const segmentM = map.distance(start, end);
					const progressM = (plannedRouteCumulativeM[i - 1] || 0) + (segmentM * ratio);

					if (!best || distanceM < best.distanceM) {
						best = { distanceM, progressM, index: i, ratio };
					}
				}

				return best;
			}

			function routeEtaSummary(lat, lng, speedKmh, nextDistanceM) {
				const progress = nearestRouteProgressMeters(lat, lng);
				const totalRouteM = plannedRouteCumulativeM.length > 0
					? plannedRouteCumulativeM[plannedRouteCumulativeM.length - 1]
					: 0;

				if (!progress || totalRouteM <= 0) return { detail: '', speech: '', remainingM: null };

				const remainingM = Math.max(0, totalRouteM - progress.progressM);
				const etaSpeed = Math.max(activityAutoPauseSpeedKmh(), effectiveEtaSpeedKmh(speedKmh));
				const destinationSeconds = (remainingM / 1000) / etaSpeed * 3600;
				const destinationEta = formatEtaDuration(destinationSeconds);
				const destinationClock = formatEtaClock(destinationSeconds);
				const nextSeconds = Number(nextDistanceM || 0) > 0
					? (Number(nextDistanceM) / 1000) / etaSpeed * 3600
					: 0;
				const nextEta = nextSeconds > 0 ? formatEtaDuration(nextSeconds) : '';
				const detailParts = [];

				if (nextEta) detailParts.push('Instruksi ~' + nextEta);
				detailParts.push('Tujuan ' + roundDistanceMeters(remainingM) + ' / ' + destinationEta + (destinationClock ? ' / ' + destinationClock : ''));

				return {
					detail: detailParts.join(' • '),
					speech: 'Sisa ke tujuan ' + roundDistanceMeters(remainingM) + ', kira-kira ' + destinationEta + (destinationClock ? ', estimasi sampai ' + destinationClock : ''),
					remainingM
				};
			}

			function checkpointTypeLabel(type) {
				const labels = {
					food: 'makan atau warung',
					water: 'air',
					minimarket: 'minimarket',
					fuel: 'pom atau bengkel',
					mosque: 'masjid atau tempat ibadah',
					camp: 'camp atau istirahat',
					medical: 'medis',
					other: 'checkpoint'
				};
				return labels[type] || labels.other;
			}

			function normalizeCheckpointList(list) {
				if (!Array.isArray(list)) return [];

				return list.map(function(checkpoint) {
					const lat = Number(checkpoint.lat);
					const lng = Number(checkpoint.lng !== undefined ? checkpoint.lng : checkpoint.lon);
					const reminderM = Number(checkpoint.reminder_m || checkpoint.reminderM || 1000);

					if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
					return {
						lat: lat,
						lng: lng,
						name: String(checkpoint.name || 'Checkpoint').slice(0, 80),
						type: checkpoint.type || 'other',
						reminder_m: Number.isFinite(reminderM) ? Math.max(0, reminderM) : 1000
					};
				}).filter(Boolean);
			}

			function drawCheckpointMarkers() {
				checkpointMarkers.forEach(function(marker) {
					map.removeLayer(marker);
				});
				checkpointMarkers = [];

				plannedRouteCheckpoints.forEach(function(checkpoint) {
					const marker = L.circleMarker([checkpoint.lat, checkpoint.lng], {
						radius: 7,
						color: '#fff',
						weight: 2,
						fillColor: '#f1c40f',
						fillOpacity: 1
					}).addTo(map).bindTooltip(checkpoint.name || 'Checkpoint', {
						permanent: false,
						direction: 'top'
					});
					checkpointMarkers.push(marker);
				});
			}

			function updateCheckpointReminders(lat, lng) {
				if (!rec || !plannedRouteCheckpoints.length) return;

				plannedRouteCheckpoints.forEach(function(checkpoint, index) {
					const reminderM = Number(checkpoint.reminder_m || 0);
					if (reminderM <= 0 || checkpointReminderMarks[index]) return;

					const distanceM = map.distance([lat, lng], [checkpoint.lat, checkpoint.lng]);
					if (distanceM > reminderM) return;

					checkpointReminderMarks[index] = true;
					speakRoute(
						'Dalam ' + roundDistanceMeters(distanceM) + ', ada ' +
							(checkpoint.name || checkpointTypeLabel(checkpoint.type)) + '.',
						false
					);
				});
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

			function plannedRouteDestination() {
				if (
					plannedRouteData &&
					Array.isArray(plannedRouteData.waypoints) &&
					plannedRouteData.waypoints.length > 0
				) {
					const lastWaypoint = plannedRouteData.waypoints[plannedRouteData.waypoints.length - 1];
					if (lastWaypoint) {
						return {
							lat: Number(lastWaypoint.lat !== undefined ? lastWaypoint.lat : lastWaypoint[0]),
							lng: Number(lastWaypoint.lng !== undefined ? lastWaypoint.lng : lastWaypoint[1])
						};
					}
				}

				if (plannedRouteCoords && plannedRouteCoords.length > 0) {
					const lastCoord = plannedRouteCoords[plannedRouteCoords.length - 1];
					return { lat: Number(lastCoord[0]), lng: Number(lastCoord[1]) };
				}

				return null;
			}

			function distanceToDestinationMeters(lat, lng) {
				const destination = plannedRouteDestination();
				if (!destination || isNaN(destination.lat) || isNaN(destination.lng)) return null;
				return map.distance([lat, lng], [destination.lat, destination.lng]);
			}

			function offRouteDiscoveryDetail(lat, lng, distanceM, speedKmh) {
				const now = Date.now();
				const destinationM = distanceToDestinationMeters(lat, lng);

				if (!offRouteState.firstOffAt) offRouteState.firstOffAt = now;
				offRouteState.peakDistanceM = Math.max(offRouteState.peakDistanceM || 0, distanceM);

				const offSeconds = (now - offRouteState.firstOffAt) / 1000;
				const previousDestinationM = offRouteState.lastDestinationM;
				const destinationImproving =
					previousDestinationM === null ||
					destinationM === null ||
					destinationM <= previousDestinationM + 30;
				const movingEnough = Number(speedKmh || 0) >= activityAutoPauseSpeedKmh();
				const looksIntentional =
					movingEnough &&
					offSeconds >= OFF_ROUTE_DISCOVERY_SECONDS &&
					distanceM >= OFF_ROUTE_DISCOVERY_M &&
					destinationImproving;

				offRouteState.lastDestinationM = destinationM;

				return {
					looksIntentional,
					offSeconds,
					destinationM,
					destinationImproving,
					text:
						destinationM !== null
							? 'Tujuan masih ' + roundDistanceMeters(destinationM) + '.'
							: 'Tujuan tetap sama.'
				};
			}

			function autoRerouteAllowedByMode() {
				return isStealthMode && (trackingMode === 'hemat' || trackingMode === 'expedition');
			}

			function maybeControlledAutoReroute(lat, lng, accuracy, speedKmh, distanceM, discovery) {
				if (!isCap || !autoRerouteAllowedByMode() || rerouteInProgress) return false;
				if (!discovery || !discovery.looksIntentional) return false;
				if (autoRerouteCount >= AUTO_REROUTE_MAX_PER_ACTIVITY) return false;

				const now = Date.now();
				if (lastAutoRerouteAt > 0 && now - lastAutoRerouteAt < AUTO_REROUTE_COOLDOWN_MS) return false;

				const config = currentTrackingConfig();
				const maxAccuracy = Math.min(config.accuracyLimit, AUTO_REROUTE_MAX_ACCURACY_M);
				if (Number(accuracy || 999) > maxAccuracy) return false;
				if (Number(speedKmh || 0) < activityAutoPauseSpeedKmh()) return false;
				if (Number(distanceM || 0) < AUTO_REROUTE_M) return false;
				if (Number(discovery.offSeconds || 0) < AUTO_REROUTE_SECONDS) return false;
				if (discovery.destinationM === null || !discovery.destinationImproving) return false;

				if (!offRouteState.autoCandidateAt) offRouteState.autoCandidateAt = now;

				autoRerouteCount += 1;
				lastAutoRerouteAt = now;
				offRouteState.autoCandidateAt = 0;
				rerouteToDestination({
					automatic: true,
					reason: 'stealth-alternative-route'
				});
				return true;
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

			function updateOffRouteStatus(lat, lng, accuracy, speedKmh = 0) {
				if (!rec || !plannedRouteCoords || plannedRouteCoords.length < 2) return;

				const distanceM = distanceToPlannedRouteMeters(lat, lng);
				if (distanceM === null) return;

				const now = Date.now();
				const warnThreshold = Math.max(OFF_ROUTE_WARN_M, Number(accuracy || 0) * 1.5);
				const offThreshold = Math.max(OFF_ROUTE_M, Number(accuracy || 0) * 2);
				const backThreshold = Math.max(BACK_ON_ROUTE_M, Number(accuracy || 0) + 25);
				offRouteState.lastDistance = distanceM;

				if (distanceM >= offThreshold) {
					const discovery = offRouteDiscoveryDetail(lat, lng, distanceM, speedKmh);
					offRouteState.active = true;
					offRouteState.warned = true;
					setPlannedRouteAlertStyle(true);
					setRerouteButtonVisible(true);

					if (discovery.looksIntentional) {
						const autoTriggered = maybeControlledAutoReroute(lat, lng, accuracy, speedKmh, distanceM, discovery);
						if (autoTriggered) {
							setRouteStatus(
								'↻ AUTO REROUTE TERKENDALI',
								'Stealth aktif dan jalur alternatif konsisten. Membuat rute baru ke tujuan yang sama.',
								true
							);
							return;
						}

						setRouteStatus(
							'↻ JALUR ALTERNATIF TERDETEKSI',
							'Kamu sudah keluar sekitar ' + roundDistanceMeters(distanceM) + ' dari rute. ' +
								discovery.text + ' ' +
								(isCap
									? (autoRerouteAllowedByMode()
										? 'Auto reroute aktif jika kondisi tetap konsisten.'
										: 'Tekan REROUTE untuk adaptasi rute ke posisi sekarang.')
									: 'Ikuti jalur aman menuju tujuan.'),
							true
						);

						if (isCap && now - offRouteState.lastDiscoverySpeech > 90000) {
							speakRoute(
								'Sepertinya kamu mengambil jalur lain. Jika jalur ini memang dipilih, tekan reroute untuk membuat rute baru ke tujuan yang sama.',
								true
							);
							offRouteState.lastDiscoverySpeech = now;
							offRouteState.lastWarn = now;
						}

						return;
					}

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
					if (!offRouteState.firstOffAt) offRouteState.firstOffAt = now;
					offRouteState.peakDistanceM = Math.max(offRouteState.peakDistanceM || 0, distanceM);
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
				offRouteState.firstOffAt = 0;
				offRouteState.lastDestinationM = null;
				offRouteState.peakDistanceM = 0;
				offRouteState.autoCandidateAt = 0;
				setPlannedRouteAlertStyle(false);
				setRerouteButtonVisible(false);
			}

			// --- Pemilihan suara ------------------------------------------------
			// Suara TTS tidak disediakan aplikasi ini, melainkan oleh peramban dan
			// sistem operasi, jadi yang bisa diperbaiki adalah cara MEMILIH di
			// antara yang tersedia. Versi lama mengambil suara Indonesia pertama
			// (bisa pria, bisa berkualitas rendah), dan kalau perangkat tidak punya
			// suara Indonesia sama sekali, kata Indonesia tetap dilafalkan memakai
			// suara bawaan peramban yang biasanya Inggris — itulah yang terdengar
			// seperti "aksen jelek".
			//
			// Peringkat dan pemilihannya ada di /assets/voice-picker.js, berkas yang
			// sama juga diuji oleh tests/voice-picker.mjs.
			const navVoicePrefKey = 'gaspool_nav_voice';
			let voicePickerMod = null, voicePickerTried = false, navVoiceChoice = '';

			async function loadVoicePicker() {
				if (voicePickerMod || voicePickerTried) return voicePickerMod;
				voicePickerTried = true;
				try { voicePickerMod = await import('/assets/voice-picker.js'); } catch (e) { voicePickerMod = null; }
				return voicePickerMod;
			}

			function loadVoicePreference() {
				try { navVoiceChoice = localStorage.getItem(navVoicePrefKey) || ''; } catch (e) { navVoiceChoice = ''; }
				return navVoiceChoice;
			}

			function saveVoicePreference(name) {
				navVoiceChoice = name || '';
				try {
					if (navVoiceChoice) localStorage.setItem(navVoicePrefKey, navVoiceChoice);
					else localStorage.removeItem(navVoicePrefKey);
				} catch (e) {}
			}

			function availableVoices() {
				if (!('speechSynthesis' in window)) return [];
				return window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
			}

			function pickIndonesianVoice() {
				const voices = availableVoices();
				if (!voicePickerMod) {
					// Jaring pengaman sebelum modul selesai dimuat: tetap pilih yang
					// berbahasa Indonesia, jangan yang kebetulan pertama.
					return voices.find(v => (v.lang || '').toLowerCase().startsWith('id')) || null;
				}
				return voicePickerMod.pickBestVoice(voices, navVoiceChoice);
			}

			// Ganti ke suara berikutnya yang layak, lalu ucapkan contoh singkat
			// supaya pemakainya bisa langsung mendengar perbedaannya. Tidak ada
			// cara menilai "enak didengar" dari kode — telinga pemakainyalah yang
			// menentukan, jadi pilihan diserahkan kepadanya.
			async function cycleNavVoice() {
				const mod = await loadVoicePicker();
				if (!mod) { setNavVoiceStatus('PILIH SUARA TIDAK TERSEDIA', true); return; }

				const candidates = mod.rankVoices(availableVoices()).filter(mod.isAcceptableVoice);
				if (candidates.length === 0) {
					setNavVoiceStatus('TIDAK ADA SUARA INDONESIA DI PERANGKAT INI', true);
					return;
				}

				const current = mod.pickBestVoice(availableVoices(), navVoiceChoice);
				const index = current ? candidates.findIndex(v => v.name === current.name) : -1;
				const next = candidates[(index + 1) % candidates.length];

				saveVoicePreference(next.name);
				setNavVoiceStatus('SUARA: ' + mod.describeVoice(next));

				// Contoh diucapkan supaya bisa langsung dibandingkan.
				const wasEnabled = routeVoiceEnabled;
				routeVoiceEnabled = true;
				speakRouteNow('Belok kiri dalam tiga ratus meter');
				routeVoiceEnabled = wasEnabled;
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
					// Suara yang sedang dipakai ikut ditampilkan supaya kalau
					// terdengar aneh, pemakainya tahu itu suara mana dan bisa
					// langsung menekan GANTI SUARA.
					const activeVoice = pickIndonesianVoice();
					const voiceNote = voicePickerMod
						? (activeVoice ? ' · ' + voicePickerMod.describeVoice(activeVoice) : ' · TIDAK ADA SUARA INDONESIA')
						: '';
					setNavVoiceStatus((routeVoiceReady ? 'SUARA NAV AKTIF' : 'SUARA NAV SIAP') + voiceNote, Boolean(voicePickerMod) && !activeVoice);
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

				speakRoute(
					'Ulangi instruksi. ' + lastInstructionSpeechText + '. ' +
						(lastRouteEtaSpeechText ? lastRouteEtaSpeechText + '.' : ''),
					true
				);
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

			function updateRouteNavigator(lat, lng, speedKmh = 0) {
				if (!rec || !plannedRouteCoords || plannedRouteCoords.length < 2) return;

				if (!plannedRouteInstructions.length) {
					const etaOnly = routeEtaSummary(lat, lng, speedKmh, 0);
					lastInstructionSpeechText = etaOnly.speech || 'Ikuti rute menuju tujuan';
					lastRouteEtaSpeechText = etaOnly.speech || '';
					updateNavVoiceControls();
					setRouteStatus(
						'🧭 SISA ' + (etaOnly.remainingM !== null ? roundDistanceMeters(etaOnly.remainingM) : 'RUTE'),
						etaOnly.detail || 'Ikuti garis biru menuju tujuan.'
					);
					return;
				}

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
					const eta = routeEtaSummary(lat, lng, speedKmh, distM);
					lastInstructionSpeechText = phrase;
					lastRouteEtaSpeechText = eta.speech || '';
					updateNavVoiceControls();
					setRouteStatus('🧭 NEXT ' + roundDistanceMeters(distM), phrase + (eta.detail ? ' • ' + eta.detail : ''));

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
					const eta = routeEtaSummary(lat, lng, speedKmh, 0);
					lastRouteEtaSpeechText = eta.speech || '';
					setRouteStatus('🧭 RUTE SELESAI', eta.detail || 'Semua arahan route plan sudah dilewati.');
				}
			}

			function applyPlannedRoute(route) {
				plannedRouteData = route.data;
				plannedRouteInstructions = Array.isArray(plannedRouteData.instructions) ? plannedRouteData.instructions : [];
				plannedRouteCheckpoints = normalizeCheckpointList(plannedRouteData.checkpoints);
				checkpointReminderMarks = {};
				const coords = normalizeRouteCoords(plannedRouteData.coordinates);
				plannedRouteCoords = coords;
				plannedRouteCumulativeM = buildRouteCumulativeMeters(coords);
				routeNextInstructionIndex = 0;
				routeInstructionMarks = {};
				lastRouteEtaSpeechText = '';
				offRouteState = {
					active: false,
					warned: false,
					lastWarn: 0,
					lastDistance: null,
					firstOffAt: 0,
					lastDiscoverySpeech: 0,
					lastDestinationM: null,
					peakDistanceM: 0,
					autoCandidateAt: 0
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
				drawCheckpointMarkers();
				line.bringToFront();
				marker.bringToFront();

				const routeName = route.name || plannedRouteData.name || 'Route Plan';
				const routeDistance = Number(route.distance || plannedRouteData.distance_km || 0).toFixed(1);
				setRouteStatus(
					'🧭 ' + routeName,
					routeDistance + ' KM • ' + plannedRouteInstructions.length + ' arahan • ' + plannedRouteCheckpoints.length + ' checkpoint'
				);
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
					saveOfflineRoutePack(payload.route);
					await publishPeletonRoute(activePlannedRouteId);

					setTimeout(() => {
						map.fitBounds(plannedRouteLine.getBounds(), { padding: [35, 35] });
					}, 200);
				} catch (err) {
					console.warn('Gagal memuat route plan:', err);
					const offlineRoute = loadOfflineRoutePack(activePlannedRouteId);
					if (offlineRoute) {
						applyPlannedRoute(offlineRoute);
						setRouteStatus('🧭 OFFLINE ROUTE PACK', 'Rute dimuat dari perangkat. Peta dasar mungkin terbatas.');
						return;
					}
					if (roomID !== "SINGLE_MODE") {
						await loadPeletonRoute(true);
						return;
					}
					setRouteStatus('🧭 RUTE PLAN GAGAL DIMUAT', 'Tracking tetap bisa berjalan normal.', true);
				}
			}

			async function publishPeletonRoute(routeId) {
				if (!isCap || roomID === "SINGLE_MODE" || !routeId) return;

				try {
					const res = await fetch('/api/peleton_route', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							room: roomID,
							route_id: Number(routeId)
						})
					});
					const payload = await res.json().catch(() => ({}));

					if (res.ok && payload.success && payload.peleton_route) {
						peletonRouteVersion = Number(payload.peleton_route.version || peletonRouteVersion || 1);
					}
				} catch (err) {
					console.warn('Gagal publish rute peleton:', err);
				}
			}

			async function loadPeletonRoute(silent = false) {
				if (roomID === "SINGLE_MODE") return;

				try {
					const res = await fetch('/api/peleton_route/' + encodeURIComponent(roomID), {
						cache: 'no-store'
					});
					const payload = await res.json();

					if (!res.ok || !payload.success) throw new Error(payload.message || 'Rute peleton gagal dimuat.');

					if (!payload.route || !payload.peleton_route) {
						if (!silent && !activePlannedRouteId) {
							setRouteStatus('🧭 RUTE PELETON BELUM ADA', 'Menunggu kapten publish route plan.');
						}
						return;
					}

					const nextVersion = Number(payload.peleton_route.version || 0);
					const nextRouteId = String(payload.peleton_route.route_id || payload.route.id || '');
					const changed = nextVersion !== peletonRouteVersion || nextRouteId !== String(activePlannedRouteId || '');

					if (!changed) return;

					activePlannedRouteId = nextRouteId;
					peletonRouteVersion = nextVersion;
					applyPlannedRoute(payload.route);
					saveOfflineRoutePack(payload.route);

					if (!silent && !isCap) {
						speakRoute('Rute peleton diperbarui oleh kapten.', true);
					}
				} catch (err) {
					const offlineRoute = loadOfflineRoutePack(activePlannedRouteId);
					if (offlineRoute) {
						applyPlannedRoute(offlineRoute);
						if (!silent) setRouteStatus('🧭 OFFLINE ROUTE PACK', 'Memakai pack rute terakhir di perangkat.');
						return;
					}
					if (!silent) {
						console.warn('Gagal memuat rute peleton:', err);
						setRouteStatus('🧭 RUTE PELETON GAGAL', 'Tracking tetap bisa berjalan normal.', true);
					}
				}
			}

			async function rerouteToDestination(options = {}) {
				if (rerouteInProgress) return;

				const automatic = Boolean(options && options.automatic);
				const btn = document.getElementById('btn-reroute');
				const destination = plannedRouteDestination();

				if (!latestPosition || !destination) {
					setRouteStatus('↻ REROUTE BELUM SIAP', 'GPS atau tujuan rute belum tersedia.', true);
					return;
				}

				rerouteInProgress = true;
				if (btn) {
					btn.disabled = true;
					btn.innerText = automatic ? 'AUTO...' : '...';
				}
				setRouteStatus(
					automatic ? '↻ AUTO REROUTE' : '↻ MEMBUAT RUTE BARU',
					'Tujuan tetap sama, start memakai posisi GPS sekarang.'
				);
				speakRoute(
					automatic
						? 'Kamu konsisten mengambil jalur lain. Gaspool membuat rute baru ke tujuan yang sama.'
						: 'Membuat rute baru ke tujuan yang sama.',
					true
				);

				try {
					const res = await fetch('/api/route_plan', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							name: (automatic ? 'Auto Reroute - ' : 'Reroute - ') + (plannedRouteData.name || 'Route Plan'),
							profile: plannedRouteData.profile || 'cycling-regular',
							waypoints: [
								{ lat: latestPosition.lat, lng: latestPosition.lng },
								{ lat: Number(destination.lat), lng: Number(destination.lng) }
							]
						})
					});
					const payload = await res.json();

					if (!res.ok || !payload.success || !payload.route || !payload.route.data) {
						throw new Error(payload.message || 'Reroute gagal.');
					}

					activePlannedRouteId = String(payload.route.id || activePlannedRouteId || '');
					applyPlannedRoute(payload.route);
					saveOfflineRoutePack(payload.route);
					await publishPeletonRoute(activePlannedRouteId);
					setRouteStatus(
						automatic ? '↻ AUTO REROUTE SIAP' : '↻ REROUTE SIAP',
						'Route ID #' + activePlannedRouteId + ' menggantikan rute lama.'
					);
					speakRoute(automatic ? 'Auto reroute siap. Lanjutkan perjalanan.' : 'Rute baru siap. Lanjutkan perjalanan.', true);
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

			async function bootRouteSharing() {
				if (activePlannedRouteId) {
					await loadPlannedRoute();
				} else if (roomID !== "SINGLE_MODE") {
					await loadPeletonRoute(false);
				}

				if (roomID !== "SINGLE_MODE" && !isCap) {
					peletonRoutePollInt = setInterval(() => {
						const now = Date.now();
						if (now - lastPeletonRouteCheck < 40000) return;
						lastPeletonRouteCheck = now;
						loadPeletonRoute(true);
					}, 45000);
				}
			}

			bootRouteSharing();
			bootLiveShare();
			// Pilihan suara dimuat lebih dulu supaya pemanggilan pertama sudah
			// menghormati preferensi pemakai, bukan mengambil suara pertama yang
			// kebetulan ada. Kegagalan memuat tidak menghalangi navigasi.
			loadVoicePreference();
			loadVoicePicker().then(updateNavVoiceControls).catch(() => {});
			updateNavVoiceControls();
			updatePrivacyButton();
			updateTrackingModeUI();
			updateStageUI();
			updateNutritionUI();
			updateSignalUI();
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
				}, () => console.log("Menunggu akurasi GPS..."), geolocationOptions());
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
					startT = d.startT || 0;
					startTimezoneOffsetMin = normalizeTimezoneOffset(d.startTimezoneOffsetMin);
					startTimezoneName = normalizeTimezoneName(d.startTimezoneName);
					movingTime = d.movingTime || 0;
					skippedClockGapSeconds = d.skippedClockGapSeconds || 0;
					autoRerouteCount = Number(d.autoRerouteCount || 0);
					lastAutoRerouteAt = Number(d.lastAutoRerouteAt || 0);
					trackingMode = sanitizeTrackingMode(d.trackingMode || trackingMode);
					localStorage.setItem(trackingModeKey, trackingMode);
					updateTrackingModeUI();
					lastAnnouncedKm = d.lastAnnouncedKm || 0;
					tempReadings = d.tempReadings || [];
					lastTempCheck = d.lastTempCheck || 0;
					totalElevation = d.totalElevation || 0;
					lastAlt = d.lastAlt || null;
					tripStages = normalizeTripStages(d.tripStages);
					restBlocks = normalizeRestBlocks(d.restBlocks);
					overnightPause = d.overnightPause && d.overnightPause.active ? d.overnightPause : null;
					nutritionReminderState = normalizeNutritionState(d.nutritionReminderState);
					nutritionReminderEvents = normalizeNutritionEvents(d.nutritionReminderEvents);
					signalLogs = normalizeSignalLogs(d.signalLogs);
					rideIsPublic = Boolean(d.isPublic);
					updatePrivacyButton();
					updateNutritionUI();
					updateSignalUI();
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
						lastPointSavedAt = Date.now();
					} else {
						console.warn("IndexedDB gagal dimuat, rute visual mungkin tidak terlihat tapi pencatatan jalan terus.");
					}

					ensureCurrentStage('resume');
					const overnightPauseStart = overnightPause && overnightPause.paused_at ? Number(overnightPause.paused_at) : 0;
					const overnightRecorded = overnightPauseStart > 0
						? recordRestBlock(overnightPauseStart, Date.now(), 'overnight_pause', 'Sesi dilanjutkan dari Pause Overnight.')
						: false;
					overnightPause = null;
					if (overnightRecorded && dist >= 0.2 && path.length >= 2) {
						beginNextStage('overnight_resume');
						speakRoute('Pause overnight selesai. Etape baru dimulai.', true);
					} else {
						maybeStartResumeStage(d.savedAt);
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

			function discardSession() {
				restartGpsWatch = null;
				if (peletonRoutePollInt) clearInterval(peletonRoutePollInt);
				localStorage.removeItem(key);
				clearDB();
				window.location.reload();
			}

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

			window.addEventListener('offline', function() {
				startSignalEvent('network_offline', 'Koneksi internet hilang. Tracking lokal tetap berjalan.');
			});

			window.addEventListener('online', function() {
				closeSignalEvent('network_offline', 'Koneksi internet kembali online.');
			});

			function mulai(isResume = false) {
				rec = true;
				requestWakeLock();				
				if(!isResume) { 
					startT = Date.now(); path = []; dist = 0; movingTime = 0; lastAnnouncedKm = 0; 
					captureStartTimezone();
					skippedClockGapSeconds = 0;
					// Muat modul akuntansi lalu mulai dari nol. Kegagalan memuat
					// tidak menghalangi gowes: instrumentasi sifatnya tambahan.
					loadLiveClock().then(resetLiveClock).catch(() => {});
					autoRerouteCount = 0;
					lastAutoRerouteAt = 0;
					lastPointSavedAt = 0;
					tripStages = [];
					restBlocks = [];
					overnightPause = null;
					autoPauseStartedAt = 0;
					nutritionReminderState = defaultNutritionState();
					nutritionReminderEvents = [];
					signalLogs = [];
					signalState = {
						gpsErrorStartedAt: 0,
						poorAccuracyStartedAt: 0,
						networkOfflineStartedAt: navigator.onLine ? 0 : Date.now(),
						lastGpsOkAt: 0,
						lastSignalSpeechAt: 0
					};
					tempReadings = []; lastTempCheck = 0; totalElevation = 0; lastAlt = null; clearDB();
				}
				lastTick = Date.now();
				ensureCurrentStage(isResume ? 'resume' : 'start');
				nutritionReminderState = normalizeNutritionState(nutritionReminderState);
				if (!navigator.onLine) {
					startSignalEvent('network_offline', 'Koneksi internet belum tersedia saat tracking dimulai.');
				}
				updateNutritionUI();
				updateSignalUI();
				bootCompactTrackerPanel();
				
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
					// Simpan nilai mentah sebelum dipotong: potongan itulah yang
					// dicatat sebagai waktu yang lewat tetapi tidak dihitung.
					const rawDelta = delta;
					if (delta > REST_CLOCK_GAP_SECONDS) {
						skippedClockGapSeconds += delta;
						if (delta >= REST_BLOCK_MIN_SECONDS) {
							recordRestBlock(
								now - (delta * 1000),
								now,
								'system_gap',
								'Browser atau sistem berhenti lama. Moving time tidak ditambahkan.'
							);
						}
						pushSignalLog(
							'system_gap',
							now - (delta * 1000),
							now,
							'Browser atau sistem sempat berhenti mengirim tick.'
						);
						delta = 0;
					} else {
						const config = currentTrackingConfig();
						const maxDelta = isStealthMode ? config.stealthMaxClockDelta : config.maxClockDelta;
						delta = Math.min(delta, maxDelta);
					}
					
					recordLiveClockSample(rawDelta, !rec || isPaused);

					if (rec && !isPaused) movingTime += delta;
					
					let s = Math.floor(movingTime);
					document.getElementById('val-time').innerText = new Date(s * 1000).toISOString().substr(11, 8);
					updateStageUI();
					updateNutritionReminders();
					
					if (s > 0 && s % 900 === 0 && (s - lastTempCheck > 10)) {
						lastTempCheck = s;
						if (path.length > 0) {
							const p = path[path.length-1];
							recordTemperature(p.lat, p.lng);
						}
					}
				}, 1000);

				function handleGpsPosition(p) {
					const { latitude:lat, longitude:lng, speed, accuracy, altitude } = p.coords;
					const config = currentTrackingConfig();
					if(accuracy > config.accuracyLimit) {
						startSignalEvent(
							'poor_accuracy',
							'Akurasi GPS sedang buruk, titik sementara diabaikan.'
						);
						updateSignalUI();
						return;
					}
					signalState.lastGpsOkAt = Date.now();
					closeSignalEvent('gps_error', 'GPS kembali menerima posisi.');
					closeSignalEvent('poor_accuracy', 'Akurasi GPS kembali masuk batas.');
					
					let speedKmh = (speed || 0) * 3.6;
					const gpsStatus =
  document.getElementById(
    'gps-status'
  );

if (!gpsStatus) return;

					if (speedKmh < activityAutoPauseSpeedKmh()) {

  if (!isPaused && !autoPauseStartedAt) {

    autoPauseStartedAt = Date.now();

  }

  isPaused = true;

  gpsStatus.innerHTML =
    '⏸️ AUTO-PAUSE • ' +
    gpsQuality(accuracy);

  gpsStatus.style.color =
    '#f1c40f';

} else {

  if (autoPauseStartedAt) {

    recordRestBlock(
      autoPauseStartedAt,
      Date.now(),
      'auto_pause',
      'Auto-pause panjang terdeteksi.'
    );
    autoPauseStartedAt = 0;

  }

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
						
						if(d > 0.003 && d < 1.5 && shouldStoreTrackPoint(d, speedKmh)) { 
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
    lastPointSavedAt = Date.now();
    addTrackPointToMap(cur); 
    
} else if (d >= 1.5) {
    console.warn("Lonjakan Sinyal (Blank Spot). Jangkar dipindah, jarak tempuh tidak ditambahkan.");
    
    // TETAP rekam koordinatnya sebagai pijakan baru agar tracker tidak lumpuh
    let pt = { lat, lng, speed: speedKmh, ele: altitude || 0, time: new Date().toISOString() };
    path.push(pt); 
    savePointDB(pt); 
    lastPointSavedAt = Date.now();
    addTrackPointToMap(cur); 
    lastAlt = altitude; // Reset acuan elevasi juga
}
					} else { 
						let pt = { lat, lng, speed: speedKmh, ele: altitude || 0, time: new Date().toISOString() };
						path.push(pt); 
						savePointDB(pt);
						lastPointSavedAt = Date.now();
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
					
					updateRouteNavigator(lat, lng, speedKmh);
					updateOffRouteStatus(lat, lng, accuracy, speedKmh);
					updateCheckpointReminders(lat, lng);

					let currentKm = Math.floor(dist);
					if (currentKm > lastAnnouncedKm && currentKm >= 1 && plannedRouteInstructions.length === 0) {
						lastAnnouncedKm = currentKm;
						let avgSpeedVoice = movingTime > 0 ? (dist / (movingTime / 3600)).toFixed(1) : "0.0";
						speakRoute('Jarak tempuh ' + currentKm + ' kilometer. Kecepatan rata-rata ' + avgSpeedVoice + ' kilometer per jam.', false);
					}

					// Simpan Blackbox (Metadata saja, path di-skip karena sudah masuk IndexedDB)
					let nowTime = Date.now();
					if (nowTime - lastSave > 10000) { 
						persistBlackboxSnapshot(nowTime);
						lastSave = nowTime;
					}
				}

				function handleGpsError(err) {

  console.warn(
    'GPS ERROR',
    err
  );
  startSignalEvent(
    'gps_error',
    'Sinyal GPS hilang. Gaspool menunggu posisi kembali.'
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

}

				function startGpsWatch() {
					watchId = navigator.geolocation.watchPosition(
						handleGpsPosition,
						handleGpsError,
						geolocationOptions()
					);
				}

				restartGpsWatch = startGpsWatch;
				startGpsWatch();


				// --- THROTTLE RADAR SYNC ---
				radarInt = setInterval(() => {
					radarTick += 4;
					const config = currentTrackingConfig();
					let threshold = isStealthMode ? config.stealthRadarSeconds : config.radarSeconds;
					
					// liveRoom kosong berarti tidak ada yang dibagikan: gowes solo
					// sebelum kapten menekan BAGIKAN LIVE, atau setelah dihentikan.
					//
					// Yang dikirim ke server adalah liveRoom, BUKAN roomID. Di gowes
					// solo roomID bernilai tetap "SINGLE_MODE" dan server menolak
					// room itu, jadi mengirim roomID berarti posisi tidak pernah
					// tersimpan dan penonton hanya melihat peta kosong. Di mode
					// Peleton keduanya sama, sehingga satu nilai ini berlaku untuk
					// kedua mode.
					if(radarTick >= threshold && liveRoom && path.length > 0) {
						radarTick = 0;
						const lastP = path[path.length-1];
						fetch('/api/radar_sync', {
							method: 'POST',
							body: JSON.stringify({ room: liveRoom, user: userName, lat: lastP.lat, lng: lastP.lng, speed: lastP.speed || 0 })
						}).then(r => r.json()).then(res => { 
							if(res.participants) syncRadar(res.participants, res.radios); 
							if(!isCap && res.peleton_route && Number(res.peleton_route.version || 0) !== peletonRouteVersion) {
								loadPeletonRoute(true);
							}
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

			function escapeFinishHTML(value) {
				return String(value || '')
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#39;');
			}

			async function readStoredTrackPoints() {
				try {
					await waitDB();
					if (db && db.objectStoreNames.contains(STORE_NAME)) {
						const tx = db.transaction(STORE_NAME, 'readonly');
						return await new Promise(function(resolve, reject) {
							const req = tx.objectStore(STORE_NAME).getAll();
							req.onsuccess = function(e) { resolve(e.target.result || []); };
							req.onerror = function() { reject(new Error('Gagal membaca titik GPS lokal.')); };
						});
					}
				} catch(e) {
					console.warn('Gagal membaca IndexedDB, memakai path memori:', e);
				}

				return path.slice();
			}

			function finishDistanceKm(a, b) {
				try {
					if (map && typeof map.distance === 'function') {
						return map.distance([a.lat, a.lng], [b.lat, b.lng]) / 1000;
					}
				} catch(e) {}

				const rad = Math.PI / 180;
				const lat1 = Number(a.lat) * rad;
				const lat2 = Number(b.lat) * rad;
				const dLat = (Number(b.lat) - Number(a.lat)) * rad;
				const dLng = (Number(b.lng) - Number(a.lng)) * rad;
				const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
					Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
				return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
			}

			function finishSpeedLimitKmh() {
				const activity = '${type}';
				if (activity === 'walk' || activity === 'hike') return 22;
				if (activity === 'run') return 45;
				return 140;
			}

			function finishPointTimeMs(point) {
				const parsed = Date.parse(String(point && point.time ? point.time : ''));
				return Number.isFinite(parsed) ? parsed : 0;
			}

			function normalizeFinishPoint(raw) {
				const source = raw || {};
				let lat = Number(source.lat !== undefined ? source.lat : source.latitude);
				let lng = Number(source.lng !== undefined ? source.lng : (source.lon !== undefined ? source.lon : source.longitude));
				let swapped = false;

				if ((!Number.isFinite(lat) || Math.abs(lat) > 90) && Number.isFinite(lng) && Math.abs(lng) <= 90 && Number.isFinite(lat) && Math.abs(lat) <= 180) {
					const tmp = lat;
					lat = lng;
					lng = tmp;
					swapped = true;
				}

				if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
				if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

				const point = Object.assign({}, source, {
					lat: lat,
					lng: lng,
					speed: Number.isFinite(Number(source.speed)) ? Number(source.speed) : 0,
					ele: Number.isFinite(Number(source.ele !== undefined ? source.ele : source.altitude)) ? Number(source.ele !== undefined ? source.ele : source.altitude) : 0,
					time: source.time ? String(source.time) : new Date().toISOString()
				});

				return { point: point, swapped: swapped };
			}

			function restBlockExists(list, start, end) {
				const safeStart = Number(start || 0);
				const safeEnd = Number(end || 0);
				return normalizeRestBlocks(list).some(function(block) {
					const blockStart = Number(block.start || 0);
					const blockEnd = Number(block.end || 0);
					return Math.abs(blockStart - safeStart) < 60000 ||
						(blockStart <= safeEnd && blockEnd >= safeStart && Math.min(blockEnd, safeEnd) - Math.max(blockStart, safeStart) > 60000);
				});
			}

			function analyzeFinishActivity(rawPoints, existingRestBlocks, currentDuration, currentDistance) {
				const raw = Array.isArray(rawPoints) ? rawPoints : [];
				const issues = [];
				const changes = [];
				const cleaned = [];
				const suggestedRestBlocks = [];
				const speedLimit = finishSpeedLimitKmh();
				let invalid = 0;
				let duplicate = 0;
				let swapped = 0;
				let gpsJumps = 0;
				let suspiciousSpeed = 0;
				let longGaps = 0;
				let repairedDistance = 0;
				let maxSpeed = 0;
				let previous = null;

				raw.forEach(function(item) {
					const normalized = normalizeFinishPoint(item);
					if (!normalized) {
						invalid++;
						return;
					}

					const point = normalized.point;
					if (normalized.swapped) swapped++;

					if (previous && finishDistanceKm(previous, point) < 0.0005) {
						duplicate++;
						return;
					}

					if (previous) {
						const segmentKm = finishDistanceKm(previous, point);
						const prevTime = finishPointTimeMs(previous);
						const thisTime = finishPointTimeMs(point);
						const deltaSeconds = prevTime && thisTime && thisTime > prevTime ? (thisTime - prevTime) / 1000 : 0;
						const segmentSpeed = deltaSeconds > 0 ? segmentKm / (deltaSeconds / 3600) : Number(point.speed || 0);

						if (deltaSeconds >= REST_BLOCK_MIN_SECONDS && !restBlockExists(existingRestBlocks.concat(suggestedRestBlocks), prevTime, thisTime)) {
							longGaps++;
							suggestedRestBlocks.push({
								type: 'finish_review_gap',
								label: 'Jeda panjang terdeteksi saat finish review',
								start: prevTime,
								end: thisTime,
								duration_s: Math.floor(deltaSeconds),
								distance_km: Number((currentDistance || dist || 0).toFixed(3)),
								moving_time: Math.floor(currentDuration || movingTime || 0),
								note: 'Ditambahkan otomatis dari gap timestamp GPS.'
							});
						}

						if (segmentKm >= 1.5) {
							gpsJumps++;
						} else if (segmentSpeed > speedLimit) {
							suspiciousSpeed++;
						} else if (segmentKm > 0.001) {
							repairedDistance += segmentKm;
						}
					}

					maxSpeed = Math.max(maxSpeed, Number(point.speed || 0));
					cleaned.push(point);
					previous = point;
				});

				if (raw.length === 0 || cleaned.length === 0) {
					issues.push({ severity: 'danger', code: 'empty_route', message: 'Titik GPS kosong. Aktivitas belum bisa disimpan aman.', autoFix: false });
				}
				if (invalid > 0) {
					issues.push({ severity: 'warning', code: 'invalid_points', message: invalid + ' titik GPS invalid akan dibuang.', autoFix: true });
					changes.push('Buang ' + invalid + ' titik GPS invalid.');
				}
				if (duplicate > 0) {
					issues.push({ severity: 'warning', code: 'duplicate_points', message: duplicate + ' titik GPS duplikat berurutan terdeteksi.', autoFix: true });
					changes.push('Bersihkan ' + duplicate + ' titik duplikat berurutan.');
				}
				if (swapped > 0) {
					issues.push({ severity: 'warning', code: 'swapped_coordinates', message: swapped + ' titik terlihat memakai urutan lng/lat.', autoFix: true });
					changes.push('Normalisasi koordinat lng/lat menjadi lat/lng.');
				}
				if (gpsJumps > 0) {
					issues.push({ severity: 'warning', code: 'gps_jump', message: gpsJumps + ' lonjakan GPS ekstrem terdeteksi.', autoFix: true });
					changes.push('Hitung ulang jarak dengan lonjakan GPS diabaikan dari statistik.');
				}
				if (suspiciousSpeed > 0) {
					issues.push({ severity: 'warning', code: 'suspicious_speed', message: suspiciousSpeed + ' segmen melebihi batas speed wajar.', autoFix: true });
					changes.push('Hitung ulang jarak dengan segmen speed tidak wajar diabaikan.');
				}
				if (longGaps > 0) {
					issues.push({ severity: 'warning', code: 'long_gap', message: longGaps + ' gap panjang terdeteksi dan bisa jadi rest block.', autoFix: true });
					changes.push('Tambahkan rest block dari gap timestamp panjang.');
				}
				if (skippedClockGapSeconds > 0) {
					issues.push({ severity: 'info', code: 'clock_gap', message: 'Ada ' + formatStageDuration(skippedClockGapSeconds) + ' system gap yang sudah diabaikan dari moving time.', autoFix: false });
				}

				// Ke mana perginya waktu selama gowes. Ditampilkan apa adanya supaya
				// selisih antara jam di layar dan statistik setelah repair bisa
				// dijelaskan dengan angka, bukan ditebak.
				const clockSummary = liveClockSummary();
				if (clockSummary && clockSummary.uncounted >= 1) {
					const parts = [];
					if (clockSummary.clamped >= 1) parts.push(formatStageDuration(clockSummary.clamped) + ' dari tick yang terlambat');
					if (clockSummary.dropped >= 1) parts.push(formatStageDuration(clockSummary.dropped) + ' dari sistem berhenti');
					issues.push({
						severity: clockSummary.uncounted >= 60 ? 'warning' : 'info',
						code: 'live_clock_gap',
						message: formatStageDuration(clockSummary.uncounted) + ' waktu tidak dihitung sebagai bergerak (' + parts.join(', ') + ').',
						autoFix: false
					});
				}
				if (cleaned.length > 0 && currentDistance > 0 && repairedDistance > 0) {
					const delta = Math.abs(repairedDistance - Number(currentDistance || 0));
					if (delta > Math.max(0.25, Number(currentDistance || 0) * 0.08)) {
						issues.push({ severity: 'warning', code: 'distance_mismatch', message: 'Jarak live berbeda dari hasil hitung ulang sekitar ' + delta.toFixed(2) + ' km.', autoFix: true });
						changes.push('Pakai jarak hasil hitung ulang: ' + repairedDistance.toFixed(2) + ' km.');
					}
				}

				const hasDanger = issues.some(function(issue) { return issue.severity === 'danger'; });
				const canAutoRepair = !hasDanger && issues.some(function(issue) { return issue.autoFix; });
				const currentAvg = currentDuration > 0 && currentDistance > 0 ? currentDistance / (currentDuration / 3600) : 0;
				const repairedAvg = currentDuration > 0 && repairedDistance > 0 ? repairedDistance / (currentDuration / 3600) : currentAvg;

				return {
					healthy: issues.filter(function(issue) { return issue.severity !== 'info'; }).length === 0,
					hasDanger: hasDanger,
					canAutoRepair: canAutoRepair,
					issues: issues,
					changes: changes,
					cleanedPoints: cleaned,
					suggestedRestBlocks: normalizeRestBlocks(suggestedRestBlocks),
					counts: {
						raw: raw.length,
						valid: cleaned.length,
						invalid: invalid,
						duplicate: duplicate,
						swapped: swapped,
						gps_jumps: gpsJumps,
						suspicious_speed: suspiciousSpeed,
						long_gaps: longGaps
					},
					currentStats: {
						distance_km: Number(Number(currentDistance || 0).toFixed(3)),
						moving_time: Math.floor(currentDuration || 0),
						avg_speed: Number(currentAvg.toFixed(2)),
						max_speed: Number(maxSpeed.toFixed(2))
					},
					repairedStats: {
						distance_km: Number(Math.max(0, repairedDistance).toFixed(3)),
						moving_time: Math.floor(currentDuration || 0),
						avg_speed: Number(repairedAvg.toFixed(2)),
						max_speed: Number(maxSpeed.toFixed(2))
					}
				};
			}

			function mergeFinishRestBlocks(base, additions) {
				let merged = normalizeRestBlocks(base);
				normalizeRestBlocks(additions).forEach(function(block) {
					if (!restBlockExists(merged, block.start, block.end || block.start + block.duration_s * 1000)) {
						merged.push(block);
					}
				});
				return normalizeRestBlocks(merged);
			}

			function renderFinishRows(id, rows, emptyText) {
				const box = document.getElementById(id);
				if (!box) return;
				const list = Array.isArray(rows) ? rows : [];
				if (list.length === 0) {
					box.innerHTML = '<div class="finish-row info">' + escapeFinishHTML(emptyText || 'Tidak ada catatan.') + '</div>';
					return;
				}
				box.innerHTML = list.map(function(row) {
					const severity = row.severity || 'info';
					const text = row.message || row;
					return '<div class="finish-row ' + escapeFinishHTML(severity) + '">' + escapeFinishHTML(text) + '</div>';
				}).join('');
			}

			// Jam ringkas untuk tabel perbandingan: 1:09:05, bukan "1 jam 9 menit".
			// Detik ikut ditampilkan karena justru detik yang dipertanyakan
			// ketika moving time live dan hasil hitung ulang berbeda.
			function formatDiffClock(seconds) {
				const total = Math.max(0, Math.floor(Number(seconds || 0)));
				const hours = Math.floor(total / 3600);
				const minutes = Math.floor((total % 3600) / 60);
				const secs = total % 60;
				return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
			}

			// Tabel SEBELUM -> SESUDAH. Semua angka yang dipakai tombol
			// "AUTO REPAIR & SAVE" ditampilkan lebih dulu, supaya keputusan
			// diambil dengan angka, bukan tebakan. Baris yang tidak berubah
			// tetap ditampilkan (redup) — kalau disembunyikan, orang akan
			// mengira angkanya tidak pernah diperiksa.
			function renderFinishDiff(doctor) {
				const box = document.getElementById('finish-diff');
				if (!box) return;
				const before = doctor.currentStats || {};
				const after = doctor.repairedStats || {};

				const rows = [
					{
						label: 'Jarak',
						before: Number(before.distance_km || 0).toFixed(3) + ' km',
						after: Number(after.distance_km || 0).toFixed(3) + ' km',
						delta: (Number(after.distance_km || 0) - Number(before.distance_km || 0)).toFixed(3) + ' km'
					},
					{
						label: 'Moving Time',
						before: formatDiffClock(before.moving_time),
						after: formatDiffClock(after.moving_time),
						delta: (Number(after.moving_time || 0) - Number(before.moving_time || 0)) + ' detik'
					},
					{
						label: 'Average Speed',
						before: Number(before.avg_speed || 0).toFixed(2) + ' km/h',
						after: Number(after.avg_speed || 0).toFixed(2) + ' km/h',
						delta: (Number(after.avg_speed || 0) - Number(before.avg_speed || 0)).toFixed(2) + ' km/h'
					},
					{
						label: 'Max Speed',
						before: Number(before.max_speed || 0).toFixed(2) + ' km/h',
						after: Number(after.max_speed || 0).toFixed(2) + ' km/h',
						delta: (Number(after.max_speed || 0) - Number(before.max_speed || 0)).toFixed(2) + ' km/h'
					}
				];

				let changed = 0;
				// Dibandingkan lewat teks yang benar-benar tampil, bukan lewat
				// angka mentah, supaya selisih yang tidak terlihat mata tidak
				// ikut menyalakan tanda "berubah".
				const body = rows.map(function(row) {
					const isChanged = row.before !== row.after;
					if (isChanged) changed++;
					const deltaText = isChanged
						? '<div class="finish-diff-delta">' + escapeFinishHTML(row.delta) + '</div>'
						: '';
					return '<div class="finish-diff-row ' + (isChanged ? 'changed' : 'same') + '">' +
						'<div class="finish-diff-name">' + escapeFinishHTML(row.label) + '</div>' +
						'<div class="finish-diff-from">' + escapeFinishHTML(row.before) + '</div>' +
						'<div><div class="finish-diff-to">' + escapeFinishHTML(row.after) + '</div>' + deltaText + '</div>' +
					'</div>';
				}).join('');

				box.innerHTML =
					'<div class="finish-diff-head"><span>Aspek</span><span>Live</span><span>Setelah diperbaiki</span></div>' +
					body;

				const movingRow = rows[1];
				const movingUntouched = movingRow.before === movingRow.after;
				const applicable = Boolean(doctor.canAutoRepair);
				const parts = [];

				if (!applicable) {
					// Jangan pernah bilang "akan berubah" untuk usulan yang tidak
					// bisa diterapkan: tombolnya memang akan menyimpan angka live.
					// Kolom kanan tetap ditampilkan, tetapi sebagai informasi saja.
					parts.push('Perbaikan otomatis tidak tersedia untuk aktivitas ini, jadi tombol apa pun akan menyimpan angka live (kolom kiri).');
					if (changed > 0) {
						parts.push('Kolom kanan hanya usulan Activity Doctor, bukan yang akan tersimpan.');
					}
				} else if (changed > 0) {
					parts.push('<b>' + changed + '</b> dari ' + rows.length + ' angka akan berubah kalau kamu pilih AUTO REPAIR & SAVE.');
				} else {
					parts.push('Tidak ada angka yang berubah. SAVE FINAL dan AUTO REPAIR & SAVE akan menghasilkan statistik yang sama.');
				}

				if (movingUntouched) {
					parts.push('Moving Time belum dihitung ulang oleh perbaikan ini — nilainya masih jam live yang berjalan di layar.');
				}

				const note = document.getElementById('finish-diff-note');
				if (note) note.innerHTML = parts.join(' ');

				const pill = document.getElementById('finish-diff-status');
				if (pill) {
					if (!applicable) {
						pill.className = 'doctor-pill warn';
						pill.innerText = 'USULAN SAJA';
					} else if (changed > 0) {
						pill.className = 'doctor-pill warn';
						pill.innerText = changed + ' BERUBAH';
					} else {
						pill.className = 'doctor-pill';
						pill.innerText = 'TIDAK BERUBAH';
					}
				}
			}

			function renderFinishReview(state) {
				const doctor = state.doctor;
				const finalRest = state.base.rest_blocks || [];
				const finalSignals = state.base.signal_logs || [];
				const avg = state.base.duration > 0 && state.base.distance > 0 ? state.base.distance / (state.base.duration / 3600) : 0;
				const status = document.getElementById('finish-status');
				const repairStatus = document.getElementById('finish-repair-status');
				const copy = document.getElementById('finish-copy');

				setText('finish-distance', Number(state.base.distance || 0).toFixed(2) + ' km');
				setText('finish-moving', formatResumeDuration(state.base.duration || 0));
				setText('finish-avg', avg.toFixed(1) + ' km/h');
				setText('finish-points', doctor.counts.valid + ' / ' + doctor.counts.raw + ' titik');
				setText('finish-stages', (state.base.stages || []).length + ' etape');
				setText('finish-rest', finalRest.length + ' rest');
				setText('finish-signal', finalSignals.length + ' log');
				setText('finish-privacy', state.base.is_public ? 'PUBLIC' : 'PRIVATE');

				if (doctor.hasDanger) {
					status.className = 'doctor-pill danger';
					status.innerText = 'NEEDS ATTENTION';
					copy.innerText = 'Ada masalah yang tidak aman untuk auto-save. Cek catatan di bawah sebelum melanjutkan.';
				} else if (doctor.canAutoRepair) {
					status.className = 'doctor-pill warn';
					status.innerText = 'REPAIRABLE';
					copy.innerText = 'Gaspool menemukan hal kecil yang bisa diperbaiki otomatis sebelum data dikirim.';
				} else {
					status.className = 'doctor-pill';
					status.innerText = 'HEALTHY';
					copy.innerText = 'Data terlihat sehat. Aktivitas siap disimpan final.';
				}

				if (repairStatus) {
					repairStatus.className = doctor.canAutoRepair ? 'doctor-pill warn' : 'doctor-pill';
					repairStatus.innerText = doctor.canAutoRepair ? 'READY' : 'NONE';
				}

				renderFinishRows('finish-issues', doctor.issues, 'Tidak ada masalah besar.');
				renderFinishRows('finish-changes', doctor.changes.map(function(change) { return { severity: 'info', message: change }; }), 'Tidak perlu auto repair.');
				renderFinishDiff(doctor);
				setFinishReviewButtons(false);
			}

			function setFinishReviewButtons(busy) {
				finishReviewBusy = busy;
				const doctor = finishReviewState ? finishReviewState.doctor : null;
				const saveBtn = document.getElementById('finish-save-btn');
				const repairBtn = document.getElementById('finish-repair-btn');
				const continueBtn = document.getElementById('finish-continue-btn');
				const discardBtn = document.getElementById('finish-discard-btn');
				const noPoints = doctor ? doctor.counts.valid === 0 : true;

				if (saveBtn) {
					saveBtn.disabled = busy || noPoints;
					saveBtn.innerText = busy ? 'MENYIMPAN...' : 'SAVE FINAL';
				}
				if (repairBtn) {
					repairBtn.disabled = busy || !doctor || !doctor.canAutoRepair || noPoints;
					repairBtn.innerText = busy ? 'MENYIMPAN...' : 'AUTO REPAIR & SAVE';
				}
				if (continueBtn) continueBtn.disabled = busy;
				if (discardBtn) discardBtn.disabled = busy;
			}

			async function prepareFinishReviewState() {
				const finishedAt = Date.now();
				const dur = Math.floor(movingTime);

				if (autoPauseStartedAt) {
					recordRestBlock(autoPauseStartedAt, finishedAt, 'auto_pause', 'Auto-pause masih aktif saat finish.');
					autoPauseStartedAt = 0;
				}

				closeCurrentStage('finish_review');
				const finalTripStages = serializeTripStages(true);
				const finalRestBlocks = serializeRestBlocks();
				closeSignalEvent('network_offline', 'Aktivitas masuk Finish Review.');
				closeSignalEvent('gps_error', 'Aktivitas masuk Finish Review.');
				closeSignalEvent('poor_accuracy', 'Aktivitas masuk Finish Review.');
				const finalSignalLogs = serializeSignalLogs(true);
				const finalNutritionSummary = serializeNutritionSummary();
				// Ringkasan jam live, dikirim bersama aktivitas. Null berarti
				// instrumentasi tidak sempat dimuat — dan itu dicatat apa adanya,
				// bukan diganti angka nol yang bisa disalahartikan sebagai "tidak
				// ada waktu yang hilang".
				const liveClockFinalSummary = liveClockSummary();
				const finalLiveClock = liveClockFinalSummary
					? Object.assign(
						{ uncounted_seconds: liveClockFinalSummary.uncounted, balance_seconds: liveClockFinalSummary.balance },
						liveClockMod.serializeLiveClockAccounting(liveClockAcc),
					)
					: null;
				const finalTimeContext = activityTimeContext(finishedAt);

				if (path.length > 0) await recordTemperature(path[path.length - 1].lat, path[path.length - 1].lng);
				let finalAvgTemp = 0;
				if (tempReadings.length > 0) {
					const sum = tempReadings.reduce(function(a, b) { return a + b; }, 0);
					finalAvgTemp = sum / tempReadings.length;
				}

				const storedPoints = await readStoredTrackPoints();
				const rawPoints = Array.isArray(storedPoints) && storedPoints.length > 0 ? storedPoints : path.slice();
				const doctor = analyzeFinishActivity(rawPoints, finalRestBlocks, dur, dist);
				const rideUUID = Date.now() + '_' + Math.floor(Math.random() * 1000);

				return {
					prepared_at: new Date(finishedAt).toISOString(),
					rideUUID: rideUUID,
					rawPoints: rawPoints,
					doctor: doctor,
					base: {
						name: '${type.toUpperCase()} ' + formatDateWithTimezoneOffset(startT, finalTimeContext.start_timezone_offset_min),
						distance: Number(dist || 0),
						duration: dur,
						// Max speed dari titik yang benar-benar disimpan. Sebelum
						// ini nilainya tidak pernah ikut dikirim, sehingga setiap
						// aktivitas tersimpan punya max_speed 0 di D1 dan di R2,
						// padahal Finish Review sudah menghitungnya.
						max_speed: Number(Number(doctor.currentStats.max_speed || 0).toFixed(2)),
						activity_type: '${type}',
						start_date: finalTimeContext.start_date,
						finish_date: finalTimeContext.finish_date,
						start_timezone_offset_min: finalTimeContext.start_timezone_offset_min,
						finish_timezone_offset_min: finalTimeContext.finish_timezone_offset_min,
						start_timezone_name: finalTimeContext.start_timezone_name,
						finish_timezone_name: finalTimeContext.finish_timezone_name,
						room: roomID,
						planned_route_id: activePlannedRouteId ? Number(activePlannedRouteId) : null,
						is_public: rideIsPublic ? 1 : 0,
						avg_temp: finalAvgTemp,
						total_elevation: Math.round(totalElevation),
						skipped_clock_gap_seconds: Math.floor(skippedClockGapSeconds || 0),
						// Bukti ke mana waktu pergi selama gowes berjalan: potongan
						// dari tick yang terlambat dan gap sistem. Disimpan apa adanya
						// supaya selisih jam live vs hasil repair bisa dibuktikan
						// dengan angka, bukan dugaan.
						live_clock: finalLiveClock,
						stages: finalTripStages,
						rest_blocks: finalRestBlocks,
						nutrition_summary: finalNutritionSummary,
						signal_logs: finalSignalLogs
					}
				};
			}

			function buildFinishPayloads(useAutoRepair) {
				const state = finishReviewState;
				if (!state) throw new Error('Finish Review belum siap.');

				const doctor = state.doctor;
				const repaired = Boolean(useAutoRepair && doctor.canAutoRepair);
				const points = repaired ? doctor.cleanedPoints : state.rawPoints;
				const distanceValue = repaired && doctor.repairedStats.distance_km > 0
					? doctor.repairedStats.distance_km
					: state.base.distance;
				const restBlocksValue = repaired
					? mergeFinishRestBlocks(state.base.rest_blocks, doctor.suggestedRestBlocks)
					: normalizeRestBlocks(state.base.rest_blocks);
				const finishReviewMeta = {
					status: doctor.hasDanger ? 'needs_attention' : (doctor.canAutoRepair ? 'repairable' : 'healthy'),
					auto_repair_applied: repaired,
					generated_at: state.prepared_at,
					counts: doctor.counts,
					issues: doctor.issues.slice(0, 30).map(function(issue) {
						return {
							severity: issue.severity,
							code: issue.code,
							message: issue.message,
							auto_fix: Boolean(issue.autoFix)
						};
					}),
					changes: doctor.changes.slice(0, 30),
					// Kontrak yang jelas: stats_before = angka live, stats_after =
					// USULAN perbaikan. Dulu stats_after diisi angka live ketika
					// tombol "SAVE FINAL" yang dipilih, sehingga catatan aktivitas
					// selalu tampak "tidak ada yang berubah" dan usulan perbaikan
					// yang ditolak hilang tanpa jejak. Apakah usulan itu dipakai
					// dijawab oleh auto_repair_applied.
					stats_before: doctor.currentStats,
					stats_after: doctor.repairedStats
				};

				const CHUNK_SIZE = 500;
				const totalChunks = Math.max(1, Math.ceil(points.length / CHUNK_SIZE));
				const payloads = [];

				for (let i = 0; i < totalChunks; i++) {
					const payload = Object.assign({}, state.base, {
						uuid: state.rideUUID,
						chunk_index: i,
						total_chunks: totalChunks,
						points: points.slice(i * CHUNK_SIZE, (i * CHUNK_SIZE) + CHUNK_SIZE),
						distance: distanceValue,
						rest_blocks: restBlocksValue,
						finish_review: finishReviewMeta,
						source: repaired ? 'GASPOOL_FINISH_REVIEW_REPAIRED' : 'GASPOOL_FINISH_REVIEW'
					});
					payloads.push(payload);
				}

				return payloads;
			}

			async function uploadFinishPayloads(payloads) {
				let uploadSuccess = true;

				if (navigator.onLine) {
					for (let i = 0; i < payloads.length; i++) {
						try {
							const res = await fetch('/api/save_ride', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(payloads[i])
							});
							if (!res.ok) uploadSuccess = false;
						} catch(err) {
							uploadSuccess = false;
						}
					}
				} else {
					uploadSuccess = false;
				}

				await cleanupPeletonAudio();

				if (uploadSuccess) {
					localStorage.removeItem(key);
					clearDB();
					window.location.href = '/';
					return;
				}

				try {
					await waitDB();
					if (!db || !db.objectStoreNames.contains(BUNKER_STORE)) throw new Error('Bunker store tidak tersedia.');
					const txBunker = db.transaction(BUNKER_STORE, 'readwrite');
					txBunker.objectStore(BUNKER_STORE).put({ id: payloads[0].uuid, payloads: payloads, time: Date.now() });
					alert('Sinyal terputus! Data diamankan di Brankas Bunker dan akan diunggah otomatis saat internet kembali.');
					localStorage.removeItem(key);
					clearDB();
					window.location.href = '/';
				} catch(e) {
					setFinishReviewButtons(false);
					alert('Upload gagal dan Bunker tidak tersedia. Jangan tutup aplikasi. Coba SAVE FINAL lagi saat sinyal kembali.');
					throw e;
				}
			}

			async function saveFinishReview(useAutoRepair) {
				if (finishReviewBusy || !finishReviewState) return;
				const doctor = finishReviewState.doctor;

				if (doctor.counts.valid === 0) {
					alert('Titik GPS kosong. Aktivitas tidak bisa disimpan.');
					return;
				}
				if (useAutoRepair && !doctor.canAutoRepair) {
					alert('Tidak ada auto repair aman untuk diterapkan.');
					return;
				}
				if (!useAutoRepair && doctor.hasDanger && !confirm('Data punya warning berat. Simpan apa adanya?')) {
					return;
				}

				setFinishReviewButtons(true);
				try {
					await uploadFinishPayloads(buildFinishPayloads(useAutoRepair));
				} catch(e) {
					console.warn('Finish save gagal:', e);
				}
			}

			function reopenStageAfterFinishReview() {
				tripStages = normalizeTripStages(tripStages);
				const last = tripStages[tripStages.length - 1];
				if (last && last.reason === 'finish_review') {
					last.reason = 'resume_after_review';
					last.end_time = '';
					last.end_distance_km = null;
					last.end_moving_time = null;
					last.end_point_index = null;
				}
			}

			function resumeFromFinishReview() {
				if (finishReviewBusy) return;
				document.getElementById('finishReview').style.display = 'none';
				finishReviewState = null;
				finishReviewBusy = false;
				reopenStageAfterFinishReview();
				isPaused = false;
				const stopBtn = document.getElementById('btn-stop');
				if (stopBtn) {
					stopBtn.innerText = '⬜ TERMINATE & SAVE';
					stopBtn.disabled = false;
				}
				mulai(true);
			}

			async function discardFinishReview() {
				if (finishReviewBusy) return;
				if (!confirm('Buang aktivitas ini dan hapus data lokal?')) return;
				finishReviewBusy = true;
				await cleanupPeletonAudio();
				localStorage.removeItem(key);
				clearDB();
				window.location.href = '/';
			}

			async function selesai() {
				if (isStealthMode) disableStealth();
				stopLiveEngines();

				const dur = Math.floor(movingTime);

				if (!isCap) {
					if (autoPauseStartedAt) {
						recordRestBlock(autoPauseStartedAt, Date.now(), 'auto_pause', 'Auto-pause masih aktif saat finish.');
						autoPauseStartedAt = 0;
					}
					closeCurrentStage('finish');
					document.getElementById('fin-dist').innerText = dist.toFixed(2);
					document.getElementById('fin-time').innerText = document.getElementById('val-time').innerText;
					document.getElementById('fin-spd').innerText = (dist / (dur / 3600) || 0).toFixed(1);
					document.getElementById('guestFinish').style.display = 'flex';
					localStorage.removeItem(key);
					clearDB();
					return;
				}

				const stopBtn = document.getElementById('btn-stop');
				if (stopBtn) {
					stopBtn.innerText = 'MENGECEK DATA...';
					stopBtn.disabled = true;
				}

				try {
					finishReviewState = await prepareFinishReviewState();
					renderFinishReview(finishReviewState);
					document.getElementById('finishReview').style.display = 'block';
				} catch(e) {
					console.error('Finish Review gagal:', e);
					alert('Finish Review gagal disiapkan. Tracking akan dilanjutkan agar data tidak hilang.');
					resumeFromFinishReview();
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
					rec = false;
					restartGpsWatch = null;
					if (watchId) navigator.geolocation.clearWatch(watchId);
					if (radarInt) clearInterval(radarInt);
					if (clockInt) clearInterval(clockInt);
					if (peletonRoutePollInt) clearInterval(peletonRoutePollInt);
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

			function liveShareUrl() {
				return window.location.origin + '/radar/' + liveRoom;
			}

			function updateLiveShareUI() {
				const panel = document.getElementById('live-panel');
				if (!panel) return;

				if (!liveRoom) {
					panel.style.display = 'none';
					return;
				}

				panel.style.display = 'block';
				const label = document.getElementById('live-label');
				const link = document.getElementById('live-link');
				const dot = document.getElementById('live-dot');
				if (label) label.textContent = isPeletonMode ? 'LIVE PELETON' : 'LIVE — LOKASI DIBAGIKAN';
				if (link) link.textContent = liveShareUrl();
				if (dot) dot.classList.remove('is-off');
			}

			// Ruang siaran dibuat saat tombol ditekan, bukan saat halaman dibuka.
			// Menyiarkan lokasi harus selalu hasil tindakan yang disadari, bukan
			// efek samping membuka halaman.
			async function ensureLiveRoom() {
				if (liveRoom) return liveRoom;

				// Link yang tadinya sudah dibagikan dipakai kembali kalau masih segar,
				// supaya reload halaman tidak mematikan link yang sudah dikirim ke rekan.
				if (resumableLiveRoom) {
					liveRoom = resumableLiveRoom;
					resumableLiveRoom = '';
					updateLiveShareUI();
					return liveRoom;
				}

				// Nama ikut dikirim supaya halaman penonton bisa menyapa "sedang
				// gowes siapa", bukan hanya menampilkan titik di peta.
				const res = await fetch('/api/live_start', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ user: userName })
				});
				const data = await res.json();
				if (!data || !data.success || !data.token) throw new Error('live_start failed');

				liveRoom = data.token;
				rememberLiveRoom(liveRoom);
				updateLiveShareUI();
				return liveRoom;
			}

			function rememberLiveRoom(token) {
				try { localStorage.setItem(liveShareKey, JSON.stringify({ token: token, at: Date.now() })); } catch (e) {}
			}

			function forgetLiveRoom() {
				try { localStorage.removeItem(liveShareKey); } catch (e) {}
			}

			async function shareLive() {
				try {
					await ensureLiveRoom();
				} catch (e) {
					setRouteStatus('📡 LINK GAGAL DIBUAT', 'Siaran tidak dimulai. Cek koneksi lalu coba lagi.', true);
					return;
				}

				const intro = isPeletonMode
					? 'Pantau pergerakan gowes peleton secara live di sini:'
					: 'Pantau pergerakan gowes saya secara live di sini:';
				const text = intro + '\\n' + liveShareUrl();
				window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
			}

			async function copyLiveLink() {
				if (!liveRoom) return;

				try {
					await navigator.clipboard.writeText(liveShareUrl());
					setRouteStatus('📡 LINK DISALIN', liveShareUrl());
				} catch (e) {
					// Clipboard butuh konteks aman dan izin; kalau ditolak, link
					// ditampilkan supaya masih bisa disalin manual.
					setRouteStatus('📡 SALIN MANUAL', liveShareUrl());
				}
			}

			function stopLiveShare() {
				liveRoom = '';
				resumableLiveRoom = '';
				forgetLiveRoom();
				updateLiveShareUI();
				setRouteStatus('📡 SIARAN DIHENTIKAN', 'Lokasi tidak lagi dibagikan.');
			}

			// Dipanggil sekali saat halaman siap. Sengaja TIDAK langsung menyiarkan:
			// hanya menyiapkan token agar link lama bisa dipakai lagi kalau kapten
			// menekan tombol bagikan.
			function bootLiveShare() {
				if (!isPeletonMode) {
					try {
						const raw = localStorage.getItem(liveShareKey);
						if (raw) {
							const saved = JSON.parse(raw);
							const fresh = saved && Date.now() - Number(saved.at || 0) < LIVE_RESUME_MAX_AGE_MS;
							if (fresh && /^[A-Z0-9]{16}$/.test(String(saved.token || ''))) {
								resumableLiveRoom = String(saved.token);
								setRouteStatus('📡 SIARAN SIAP DILANJUT', 'Tekan BAGIKAN LIVE untuk memakai link yang sama.');
							} else {
								forgetLiveRoom();
							}
						}
					} catch (e) {
						forgetLiveRoom();
					}
				}

				updateLiveShareUI();
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

  // Room Peleton dipilih sendiri oleh pemakainya dan berguna untuk ditampilkan
  // (peserta perlu tahu room mana yang mereka ikuti). Siaran solo sebaliknya:
  // namanya token acak, jadi menampilkan "ROOM: <token>" di layar penonton
  // hanya membocorkan alamat siaran tanpa menjelaskan apa pun. Karena itu
  // tampilannya dibedakan di sini, saat halaman dirender.
  const liveSession = await readLiveSession(c.env.GASPOOL_RADAR, room);
  const isLiveShare = liveSession !== null;
  const pageTitle = isLiveShare ? "Gowes Live" : `Radar Peleton: ${room}`;
  const headline = isLiveShare ? "GOWES LIVE" : "RADAR PELETON";
  const subline = isLiveShare
    ? `${liveSession.user ? liveSession.user : "Pesepeda"} · lokasi langsung`
    : `ROOM: ${room}`;

  // Teks ajakan dibangun di sini lalu dikirim sebagai literal JSON, bukan
  // dirangkai di browser: variabel `room` hanya ada di server, dan
  // JSON.stringify menjamin tanda kutip serta baris baru sampai utuh.
  const shareIntro = isLiveShare
    ? "Pantau pergerakan gowes saya secara live!"
    : `Pantau pergerakan gowes peleton secara live!\nRoom: *${room}*`;

  return c.html(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      ${FAVICON_LINKS}
        <title>${pageTitle}</title>
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
            /* Warna label mengikuti warna titiknya, supaya legenda di atas
               benar-benar cocok dengan yang terlihat di peta. Label ungu lama
               membuat titik merah terbaca seperti milik orang lain. */
            .label-rider { background: rgba(231, 76, 60, 0.94) !important; }
            .label-me { background: rgba(46, 204, 113, 0.94) !important; color: #06170d !important; }
            .btn-share { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #25D366; color: white; border: none; padding: 12px 25px; border-radius: 12px; font-weight: bold; font-size: 12px; cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.5); text-decoration: none;}
            /* Keterangan warna titik. Tanpa ini penonton tidak tahu titik mana
               dirinya dan titik mana pesepeda yang dipantau. */
            .legend { position: absolute; top: 108px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; gap: 14px; align-items: center; background: rgba(10,10,18,0.85); backdrop-filter: blur(10px); padding: 8px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); font-size: 11px; font-weight: 800; letter-spacing: 0.4px; white-space: nowrap; }
            .legend .lg { display: flex; align-items: center; gap: 6px; color: #cbd5e1; }
            .legend i.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; border: 2px solid #fff; }
            .dot-rider { background: #e74c3c; }
            .dot-me { background: #2ecc71; }
            #legend-distance { color: #f1c40f; }
            .radar-note { position: absolute; bottom: 92px; left: 50%; transform: translateX(-50%); z-index: 1000; background: rgba(10,10,18,0.92); border: 1px solid rgba(241,196,15,0.45); color: #f1c40f; font-size: 11px; font-weight: 800; line-height: 1.45; padding: 9px 14px; border-radius: 12px; max-width: 320px; text-align: center; display: none; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1 class="title">${headline}</h1>
            <div class="subtitle"><span class="status-dot"></span>${subline}</div>
        </div>
        <div id="map"></div>
        <div class="legend" id="legend">
            <span class="lg"><i class="dot dot-rider"></i><span id="legend-rider">PESEPEDA</span></span>
            <span class="lg"><i class="dot dot-me"></i>KAMU</span>
            <span class="lg" id="legend-distance"></span>
        </div>
        <div class="radar-note" id="radar-note"></div>
        <button class="btn-share" onclick="shareWa()">💬 BAGIKAN KE KELUARGA</button>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
        <script>
            const map = L.map('map', { zoomControl: false }).setView([-7.25, 112.76], 13);

            // Nama pesepeda untuk legenda. Dikirim sebagai literal JSON karena
            // variabel server tidak ada di browser.
            const riderName = ${JSON.stringify(liveSession && liveSession.user ? liveSession.user : "")};
            (function () {
                const el = document.getElementById('legend-rider');
                if (el && riderName) el.textContent = 'GOWES ' + String(riderName).toUpperCase();
            })();
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);
            
            // ==============================================================
            // POSISI PENONTON SENDIRI (titik hijau)
            // ==============================================================
            // watch:true membuat browser terus memperbarui posisi, jadi titik
            // ini ikut bergeser saat penonton berpindah, bukan hanya sekali
            // saat halaman dibuka.
            //
            // Posisi penonton TIDAK dikirim ke server mana pun. Titik hijau ini
            // hanya digambar di layar orang yang membukanya sendiri, supaya
            // pembagian lokasi tetap satu arah: yang dibagikan hanya posisi
            // pesepeda, bukan posisi siapa pun yang menonton.
            let viewerPos = null;
            let viewerMarker = null;
            let viewerAccuracy = 0;

            const noteBox = document.getElementById('radar-note');
            // Dua hal bisa membuat layar tampak "kosong": posisi pesepeda belum
            // sampai, atau izin lokasi penonton ditolak. Dulu keduanya diam saja
            // sehingga penonton mengira aplikasinya rusak. Sekarang masing-masing
            // punya kalimatnya sendiri.
            let viewerBlocked = false;
            let waitingNotice = '';

            function radarNote(message) {
                if (!noteBox) return;
                if (!message) { noteBox.style.display = 'none'; noteBox.textContent = ''; return; }
                noteBox.textContent = message;
                noteBox.style.display = 'block';
            }

            function refreshNote() {
                if (viewerBlocked) {
                    radarNote(viewerBlocked + ' Titik merah pesepeda tetap diperbarui.');
                } else if (waitingNotice) {
                    radarNote(waitingNotice);
                } else {
                    radarNote('');
                }
            }

            map.locate({setView: true, maxZoom: 14, watch: true, enableHighAccuracy: true});

            map.on('locationfound', function(e) {
                viewerPos = e.latlng;
                viewerAccuracy = Number(e.accuracy || 0);
                if (!viewerMarker) {
                    viewerMarker = L.circleMarker(e.latlng, {
                        radius: 8, color: '#fff', weight: 2, fillColor: '#2ecc71', fillOpacity: 1
                    }).addTo(map)
                      .bindTooltip('KAMU', {permanent: true, className: 'peleton-label label-me', direction: 'top', offset: [0, -10]});
                } else {
                    viewerMarker.setLatLng(e.latlng);
                }
                viewerBlocked = false;
                refreshNote();
                updateLegendDistance();
            });

            map.on('locationerror', function(e) {
                // Izin lokasi ditolak atau tidak tersedia. Katakan apa adanya:
                // tanpa pesan, penonton mengira aplikasinya rusak, padahal
                // halaman tetap bekerja dan titik pesepeda tetap tampil.
                viewerBlocked = e && e.code === 1
                    ? 'Izin lokasi ditolak browser, jadi titik hijau (kamu) tidak ditampilkan.'
                    : 'Posisi kamu belum bisa dibaca browser, jadi titik hijau (kamu) belum tampil.';
                refreshNote();
            });

            const markers = {};
            // Garis jejak per peserta, dipisah dari marker supaya posisi bisa
            // diperbarui tanpa menggambar ulang seluruh garis.
            const trails = {};
            let bounds = L.latLngBounds();

            function shareWa() {
                const url = window.location.href;
                const text = ${JSON.stringify(shareIntro)} + '\\n\\nBuka radar: \\n' + url;
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
                            // Merah = pesepeda yang dipantau, hijau = penonton
                            // sendiri. Warnanya sengaja dibedakan supaya tidak
                            // tertukar, dan legenda di bawah judul menjelaskan
                            // artinya tanpa perlu menebak.
                            if(!markers[p.user]) {
                                markers[p.user] = L.circleMarker(latlng, {radius: 8, color: '#fff', weight: 2, fillColor: '#e74c3c', fillOpacity: 1}).addTo(map)
                                    .bindTooltip(p.user + ' (' + Math.round(p.speed) + ' km/h)', {permanent: true, className: 'peleton-label label-rider', direction: 'top', offset: [0, -10]}).openTooltip();
                            } else {
                                markers[p.user].setLatLng(latlng);
                                markers[p.user].setTooltipContent(p.user + ' (' + Math.round(p.speed) + ' km/h)');
                            }

                            // Jejak perjalanan. Titik terakhir saja tidak cukup:
                            // penonton yang membuka tautan belakangan tidak tahu
                            // pemiliknya sudah lewat mana. Tanpa jejak, layar
                            // hanya menampilkan satu titik tanpa arah.
                            const trail = Array.isArray(p.trail) ? p.trail : [];
                            if(trail.length >= 2) {
                                const points = trail
                                    .filter(q => Number.isFinite(q && q.lat) && Number.isFinite(q && q.lng))
                                    .map(q => [q.lat, q.lng]);
                                if(points.length >= 2) {
                                    if(trails[p.user]) {
                                        trails[p.user].setLatLngs(points);
                                    } else {
                                        trails[p.user] = L.polyline(points, {color: '#e74c3c', weight: 3, opacity: 0.55}).addTo(map);
                                    }
                                    // Ikut menentukan area peta supaya seluruh
                                    // jejak terlihat, bukan hanya posisi terkini.
                                    points.forEach(pt => bounds.extend(pt));
                                }
                            }
                        });

                        // Kalau tidak ada satu pun posisi yang segar, katakan
                        // sedang menunggu. Peta kosong tanpa penjelasan adalah
                        // persis pengalaman yang membingungkan: penonton tidak
                        // tahu apakah tautannya salah atau siarannya mati.
                        waitingNotice = hasUpdate
                            ? ''
                            : 'Belum ada posisi terkirim. Kalau siaran sempat berhenti, minta pesepeda menekan BAGIKAN LIVE lagi — titik merah akan muncul di sini.';
                        refreshNote();

                        // Pusatkan peta dinamis mengikuti sebaran pesepeda.
                        //
                        // Titik penonton ikut diperhitungkan hanya kalau jaraknya
                        // dekat (di bawah 5 km). Kalau penonton berada di kota
                        // lain, memasukkan posisinya akan memaksa peta men-zoom
                        // keluar sampai titik pesepeda tinggal sebesar debu —
                        // justru menghilangkan hal yang ingin dilihat. Jaraknya
                        // tetap ditampilkan di legenda.
                        if(hasUpdate) {
                            if(viewerPos && map.distance(viewerPos, bounds.getCenter()) < 5000) {
                                bounds.extend(viewerPos);
                            }
                            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
                        }
                    }
                    updateLegendDistance();
                } catch(e) {}
            }

            // Jarak penonton ke pesepeda, dibulatkan. Ini yang biasanya paling
            // ingin diketahui penonton: "dia masih jauh atau sudah dekat?".
            function updateLegendDistance() {
                const label = document.getElementById('legend-distance');
                if (!label) return;
                const first = Object.keys(markers)[0];
                if (!viewerPos || !first) { label.textContent = ''; return; }
                const d = map.distance(viewerPos, markers[first].getLatLng());
                const acc = viewerAccuracy > 0 ? ' ±' + Math.round(viewerAccuracy) + 'm' : '';
                label.textContent = d < 1000
                    ? Math.round(d) + ' m' + acc
                    : (d / 1000).toFixed(1) + ' km' + acc;
            }

            fetchRadar();
            setInterval(fetchRadar, 5000); // Polling setiap 5 detik
        </script>
    </body>
    </html>
    `);
});

export default tracker;
