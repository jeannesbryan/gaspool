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

  // --- B10: live share token for a solo ride ------------------------------
  // Link /radar/<room> can be opened without logging in, and a Peleton room
  // name is chosen by its owner, so a guessable name leaks live location. A
  // solo broadcast therefore has to use an unguessable token.
  const liveStart = await postJson("/api/live_start", { user: "captain" });
  const livePayload = JSON.parse(liveStart.text);
  const liveToken = String(livePayload.token || "");

  check(
    "B10 live_start issues a token",
    liveStart.res.status === 200 && livePayload.success === true,
    liveStart.text.slice(0, 200),
  );
  check(
    "B10 token is the documented shape",
    /^[A-Z0-9]{16}$/.test(liveToken),
    `token=${liveToken}`,
  );
  check(
    "B10 token avoids characters that are misread out loud",
    !/[IO]/.test(liveToken),
    `token=${liveToken}`,
  );

  const secondLive = await postJson("/api/live_start", { user: "captain" });
  const secondToken = String(JSON.parse(secondLive.text).token || "");
  check(
    "B10 two broadcasts never share a token",
    liveToken.length > 0 && secondToken.length > 0 && liveToken !== secondToken,
    `${liveToken} vs ${secondToken}`,
  );

  // The token has to survive the same sanitising the radar path applies,
  // otherwise the published link would point at a different room than the one
  // the tracker actually syncs to.
  const tokenSync = await postJson("/api/radar_sync", {
    room: liveToken,
    user: "captain",
    lat: -6.2,
    lng: 106.8,
    speed: 18,
  });
  check(
    "B10 the issued token works as a radar room",
    tokenSync.res.status === 200 && JSON.parse(tokenSync.text).success === true,
    tokenSync.text.slice(0, 200),
  );

  const tokenView = await get(`/api/radar_view/${liveToken}`);
  const tokenViewBody = JSON.parse(tokenView.text);
  check(
    "B10 a spectator can read the broadcast by token",
    tokenView.res.status === 200 &&
      Array.isArray(tokenViewBody.participants) &&
      tokenViewBody.participants.some((p) => p.user === "captain"),
    tokenView.text.slice(0, 200),
  );

  // --- B11: the tracker page renders in both modes ------------------------
  // This page is one enormous template literal, so a stray backtick or a
  // mistyped interpolation can break the whole HTML without any TypeScript
  // error. Checking the rendered output is the only way to catch that.
  const soloPage = await get("/record?type=ride");
  check("B11 tracker page renders for a solo ride", soloPage.res.status === 200, `status ${soloPage.res.status}`);
  check(
    "B11 solo page offers the live share button",
    soloPage.text.includes('id="btn-live"') && soloPage.text.includes("BAGIKAN LIVE"),
    soloPage.text.includes('id="btn-live"') ? "button present, label unexpected" : "button missing",
  );
  check(
    "B11 solo page carries the live panel and its wiring",
    ["live-panel", "live-link", "bootLiveShare", "/api/live_start", "stopLiveShare"].every((needle) =>
      soloPage.text.includes(needle),
    ),
    "one of the live-share hooks is missing from the rendered page",
  );
  check(
    "B11 tracker page no longer references the removed handler",
    !soloPage.text.includes("shareSpectator"),
    "shareSpectator() is still referenced somewhere in the page",
  );
  check(
    "B11 tracker page loads the live clock accounting module",
    soloPage.text.includes("/assets/live-clock.js") &&
      soloPage.text.includes("recordLiveClockSample") &&
      soloPage.text.includes("live_clock"),
    "the clock instrumentation is not wired into the rendered page",
  );
  check(
    "B11 the clock module is actually served",
    (await get("/assets/live-clock.js")).res.status === 200,
    "the browser would fail to import the module at runtime",
  );
  check(
    "B11 tracker page wires up the voice picker",
    soloPage.text.includes("/assets/voice-picker.js") &&
      soloPage.text.includes("cycleNavVoice") &&
      soloPage.text.includes("GANTI SUARA") &&
      soloPage.text.includes("loadVoicePreference"),
    "the voice picker is not wired into the rendered page",
  );
  check(
    "B11 the voice picker module is actually served",
    (await get("/assets/voice-picker.js")).res.status === 200,
    "the browser would fail to import the module at runtime",
  );
  check(
    "B11 the old first-match voice lookup is gone",
    !soloPage.text.includes("voices.find(v => (v.lang || '').toLowerCase().startsWith('ms'))"),
    "the old picker that took the first match is still present",
  );

  // --- B16: touch targets on the page used while riding -------------------
  // This page is operated while pedalling, sometimes with gloves on, so a
  // control that is comfortable with a mouse can still be too small to hit.
  // Measured in a real browser before this was fixed: fifteen visible buttons,
  // every one of them under 44px, the smallest only 25px.
  //
  // The media query is what caused it — it forced 34px on small screens, where
  // the space is tightest and the targets matter most. A text check cannot
  // measure a rendered button, so it guards the declarations instead: if
  // someone lowers them again, this fails. The rendered sizes were verified
  // separately in a browser.
  const declaredMinHeights = [...soloPage.text.matchAll(/min-height:\s*(\d+)px/g)].map((m) =>
    Number(m[1]),
  );
  check(
    "B16 every declared minimum touch target is at least 44px",
    declaredMinHeights.length > 0 && Math.min(...declaredMinHeights) >= 44,
    `terkecil=${declaredMinHeights.length ? Math.min(...declaredMinHeights) : "tidak ada"}px dari ${declaredMinHeights.length} deklarasi`,
  );
  check(
    "B16 small screens no longer shrink the touch targets",
    !/min-height:\s*(?:[1-3][0-9])px/.test(soloPage.text),
    "ada aturan yang mengecilkan tombol di bawah 40px",
  );
  check(
    "B16 tracker button labels are large enough to read",
    soloPage.text.includes(".action-row .btn { padding:10px 6px !important; font-size:11px !important; min-height:48px; }") &&
      soloPage.text.includes(".nav-voice-status { margin: -2px 0 6px; font-size: 11px;"),
    "label tombol atau baris status suara masih terlalu kecil",
  );

  const peletonPage = await get("/record?type=ride&room=TESTROOM");
  check("B11 tracker page renders for a peleton room", peletonPage.res.status === 200, `status ${peletonPage.res.status}`);
  check(
    "B11 peleton page keeps its own label",
    peletonPage.text.includes("SHARE RADAR") && peletonPage.text.includes('const roomID = "TESTROOM"'),
    "peleton mode lost its room identity or its label",
  );

  // --- B12: the spectator page distinguishes solo from peleton ------------
  const soloRadar = await get(`/radar/${liveToken}`);
  check(
    "B12 solo broadcast page greets the spectator",
    soloRadar.res.status === 200 && soloRadar.text.includes("GOWES LIVE"),
    `status ${soloRadar.res.status}`,
  );
  check(
    "B12 solo broadcast page names the rider",
    soloRadar.text.includes("captain · lokasi langsung"),
    "the rider name is missing from the solo page",
  );
  check(
    "B12 solo broadcast page stops advertising the raw token",
    !soloRadar.text.includes(`ROOM: ${liveToken}`),
    "the solo page still prints the token as if it were a peleton room name",
  );

  const peletonRadar = await get("/radar/TESTROOM");
  check(
    "B12 peleton radar page keeps its room label",
    peletonRadar.res.status === 200 &&
      peletonRadar.text.includes("RADAR PELETON") &&
      peletonRadar.text.includes("ROOM: TESTROOM"),
    `status ${peletonRadar.res.status}`,
  );

  // --- B14: the radar keeps a trail, not just the last position ------------
  // A spectator who opens the link late should be able to see where the rider
  // came from. The trail has to travel inside the participant entry: a separate
  // key would show up in the participant list as a second rider.
  const trailRoom = "TRAILROOM";
  await postJson("/api/radar_sync", { room: trailRoom, user: "rider", lat: -7.25, lng: 112.75, speed: 20 });
  await postJson("/api/radar_sync", { room: trailRoom, user: "rider", lat: -7.26, lng: 112.76, speed: 21 });
  await postJson("/api/radar_sync", { room: trailRoom, user: "rider", lat: -7.27, lng: 112.77, speed: 22 });

  const trailView = JSON.parse((await get(`/api/radar_view/${trailRoom}`)).text);
  const rider = (trailView.participants || []).find((p) => p.user === "rider");

  check(
    "B14 participant entry carries a trail",
    Boolean(rider) && Array.isArray(rider.trail) && rider.trail.length >= 3,
    JSON.stringify(rider ? rider.trail : trailView),
  );
  check(
    "B14 the trail does not appear as a second participant",
    (trailView.participants || []).filter((p) => p.user === "rider").length === 1 &&
      (trailView.participants || []).length === 1,
    `participants=${JSON.stringify((trailView.participants || []).map((p) => p.user))}`,
  );
  check(
    "B14 the trail records the starting point once",
    Boolean(rider && rider.trail_start) &&
      Math.abs(Number(rider.trail_start.lat) - -7.25) < 0.001,
    JSON.stringify(rider ? rider.trail_start : null),
  );

  // A rider who does not move must not stretch the trail with GPS jitter.
  const before = rider ? rider.trail.length : 0;
  await postJson("/api/radar_sync", { room: trailRoom, user: "rider", lat: -7.27, lng: 112.77, speed: 0 });
  const afterView = JSON.parse((await get(`/api/radar_view/${trailRoom}`)).text);
  const afterRider = (afterView.participants || []).find((p) => p.user === "rider");
  check(
    "B14 standing still does not extend the trail",
    afterRider && afterRider.trail.length === before,
    `${before} -> ${afterRider ? afterRider.trail.length : "?"}`,
  );

  // --- B13: lifetime milestones (every 1000 km) ---------------------------
  // The dashboard cards follow the active filter, so "this month" would make a
  // lifetime achievement look like it had shrunk. Milestones therefore read
  // from their own endpoint that ignores filters entirely.
  const milesAnonymous = await get("/api/milestones");
  check(
    "B13 milestones endpoint is protected",
    milesAnonymous.res.status === 401 || milesAnonymous.res.status === 403,
    `status ${milesAnonymous.res.status}`,
  );

  const milesRes = await get("/api/milestones", { headers: { cookie: `gaspool_session=${token}` } });
  const milesBody = JSON.parse(milesRes.text);
  const lifetime = milesBody.lifetime || {};
  const milestone = milesBody.milestone || {};

  check(
    "B13 milestones endpoint responds with lifetime totals",
    milesRes.res.status === 200 && milesBody.success === true,
    milesRes.text.slice(0, 200),
  );
  // Seed holds exactly one ride: 12.34 km, 1800 s, 120 m.
  check(
    "B13 lifetime totals come from every ride, not a filtered subset",
    Math.abs(Number(lifetime.distance_km) - 12.34) < 0.01 &&
      Number(lifetime.activities) === 1 &&
      Number(lifetime.moving_time_seconds) === 1800 &&
      Math.abs(Number(lifetime.elevation_gain_m) - 120) < 0.01,
    JSON.stringify(lifetime),
  );
  check(
    "B13 milestone step is one thousand kilometres",
    Number(milestone.step_km) === 1000,
    `step=${milestone.step_km}`,
  );
  // 12.34 km means the first milestone has not been reached yet, which is the
  // state that must not render as a broken or negative progress bar.
  check(
    "B13 below the first milestone is reported honestly",
    Number(milestone.reached_count) === 0 &&
      Number(milestone.last_reached_km) === 0 &&
      Number(milestone.next_km) === 1000 &&
      Math.abs(Number(milestone.remaining_km) - 987.66) < 0.05,
    JSON.stringify(milestone),
  );
  check(
    "B13 progress stays inside 0..1 so the bar cannot overflow",
    Number(milestone.progress_ratio) >= 0 && Number(milestone.progress_ratio) < 1,
    `ratio=${milestone.progress_ratio}`,
  );

  const dashPage = await get("/", { headers: { cookie: `gaspool_session=${token}` } });
  check("B13 dashboard renders", dashPage.res.status === 200, `status ${dashPage.res.status}`);
  check(
    "B13 dashboard shows the milestone section and its share card",
    ["milestoneCard", "milestoneFill", "btnShareMilestone", "milestoneShareCard", "shareCardDist"].every(
      (needle) => dashPage.text.includes(needle),
    ),
    "a milestone element is missing from the rendered dashboard",
  );
  check(
    "B13 dashboard loads the renderer needed to build the card",
    dashPage.text.includes("html2canvas"),
    "the share button would fail without html2canvas",
  );
  check(
    "B13 dashboard labels the account as USER",
    dashPage.text.includes("USER: ") && !dashPage.text.includes("UNIT: "),
    "the header still says UNIT",
  );

  // --- B15: favicon is declared, and served where browsers look for it ----
  // Only one page used to declare an icon at all, and the sizes it declared
  // were 192 and 512 — not the 16/32 that a browser picks for a tab. On top of
  // that, nothing answered /favicon.ico, which browsers request on their own.
  const iconRes = await get("/favicon.ico");
  check(
    "B15 /favicon.ico is served from the site root",
    iconRes.res.status === 200,
    `status ${iconRes.res.status} — browsers request this path without being told to`,
  );

  for (const [label, path] of [
    ["login", "/login"],
    ["tracker", "/record?type=ride"],
    ["dashboard", "/"],
  ]) {
    const page = await get(path, { headers: { cookie: `gaspool_session=${token}` } });
    check(
      `B15 ${label} page declares the tab icon`,
      page.text.includes('sizes="16x16"') && page.text.includes('sizes="32x32"'),
      `${label} page is missing the small icons a browser uses for a tab`,
    );
  }

  // --- B17: Finish Review shows SEBELUM -> SESUDAH -------------------------
  // Keputusan "simpan apa adanya" atau "perbaiki dulu" dulu diambil tanpa
  // angka: modal hanya menampilkan statistik live dan daftar perubahan berupa
  // teks. Sekarang perbandingannya harus ada di halaman, tepat di atas tombol.
  const trackerPage = await get("/record?type=ride", {
    headers: { cookie: `gaspool_session=${token}` },
  });
  const trackerHtml = trackerPage.text;

  check(
    "B17 finish review renders a Sebelum -> Sesudah section",
    trackerHtml.includes("Sebelum → Sesudah") && trackerHtml.includes('id="finish-diff"'),
    "the finish review modal has no before/after section",
  );
  check(
    "B17 the comparison is rendered before the save buttons",
    trackerHtml.indexOf('id="finish-diff"') > 0 &&
      trackerHtml.indexOf('id="finish-diff"') < trackerHtml.indexOf('id="finish-save-btn"'),
    "the comparison must sit above SAVE FINAL / AUTO REPAIR & SAVE",
  );
  for (const label of ["Jarak", "Moving Time", "Average Speed", "Max Speed"]) {
    check(
      `B17 the comparison covers ${label}`,
      trackerHtml.includes(`label: '${label}'`),
      `missing row for ${label}`,
    );
  }
  check(
    "B17 renderFinishDiff is wired into the modal renderer",
    trackerHtml.includes("function renderFinishDiff(doctor)") &&
      trackerHtml.includes("renderFinishDiff(doctor);"),
    "renderFinishDiff exists but is never called",
  );
  check(
    "B17 an unchanged repair is reported honestly",
    trackerHtml.includes("Tidak ada angka yang berubah"),
    "the modal must say so when the repair changes nothing",
  );

  // --- B18: max_speed is actually sent with the activity -------------------
  // Before this, the finish payload had no max_speed key at all, so every saved
  // ride landed in D1 and R2 with max_speed 0 while the modal was showing a
  // real number.
  check(
    "B18 the finish payload carries max_speed",
    /max_speed:\s*Number\(Number\(doctor\.currentStats\.max_speed/.test(trackerHtml),
    "state.base has no max_speed, so saved activities lose it again",
  );
  check(
    "B18 stats_after records the repair proposal, not the live stats",
    trackerHtml.includes("stats_after: doctor.repairedStats") &&
      !trackerHtml.includes("stats_after: repaired ? doctor.repairedStats"),
    "stats_after must always describe the proposal; auto_repair_applied says if it was used",
  );

  // --- B19: the login form can reveal the password -------------------------
  const loginPage = await get("/login");
  check(
    "B19 login has a password field with an id for the toggle",
    loginPage.text.includes('id="login-password"') && loginPage.text.includes('type="password"'),
    "password input is not addressable by the toggle",
  );
  check(
    "B19 login has a show/hide button",
    loginPage.text.includes('id="password-toggle"') &&
      loginPage.text.includes("Tampilkan kata sandi"),
    "no toggle button next to the password field",
  );
  check(
    "B19 the toggle switches the input type",
    loginPage.text.includes("input.setAttribute('type', show ? 'text' : 'password')"),
    "the toggle exists but does not change the input type",
  );
  check(
    "B19 the toggle is a real button, not a submit",
    /<button type="button" class="password-toggle"/.test(loginPage.text),
    "a submit button here would send the form",
  );

  // --- B20: siaran solo benar-benar mengirim posisi ------------------------
  // Bug yang pernah lolos: gate siaran sudah memakai liveRoom, tapi payload
  // /radar_sync masih mengirim roomID. Di gowes solo roomID = "SINGLE_MODE" dan
  // server menolak room itu, sehingga tidak ada satu pun posisi yang tersimpan
  // dan penonton cuma melihat peta kosong. Test lama tidak menangkapnya karena
  // tidak ada yang memeriksa isi payload.
  check(
    "B20 solo broadcast posts to the live room, not to roomID",
    trackerHtml.includes("room: liveRoom, user: userName, lat: lastP.lat"),
    "payload /radar_sync must carry liveRoom; roomID is 'SINGLE_MODE' in solo mode and is rejected by the server",
  );
  check(
    "B20 the broadcast still only runs while a live room is active",
    trackerHtml.includes("radarTick >= threshold && liveRoom && path.length > 0"),
    "radar must stay silent until the rider presses BAGIKAN LIVE",
  );

  // Endpoint yang benar-benar menerima room itu, diuji terhadap Worker.
  const readJson = (result) => {
    try {
      return JSON.parse(result.text);
    } catch (err) {
      return {};
    }
  };

  // Nama sengaja tanpa spasi: sanitizeRadioUser membuang karakter di luar
  // [A-Za-z0-9_-], jadi "Smoke Rider" tersimpan sebagai "SmokeRider" dan
  // perbandingan yang memakai spasi akan gagal karena alasan yang salah.
  const soloUser = "SmokeRider";
  const soloStart = readJson(await postJson("/api/live_start", { user: soloUser }));
  const soloToken = String(soloStart.token || "");
  check("B20 live_start returns a token used as the radar room", Boolean(soloToken));

  if (soloToken) {
    // roomID gowes solo: server harus menolaknya (inilah sebab peta kosong dulu).
    const rejected = readJson(
      await postJson("/api/radar_sync", {
        room: "SINGLE_MODE",
        user: soloUser,
        lat: -7.25,
        lng: 112.76,
        speed: 18,
      }),
    );
    check(
      "B20 SINGLE_MODE is refused, so roomID can never be the broadcast room",
      Array.isArray(rejected.participants) && rejected.participants.length === 0,
      "SINGLE_MODE should never store a position",
    );

    await postJson("/api/radar_sync", {
      room: soloToken,
      user: soloUser,
      lat: -7.25,
      lng: 112.76,
      speed: 21,
    });
    const soloView = readJson(await get("/api/radar_view/" + soloToken));
    const soloParticipants = Array.isArray(soloView.participants) ? soloView.participants : [];
    check(
      "B20 a solo broadcast does reach the viewer endpoint",
      soloParticipants.length === 1 && soloParticipants[0].user === soloUser,
      "radar_view returned no participant for a freshly synced solo ride",
    );
    check(
      "B20 the viewer page is told this is a live share",
      Boolean(soloView.live) && soloView.live.user === soloUser,
      "live session marker is missing on the viewer endpoint",
    );
  }

  // --- B21: halaman penonton menampilkan dua titik -------------------------
  const radarPage = await get("/radar/" + (soloToken || "SMOKEROOM"));
  const radarHtml = radarPage.text;

  check(
    "B21 the viewer page draws its own position",
    radarHtml.includes("fillColor: '#2ecc71'") &&
      radarHtml.includes("map.on('locationfound'"),
    "no green marker for the viewer",
  );
  check(
    "B21 the rider marker is red, not the old orange",
    radarHtml.includes("fillColor: '#e74c3c'") && !radarHtml.includes("fillColor: '#FF5F00'"),
    "rider trail and marker must share one colour so the legend is truthful",
  );
  check(
    "B21 the viewer position follows movement instead of a single fix",
    radarHtml.includes("watch: true"),
    "locate() must watch; one-shot locate leaves the viewer dot frozen",
  );
  check(
    "B21 the legend explains the colours",
    radarHtml.includes('id="legend"') &&
      radarHtml.includes("dot-rider") &&
      radarHtml.includes("dot-me"),
    "without a legend the two dots are ambiguous",
  );
  check(
    "B21 the viewer position is never uploaded",
    !/radar_sync[\s\S]{0,200}viewerMarker/.test(radarHtml),
    "the viewer's own coordinates must stay on their device",
  );
  check(
    "B21 an empty map explains itself",
    radarHtml.includes("Belum ada posisi terkirim"),
    "an empty map with no message is exactly the confusion this fixes",
  );
  check(
    "B21 denied geolocation says so instead of failing silently",
    radarHtml.includes("Izin lokasi ditolak browser"),
    "permission errors must be visible to the viewer",
  );

  // --- B22: kartu milestone transparan ------------------------------------
  const cardPage = await get("/", { headers: { cookie: `gaspool_session=${token}` } });
  check(
    "B22 the milestone card is rendered with a transparent background",
    /\.share-card \{[^}]*background: transparent/.test(cardPage.text),
    "a solid background would cover the photo it is meant to sit on",
  );
  check(
    "B22 html2canvas is told not to paint a background",
    /backgroundColor: null,\s*\n\s*scale: 2/.test(cardPage.text),
    "backgroundColor '#12162b' produces an opaque rectangle",
  );
  check(
    "B22 the card text stays readable over a photo",
    cardPage.text.includes("text-shadow") && cardPage.text.includes(".share-cell-value"),
    "numbers need a shadow or they vanish on bright photos",
  );

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
