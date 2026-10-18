import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { getR2PublicBaseUrl } from "./config";

// Import every module/router
import authRouter from "./routes/auth";
import dashboardRouter from "./routes/dashboard";
import trackerRouter from "./routes/tracker";
import studioRouter from "./routes/studio";
import apiRouter from "./api/api";

// Data types for Cloudflare Bindings (D1, R2, KV)
export type Bindings = {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  GASPOOL_RADAR: KVNamespace;
  JWT_SECRET: string;
  ORS_API_KEY: string;
  ROUTING_PROVIDER?: string;
  PUBLIC_PROFILE_SLUG?: string;
  PUBLIC_PROFILE_NAME?: string;
  PUBLIC_PROFILE_AVATAR?: string;
  // Public domain of this instance's R2 bucket. Set it in wrangler.jsonc.
  R2_PUBLIC_BASE_URL?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ==========================================
// DEFENCE MIDDLEWARE (PASSIVE SHIELD)
// ==========================================

// 1. Logger (terminal CCTV) - records every API call
app.use("*", logger());

app.use("*", async (c, next) => {
  await next();

  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
});

// 2. Secure Headers (XSS & clickjacking padlock) with a VIP allowlist
//
// The CSP is built per request because `mediaSrc` must carry the R2 domain of
// this instance. That domain used to be hardcoded here, so a copy of
// Gaspool deployed on another Cloudflare account would block its own
// audio.
app.use("*", async (c, next) => {
  const r2PublicUrl = getR2PublicBaseUrl(c.env);

  return secureHeaders({
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
        "https://*.tile.openstreetmap.org", // Peta terang OpenStreetMap
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
        r2PublicUrl, // Radio Suara dari Bucket R2 instance ini
      ],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  })(c, next);
});

// Mount the routers (sub-apps) on their own paths
app.route("/", authRouter);
app.route("/", dashboardRouter);
app.route("/", trackerRouter);
app.route("/", studioRouter);
app.route("/api", apiRouter); // Semua yang berawalan /api masuk ke api.ts

export default app;
