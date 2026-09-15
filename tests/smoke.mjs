/**
 * Gaspool smoke test.
 *
 * Boots the real Worker with wrangler in local mode (D1, R2 and KV emulated on
 * disk in a temporary directory), seeds it, then checks the invariants that the
 * audit established. It needs no Cloudflare account, no API token and no
 * network access, so anyone who clones this repository can run it.
 *
 *   node tests/smoke.mjs
 *
 * Exit code 0 = all assertions passed.
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CONFIG = "tests/wrangler.test.jsonc";
const DB_NAME = "gaspool-test-db";
const JWT_SECRET = "test-only-jwt-secret-not-used-in-production";

/**
 * Ask the kernel for a free port instead of hardcoding one. A fixed port means a
 * leftover server from an interrupted run can silently take the connection, and
 * the harness would then assert against a stale Worker whose persist directory
 * has already been deleted.
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

let PORT = 0;
let BASE = "";
let ORIGIN = "";

const persistDir = mkdtempSync(join(tmpdir(), "gaspool-test-"));
const results = [];
let server = null;

// ---------------------------------------------------------------- assertions
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  const mark = passed ? "  ok  " : " FAIL ";
  console.log(`${mark} ${name}${passed || !detail ? "" : `\n         ${detail}`}`);
};

const checkEqual = (name, actual, expected) =>
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ------------------------------------------------------------- wrangler glue
const run = (args, { quiet = true } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("npx", args, {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk));
    child.stderr?.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(" ")}\n${out}`))));
  });

const wrangler = (args) =>
  run(["wrangler", ...args, "--config", CONFIG, "--local", "--persist-to", persistDir]);

let seedIndex = 0;
const seededDb = (sql) => {
  seedIndex += 1;
  const file = join(persistDir, `seed-${seedIndex}.sql`);
  writeFileSync(file, sql);
  return wrangler(["d1", "execute", DB_NAME, `--file=${file}`]);
};

// ------------------------------------------------------------------ fixtures
const RIDE_COLUMNS = `(id, name, distance, moving_time, average_speed, max_speed,
  total_elevation_gain, avg_temp, participants, start_date, polyline,
  activity_type, source, planned_route_id, is_public, notes)`;

const seedSql = `
INSERT INTO rides ${RIDE_COLUMNS} VALUES
  (1, 'Public Ride', 12.34, 1800, 24.68, 31.2, 120.0, 28, '[]',
   '2026-07-03T04:56:16.000Z', 'https://pub-test.invalid/gaspool/ride_1.json',
   'ride', 'GASPOOL', NULL, 1, 'PRIVATE NOTE THAT MUST NOT LEAK');

-- Eight recent failed attempts from one address: the ninth must be refused.
INSERT INTO login_logs (ip_address, attempts, last_attempt) VALUES
  ('203.0.113.9', 8, ${Date.now()}),
  ('203.0.113.10', 1, ${Date.now()});
`;

// ---------------------------------------------------------------------- jwt
const signJwt = (payload) => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

const get = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  return { res, text: await res.text() };
};

const postJson = (path, body, token) =>
  get(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(token ? { cookie: `gaspool_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------- runner
const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};

const main = async () => {
  PORT = Number(process.env.GASPOOL_TEST_PORT || (await freePort()));
  BASE = `http://127.0.0.1:${PORT}`;
  ORIGIN = BASE;

  console.log(`gaspool smoke test (port: ${PORT}, persist: ${persistDir})\n`);

  await seededDb("SELECT 1;"); // creates the local database
  await wrangler(["d1", "execute", DB_NAME, `--file=${join(ROOT, "schema.sql")}`]);
  await seededDb(seedSql);

  // detached:true makes npx the leader of its own process group, so teardown can
  // signal the whole tree. Killing only npx leaves workerd holding the port.
  server = spawn("npx", ["wrangler", "dev", "--config", CONFIG, "--local", "--persist-to", persistDir, "--port", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let serverLog = "";
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));

  const up = await waitForServer();
  check("worker boots and serves /login", up, up ? "" : serverLog.slice(-1500));
  if (!up) return;

  const token = signJwt({ email: "test@local", exp: Math.floor(Date.now() / 1000) + 3600 });

  // --- boot ---------------------------------------------------------------
  const home = await get("/");
  check("home responds", [200, 302].includes(home.res.status), `status ${home.res.status}`);

  // --- CSP must follow the configured bucket, not a hardcoded one (B-portability)
  const csp = home.res.headers.get("content-security-policy") || "";
  check("CSP media-src uses the configured R2 bucket", csp.includes("https://pub-test.invalid"), csp);
  check("CSP no longer pins the author's bucket", !csp.includes("pub-13cc00374110455e9437c511bcbdf007"));

  // --- B2: private notes must not reach a public endpoint ------------------
  const publicRides = await get("/api/public_rides/jeannesbryan");
  const ridesBody = JSON.parse(publicRides.text);
  const firstRide = ridesBody.rides?.[0] || {};
  check("public_rides responds", publicRides.res.status === 200, `status ${publicRides.res.status}`);
  check("B2 public_rides omits private notes", !("notes" in firstRide), JSON.stringify(Object.keys(firstRide)));
  check("B2 public_rides still exposes fields the page needs", ["id", "name", "distance", "polyline"].every((k) => k in firstRide));
  check("B2 private note text absent from the raw response", !publicRides.text.includes("MUST NOT LEAK"));

  // --- B4: weather input validation ---------------------------------------
  const badWeather = await get("/api/weather?lat=&lng=");
  checkEqual("B4 weather rejects empty lat/lng", JSON.parse(badWeather.text).temp, null);
  const rangeWeather = await get("/api/weather?lat=999&lng=999");
  checkEqual("B4 weather rejects out-of-range coordinates", JSON.parse(rangeWeather.text).temp, null);
  const nanWeather = await get("/api/weather?lat=abc&lng=106.8");
  checkEqual("B4 weather rejects non-numeric input", JSON.parse(nanWeather.text).temp, null);

  // --- B5: radar accepts hostile input without falling over ---------------
  const radar = await postJson("/api/radar_sync", {
    room: "ROOMX:INJECTED",
    user: "pilot<script>",
    lat: -6.2,
    lng: 106.8,
    speed: 20,
  });
  check("B5 radar_sync survives a hostile room/user", radar.res.status === 200 && JSON.parse(radar.text).success === true, radar.text.slice(0, 200));

  // --- B6: delete_ride id validation -------------------------------------
  const badDelete = await get("/api/delete_ride/abc", {
    method: "DELETE",
    headers: { origin: ORIGIN, cookie: `gaspool_session=${token}` },
  });
  checkEqual("B6 delete_ride rejects a non-numeric id", badDelete.res.status, 400);

  // --- B9: edit_ride existence check -------------------------------------
  const missingEdit = await postJson("/api/edit_ride/99999", { name: "x" }, token);
  checkEqual("B9 edit_ride reports 404 for an unknown ride", missingEdit.res.status, 404);
  const existingEdit = await postJson("/api/edit_ride/1", { name: "Renamed" }, token);
  checkEqual("B9 edit_ride updates an existing ride", existingEdit.res.status, 200);

  // --- auth is still enforced on protected endpoints ---------------------
  const noAuth = await postJson("/api/edit_ride/1", { name: "x" });
  checkEqual("protected endpoint rejects a request with no session", noAuth.res.status, 401);

  // --- B7: login attempt limiting ----------------------------------------
  const locked = await get("/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ email: "a@b.c", password: "x" }),
  });
  checkEqual("B7 login returns 429 after too many failures", locked.res.status, 429);

  const notLocked = await get("/login", { headers: { "cf-connecting-ip": "203.0.113.10" } });
  check("B7 a different address is not blocked", notLocked.res.status !== 429, `status ${notLocked.res.status}`);

  const freshAddress = await postJson("/login", { email: "a@b.c", password: "x" });
  check("B7 a fresh address is not blocked", freshAddress.res.status !== 429, `status ${freshAddress.res.status}`);
};

main()
  .catch((error) => {
    check("harness completed without throwing", false, error?.stack || String(error));
  })
  .finally(async () => {
    // Signal the entire process group, otherwise workerd survives and keeps the
    // port (and the deleted persist directory) for the next run.
    const killGroup = (signal) => {
      if (!server?.pid) return;
      try {
        process.kill(-server.pid, signal);
      } catch {
        try {
          server.kill(signal);
        } catch {
          // already gone
        }
      }
    };

    killGroup("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    killGroup("SIGKILL");

    try {
      rmSync(persistDir, { recursive: true, force: true });
    } catch {
      // best effort
    }

    const failed = results.filter((item) => !item.passed);
    console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
    if (failed.length > 0) {
      console.log(`\n${failed.length} failed:`);
      for (const item of failed) console.log(`  - ${item.name}`);
    }
    process.exit(failed.length > 0 ? 1 : 0);
  });
