import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

// Import semua modul/router
import authRouter from "./routes/auth";
import dashboardRouter from "./routes/dashboard";
import trackerRouter from "./routes/tracker";
import studioRouter from "./routes/studio";
import apiRouter from "./api/api";

// Tipe Data untuk Cloudflare Bindings (D1, R2, KV)
export type Bindings = {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  GASPOOL_RADAR: KVNamespace;
  JWT_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ==========================================
// MIDDLEWARE PERTAHANAN (PERISAI PASIF)
// ==========================================

// 1. Logger (CCTV Terminal) - Mencatat setiap tembakan API
app.use("*", logger());

app.use("*", async (c, next) => {
  await next();

  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
});

// 2. Secure Headers (Gembok XSS & Clickjacking) dengan Daftar Putih VIP
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Mengizinkan script bawaan UI kita
        "'unsafe-eval'", // Dibutuhkan oleh Leaflet / HTML2Canvas
        "https://unpkg.com",
		"https://cdnjs.cloudflare.com",
        "https://html2canvas.hertzen.com",
        "https://challenges.cloudflare.com", // Izin untuk Satpam Turnstile
        "https://static.cloudflareinsights.com", // <-- INJEKSI IZIN CLOUDFLARE ANALYTICS
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Mengizinkan CSS inline kita
        "https://unpkg.com",
		"https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://*.basemaps.cartocdn.com", // Peta CartoDB Dark Mode
        "https://server.arcgisonline.com", // Peta Satelit ArcGIS
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      connectSrc: [
        "'self'",
        "https:", // <-- KUNCI UTAMA (Tanpa bintang) agar list gowes tidak blank!
        "http://localhost:*",
      ],
      frameSrc: [
        "'self'",
        "https://challenges.cloudflare.com", // Iframe Turnstile
      ],
      mediaSrc: [
        "'self'",
        "blob:",
        "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev", // Radio Suara dari Bucket R2
      ],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

// Pasang Router (Sub-Aplikasi) ke jalur masing-masing
app.route("/", authRouter);
app.route("/", dashboardRouter);
app.route("/", trackerRouter);
app.route("/", studioRouter);
app.route("/api", apiRouter); // Semua yang berawalan /api masuk ke api.ts

export default app;
