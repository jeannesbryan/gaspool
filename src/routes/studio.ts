import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { Bindings } from "../index";

const studio = new Hono<{ Bindings: Bindings }>();

// ==========================================
// 1. STUDIO FLEXING (SHARE MAP, STATS & GPX)
// ==========================================
studio.get("/detail/:id", async (c) => {
  const token = getCookie(c, "gaspool_session");
  const isGuest = !token; // Status Tamu

  const id = c.req.param("id");

  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?")
      .bind(id)
      .first();

    if (!ride) return c.text("Aktivitas tidak ditemukan!", 404);

    const type = ride.activity_type || "ride";
    const isPace = type === "run" || type === "walk" || type === "hike";

    let barengLabel = "Gowes Bareng";
    if (type === "run") barengLabel = "Lari Bareng";
    else if (type === "walk") barengLabel = "Jalan Bareng";
    else if (type === "hike") barengLabel = "Mendaki Bareng";

    const startDateIso = ride.start_date
      ? new Date(ride.start_date).toISOString()
      : new Date().toISOString();

    const labelAvg = isPace ? "Pace Rata-Rata" : "Kecepatan Rata-Rata";
    const unitAvg = isPace ? "Min/Km" : "Km/h";
    let valAvg = "0.0";

    if (isPace) {
      if (ride.distance > 0 && ride.moving_time > 0) {
        const paceSec = ride.moving_time / ride.distance;
        const pM = Math.floor(paceSec / 60);
        const pS = Math.floor(paceSec % 60);
        valAvg = `${pM}:${pS.toString().padStart(2, "0")}`;
      } else {
        valAvg = "0:00";
      }
    } else {
      valAvg = ride.average_speed
        ? parseFloat(ride.average_speed).toFixed(1)
        : "0.0";
    }

    const mTime = ride.moving_time || 0;
    const h = Math.floor(mTime / 3600).toString().padStart(2, "0");
    const m = Math.floor((mTime % 3600) / 60).toString().padStart(2, "0");
    const s = (mTime % 60).toString().padStart(2, "0");
    const timeStr = `${h}:${m}:${s}`;

    let participantsText = "";

    const escapeHTML = (str: string = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const safeRideName = escapeHTML(ride.name || "Aktivitas");
    const safeRideNotes = escapeHTML(ride.notes || "");

    const safeGPXName = String(ride.name || "Aktivitas")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    if (ride.participants && ride.participants !== "[]") {
      try {
        const arr = JSON.parse(ride.participants);

        if (Array.isArray(arr)) {
          participantsText = arr.join(", ");
        }
      } catch (e) {}
    }

    const safeParticipants = escapeHTML(participantsText);

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

              :root {
                  --primary: #FF5F00;
                  --bg-body: #0a0a12;
                  --text-main: #ecf0f1;
                  --text-muted: #94a3b8;
                  --card-bg: rgba(255,255,255,0.05);
                  --card-border: rgba(255,255,255,0.1);
                  --map-bg: #000000;
              }

              body {
                  font-family: 'Inter', sans-serif;
                  background: var(--bg-body);
                  color: var(--text-main);
                  margin: 0;
                  padding-bottom: 50px;
                  background-image: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0a0a12 70%);
                  min-height: 100vh;
              }

              .container {
                  max-width: 600px;
                  margin: auto;
                  padding: 15px;
              }

              .header {
                  display: flex;
                  align-items: center;
                  gap: 15px;
                  margin-bottom: 20px;
              }

              .back-btn {
                  text-decoration: none;
                  color: var(--text-main);
                  font-size: 1.5rem;
                  background: var(--card-bg);
                  border: 1px solid var(--card-border);
                  width: 45px;
                  height: 45px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 50%;
                  transition: 0.2s;
              }

              #capture-area {
                  background: var(--bg-body);
                  border-radius: 24px;
                  overflow: hidden;
                  border: 1px solid var(--card-border);
                  position: relative;
              }

              #map {
                  height: 350px;
                  width: 100%;
                  z-index: 1;
                  background: var(--map-bg);
              }

              .info-panel {
                  padding: 25px 20px 20px 20px;
                  background: var(--bg-body);
                  position: relative;
                  z-index: 10;
                  border-top: 2px solid var(--primary);
              }

              .badge-type {
                  background: var(--primary);
                  color: #fff;
                  padding: 4px 12px;
                  border-radius: 20px;
                  font-size: 0.7rem;
                  font-weight: 900;
                  text-transform: uppercase;
                  margin-bottom: 12px;
                  display: inline-block;
              }

              .title {
                  font-size: 1.6rem;
                  font-weight: 900;
                  margin: 0 0 5px 0;
                  font-style: italic;
                  color: #ffffff;
                  text-shadow: 0px 2px 4px rgba(0,0,0,0.5);
              }

              .date {
                  color: var(--text-main);
                  font-size: 0.85rem;
                  margin-bottom: 25px;
                  font-weight: bold;
              }

              .stat-box {
                  background: var(--card-bg);
                  padding: 15px;
                  border-radius: 18px;
                  border: 1px solid var(--card-border);
                  text-align: center;
              }

              .stat-label {
                  color: var(--text-muted);
                  font-size: 0.65rem;
                  font-weight: 800;
                  text-transform: uppercase;
                  margin-bottom: 5px;
                  display: block;
              }

              .stat-value {
                  font-size: 1.3rem;
                  font-weight: 900;
                  color: var(--primary);
                  line-height: 1;
              }

              .stat-unit {
                  font-size: 0.7rem;
                  color: var(--text-muted);
                  margin-left: 3px;
                  font-weight: bold;
              }

              .split-section {
                  display: none;
                  margin-top: 18px;
                  padding: 16px;
                  border-radius: 18px;
                  border: 1px solid var(--card-border);
                  background: rgba(255,255,255,0.04);
              }

              .split-head {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 10px;
                  margin-bottom: 12px;
              }

              .split-title {
                  color: var(--primary);
                  font-size: 0.78rem;
                  font-weight: 950;
                  letter-spacing: 0.8px;
                  text-transform: uppercase;
              }

              .split-note {
                  color: var(--text-muted);
                  font-size: 0.65rem;
                  font-weight: 800;
                  text-align: right;
              }

              .split-table {
                  display: grid;
                  gap: 8px;
              }

              .split-row {
                  display: grid;
                  grid-template-columns: 56px 1fr 82px;
                  gap: 10px;
                  align-items: center;
                  padding: 10px 11px;
                  border-radius: 13px;
                  background: rgba(0,0,0,0.18);
                  border: 1px solid rgba(255,255,255,0.06);
              }

              .split-km {
                  color: #fff;
                  font-size: 0.78rem;
                  font-weight: 950;
              }

              .split-time {
                  color: var(--text-main);
                  font-size: 0.9rem;
                  font-weight: 950;
              }

              .split-metric {
                  color: var(--primary);
                  font-size: 0.78rem;
                  font-weight: 950;
                  text-align: right;
              }

              .match-section {
                  display: none;
                  margin-top: 18px;
                  padding: 16px;
                  border-radius: 18px;
                  border: 1px solid var(--card-border);
                  background: rgba(255,255,255,0.04);
              }

              .match-head {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 10px;
                  margin-bottom: 12px;
              }

              .match-title {
                  color: var(--primary);
                  font-size: 0.78rem;
                  font-weight: 950;
                  letter-spacing: 0.8px;
                  text-transform: uppercase;
              }

              .match-note {
                  color: var(--text-muted);
                  font-size: 0.65rem;
                  font-weight: 800;
                  text-align: right;
              }

              .match-list {
                  display: grid;
                  gap: 9px;
              }

              .match-card {
                  display: grid;
                  grid-template-columns: 1fr auto;
                  gap: 10px;
                  padding: 12px;
                  border-radius: 14px;
                  border: 1px solid rgba(255,255,255,0.07);
                  background: rgba(0,0,0,0.18);
                  text-decoration: none;
                  color: var(--text-main);
              }

              .match-name {
                  font-size: 0.85rem;
                  font-weight: 950;
                  line-height: 1.25;
                  margin-bottom: 5px;
              }

              .match-meta {
                  color: var(--text-muted);
                  font-size: 0.68rem;
                  font-weight: 800;
                  line-height: 1.45;
              }

              .match-score {
                  color: var(--primary);
                  font-size: 1rem;
                  font-weight: 950;
                  text-align: right;
                  white-space: nowrap;
              }

              .match-delta {
                  margin-top: 5px;
                  font-size: 0.72rem;
                  font-weight: 950;
              }

              .match-better { color: #2ecc71; }
              .match-worse { color: #e74c3c; }
              .match-even { color: var(--text-muted); }

              .segment-section {
                  display: none;
                  margin-top: 18px;
                  padding: 16px;
                  border-radius: 18px;
                  border: 1px solid var(--card-border);
                  background: rgba(255,255,255,0.04);
              }

              .segment-title {
                  color: var(--primary);
                  font-size: 0.78rem;
                  font-weight: 950;
                  letter-spacing: 0.8px;
                  text-transform: uppercase;
                  margin-bottom: 10px;
              }

              .segment-hint {
                  color: var(--text-muted);
                  font-size: 0.72rem;
                  font-weight: 800;
                  line-height: 1.45;
                  margin-bottom: 12px;
              }

              .segment-input {
                  width: 100%;
                  border: 1px solid var(--card-border);
                  background: rgba(0,0,0,0.25);
                  color: #fff;
                  border-radius: 13px;
                  padding: 12px;
                  font-weight: 850;
                  outline: none;
                  margin-bottom: 10px;
              }

              .segment-range-row {
                  display: grid;
                  grid-template-columns: 60px 1fr 54px;
                  align-items: center;
                  gap: 10px;
                  margin: 9px 0;
                  color: var(--text-muted);
                  font-size: 0.68rem;
                  font-weight: 900;
              }

              .segment-range-row input[type="range"] {
                  width: 100%;
                  accent-color: var(--primary);
              }

              .segment-preview {
                  display: grid;
                  grid-template-columns: repeat(3, 1fr);
                  gap: 8px;
                  margin: 12px 0;
              }

              .segment-stat {
                  padding: 10px;
                  border-radius: 13px;
                  border: 1px solid rgba(255,255,255,0.07);
                  background: rgba(0,0,0,0.18);
                  text-align: center;
              }

              .segment-stat strong {
                  display: block;
                  color: var(--primary);
                  font-size: 0.98rem;
                  font-weight: 950;
              }

              .segment-stat span {
                  display: block;
                  color: var(--text-muted);
                  font-size: 0.58rem;
                  font-weight: 900;
                  letter-spacing: 0.8px;
                  margin-top: 4px;
              }

              .segment-status {
                  color: var(--text-muted);
                  font-size: 0.72rem;
                  font-weight: 850;
                  line-height: 1.45;
                  min-height: 18px;
                  margin-top: 10px;
              }

              .segment-list {
                  display: grid;
                  gap: 8px;
                  margin-top: 12px;
              }

              .segment-card {
                  border: 1px solid rgba(255,255,255,0.07);
                  background: rgba(0,0,0,0.18);
                  border-radius: 14px;
                  padding: 12px;
                  color: var(--text-main);
                  text-decoration: none;
              }

              .segment-card-title {
                  font-size: 0.83rem;
                  font-weight: 950;
                  margin-bottom: 5px;
              }

              .segment-card-meta {
                  color: var(--text-muted);
                  font-size: 0.68rem;
                  font-weight: 800;
                  line-height: 1.45;
              }

              .btn-group {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 10px;
                  margin-top: 20px;
              }

              .btn {
                  border: none;
                  padding: 15px;
                  border-radius: 15px;
                  font-weight: 900;
                  cursor: pointer;
                  transition: 0.2s;
                  font-size: 0.75rem;
                  text-align: center;
                  color: #fff;
                  text-decoration: none;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 5px;
              }

              #minimalist-card {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  text-align: center;
                  width: 550px;
                  padding: 40px 20px;
                  color: var(--text-main);
                  background: transparent;
                  position: absolute;
                  left: -9999px;
                  top: 0;
              }

              .minimal-item {
                  display: flex;
                  flex-direction: column;
                  justify-content: center;
                  align-items: center;
              }

              .minimal-label {
                  font-size: 13px;
                  color: var(--text-main);
                  opacity: 0.8;
                  font-weight: 600;
                  margin-bottom: 5px;
                  white-space: nowrap;
              }

              .minimal-value {
                  font-size: 26px;
                  font-weight: 900;
                  color: var(--primary);
                  letter-spacing: -1px;
                  line-height: 1.2;
              }

              .minimal-value small {
                  font-size: 14px;
              }

              .activity-notes {
                  margin: 12px 0 10px;
                  padding: 14px;
                  border-radius: 16px;
                  background: rgba(255, 95, 0, 0.08);
                  border: 1px solid rgba(255, 95, 0, 0.22);
                  color: #cbd5e1;
                  font-size: 13px;
                  line-height: 1.55;
                  font-weight: 750;
                  white-space: pre-wrap;
              }

              .activity-notes-label {
                  display: block;
                  color: var(--primary);
                  font-size: 10px;
                  font-weight: 950;
                  letter-spacing: 1px;
                  text-transform: uppercase;
                  margin-bottom: 5px;
              }

              #minimal-route-wrap {
                  width: 500px !important;
                  height: 250px !important;
                  background: transparent !important;
                  margin: 0 auto 15px auto !important;
                  border: none;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  overflow: visible;
              }

              #minimal-route-svg {
                  width: 100%;
                  height: 100%;
                  display: block;
                  overflow: visible;
              }

              #minimal-route-path {
                  fill: none;
                  stroke: var(--primary);
                  stroke-width: 7;
                  stroke-linecap: round;
                  stroke-linejoin: round;
              }



              .doctor-btn {
                  grid-column: 1 / -1;
                  background: linear-gradient(135deg, #0f766e, #14b8a6);
                  border: 1px solid rgba(45, 212, 191, 0.35);
                  box-shadow: 0 10px 26px rgba(20, 184, 166, 0.16);
              }

              .doctor-modal {
                  position: fixed;
                  inset: 0;
                  z-index: 9999;
                  display: none;
                  align-items: flex-end;
                  justify-content: center;
                  padding: 14px;
                  background: rgba(0, 0, 0, 0.72);
                  backdrop-filter: blur(8px);
              }

              .doctor-modal.is-open {
                  display: flex;
              }

              .doctor-dialog {
                  width: 100%;
                  max-width: 620px;
                  max-height: 88vh;
                  overflow: auto;
                  border-radius: 24px;
                  border: 1px solid rgba(255,255,255,0.12);
                  background: #10101a;
                  box-shadow: 0 -20px 60px rgba(0,0,0,0.55);
              }

              .doctor-header {
                  position: sticky;
                  top: 0;
                  z-index: 2;
                  display: flex;
                  justify-content: space-between;
                  align-items: flex-start;
                  gap: 12px;
                  padding: 18px;
                  border-bottom: 1px solid rgba(255,255,255,0.08);
                  background: linear-gradient(180deg, #151522, #10101a);
              }

              .doctor-title {
                  margin: 0;
                  color: var(--primary);
                  font-size: 1.05rem;
                  font-weight: 950;
                  font-style: italic;
                  text-transform: uppercase;
                  letter-spacing: 0.6px;
              }

              .doctor-subtitle {
                  margin-top: 5px;
                  color: var(--text-muted);
                  font-size: 0.72rem;
                  font-weight: 800;
                  line-height: 1.4;
              }

              .doctor-close {
                  border: 1px solid rgba(255,255,255,0.12);
                  background: rgba(255,255,255,0.06);
                  color: #fff;
                  border-radius: 12px;
                  padding: 9px 12px;
                  font-weight: 950;
                  cursor: pointer;
              }

              .doctor-body {
                  padding: 16px;
                  display: grid;
                  gap: 12px;
              }

              .doctor-card {
                  border-radius: 18px;
                  border: 1px solid rgba(255,255,255,0.08);
                  background: rgba(255,255,255,0.045);
                  padding: 14px;
              }

              .doctor-status-row {
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 10px;
                  margin-bottom: 10px;
              }

              .doctor-pill {
                  display: inline-flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 999px;
                  padding: 7px 11px;
                  font-size: 0.62rem;
                  font-weight: 950;
                  text-transform: uppercase;
                  letter-spacing: 0.8px;
                  color: #fff;
                  background: rgba(148, 163, 184, 0.18);
                  border: 1px solid rgba(148, 163, 184, 0.28);
                  white-space: nowrap;
              }

              .doctor-pill.healthy {
                  background: rgba(46, 204, 113, 0.16);
                  border-color: rgba(46, 204, 113, 0.35);
                  color: #86efac;
              }

              .doctor-pill.repairable,
              .doctor-pill.needs_attention {
                  background: rgba(255, 95, 0, 0.16);
                  border-color: rgba(255, 95, 0, 0.34);
                  color: #fdba74;
              }

              .doctor-pill.broken {
                  background: rgba(231, 76, 60, 0.16);
                  border-color: rgba(231, 76, 60, 0.34);
                  color: #fca5a5;
              }

              .doctor-summary {
                  color: #dbeafe;
                  font-size: 0.8rem;
                  font-weight: 820;
                  line-height: 1.55;
              }

              .doctor-mini-grid {
                  display: grid;
                  grid-template-columns: repeat(3, 1fr);
                  gap: 8px;
              }

              .doctor-mini {
                  border-radius: 14px;
                  padding: 10px;
                  text-align: center;
                  background: rgba(0,0,0,0.18);
                  border: 1px solid rgba(255,255,255,0.06);
              }

              .doctor-mini strong {
                  display: block;
                  color: var(--primary);
                  font-size: 1rem;
                  font-weight: 950;
              }

              .doctor-mini span {
                  display: block;
                  margin-top: 4px;
                  color: var(--text-muted);
                  font-size: 0.56rem;
                  font-weight: 900;
                  letter-spacing: 0.8px;
                  text-transform: uppercase;
              }

              .doctor-section-title {
                  margin: 0 0 8px;
                  color: var(--primary);
                  font-size: 0.72rem;
                  font-weight: 950;
                  letter-spacing: 0.9px;
                  text-transform: uppercase;
              }

              .doctor-list {
                  display: grid;
                  gap: 8px;
              }

              .doctor-empty {
                  color: var(--text-muted);
                  font-size: 0.74rem;
                  font-weight: 800;
                  line-height: 1.45;
              }

              .doctor-issue {
                  display: grid;
                  grid-template-columns: 82px 1fr;
                  gap: 10px;
                  align-items: start;
                  border-radius: 14px;
                  padding: 11px;
                  background: rgba(0,0,0,0.18);
                  border: 1px solid rgba(255,255,255,0.06);
              }

              .doctor-severity {
                  border-radius: 999px;
                  padding: 6px 8px;
                  text-align: center;
                  font-size: 0.56rem;
                  font-weight: 950;
                  text-transform: uppercase;
                  color: #fff;
                  background: rgba(148,163,184,0.18);
              }

              .doctor-severity.warning { background: rgba(255, 95, 0, 0.22); color: #fdba74; }
              .doctor-severity.danger { background: rgba(231, 76, 60, 0.22); color: #fca5a5; }
              .doctor-severity.info { background: rgba(52, 152, 219, 0.20); color: #93c5fd; }

              .doctor-issue-title {
                  color: #fff;
                  font-size: 0.82rem;
                  font-weight: 950;
                  margin-bottom: 4px;
              }

              .doctor-issue-detail,
              .doctor-change-detail {
                  color: var(--text-muted);
                  font-size: 0.68rem;
                  font-weight: 800;
                  line-height: 1.45;
              }

              .doctor-change {
                  border-radius: 14px;
                  padding: 11px;
                  background: rgba(0,0,0,0.18);
                  border: 1px solid rgba(255,255,255,0.06);
              }

              .doctor-change-field {
                  color: #fff;
                  font-size: 0.78rem;
                  font-weight: 950;
                  margin-bottom: 4px;
              }

              .doctor-before-after {
                  margin-top: 6px;
                  color: #cbd5e1;
                  font-size: 0.68rem;
                  font-weight: 850;
              }

              .doctor-actions {
                  display: flex;
                  flex-wrap: wrap;
                  gap: 7px;
              }

              .doctor-action-chip {
                  border-radius: 999px;
                  padding: 7px 10px;
                  color: #dbeafe;
                  background: rgba(255,255,255,0.07);
                  border: 1px solid rgba(255,255,255,0.08);
                  font-size: 0.62rem;
                  font-weight: 900;
              }

              .doctor-footer {
                  position: sticky;
                  bottom: 0;
                  z-index: 2;
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 10px;
                  padding: 14px 16px 16px;
                  background: linear-gradient(0deg, #10101a, rgba(16,16,26,0.92));
                  border-top: 1px solid rgba(255,255,255,0.08);
              }

              .doctor-footer .btn {
                  width: 100%;
              }

              .doctor-message {
                  grid-column: 1 / -1;
                  min-height: 18px;
                  color: var(--text-muted);
                  font-size: 0.72rem;
                  font-weight: 850;
                  line-height: 1.45;
              }

              @media (min-width: 720px) {
                  .doctor-modal { align-items: center; }
              }

              @media (max-width: 430px) {
                  .doctor-mini-grid { grid-template-columns: repeat(2, 1fr); }
                  .doctor-issue { grid-template-columns: 1fr; }
              }

              ${isGuest ? ".btn-group { display: none !important; } .back-btn { display: none !important; }" : ""}
          </style>
      </head>

      <body>
      <div class="container">
        ${
          isGuest
            ? '<div style="margin-bottom:15px;"><a href="javascript:history.back()" style="color:var(--primary); text-decoration:none; font-weight:bold; font-size:0.8rem;">‹ KEMBALI</a></div>'
            : `
            <div class="header">
                <a href="/" class="back-btn">‹</a>
                <h2 style="margin:0; font-style: italic; color: var(--primary);">Detail Aktivitas</h2>
            </div>`
        }

          <div id="capture-area">
              <div id="map"></div>

              <div class="info-panel">
                  <span class="badge-type">${type}</span>
                  <h1 class="title">${safeRideName}</h1>
                  <div class="date" id="display-date"></div>

                  ${
                    safeRideNotes
                      ? `<div class="activity-notes"><span class="activity-notes-label">CATATAN</span>${safeRideNotes}</div>`
                      : ""
                  }

                  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                      <div class="stat-box" style="padding: 12px 5px;">
                          <span class="stat-label" style="font-size: 0.6rem;">JARAK</span>
                          <span class="stat-value" style="font-size: 1.15rem;">${parseFloat(ride.distance || 0).toFixed(2)}</span>
                          <span class="stat-unit">KM</span>
                      </div>

                      <div class="stat-box" style="padding: 12px 5px;">
                          <span class="stat-label" style="font-size: 0.6rem;">${labelAvg}</span>
                          <span class="stat-value" style="font-size: 1.15rem;">${valAvg}</span>
                          <span class="stat-unit">${unitAvg}</span>
                      </div>

                      <div class="stat-box" style="padding: 12px 5px;">
                          <span class="stat-label" style="font-size: 0.6rem;">WAKTU</span>
                          <span class="stat-value" style="font-size: 1.15rem;">${timeStr}</span>
                      </div>
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                      <div class="stat-box">
                          <span class="stat-label">TOTAL ELEVASI</span>
                          <span class="stat-value">${Math.round(ride.total_elevation_gain || 0)}</span>
                          <span class="stat-unit">M</span>
                      </div>

                      <div class="stat-box">
                          <span class="stat-label">SUHU RATA-RATA</span>
                          <span class="stat-value">${ride.avg_temp ? parseFloat(ride.avg_temp).toFixed(1) : "--"}</span>
                          <span class="stat-unit">°C</span>
                      </div>
                  </div>

                  ${
                    participantsText !== ""
                      ? `
                      <div style="display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 10px;">
                          <div class="stat-box" style="background: rgba(255, 95, 0, 0.1); border-color: rgba(255, 95, 0, 0.3);">
                              <span class="stat-label" style="color: var(--primary);">👥 ${barengLabel.toUpperCase()}</span>
                              <span style="font-size: 14px; font-weight: bold; margin-top: 5px; display: block; line-height: 1.5; color: var(--text-main);">${safeParticipants}</span>
                          </div>
                      </div>
                  `
                      : ""
                  }

                  <div style="text-align: center; margin-top: 30px;">
                      <img src="/assets/gaspool.png" alt="Gaspool" style="height: 90px; opacity: 0.9;">
                  </div>
              </div>
          </div>

          <section id="split-section" class="split-section">
              <div class="split-head">
                  <div class="split-title">Auto Split / KM</div>
                  <div class="split-note" id="split-note">Dihitung dari timestamp GPS</div>
              </div>
              <div id="split-list" class="split-table"></div>
          </section>

          ${
            isGuest
              ? ""
              : `
          <section id="match-section" class="match-section">
              <div class="match-head">
                  <div class="match-title">Rute Mirip</div>
                  <div class="match-note" id="match-note">Personal effort comparison</div>
              </div>
              <div id="match-list" class="match-list"></div>
          </section>
          `
          }

          ${
            isGuest
              ? ""
              : `
          <section id="segment-section" class="segment-section">
              <div class="segment-title">Personal Segments</div>
              <div class="segment-hint">Pilih potongan rute dari aktivitas ini untuk disimpan sebagai segmen pribadi. Gaspool akan mencari effort terbaik dari riwayatmu sendiri.</div>
              <input id="segment-name" class="segment-input" maxlength="80" placeholder="Misal: Tanjakan pulang / Sprint alun-alun">
              <div class="segment-range-row">
                  <div>START</div>
                  <input id="segment-start" type="range" min="0" max="100" value="20">
                  <div id="segment-start-label">20%</div>
              </div>
              <div class="segment-range-row">
                  <div>FINISH</div>
                  <input id="segment-end" type="range" min="0" max="100" value="60">
                  <div id="segment-end-label">60%</div>
              </div>
              <div class="segment-preview">
                  <div class="segment-stat"><strong id="segment-distance">0.00</strong><span>KM</span></div>
                  <div class="segment-stat"><strong id="segment-start-km">0.00</strong><span>START KM</span></div>
                  <div class="segment-stat"><strong id="segment-end-km">0.00</strong><span>FINISH KM</span></div>
              </div>
              <button id="segment-save" class="btn" style="background:#8e44ad; width:100%;" type="button">SIMPAN SEGMEN</button>
              <div id="segment-status" class="segment-status">Memuat koordinat aktivitas...</div>
              <div id="segment-efforts" class="segment-list"></div>
              <div id="activity-segments" class="segment-list"></div>
          </section>
          `
          }

          <div class="btn-group">
              <button onclick="takeScreenshot('standard')" class="btn" style="background: var(--primary);">📸 SHARE MAP</button>
              <button onclick="takeScreenshot('minimalist')" class="btn" style="background: #333;">✨ SHARE STATS</button>
              <a href="/video_flex/${id}" class="btn" style="background: #8e44ad;">🎬 BUAT VIDEO</a>
              <button onclick="downloadGPX()" class="btn" style="background: #27ae60;">📥 EXPORT GPX</button>
              <button id="doctor-open-btn" onclick="openActivityDoctor()" class="btn doctor-btn" type="button">🩺 CEK & PERBAIKI AKTIVITAS INI</button>
          </div>
      </div>

      ${
        isGuest
          ? ""
          : `
      <div id="doctor-modal" class="doctor-modal" role="dialog" aria-modal="true" aria-labelledby="doctor-title">
          <div class="doctor-dialog">
              <div class="doctor-header">
                  <div>
                      <h3 id="doctor-title" class="doctor-title">Activity Doctor</h3>
                      <div class="doctor-subtitle">Scan otomatis untuk route JSON, metadata, rest block, dan statistik aktivitas.</div>
                  </div>
                  <button class="doctor-close" type="button" onclick="closeActivityDoctor()">TUTUP</button>
              </div>

              <div class="doctor-body">
                  <div class="doctor-card">
                      <div class="doctor-status-row">
                          <div id="doctor-status-pill" class="doctor-pill">BELUM DICEK</div>
                          <div id="doctor-source" class="doctor-empty" style="text-align:right;">-</div>
                      </div>
                      <div id="doctor-summary" class="doctor-summary">Tekan scan untuk memeriksa aktivitas ini.</div>
                  </div>

                  <div class="doctor-card">
                      <div class="doctor-section-title">Ringkasan Data</div>
                      <div id="doctor-counts" class="doctor-mini-grid">
                          <div class="doctor-mini"><strong>-</strong><span>Raw Point</span></div>
                          <div class="doctor-mini"><strong>-</strong><span>Valid</span></div>
                          <div class="doctor-mini"><strong>-</strong><span>Duplikat</span></div>
                      </div>
                  </div>

                  <div class="doctor-card">
                      <div class="doctor-section-title">Preview Statistik</div>
                      <div id="doctor-stats" class="doctor-list"><div class="doctor-empty">Belum ada hasil scan.</div></div>
                  </div>

                  <div class="doctor-card">
                      <div class="doctor-section-title">Masalah Terdeteksi</div>
                      <div id="doctor-issues" class="doctor-list"><div class="doctor-empty">Belum ada hasil scan.</div></div>
                  </div>

                  <div class="doctor-card">
                      <div class="doctor-section-title">Rencana Perubahan</div>
                      <div id="doctor-changes" class="doctor-list"><div class="doctor-empty">Belum ada perubahan.</div></div>
                  </div>

                  <div class="doctor-card">
                      <div class="doctor-section-title">Auto Repair Actions</div>
                      <div id="doctor-actions" class="doctor-actions"><span class="doctor-action-chip">Belum ada action</span></div>
                  </div>
              </div>

              <div class="doctor-footer">
                  <div id="doctor-message" class="doctor-message"></div>
                  <button id="doctor-rescan-btn" class="btn" style="background:#334155;" type="button" onclick="scanActivityDoctor()">SCAN ULANG</button>
                  <button id="doctor-apply-btn" class="btn" style="background:#0f766e;" type="button" onclick="applyActivityDoctor()" disabled>APPLY AUTO REPAIR</button>
              </div>
          </div>
      </div>
      `
      }

      <div id="minimalist-card">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; width: 100%; margin-bottom: 25px;">
              <div class="minimal-item">
                  <div class="minimal-label">Jarak Tempuh</div>
                  <div class="minimal-value">${parseFloat(ride.distance || 0).toFixed(2)} <small>km</small></div>
              </div>

              <div class="minimal-item">
                  <div class="minimal-label">${labelAvg}</div>
                  <div class="minimal-value">${valAvg.replace(".", ",")} <small>${unitAvg.toLowerCase()}</small></div>
              </div>

              <div class="minimal-item">
                  <div class="minimal-label">Moving Time</div>
                  <div class="minimal-value">${timeStr}</div>
              </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 80%; margin: 0 auto 25px auto;">
              <div class="minimal-item">
                  <div class="minimal-label">Total Elevasi</div>
                  <div class="minimal-value">${Math.round(ride.total_elevation_gain || 0)} <small>m</small></div>
              </div>

              <div class="minimal-item">
                  <div class="minimal-label">Suhu Rata-Rata</div>
                  <div class="minimal-value">${ride.avg_temp ? parseFloat(ride.avg_temp).toFixed(1).replace(".", ",") + " <small>&deg;C</small>" : "-- <small>&deg;C</small>"}</div>
              </div>
          </div>

          ${
            participantsText !== ""
              ? `
          <div style="width: 100%; margin-bottom: 25px;">
              <div class="minimal-item">
                  <div class="minimal-label">${barengLabel}</div>
                  <div class="minimal-value" style="font-size: 20px; line-height: 1.4;">${safeParticipants}</div>
              </div>
          </div>
          `
              : ""
          }

          <div id="minimal-route-wrap">
              <svg id="minimal-route-svg" viewBox="0 0 500 250" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <path id="minimal-route-path" d=""></path>
              </svg>
          </div>
          <img src="/assets/gaspool.png" alt="Gaspool" style="height: 60px; margin-top: 15px;">
      </div>

      <script>
          const d = new Date("${startDateIso}");
          const options = {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
          };

          document.getElementById('display-date').innerText = d.toLocaleDateString('id-ID', options);

          const tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

          const map = L.map('map', {
              zoomControl: false,
              attributionControl: false
          });

          L.tileLayer(tileUrl, {
              crossOrigin: 'anonymous',
              maxZoom: 19
          }).addTo(map);

          const rawUrl = ${JSON.stringify(ride.polyline || "")};
          const currentRideId = ${JSON.stringify(id)};
          const activityType = ${JSON.stringify(type)};
          const canLoadMatches = ${isGuest ? "false" : "true"};
          const totalMovingSeconds = ${Math.max(0, Math.floor(Number(mTime || 0)))};
          const totalActivityDistanceKm = ${Math.max(0, Number(ride.distance || 0))};
          let shareRouteBounds = null;
          let shareRouteLatLngs = [];

          function decodePolyline(str, precision = 5) {
              let index = 0;
              let lat = 0;
              let lng = 0;
              let coordinates = [];
              let shift = 0;
              let result = 0;
              let byte = null;
              const factor = Math.pow(10, precision);

              while (index < str.length) {
                  byte = null;
                  shift = 0;
                  result = 0;

                  do {
                      byte = str.charCodeAt(index++) - 63;
                      result |= (byte & 0x1f) << shift;
                      shift += 5;
                  } while (byte >= 0x20);

                  const lat_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

                  shift = 0;
                  result = 0;

                  do {
                      byte = str.charCodeAt(index++) - 63;
                      result |= (byte & 0x1f) << shift;
                      shift += 5;
                  } while (byte >= 0x20);

                  const lng_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

                  lat += lat_change;
                  lng += lng_change;

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
              if (value.points) return extractCoordinateList(value.points);
              if (value.path) return extractCoordinateList(value.path);
              if (value.data) return extractCoordinateList(value.data);
              if (value.polyline) return extractCoordinateList(value.polyline);
              if (value.coordinates) return extractCoordinateList(value.coordinates);
              return [];
          }

          function normalizeRoutePoint(point) {
              if (Array.isArray(point)) {
                  const first = parseFloat(point[0]);
                  const second = parseFloat(point[1]);
                  const ele = point.length > 2 ? parseFloat(point[2]) : 0;
                  if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
                      return { lat: second, lng: first, ele: isNaN(ele) ? 0 : ele, time: '' };
                  }
                  return { lat: first, lng: second, ele: isNaN(ele) ? 0 : ele, time: '' };
              }

              if (point && point.lat !== undefined) {
                  return {
                      lat: parseFloat(point.lat),
                      lng: parseFloat(point.lng !== undefined ? point.lng : point.lon),
                      ele: point.ele || point.elevation || 0,
                      time: point.time || ''
                  };
              }

              return null;
          }

          function normalizeRoutePoints(value) {
              return extractCoordinateList(value).map(normalizeRoutePoint).filter(function(p) {
                  return p !== null && !isNaN(p.lat) && !isNaN(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
              });
          }

          function renderMinimalRoute(points, dashStyle) {
              const pathEl = document.getElementById('minimal-route-path');
              if (!pathEl || !Array.isArray(points) || points.length < 2) return;

              const width = 500;
              const height = 250;
              const padX = 34;
              const padY = 28;
              let minLat = Infinity;
              let maxLat = -Infinity;
              let minLng = Infinity;
              let maxLng = -Infinity;

              points.forEach(function(point) {
                  minLat = Math.min(minLat, point.lat);
                  maxLat = Math.max(maxLat, point.lat);
                  minLng = Math.min(minLng, point.lng);
                  maxLng = Math.max(maxLng, point.lng);
              });

              const latRange = Math.max(maxLat - minLat, 0.00001);
              const lngRange = Math.max(maxLng - minLng, 0.00001);
              const scale = Math.min((width - padX * 2) / lngRange, (height - padY * 2) / latRange);
              const routeWidth = lngRange * scale;
              const routeHeight = latRange * scale;
              const offsetX = (width - routeWidth) / 2;
              const offsetY = (height - routeHeight) / 2;

              const path = points.map(function(point, index) {
                  const x = offsetX + (point.lng - minLng) * scale;
                  const y = offsetY + (maxLat - point.lat) * scale;
                  return (index === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2);
              }).join(' ');

              pathEl.setAttribute('d', path);
              if (dashStyle) {
                  pathEl.setAttribute('stroke-dasharray', '10 14');
              } else {
                  pathEl.removeAttribute('stroke-dasharray');
              }
          }

          async function getCoordinates() {
              if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') return [];

              try {
                  let pts = [];
                  let urlStr = rawUrl.trim();

                  if (urlStr.startsWith('"')) {
                      try {
                          urlStr = JSON.parse(urlStr);
                      } catch (e) {
                          urlStr = urlStr.slice(1, -1).replace(/\\\\"/g, '"');
                      }
                  }

                  if (urlStr.startsWith('[')) {
                      pts = JSON.parse(urlStr);
                  } else if (urlStr.startsWith('http')) {
                      const res = await fetch(urlStr, { cache: 'no-store' });

                      if (!res.ok) {
                          throw new Error('Fetch rute gagal: HTTP ' + res.status);
                      }

                      pts = await res.json();
                  } else {
                      pts = decodePolyline(urlStr);
                  }

                  return normalizeRoutePoints(pts);
              } catch (e) {
                  console.error('Gagal membaca koordinat detail:', e);
                  return [];
              }
          }

          function centerRoutePixelBounds() {
              if (!Array.isArray(shareRouteLatLngs) || shareRouteLatLngs.length < 2) return;

              const size = map.getSize();
              let minX = Infinity;
              let maxX = -Infinity;
              let minY = Infinity;
              let maxY = -Infinity;

              shareRouteLatLngs.forEach(function(latlng) {
                  const point = map.latLngToContainerPoint(latlng);
                  minX = Math.min(minX, point.x);
                  maxX = Math.max(maxX, point.x);
                  minY = Math.min(minY, point.y);
                  maxY = Math.max(maxY, point.y);
              });

              if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

              const routeCenter = L.point((minX + maxX) / 2, (minY + maxY) / 2);
              const mapCenter = L.point(size.x / 2, size.y / 2);

              if (Math.abs(routeCenter.x - mapCenter.x) < 1 && Math.abs(routeCenter.y - mapCenter.y) < 1) return;

              map.setView(map.containerPointToLatLng(routeCenter), map.getZoom(), {
                  animate: false,
                  reset: true
              });
          }

          function refitStandardMapForCapture() {
              if (!shareRouteBounds || !shareRouteBounds.isValid()) return Promise.resolve();

              return new Promise(function(resolve) {
                  const mapEl = document.getElementById('map');
                  const width = mapEl ? mapEl.clientWidth : 0;
                  const height = mapEl ? mapEl.clientHeight : 0;
                  const padX = Math.max(34, Math.round(width * 0.08));
                  const padY = Math.max(30, Math.round(height * 0.12));

                  map.invalidateSize(true);
                  map.fitBounds(shareRouteBounds, {
                      paddingTopLeft: [padX, padY],
                      paddingBottomRight: [padX, padY],
                      animate: false
                  });

                  requestAnimationFrame(function() {
                      centerRoutePixelBounds();
                      map.invalidateSize(true);
                      requestAnimationFrame(function() {
                          centerRoutePixelBounds();
                          resolve();
                      });
                  });
              });
          }

          async function drawMap() {
              try {
                  const coordsObj = await getCoordinates();

                  if (coordsObj.length > 1) {
                      const coordsLatLng = coordsObj.map(p => [p.lat, p.lng]);
                      shareRouteLatLngs = coordsLatLng;
                      const dashStyle = ('${type}' === 'run' || '${type}' === 'walk' || '${type}' === 'hike') ? '5, 10' : null;

                      const outlinePath = L.polyline(coordsLatLng, {
                          color: '#ffffff',
                          weight: 8,
                          dashArray: dashStyle
                      }).addTo(map);

                      L.polyline(coordsLatLng, {
                          color: '#FF5F00',
                          weight: 4,
                          dashArray: dashStyle
                      }).addTo(map);

                      L.circleMarker(coordsLatLng[0], {
                          radius: 6,
                          color: '#2ecc71',
                          fillOpacity: 1
                      }).addTo(map);

                      L.circleMarker(coordsLatLng[coordsLatLng.length - 1], {
                          radius: 6,
                          color: '#e74c3c',
                          fillOpacity: 1
                      }).addTo(map);

                      renderMinimalRoute(coordsObj, dashStyle);
                      shareRouteBounds = outlinePath.getBounds();

                      map.fitBounds(shareRouteBounds, {
                          padding: [30, 30]
                      });
                      centerRoutePixelBounds();

                      setTimeout(() => {
                          map.invalidateSize();
                          map.fitBounds(shareRouteBounds, {
                              padding: [30, 30]
                          });
                          centerRoutePixelBounds();
                      }, 500);

                      renderAutoSplits(coordsObj);
                      initSegmentBuilder(coordsObj);
                      loadActivitySegments();
                  }
              } catch (e) {
                  console.error('Gagal drawMap:', e);
              }
          }

          drawMap();

          function distanceKm(a, b) {
              const R = 6371;
              const dLat = (b.lat - a.lat) * Math.PI / 180;
              const dLng = (b.lng - a.lng) * Math.PI / 180;
              const lat1 = a.lat * Math.PI / 180;
              const lat2 = b.lat * Math.PI / 180;
              const sinLat = Math.sin(dLat / 2);
              const sinLng = Math.sin(dLng / 2);
              const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
              return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
          }

          function pointTimeMs(point) {
              if (!point || !point.time) return null;
              const time = Date.parse(point.time);
              return Number.isFinite(time) ? time : null;
          }

          function splitTuning() {
              if (activityType === 'hike') return { minKmh: 0.5, maxKmh: 10, fallbackKmh: 3.5, restGapSeconds: 900 };
              if (activityType === 'walk') return { minKmh: 0.8, maxKmh: 12, fallbackKmh: 4.5, restGapSeconds: 900 };
              if (activityType === 'run') return { minKmh: 1.8, maxKmh: 35, fallbackKmh: 8.5, restGapSeconds: 600 };
              return { minKmh: 2.5, maxKmh: 80, fallbackKmh: 18, restGapSeconds: 600 };
          }

          function median(values) {
              const sorted = values
                  .filter(function(value) { return Number.isFinite(value) && value > 0; })
                  .sort(function(a, b) { return a - b; });

              if (sorted.length === 0) return null;
              const mid = Math.floor(sorted.length / 2);
              return sorted.length % 2 === 0
                  ? (sorted[mid - 1] + sorted[mid]) / 2
                  : sorted[mid];
          }

          function estimateMovingSpeedKmh(points, tuning) {
              const samples = [];

              for (let i = 1; i < points.length; i++) {
                  const prev = points[i - 1];
                  const cur = points[i];
                  const segmentKm = distanceKm(prev, cur);
                  const prevTime = pointTimeMs(prev);
                  const curTime = pointTimeMs(cur);

                  if (!Number.isFinite(segmentKm) || segmentKm <= 0.003 || segmentKm > 2) continue;
                  if (prevTime === null || curTime === null || curTime <= prevTime) continue;

                  const elapsedSeconds = (curTime - prevTime) / 1000;
                  const speedKmh = segmentKm / (elapsedSeconds / 3600);

                  if (
                      elapsedSeconds > 0 &&
                      elapsedSeconds <= tuning.restGapSeconds &&
                      speedKmh >= tuning.minKmh &&
                      speedKmh <= tuning.maxKmh
                  ) {
                      samples.push(speedKmh);
                  }
              }

              const routeMedian = median(samples);
              if (routeMedian !== null) return routeMedian;

              const rideAverage = totalMovingSeconds > 0 && totalActivityDistanceKm > 0
                  ? totalActivityDistanceKm / (totalMovingSeconds / 3600)
                  : 0;

              if (rideAverage >= tuning.minKmh && rideAverage <= tuning.maxKmh) return rideAverage;
              return tuning.fallbackKmh;
          }

          function formatSplitTime(seconds) {
              const total = Math.max(0, Math.round(Number(seconds || 0)));
              const hours = Math.floor(total / 3600);
              const minutes = Math.floor((total % 3600) / 60);
              const secs = total % 60;

              if (hours > 0) {
                  return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
              }

              return minutes + ':' + String(secs).padStart(2, '0');
          }

          function formatSplitMetric(seconds, distance) {
              if (!seconds || !distance) return '--';

              if (activityType === 'run' || activityType === 'walk' || activityType === 'hike') {
                  return formatSplitTime(seconds / distance) + '/km';
              }

              return (distance / (seconds / 3600)).toFixed(1) + ' km/h';
          }

          function buildKilometerSplits(points) {
              if (!Array.isArray(points) || points.length < 2) return { splits: [], adjustedGapCount: 0, adjustedGapSeconds: 0 };

              const tuning = splitTuning();
              const fallbackSpeedKmh = estimateMovingSpeedKmh(points, tuning);

              let total = 0;
              let movingTotalSeconds = 0;
              let target = 1;
              let splitStartDistance = 0;
              let splitStartMovingSeconds = 0;
              let adjustedGapCount = 0;
              let adjustedGapSeconds = 0;
              const splits = [];

              for (let i = 1; i < points.length; i++) {
                  const prev = points[i - 1];
                  const cur = points[i];
                  const segmentKm = distanceKm(prev, cur);

                  if (!Number.isFinite(segmentKm) || segmentKm <= 0 || segmentKm > 2) continue;

                  const before = total;
                  const after = total + segmentKm;
                  const prevTime = pointTimeMs(prev);
                  const curTime = pointTimeMs(cur);
                  let segmentSeconds = segmentKm / (fallbackSpeedKmh / 3600);
                  let adjustedSegment = true;

                  if (prevTime !== null && curTime !== null && curTime >= prevTime) {
                      const elapsedSeconds = (curTime - prevTime) / 1000;
                      const speedKmh = elapsedSeconds > 0 ? segmentKm / (elapsedSeconds / 3600) : 0;
                      const looksLikeRestGap =
                          elapsedSeconds > tuning.restGapSeconds &&
                          (elapsedSeconds > 7200 || speedKmh < tuning.minKmh);
                      const looksLikeBadClock =
                          elapsedSeconds > 0 &&
                          (speedKmh > tuning.maxKmh || elapsedSeconds > 86400);

                      if (!looksLikeRestGap && !looksLikeBadClock && elapsedSeconds > 0) {
                          segmentSeconds = elapsedSeconds;
                          adjustedSegment = false;
                      } else {
                          adjustedGapCount += 1;
                          adjustedGapSeconds += Math.max(0, elapsedSeconds - segmentSeconds);
                      }
                  }

                  while (after >= target) {
                      const ratio = (target - before) / segmentKm;
                      const boundaryMovingSeconds = movingTotalSeconds + (segmentSeconds * ratio);

                      const distance = target - splitStartDistance;
                      const seconds = boundaryMovingSeconds - splitStartMovingSeconds;

                      splits.push({
                          index: splits.length + 1,
                          distance,
                          seconds,
                          partial: false,
                          adjusted: adjustedSegment
                      });

                      splitStartDistance = target;
                      splitStartMovingSeconds = boundaryMovingSeconds;
                      target += 1;
                  }

                  total = after;
                  movingTotalSeconds += segmentSeconds;
              }

              const leftover = total - splitStartDistance;
              if (leftover >= 0.1) {
                  const seconds = movingTotalSeconds - splitStartMovingSeconds;

                  splits.push({
                      index: splits.length + 1,
                      distance: leftover,
                      seconds,
                      partial: true,
                      adjusted: false
                  });
              }

              return {
                  splits: splits.filter(function(split) {
                  return split.distance > 0 && split.seconds !== null && split.seconds >= 0;
                  }),
                  adjustedGapCount,
                  adjustedGapSeconds
              };
          }

          function renderAutoSplits(points) {
              const section = document.getElementById('split-section');
              const list = document.getElementById('split-list');
              const note = document.getElementById('split-note');
              if (!section || !list || !note) return;

              const splitResult = buildKilometerSplits(points);
              const splits = splitResult.splits || [];
              if (splits.length === 0) {
                  section.style.display = 'none';
                  return;
              }

              const baseNote = totalMovingSeconds > 0 && totalActivityDistanceKm > 0
                  ? 'Dari ' + totalActivityDistanceKm.toFixed(2) + ' km aktivitas'
                  : 'Dihitung dari timestamp GPS';
              note.innerText = splitResult.adjustedGapCount > 0
                  ? baseNote + ' • jeda panjang diabaikan'
                  : baseNote;

              list.innerHTML = splits.map(function(split) {
                  const kmLabel = split.partial
                      ? split.distance.toFixed(2) + ' km'
                      : 'KM ' + split.index;
                  const time = formatSplitTime(split.seconds);
                  const metric = formatSplitMetric(split.seconds, split.distance);

                  return '<div class="split-row">' +
                      '<div class="split-km">' + kmLabel + '</div>' +
                      '<div class="split-time">' + time + '</div>' +
                      '<div class="split-metric">' + metric + '</div>' +
                  '</div>';
              }).join('');

              section.style.display = 'block';
          }

          function escapeClientHTML(str) {
              return String(str || '')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
          }

          function formatMatchDate(value) {
              if (!value) return '-';
              const date = new Date(value);
              if (Number.isNaN(date.getTime())) return String(value);
              return date.toLocaleDateString('id-ID');
          }

          function formatMatchDelta(seconds) {
              const delta = Math.round(Number(seconds || 0));
              const abs = Math.abs(delta);
              const prefix = delta < 0 ? 'Lebih cepat ' : delta > 0 ? 'Lebih lambat ' : 'Sama cepat';
              if (delta === 0) return prefix;
              return prefix + formatSplitTime(abs);
          }

          function renderMatchedActivities(matches) {
              const section = document.getElementById('match-section');
              const list = document.getElementById('match-list');
              const note = document.getElementById('match-note');
              if (!section || !list || !note) return;

              if (!Array.isArray(matches) || matches.length === 0) {
                  section.style.display = 'none';
                  return;
              }

              note.innerText = matches.length + ' aktivitas mirip ditemukan';
              list.innerHTML = matches.map(function(match) {
                  const delta = Number(match.time_delta_seconds || 0);
                  const deltaClass = delta < 0 ? 'match-better' : delta > 0 ? 'match-worse' : 'match-even';
                  const speedDelta = Number(match.speed_delta_kmh || 0);
                  const speedText = speedDelta === 0 ? '' : ' • ' + (speedDelta > 0 ? '+' : '') + speedDelta.toFixed(1) + ' km/h';
                  const elevationDelta = Number(match.elevation_delta_m || 0);
                  const elevationText = elevationDelta === 0 ? '' : ' • elev ' + (elevationDelta > 0 ? '+' : '') + Math.round(elevationDelta) + ' m';

                  return '<a class="match-card" href="/detail/' + encodeURIComponent(match.id) + '">' +
                      '<div>' +
                          '<div class="match-name">' + escapeClientHTML(match.name) + '</div>' +
                          '<div class="match-meta">' +
                              Number(match.distance || 0).toFixed(2) + ' km • ' +
                              formatSplitTime(match.moving_time || 0) + ' • ' +
                              formatMatchDate(match.start_date) +
                          '</div>' +
                          '<div class="match-delta ' + deltaClass + '">' +
                              formatMatchDelta(delta) + speedText + elevationText +
                          '</div>' +
                      '</div>' +
                      '<div class="match-score">' + Math.round(match.similarity_percent || 0) + '%</div>' +
                  '</a>';
              }).join('');

              section.style.display = 'block';
          }

          async function loadMatchedActivities() {
              if (!canLoadMatches) return;

              try {
                  const res = await fetch('/api/matched_activities/' + encodeURIComponent(currentRideId), {
                      cache: 'no-store'
                  });
                  const data = await res.json();

                  if (!res.ok || !data.success) {
                      throw new Error(data.message || 'Gagal memuat rute mirip.');
                  }

                  renderMatchedActivities(data.matches || []);
              } catch (err) {
                  console.error('Gagal memuat matched activities:', err);
              }
          }

          loadMatchedActivities();

          let segmentRoutePoints = [];
          let segmentCumulativeKm = [];

          function setSegmentStatus(text, isError) {
              const el = document.getElementById('segment-status');
              if (!el) return;
              el.innerText = text;
              el.style.color = isError ? '#e74c3c' : '#94a3b8';
          }

          function buildSegmentCumulative(points) {
              const out = [0];
              for (let i = 1; i < points.length; i++) {
                  out.push(out[i - 1] + distanceKm(points[i - 1], points[i]));
              }
              return out;
          }

          function getSegmentSelection() {
              const startInput = document.getElementById('segment-start');
              const endInput = document.getElementById('segment-end');
              if (!startInput || !endInput || segmentRoutePoints.length < 2) return null;

              let startIndex = Number(startInput.value || 0);
              let endIndex = Number(endInput.value || 0);

              if (endIndex <= startIndex) {
                  endIndex = Math.min(segmentRoutePoints.length - 1, startIndex + 1);
                  endInput.value = String(endIndex);
              }

              return { startIndex, endIndex };
          }

          function updateSegmentPreview() {
              const selection = getSegmentSelection();
              if (!selection || segmentCumulativeKm.length === 0) return;

              const totalIndex = Math.max(1, segmentRoutePoints.length - 1);
              const startPercent = Math.round((selection.startIndex / totalIndex) * 100);
              const endPercent = Math.round((selection.endIndex / totalIndex) * 100);
              const startKm = segmentCumulativeKm[selection.startIndex] || 0;
              const endKm = segmentCumulativeKm[selection.endIndex] || 0;
              const distance = Math.max(0, endKm - startKm);

              document.getElementById('segment-start-label').innerText = startPercent + '%';
              document.getElementById('segment-end-label').innerText = endPercent + '%';
              document.getElementById('segment-distance').innerText = distance.toFixed(2);
              document.getElementById('segment-start-km').innerText = startKm.toFixed(2);
              document.getElementById('segment-end-km').innerText = endKm.toFixed(2);
          }

          function renderSegmentEfforts(efforts, title) {
              const el = document.getElementById('segment-efforts');
              if (!el) return;

              if (!Array.isArray(efforts) || efforts.length === 0) {
                  el.innerHTML = '<div class="segment-card"><div class="segment-card-meta">Belum ada effort lain yang cocok untuk segmen ini.</div></div>';
                  return;
              }

              el.innerHTML =
                  '<div class="segment-title" style="margin-top:10px;">' + escapeClientHTML(title || 'Leaderboard Pribadi') + '</div>' +
                  efforts.slice(0, 5).map(function(effort, index) {
                      return '<a class="segment-card" href="/detail/' + encodeURIComponent(effort.ride_id) + '">' +
                          '<div class="segment-card-title">#' + (index + 1) + ' ' + escapeClientHTML(effort.ride_name) + '</div>' +
                          '<div class="segment-card-meta">' +
                              formatSplitTime(effort.elapsed_seconds || 0) + ' • ' +
                              Number(effort.distance_km || 0).toFixed(2) + ' km • ' +
                              Number(effort.average_speed || 0).toFixed(1) + ' km/h' +
                              (effort.is_source ? ' • sumber segmen' : '') +
                          '</div>' +
                      '</a>';
                  }).join('');
          }

          function renderActivitySegments(matches) {
              const el = document.getElementById('activity-segments');
              if (!el) return;

              if (!Array.isArray(matches) || matches.length === 0) {
                  el.innerHTML = '';
                  return;
              }

              el.innerHTML =
                  '<div class="segment-title" style="margin-top:14px;">Segmen yang Kena di Aktivitas Ini</div>' +
                  matches.slice(0, 5).map(function(item) {
                      const segment = item.segment || {};
                      const effort = item.effort || {};
                      const best = item.best || null;
                      const delta = Number(item.delta_seconds || 0);
                      const deltaText = best
                          ? (delta <= 0 ? 'PR / tercepat pribadi' : 'Lebih lambat ' + formatSplitTime(delta) + ' dari PR')
                          : 'Effort pertama';

                      return '<div class="segment-card">' +
                          '<div class="segment-card-title">' + escapeClientHTML(segment.name || 'Personal Segment') + '</div>' +
                          '<div class="segment-card-meta">' +
                              formatSplitTime(effort.elapsed_seconds || 0) + ' • ' +
                              Number(effort.distance_km || segment.distance_km || 0).toFixed(2) + ' km • ' +
                              deltaText +
                          '</div>' +
                      '</div>';
                  }).join('');
          }

          async function loadActivitySegments() {
              if (!canLoadMatches) return;

              try {
                  const res = await fetch('/api/activity_segments/' + encodeURIComponent(currentRideId), {
                      cache: 'no-store'
                  });
                  const data = await res.json();

                  if (!res.ok || !data.success) return;
                  renderActivitySegments(data.matches || []);
              } catch (err) {
                  console.error('Gagal memuat segment aktivitas:', err);
              }
          }

          async function savePersonalSegment() {
              const selection = getSegmentSelection();
              if (!selection) return;

              const name = String(document.getElementById('segment-name')?.value || '').trim() || 'Personal Segment';
              const btn = document.getElementById('segment-save');
              if (btn) btn.disabled = true;
              setSegmentStatus('Menyimpan personal segment...', false);

              try {
                  const res = await fetch('/api/segments', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                          source_ride_id: currentRideId,
                          name: name,
                          start_index: selection.startIndex,
                          end_index: selection.endIndex
                      })
                  });
                  const data = await res.json();

                  if (!res.ok || !data.success) {
                      throw new Error(data.message || 'Gagal membuat segment.');
                  }

                  setSegmentStatus('Segment #' + data.segment.id + ' tersimpan: ' + Number(data.segment.distance_km || 0).toFixed(2) + ' km.', false);
                  renderSegmentEfforts(data.efforts || [], 'Leaderboard Segment Baru');
                  loadActivitySegments();
              } catch (err) {
                  console.error(err);
                  setSegmentStatus(err.message || 'Gagal membuat segment.', true);
              } finally {
                  if (btn) btn.disabled = false;
              }
          }

          function initSegmentBuilder(points) {
              if (!canLoadMatches) return;

              const section = document.getElementById('segment-section');
              const startInput = document.getElementById('segment-start');
              const endInput = document.getElementById('segment-end');
              const saveButton = document.getElementById('segment-save');
              if (!section || !startInput || !endInput || !saveButton) return;

              if (!Array.isArray(points) || points.length < 3) {
                  section.style.display = 'none';
                  return;
              }

              segmentRoutePoints = points;
              segmentCumulativeKm = buildSegmentCumulative(points);
              const maxIndex = points.length - 1;
              startInput.max = String(maxIndex);
              endInput.max = String(maxIndex);
              startInput.value = String(Math.max(0, Math.round(maxIndex * 0.2)));
              endInput.value = String(Math.max(1, Math.round(maxIndex * 0.6)));
              startInput.oninput = updateSegmentPreview;
              endInput.oninput = updateSegmentPreview;
              saveButton.onclick = savePersonalSegment;
              updateSegmentPreview();
              section.style.display = 'block';
              setSegmentStatus('Pilih start dan finish segmen, lalu simpan.', false);
          }


          let latestDoctorResult = null;
          let doctorIsApplying = false;

          function getDoctorModal() {
              return document.getElementById('doctor-modal');
          }

          function openActivityDoctor() {
              if (!canLoadMatches) return;
              const modal = getDoctorModal();
              if (!modal) return;
              modal.classList.add('is-open');
              if (!latestDoctorResult) scanActivityDoctor();
          }

          function closeActivityDoctor() {
              const modal = getDoctorModal();
              if (modal) modal.classList.remove('is-open');
          }

          function setDoctorMessage(text, isError) {
              const el = document.getElementById('doctor-message');
              if (!el) return;
              el.innerText = text || '';
              el.style.color = isError ? '#fca5a5' : 'var(--text-muted)';
          }

          function setDoctorBusy(isBusy, text) {
              const scanBtn = document.getElementById('doctor-rescan-btn');
              const applyBtn = document.getElementById('doctor-apply-btn');
              if (scanBtn) scanBtn.disabled = isBusy;
              if (applyBtn) applyBtn.disabled = true;
              if (text) setDoctorMessage(text, false);
          }

          function doctorStatusLabel(status) {
              if (status === 'healthy') return 'SEHAT';
              if (status === 'repairable') return 'REPAIRABLE';
              if (status === 'needs_attention') return 'PERLU PERHATIAN';
              if (status === 'broken') return 'BUTUH MANUAL CHECK';
              return 'BELUM DICEK';
          }

          function doctorSeverityLabel(severity) {
              if (severity === 'danger') return 'DANGER';
              if (severity === 'warning') return 'WARNING';
              return 'INFO';
          }

          function formatDoctorDuration(seconds) {
              return formatSplitTime(Math.max(0, Math.round(Number(seconds || 0))));
          }

          function formatDoctorValue(field, value) {
              if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
              if (value && typeof value === 'object') return JSON.stringify(value);
              if (value === null || value === undefined || value === '') return '-';

              const numeric = Number(value);
              if (field === 'moving_time' || String(field || '').includes('time')) {
                  return Number.isFinite(numeric) ? formatDoctorDuration(numeric) : String(value);
              }
              if (field === 'distance' || String(field || '').includes('distance')) {
                  return Number.isFinite(numeric) ? numeric.toFixed(2) + ' km' : String(value);
              }
              if (field === 'average_speed' || field === 'max_speed') {
                  return Number.isFinite(numeric) ? numeric.toFixed(1) + ' km/h' : String(value);
              }
              if (String(field || '').includes('elevation')) {
                  return Number.isFinite(numeric) ? Math.round(numeric) + ' m' : String(value);
              }

              return String(value);
          }

          function renderDoctorCounts(counts, restBlocks) {
              const el = document.getElementById('doctor-counts');
              if (!el) return;
              const data = counts || {};
              const rest = restBlocks || {};
              el.innerHTML =
                  '<div class="doctor-mini"><strong>' + Number(data.raw_points || 0) + '</strong><span>Raw Point</span></div>' +
                  '<div class="doctor-mini"><strong>' + Number(data.normalized_points || 0) + '</strong><span>Normal</span></div>' +
                  '<div class="doctor-mini"><strong>' + Number(data.invalid_points || 0) + '</strong><span>Invalid</span></div>' +
                  '<div class="doctor-mini"><strong>' + Number(data.duplicate_points || 0) + '</strong><span>Duplikat</span></div>' +
                  '<div class="doctor-mini"><strong>' + Number(data.swapped_points || 0) + '</strong><span>Lng/Lat</span></div>' +
                  '<div class="doctor-mini"><strong>' + Number(rest.detected_count || 0) + '</strong><span>Rest Gap</span></div>';
          }

          function renderDoctorStats(stats) {
              const el = document.getElementById('doctor-stats');
              if (!el) return;
              const current = stats && stats.current ? stats.current : {};
              const recalculated = stats && stats.recalculated ? stats.recalculated : {};
              const rows = [
                  ['distance_km', 'Jarak', 'distance'],
                  ['moving_time', 'Moving Time', 'moving_time'],
                  ['average_speed', 'Average Speed', 'average_speed'],
                  ['max_speed', 'Max Speed', 'max_speed'],
                  ['total_elevation_gain', 'Elevasi', 'total_elevation_gain']
              ];

              el.innerHTML = rows.map(function(row) {
                  const key = row[0];
                  const label = row[1];
                  const formatterField = row[2];
                  const before = current[key];
                  const after = recalculated[key];
                  const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
                  return '<div class="doctor-change">' +
                      '<div class="doctor-change-field">' + escapeClientHTML(label) + (changed ? ' • akan disesuaikan' : ' • stabil') + '</div>' +
                      '<div class="doctor-before-after">D1: ' + escapeClientHTML(formatDoctorValue(formatterField, before)) + ' → Repair: ' + escapeClientHTML(formatDoctorValue(formatterField, after)) + '</div>' +
                  '</div>';
              }).join('');
          }

          function renderDoctorIssues(issues) {
              const el = document.getElementById('doctor-issues');
              if (!el) return;
              if (!Array.isArray(issues) || issues.length === 0) {
                  el.innerHTML = '<div class="doctor-empty">Tidak ada masalah. Aktivitas terlihat sehat.</div>';
                  return;
              }

              el.innerHTML = issues.map(function(issue) {
                  const severity = String(issue.severity || 'info');
                  const fixText = issue.fixable ? 'Bisa auto repair' : 'Tidak aman untuk auto repair';
                  const countText = Number.isFinite(Number(issue.count)) ? ' • ' + Number(issue.count) + ' item' : '';
                  return '<div class="doctor-issue">' +
                      '<div class="doctor-severity ' + escapeClientHTML(severity) + '">' + escapeClientHTML(doctorSeverityLabel(severity)) + '</div>' +
                      '<div>' +
                          '<div class="doctor-issue-title">' + escapeClientHTML(issue.title || issue.code || 'Issue') + '</div>' +
                          '<div class="doctor-issue-detail">' + escapeClientHTML(issue.detail || '-') + '</div>' +
                          '<div class="doctor-issue-detail" style="margin-top:5px;">' + escapeClientHTML(fixText + countText) + '</div>' +
                      '</div>' +
                  '</div>';
              }).join('');
          }

          function renderDoctorChanges(changes) {
              const el = document.getElementById('doctor-changes');
              if (!el) return;
              if (!Array.isArray(changes) || changes.length === 0) {
                  el.innerHTML = '<div class="doctor-empty">Tidak ada perubahan yang direncanakan.</div>';
                  return;
              }

              el.innerHTML = changes.map(function(change) {
                  return '<div class="doctor-change">' +
                      '<div class="doctor-change-field">' + escapeClientHTML(change.field || 'field') + '</div>' +
                      '<div class="doctor-change-detail">' + escapeClientHTML(change.reason || '-') + '</div>' +
                      '<div class="doctor-before-after">' +
                          escapeClientHTML(formatDoctorValue(change.field, change.before)) +
                          ' → ' +
                          escapeClientHTML(formatDoctorValue(change.field, change.after)) +
                      '</div>' +
                  '</div>';
              }).join('');
          }

          function renderDoctorActions(actions) {
              const el = document.getElementById('doctor-actions');
              if (!el) return;
              if (!Array.isArray(actions) || actions.length === 0) {
                  el.innerHTML = '<span class="doctor-action-chip">Tidak ada action</span>';
                  return;
              }

              el.innerHTML = actions.map(function(action) {
                  return '<span class="doctor-action-chip">' + escapeClientHTML(String(action || '').replace(/_/g, ' ')) + '</span>';
              }).join('');
          }

          function renderActivityDoctorResponse(data, applyResult) {
              latestDoctorResult = data || null;
              const doctor = data && data.doctor ? data.doctor : null;
              const statusPill = document.getElementById('doctor-status-pill');
              const source = document.getElementById('doctor-source');
              const summary = document.getElementById('doctor-summary');
              const applyBtn = document.getElementById('doctor-apply-btn');

              if (!doctor) {
                  if (summary) summary.innerText = data && data.message ? data.message : 'Activity Doctor belum punya hasil.';
                  if (applyBtn) applyBtn.disabled = true;
                  return;
              }

              if (statusPill) {
                  statusPill.className = 'doctor-pill ' + String(doctor.status || '');
                  statusPill.innerText = doctorStatusLabel(doctor.status);
              }

              if (source) {
                  const guard = doctor.guardrails || {};
                  source.innerText = 'Source: ' + (doctor.source || '-') +
                      (doctor.raw_shape ? ' • ' + doctor.raw_shape : '') +
                      (guard.version ? ' • guard v' + guard.version : '');
              }

              if (summary) {
                  const issues = Array.isArray(doctor.issues) ? doctor.issues.length : 0;
                  const changes = Array.isArray(doctor.changes) ? doctor.changes.length : 0;
                  summary.innerText = data.message || (
                      doctor.healthy
                          ? 'Aktivitas terlihat sehat.'
                          : 'Ditemukan ' + issues + ' issue dan ' + changes + ' rencana perubahan.'
                  );
              }

              renderDoctorCounts(doctor.counts, doctor.rest_blocks);
              renderDoctorStats(doctor.stats);
              renderDoctorIssues(doctor.issues);
              renderDoctorChanges(doctor.changes);
              renderDoctorActions(doctor.repair_plan);

              if (applyBtn) {
                  applyBtn.disabled = doctorIsApplying || !doctor.can_auto_repair || doctor.healthy;
                  applyBtn.innerText = doctor.healthy ? 'TIDAK PERLU REPAIR' : 'APPLY AUTO REPAIR';
              }

              if (applyResult && applyResult.repair && applyResult.repair.stats) {
                  setDoctorMessage('Auto repair diterapkan. Backup: ' + (applyResult.repair.backup_key || '-') + '. Halaman akan reload agar angka terbaru tampil.', false);
              } else {
                  setDoctorMessage(doctor.can_auto_repair ? 'Auto repair aman tersedia. Apply akan membuat backup R2 dulu sebelum update D1.' : 'Tidak ada auto repair aman untuk diterapkan.', doctor.status === 'broken');
              }
          }

          async function scanActivityDoctor() {
              if (!canLoadMatches) return;
              latestDoctorResult = null;
              setDoctorBusy(true, 'Activity Doctor sedang memeriksa aktivitas...');

              try {
                  const res = await fetch('/api/activity_doctor/' + encodeURIComponent(currentRideId), {
                      cache: 'no-store'
                  });
                  const data = await res.json();

                  if (!res.ok || !data.success) {
                      throw new Error(data.message || 'Activity Doctor gagal scan.');
                  }

                  renderActivityDoctorResponse(data);
              } catch (err) {
                  console.error(err);
                  setDoctorMessage(err.message || 'Activity Doctor gagal scan.', true);
              } finally {
                  const scanBtn = document.getElementById('doctor-rescan-btn');
                  if (scanBtn) scanBtn.disabled = false;
                  const applyBtn = document.getElementById('doctor-apply-btn');
                  const doctor = latestDoctorResult && latestDoctorResult.doctor ? latestDoctorResult.doctor : null;
                  if (applyBtn && doctor) applyBtn.disabled = !doctor.can_auto_repair || doctor.healthy;
              }
          }

          async function applyActivityDoctor() {
              if (!canLoadMatches || doctorIsApplying) return;
              const doctor = latestDoctorResult && latestDoctorResult.doctor ? latestDoctorResult.doctor : null;
              if (!doctor || !doctor.can_auto_repair || doctor.healthy) return;

              const ok = window.confirm('Activity Doctor akan membuat backup R2 lalu menerapkan auto repair. Lanjutkan?');
              if (!ok) return;

              doctorIsApplying = true;
              setDoctorBusy(true, 'Membuat backup R2 dan menerapkan auto repair...');

              try {
                  const res = await fetch('/api/activity_doctor/' + encodeURIComponent(currentRideId) + '/apply', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                          confirm_auto_repair: true,
                          expected_actions: Array.isArray(doctor.repair_plan) ? doctor.repair_plan : [],
                          doctor_status: doctor.status || ''
                      })
                  });
                  const data = await res.json();

                  if (!res.ok || !data.success) {
                      throw new Error(data.message || 'Auto repair gagal diterapkan.');
                  }

                  renderActivityDoctorResponse(data, data);

                  if (data.applied) {
                      setTimeout(function() {
                          window.location.reload();
                      }, 1800);
                  }
              } catch (err) {
                  console.error(err);
                  setDoctorMessage(err.message || 'Auto repair gagal diterapkan.', true);
              } finally {
                  doctorIsApplying = false;
                  const scanBtn = document.getElementById('doctor-rescan-btn');
                  if (scanBtn) scanBtn.disabled = false;
                  const applyBtn = document.getElementById('doctor-apply-btn');
                  const nextDoctor = latestDoctorResult && latestDoctorResult.doctor ? latestDoctorResult.doctor : null;
                  if (applyBtn && nextDoctor) applyBtn.disabled = !nextDoctor.can_auto_repair || nextDoctor.healthy;
              }
          }

          async function takeScreenshot(mode) {
              const target = (mode === 'standard')
                  ? document.getElementById('capture-area')
                  : document.getElementById('minimalist-card');

              const originalScrollY = window.scrollY;
              window.scrollTo(0, 0);

              let infoPanel = null;

              if (mode === 'standard') {
                  target.style.background = 'transparent';
                  target.style.border = 'none';

                  infoPanel = target.querySelector('.info-panel');

                  if (infoPanel) {
                      infoPanel.style.background = 'transparent';
                      infoPanel.style.borderTop = 'none';
                  }

                  map.invalidateSize(true);
                  await refitStandardMapForCapture();
              }

              if (mode === 'minimalist') {
                  target.style.position = 'relative';
                  target.style.left = '0';
              }

              setTimeout(() => {
                  html2canvas(target, {
                      backgroundColor: null,
                      scale: 2,
                      useCORS: true,
                      scrollX: 0,
                      scrollY: 0
                  }).then(canvas => {
                      if (mode === 'minimalist') {
                          target.style.position = 'absolute';
                          target.style.left = '-9999px';
                      }

                      if (mode === 'standard') {
                          target.style.background = '';
                          target.style.border = '';

                          if (infoPanel) {
                              infoPanel.style.background = '';
                              infoPanel.style.borderTop = '';
                          }
                      }

                      window.scrollTo(0, originalScrollY);

                      const link = document.createElement('a');
                      link.download = 'Gaspool_' + mode + '_' + Date.now() + '.png';
                      link.href = canvas.toDataURL();
                      link.click();
                  }).catch(err => {
                      console.error('Gagal render grafis:', err);

                      if (mode === 'minimalist') {
                          target.style.position = 'absolute';
                          target.style.left = '-9999px';
                      }

                      if (mode === 'standard') {
                          target.style.background = '';
                          target.style.border = '';

                          if (infoPanel) {
                              infoPanel.style.background = '';
                              infoPanel.style.borderTop = '';
                          }
                      }

                      window.scrollTo(0, originalScrollY);
                      alert('Gagal merender gambar. Coba lagi dalam beberapa detik.');
                  });
              }, 1000);
          }

          async function downloadGPX() {
              try {
                  const coords = await getCoordinates();

                  if (coords.length === 0) return;

                  const safeName = ${JSON.stringify(safeGPXName)};

                  let g = '<?xml version="1.0" encoding="UTF-8"?>' +
                      '<gpx version="1.1" creator="Gaspool" xmlns="http://www.topografix.com/GPX/1/1">' +
                      '<trk><name>' + safeName + '</name><trkseg>\\n';

                  coords.forEach(p => {
                      g += '<trkpt lat="' + p.lat + '" lon="' + p.lng + '">';

                      if (p.ele) g += '<ele>' + p.ele + '</ele>';
                      if (p.time) g += '<time>' + p.time + '</time>';

                      g += '</trkpt>\\n';
                  });

                  g += '</trkseg></trk></gpx>';

                  const b = new Blob([g], {
                      type: 'application/gpx+xml'
                  });

                  const u = URL.createObjectURL(b);
                  const a = document.createElement('a');

                  a.download = 'Gaspool_Route.gpx';
                  a.href = u;
                  a.click();

                  URL.revokeObjectURL(u);
              } catch (e) {
                  console.error('Gagal download GPX:', e);
              }
          }
      </script>
      </body>
      </html>
    `);
  } catch (e) {
    return c.redirect("/");
  }
});

// ==========================================
// 2. VIDEO FLEXING (Satelit Sinematik FULL)
// ==========================================
studio.get("/video_flex/:id", async (c) => {
  const token = getCookie(c, "gaspool_session");

  if (!token) return c.redirect("/login");

  const id = c.req.param("id");

  try {
    const ride: any = await c.env.DB.prepare("SELECT * FROM rides WHERE id = ?")
      .bind(id)
      .first();

    if (!ride) return c.text("Aktivitas tidak ditemukan!", 404);

    const type = ride.activity_type || "ride";
    const isPace = type === "run" || type === "walk" || type === "hike";

    let participants: any[] = [];

    if (ride.participants && ride.participants !== "[]") {
      try {
        const parsedParticipants = JSON.parse(ride.participants);

        if (Array.isArray(parsedParticipants)) {
          participants = parsedParticipants;
        }
      } catch (e) {}
    }

    const startHour = new Date(ride.start_date || new Date()).getHours();

    const escapeHTML = (str: string = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const safeRideName = escapeHTML(ride.name || "Aktivitas");

    return c.html(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>Gaspool Cinema: ${safeRideName}</title>

          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

          <style>
              * {
                  box-sizing: border-box;
              }

              :root {
                  --primary: #FF5F00;
                  --bg-color: #0a0a12;
                  --bg-overlay: rgba(0, 0, 0, 0.95);
                  --text-pure: #ffffff;
              }

              body,
              html {
                  margin: 0;
                  padding: 0;
                  height: 100%;
                  width: 100%;
                  background: var(--bg-color);
                  font-family: 'Inter', sans-serif;
                  overflow: hidden;
                  user-select: none;
              }

              #video-container {
                  position: relative;
                  width: 100vw;
                  height: 100vh;
                  margin: 0 auto;
                  background: var(--bg-color);
                  overflow: hidden;
              }

              #map {
                  width: 100%;
                  height: 100%;
                  background: #000000;
                  z-index: 1;
              }

              .stat-overlay-top {
                  position: absolute;
                  top: 14px;
                  left: 14px;
                  right: 14px;
                  background: transparent;
                  border: none;
                  z-index: 1000;
                  transition: 0.3s;
              }

              .stat-overlay-top h2 {
                  margin: 0 0 9px 0;
                  font-size: 1.12rem;
                  font-weight: 900;
                  font-style: italic;
                  color: var(--text-pure);
                  text-align: center;
                  letter-spacing: 0.8px;
                  line-height: 1.15;
                  text-shadow:
                      0px 4px 10px rgba(0,0,0,1),
                      0px 0px 5px rgba(0,0,0,1);
              }

              .grid-stats {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 5px;
                  text-align: center;
              }

              .stat-item {
                  background: transparent;
                  padding: 2px 4px;
              }

              .stat-item label {
                  display: block;
                  font-size: 0.52rem;
                  font-weight: 900;
                  margin-bottom: 2px;
                  letter-spacing: 1.4px;
                  color: var(--text-pure);
                  text-shadow:
                      0px 3px 8px rgba(0,0,0,1),
                      0px 0px 4px rgba(0,0,0,1);
              }

              .stat-item span {
                  font-size: 1.55rem;
                  font-weight: 900;
                  color: var(--text-pure);
                  line-height: 1;
                  text-shadow:
                      0px 4px 10px rgba(0,0,0,1),
                      0px 0px 5px rgba(0,0,0,1);
              }

              .stat-item small {
                  font-size: 0.58rem;
                  font-weight: 900;
                  color: var(--primary);
                  margin-left: 2px;
                  text-shadow: 0px 2px 5px rgba(0,0,0,1);
              }

              .stat-main {
                  grid-column: span 2;
              }

              .stat-main span {
                  font-size: 1.9rem;
              }

              .rider-label {
                  text-align: center;
                  white-space: nowrap;
              }

              .rider-bubble {
                  width: 28px;
                  height: 28px;
                  border-radius: 50%;
                  border: 2px solid #ffffff;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: #ffffff;
                  font-size: 10px;
                  font-weight: 900;
                  line-height: 1;
                  box-shadow: 0 0 16px rgba(0,0,0,0.95);
                  text-shadow: 0 2px 4px rgba(0,0,0,0.85);
              }

              .peleton-board {
                  display: none;
                  margin: 9px auto 0 auto;
                  max-width: 520px;
                  padding: 8px 9px;
                  border-radius: 14px;
                  background: rgba(0,0,0,0.48);
                  border: 1px solid rgba(255,255,255,0.16);
                  backdrop-filter: blur(10px);
                  box-shadow: 0 8px 22px rgba(0,0,0,0.45);
              }

              .peleton-title {
                  font-size: 0.52rem;
                  font-weight: 900;
                  color: var(--primary);
                  letter-spacing: 1.4px;
                  text-align: center;
                  margin-bottom: 6px;
                  text-shadow: 0 2px 5px rgba(0,0,0,1);
              }

              .peleton-chips {
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: center;
                  gap: 5px;
              }

              .rider-chip {
                  display: inline-flex;
                  align-items: center;
                  gap: 5px;
                  max-width: 150px;
                  min-width: 0;
                  font-size: 0.62rem;
                  font-weight: 900;
                  line-height: 1.1;
                  color: #ffffff;
                  background: rgba(255,255,255,0.09);
                  border: 1px solid rgba(255,255,255,0.08);
                  border-radius: 999px;
                  padding: 5px 8px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  text-shadow: 0 2px 5px rgba(0,0,0,1);
              }

              .chip-dot {
                  width: 8px;
                  height: 8px;
                  border-radius: 50%;
                  flex: 0 0 auto;
                  box-shadow: 0 0 8px rgba(255,255,255,0.45);
              }

              .more-chip {
                  justify-content: center;
                  color: #d6d6d6;
                  background: rgba(255,255,255,0.05);
              }

              .brand-badge {
                  position: absolute;
                  bottom: 40px;
                  left: 50%;
                  transform: translateX(-50%);
                  background: transparent;
                  z-index: 1000;
                  transition: opacity 0.5s;
                  height: 105px;
                  filter: drop-shadow(0 5px 15px rgba(0,0,0,0.8));
              }

              #ending-overlay {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: var(--bg-overlay);
                  z-index: 3000;
                  display: none;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  text-align: center;
                  color: var(--text-pure);
              }

              #controls {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: var(--bg-overlay);
                  z-index: 2000;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  padding: 20px;
              }

              .btn-play {
                  background: var(--primary);
                  color: #fff;
                  border: none;
                  padding: 18px 40px;
                  border-radius: 15px;
                  font-size: 1.1rem;
                  font-weight: 900;
                  font-style: italic;
                  cursor: pointer;
                  box-shadow: 0 10px 30px rgba(255,95,0,0.4);
                  transition: 0.3s;
                  width: 100%;
                  max-width: 300px;
                  margin-bottom: 15px;
              }

              .btn-play:disabled {
                  cursor: not-allowed;
                  opacity: 0.5;
                  box-shadow: none;
              }

              .btn-cancel {
                  background: #333;
                  box-shadow: none;
              }

              .instructions {
                  color: var(--text-pure);
                  text-align: center;
                  margin-top: 20px;
                  font-size: 0.9rem;
                  font-weight: bold;
                  opacity: 0.8;
              }

              #countdown {
                  display: none;
                  font-size: 120px;
                  color: var(--primary);
                  font-weight: 900;
                  font-style: italic;
                  text-shadow: 0 0 40px var(--primary);
              }

              @media (max-width: 420px) {
                  .stat-overlay-top {
                      top: 12px;
                      left: 10px;
                      right: 10px;
                  }

                  .stat-overlay-top h2 {
                      font-size: 1rem;
                      margin-bottom: 7px;
                  }

                  .grid-stats {
                      gap: 3px;
                  }

                  .stat-item label {
                      font-size: 0.48rem;
                      letter-spacing: 1px;
                  }

                  .stat-item span {
                      font-size: 1.28rem;
                  }

                  .stat-main span {
                      font-size: 1.65rem;
                  }

                  .stat-item small {
                      font-size: 0.52rem;
                  }

                  .peleton-board {
                      margin-top: 7px;
                      padding: 7px;
                      border-radius: 12px;
                  }

                  .peleton-title {
                      font-size: 0.48rem;
                      margin-bottom: 5px;
                  }

                  .rider-chip {
                      max-width: 118px;
                      font-size: 0.56rem;
                      padding: 4px 7px;
                  }

                  .brand-badge {
                      height: 86px;
                      bottom: 30px;
                  }
              }
          </style>
      </head>

      <body>
      <div id="video-container">
          <div id="map"></div>

          <div class="stat-overlay-top">
              <h2>${safeRideName}</h2>

              <div class="grid-stats">
                  <div class="stat-item stat-main">
                      <label>JARAK TEMPUH</label>
                      <span id="v-dist">0.00</span> <small>KM</small>
                  </div>

                  <div class="stat-item">
                      <label id="label-speed-pace">${isPace ? "PACE" : "SPEED"}</label>
                      <span id="v-speed">0.0</span> <small id="unit-speed-pace">${isPace ? "MIN/KM" : "KM/H"}</small>
                  </div>

                  <div class="stat-item">
                      <label>ELEVASI</label>
                      <span id="v-elev">0</span> <small>M</small>
                  </div>

                  <div class="stat-item">
                      <label>WAKTU</label>
                      <span id="v-time">00:00:00</span>
                  </div>

                  <div class="stat-item">
                      <label>SUHU</label>
                      <span id="v-temp">--</span> <small>&deg;C</small>
                  </div>
              </div>

              <div id="peleton-board" class="peleton-board"></div>
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
          const rawUrl = ${JSON.stringify(ride.polyline || "")};
          const totalDistTarget = ${parseFloat(ride.distance || 0)};
          const totalElevTarget = ${Math.round(ride.total_elevation_gain || 0)};
          const movingTimeTarget = ${parseInt(ride.moving_time || 0)};
          const tempTarget = ${parseFloat(ride.avg_temp || 0)};
          const activityType = '${type}';
          const startHour = ${startHour};
          const ridersList = ${JSON.stringify(participants)};
          const isPeleton = ridersList.length > 0;
          const isPace = ${isPace};

          const map = L.map('map', {
              zoomControl: false,
              attributionControl: false
          }).setView([-2.5489, 118.0149], 4);

          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
              maxZoom: 19,
              crossOrigin: 'anonymous'
          }).addTo(map);

          const outlineLine = L.polyline([], {
              color: '#ffffff',
              weight: 10,
              opacity: 0.9
          }).addTo(map);

          const animatedLine = L.polyline([], {
              color: '#FF5F00',
              weight: 6,
              opacity: 1.0
          }).addTo(map);

          let fullPath = [];
          let markers = [];

          function decodePolyline(str, precision = 5) {
              let index = 0;
              let lat = 0;
              let lng = 0;
              let coordinates = [];
              let shift = 0;
              let result = 0;
              let byte = null;
              const factor = Math.pow(10, precision);

              while (index < str.length) {
                  byte = null;
                  shift = 0;
                  result = 0;

                  do {
                      byte = str.charCodeAt(index++) - 63;
                      result |= (byte & 0x1f) << shift;
                      shift += 5;
                  } while (byte >= 0x20);

                  const lat_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

                  shift = 0;
                  result = 0;

                  do {
                      byte = str.charCodeAt(index++) - 63;
                      result |= (byte & 0x1f) << shift;
                      shift += 5;
                  } while (byte >= 0x20);

                  const lng_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

                  lat += lat_change;
                  lng += lng_change;

                  coordinates.push([lat / factor, lng / factor]);
              }

              return coordinates;
          }

          function escapeClientHTML(value) {
              return String(value || '')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
          }

          function getInitials(name) {
              const clean = String(name || 'R').trim();
              const parts = clean.split(/\\s+/).filter(Boolean);

              if (parts.length === 0) return 'R';
              if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();

              return (parts[0][0] + parts[1][0]).toUpperCase();
          }

          function getPeletonPixelOffset(index, total) {
    const count = Math.max(total, 1);

    if (count <= 1) {
        return [0, 0];
    }

    // Khusus 2 orang: kiri-kanan agar BR dan MA pasti kelihatan.
    if (count === 2) {
        return index === 0 ? [-34, 0] : [34, 0];
    }

    // 3 orang ke atas: bentuk lingkaran kecil di sekitar titik utama.
    const radius = count <= 5 ? 34 : 42;
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;

    return [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
    ];
}

function getOffsetLatLng(baseLatLng, index, total) {
    const basePoint = map.latLngToContainerPoint(baseLatLng);
    const offset = getPeletonPixelOffset(index, total);

    const targetPoint = L.point(
        basePoint.x + offset[0],
        basePoint.y + offset[1]
    );

    return map.containerPointToLatLng(targetPoint);
}

function spreadPeletonMarkers(baseLatLng) {
    markers.forEach((marker, i) => {
        if (isPeleton) {
            marker.setLatLng(
                getOffsetLatLng(baseLatLng, i, markers.length)
            );
        } else {
            marker.setLatLng(baseLatLng);
        }
    });
}

          function buildPeletonBoard(colors) {
              const board = document.getElementById('peleton-board');

              if (!board || !isPeleton) {
                  if (board) board.style.display = 'none';
                  return;
              }

              const visibleRiders = ridersList.slice(0, 10);
              let html = '';

              html += '<div class="peleton-title">👥 PELETON ' + ridersList.length + ' ANGGOTA</div>';
              html += '<div class="peleton-chips">';

              visibleRiders.forEach((name, i) => {
                  const color = colors[i % colors.length];

                  html +=
                      '<div class="rider-chip">' +
                          '<span class="chip-dot" style="background:' + color + '"></span>' +
                          '<span>' + escapeClientHTML(name) + '</span>' +
                      '</div>';
              });

              if (ridersList.length > 10) {
                  html += '<div class="rider-chip more-chip">+' + (ridersList.length - 10) + ' anggota</div>';
              }

              html += '</div>';

              board.innerHTML = html;
              board.style.display = 'block';
          }

          async function loadRouteData() {
              if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
                  console.warn('Rute kosong: rawUrl kosong');
                  return [];
              }

              try {
                  let pts = [];
                  let urlStr = rawUrl.trim();

                  if (urlStr.startsWith('"')) {
                      try {
                          urlStr = JSON.parse(urlStr);
                      } catch (e) {
                          urlStr = urlStr.slice(1, -1).replace(/\\\\"/g, '"');
                      }
                  }

                  if (urlStr.startsWith('[')) {
                      pts = JSON.parse(urlStr);
                  } else if (urlStr.startsWith('http')) {
                      const res = await fetch(urlStr, { cache: 'no-store' });

                      if (!res.ok) {
                          throw new Error('Fetch rute gagal: HTTP ' + res.status);
                      }

                      pts = await res.json();
                  } else {
                      pts = decodePolyline(urlStr);
                  }

                  if (!Array.isArray(pts)) {
                      pts = pts.path || pts.data || pts.polyline || pts.coordinates || [];
                  }

                  return pts.map(p => {
                      if (Array.isArray(p)) {
                          return [
                              parseFloat(p[0]),
                              parseFloat(p[1])
                          ];
                      }

                      if (p && p.lat !== undefined) {
                          return [
                              parseFloat(p.lat),
                              parseFloat(p.lng !== undefined ? p.lng : p.lon)
                          ];
                      }

                      return null;
                  }).filter(p => p !== null && !isNaN(p[0]) && !isNaN(p[1]));
              } catch (e) {
                  console.error('Gagal load rute video:', e);
                  return [];
              }
          }

          loadRouteData()
              .then(path => {
                  fullPath = path;

                  if (fullPath.length > 0) {
                      const startCoord = fullPath[0];

                      map.setView(startCoord, 14);

                      const pelotonColors = [
                          '#FF5F00',
                          '#2ecc71',
                          '#3498db',
                          '#f1c40f',
                          '#9b59b6',
                          '#e74c3c',
                          '#1abc9c',
                          '#e67e22',
                          '#ecf0f1',
                          '#fd79a8'
                      ];

                      if (!isPeleton) {
                          const iconSymbol =
                              (activityType === 'run')
                                  ? '🏃‍♂️'
                                  : ((activityType === 'walk' || activityType === 'hike') ? '🚶‍♂️' : '🚴‍♂️');

                          const soloIcon = L.divIcon({
                              className: 'custom-icon',
                              html: '<div style="font-size: 28px; text-shadow: 0 0 15px var(--primary); text-align: center;">' + iconSymbol + '</div>',
                              iconSize: [30, 30],
                              iconAnchor: [15, 15]
                          });

                          markers.push(L.marker(startCoord, {
                              icon: soloIcon
                          }).addTo(map));
                      } else {
                          buildPeletonBoard(pelotonColors);

                          ridersList.forEach((name, i) => {
                              const color = pelotonColors[i % pelotonColors.length];
                              const initials = getInitials(name);

                              const dotIcon = L.divIcon({
                                  className: 'rider-label',
                                  html:
                                      '<div class="rider-bubble" style="background:' + color + '; border-color:' + color + '">' +
                                          escapeClientHTML(initials) +
                                      '</div>',
                                  iconSize: [30, 30],
                                  iconAnchor: [15, 15]
                              });

                              markers.push(L.marker(startCoord, {
                                  icon: dotIcon,
                                  zIndexOffset: 1000 + i
                              }).addTo(map));
                          });
						  
						  spreadPeletonMarkers(startCoord);
                      }

                      document.getElementById('btn-start').disabled = false;
                      document.getElementById('btn-start').innerText = '🎬 MULAI REKAMAN';
                  } else {
                      document.getElementById('btn-start').innerText = '❌ DATA RUTE KOSONG / GAGAL DIMUAT';
                  }
              })
              .catch(err => {
                  console.error('Fatal loadRouteData:', err);
                  document.getElementById('btn-start').innerText = '❌ GAGAL MEMUAT RUTE';
              });

          const duration = 20000;
          let startTime = null;
          let frameCount = 0;

          function getPaceFormat(secondsPerKm) {
              if (secondsPerKm <= 0) return '0:00';

              const m = Math.floor(secondsPerKm / 60);
              const s = Math.floor(secondsPerKm % 60);

              return m + ':' + (s < 10 ? '0' : '') + s;
          }

          function prepareStudio() {
              if (fullPath.length <= 1) {
                  alert('Data rute belum siap atau terlalu pendek.');
                  return;
              }

              const elem = document.documentElement;

              if (elem.requestFullscreen) {
                  elem.requestFullscreen().catch(() => {});
              } else if (elem.webkitRequestFullscreen) {
                  elem.webkitRequestFullscreen();
              }

              document.getElementById('btn-start').style.display = 'none';
              document.getElementById('btn-cancel').style.display = 'none';
              document.getElementById('inst-text').innerText = 'Bersiaplah...';
              document.getElementById('countdown').style.display = 'block';

              let count = 3;

              const interval = setInterval(() => {
                  count--;

                  if (count > 0) {
                      document.getElementById('countdown').innerText = count;
                  } else {
                      clearInterval(interval);

                      document.getElementById('controls').style.display = 'none';

                      map.invalidateSize();

                      const fullBounds = L.polyline(fullPath).getBounds();

                      if (fullBounds.isValid()) {
                          map.fitBounds(fullBounds, {
                              padding: [40, 40]
                          });
                      }

                      requestAnimationFrame((timestamp) => {
                          startTime = timestamp;
                          animate(timestamp);
                      });
                  }
              }, 1000);
          }

          function animate(currentTime) {
    if (!startTime) startTime = currentTime;

    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    frameCount++;

    const currentIndex = Math.floor(progress * (fullPath.length - 1));
    const currentPath = fullPath.slice(0, currentIndex + 1);
    const lastPoint = fullPath[currentIndex];

    if (!lastPoint) {
        console.error('Animasi berhenti: lastPoint kosong pada index', currentIndex);
        return;
    }

    outlineLine.setLatLngs(currentPath);
    animatedLine.setLatLngs(currentPath);

    if (frameCount % 2 === 0 || progress >= 1) {
        const bounds = map.getBounds();
        const latOffset = (bounds.getNorth() - bounds.getSouth()) * 0.1;

        map.setView(
            [lastPoint[0] + latOffset, lastPoint[1]],
            map.getZoom(),
            { animate: false }
        );
    }

    // Marker disebar berdasarkan pixel layar setelah map bergerak.
    // Ini mencegah BR/MA/anggota lain saling menimpa.
    spreadPeletonMarkers(lastPoint);

    document.getElementById('v-dist').innerText = (progress * totalDistTarget).toFixed(2);

    let elevProgress = progress - 0.05 * Math.sin(progress * Math.PI * 4);

    if (elevProgress < 0) elevProgress = 0;
    if (elevProgress > 1) elevProgress = 1;

    document.getElementById('v-elev').innerText = Math.floor(elevProgress * totalElevTarget);

    if (isPace) {
        const basePaceSec = totalDistTarget > 0
            ? (movingTimeTarget / totalDistTarget)
            : 0;

        const fluctuationSec = Math.sin(progress * 25) * 12;

        document.getElementById('v-speed').innerText =
            getPaceFormat(Math.max(0, basePaceSec + fluctuationSec));
    } else {
        const speedBase = movingTimeTarget > 0
            ? (totalDistTarget / (movingTimeTarget / 3600))
            : 0;

        const speedFluctuation = Math.sin(progress * 20) * 3;

        document.getElementById('v-speed').innerText =
            Math.max(0, speedBase + speedFluctuation).toFixed(1);
    }

    const currentSecs = Math.floor(progress * movingTimeTarget);
    const h = Math.floor(currentSecs / 3600).toString().padStart(2, '0');
    const m = Math.floor((currentSecs % 3600) / 60).toString().padStart(2, '0');
    const s = (currentSecs % 60).toString().padStart(2, '0');

    document.getElementById('v-time').innerText = h + ':' + m + ':' + s;

    if (tempTarget > 0) {
        let baseTemp = tempTarget;

        if (startHour >= 5 && startHour < 11) {
            baseTemp = tempTarget - 1.5 + (progress * 3.0);
        } else if (startHour >= 11 && startHour < 15) {
            baseTemp = tempTarget - 0.5 + Math.sin(progress * Math.PI) * 1.5;
        } else if (startHour >= 15 && startHour < 19) {
            baseTemp = tempTarget + 1.5 - (progress * 3.0);
        } else {
            baseTemp = tempTarget + 0.5 - (progress * 1.0);
        }

        const tempFluctuation = Math.sin(progress * 40) * 0.2;

        document.getElementById('v-temp').innerText =
            (baseTemp + tempFluctuation).toFixed(1);
    } else {
        document.getElementById('v-temp').innerText = '--';
    }

    if (progress < 1) {
        requestAnimationFrame(animate);
    } else {
        setTimeout(() => {
            document.getElementById('watermark').style.opacity = '0';
            document.getElementById('ending-overlay').style.display = 'flex';

            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }, 2000);
    }
}
      </script>
      </body>
      </html>
    `);
  } catch (err) {
    return c.redirect("/");
  }
});

export default studio;
