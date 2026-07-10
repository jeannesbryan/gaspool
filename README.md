# Gaspool

**Gaspool** is a lightweight activity tracker and peleton companion app built on **Cloudflare Workers** and **Hono**.

It helps cyclists, runners, walkers, and hikers record routes, share activity summaries, export GPX files, track peleton members live, and generate cinematic route recap videos.

Gaspool is designed to run serverlessly on Cloudflare using **Workers**, **D1**, **R2**, **KV**, **Turnstile**, and an external routing provider for planned routes.

---

## Features

### Activity Tracking

- Record cycling, running, walking, and hiking activities
- GPS-based route tracking
- Planned route tracking with route overlay
- Distance, moving time, speed, pace, elevation, and temperature display
- Activity detail page with map and statistics
- Activity Doctor scanner, Finish Review, and safe auto-repair UI for route JSON, GPS points, long gaps, metadata, and D1 stats
- Offline-friendly PWA shell

### Route Plan & Navigator

- Create a route plan from map points
- Use OpenRouteService Directions for cycling, walking, running, and hiking routes
- Save planned routes to Cloudflare R2 and D1
- Pin favorite planned routes to the top of the route library
- Export saved planned routes as GPX files
- Start tracking from a saved route plan
- Display planned route and actual GPS track together in the tracker
- Voice navigation using the browser Web Speech API
- Basic spoken turn prompts around 300m, 80m, and near the turn point
- Water and food voice reminders for long activities
- Rest block detection for long pauses, sleep, system gaps, and overnight breaks
- Lanjut Nanti / Finish Later mode for continuing an activity later

### Peleton Mode

- Create a live peleton room
- Invite other members to join the same ride room
- Family live tracking link
- Live radar map for peleton monitoring
- Temporary live location sync using Cloudflare KV
- Peleton voice radio for riders inside the tracker room

### Sharing & Export

- Share map card
- Share minimalist stats card
- Export GPX route file
- Export saved route plans as GPX files
- Generate cinematic route recap video
- Peleton video recap with stable rider initials and roster display

### Cloudflare Native

- Cloudflare Workers runtime
- Hono router
- Cloudflare D1 for app data
- Cloudflare R2 for route JSON and radio audio files
- Cloudflare KV for live peleton radar
- Cloudflare Turnstile for anti-bot protection
- Cloudflare static assets binding
- OpenRouteService for route planning

---

## Tech Stack

- TypeScript
- Hono
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare KV
- Cloudflare Turnstile
- Leaflet
- HTML
- CSS
- Vanilla JavaScript
- PWA

---

## Requirements

Before running this project, make sure you have:

- Node.js 24 or newer
- npm
- Cloudflare account
- Wrangler CLI
- Cloudflare D1 database
- Cloudflare R2 bucket
- Cloudflare KV namespace
- Cloudflare Turnstile site
- OpenRouteService API key

---

## Installation

Clone the repository:

```bash
git clone https://github.com/jeannesbryan/gaspool.git
cd gaspool
```

Install dependencies:

```bash
npm install
```

---

## Install From Zero To Live

This section is the recommended first-time deployment flow for a fresh self-hosted Gaspool instance.

The examples below use these placeholder names:

```text
Worker name      : gaspool
D1 database      : gaspool-db
R2 bucket        : gaspool-media
KV namespace     : GASPOOL_RADAR
Custom domain    : your-domain.com
Cloudflare zone  : your-domain.com
Public profile   : /rider
```

Replace them with your own values.

### 1. Login to Cloudflare

```bash
npx wrangler login
```

### 2. Create Cloudflare resources

Create a D1 database:

```bash
npx wrangler d1 create gaspool-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

Create an R2 bucket:

```bash
npx wrangler r2 bucket create gaspool-media
```

Recommended R2 lifecycle rule for temporary peleton radio audio:

```bash
npx wrangler r2 bucket lifecycle add gaspool-media delete-peleton-audio gaspool/audio/ --expire-days 1
```

This rule only targets objects whose key starts with:

```text
gaspool/audio/
```

It does not delete ride JSON or planned route JSON.

Create a KV namespace for live peleton radar:

```bash
npx wrangler kv namespace create GASPOOL_RADAR
```

Copy the returned KV `id` into `wrangler.jsonc`.

### 3. Create external service keys

Create these values before deployment:

- Cloudflare Turnstile site key and secret key
- OpenRouteService API key

For Turnstile, register the domain that will serve Gaspool, for example:

```text
your-domain.com
```

For local development, add `localhost` in the Turnstile dashboard if you want to test login locally.

### 4. Copy and edit Wrangler config

Copy the example config:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

On Windows:

```bash
copy wrangler.example.jsonc wrangler.jsonc
```

Then edit `wrangler.jsonc`:

```jsonc
{
  "name": "gaspool",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-16",
  "compatibility_flags": ["nodejs_compat"],

  "assets": {
    "binding": "ASSETS",
    "directory": "./public"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "gaspool-db",
      "database_id": "YOUR_D1_DATABASE_ID"
    }
  ],

  "r2_buckets": [
    {
      "binding": "R2_BUCKET",
      "bucket_name": "gaspool-media"
    }
  ],

  "kv_namespaces": [
    {
      "binding": "GASPOOL_RADAR",
      "id": "YOUR_KV_NAMESPACE_ID"
    }
  ],

  "routes": [
    {
      "pattern": "your-domain.com",
      "custom_domain": true
    }
  ],

  "vars": {
    "TURNSTILE_SITE_KEY": "YOUR_CLOUDFLARE_TURNSTILE_SITE_KEY",
    "ROUTING_PROVIDER": "ors",
    "PUBLIC_PROFILE_SLUG": "rider",
    "PUBLIC_PROFILE_NAME": "Gaspool Rider",
    "PUBLIC_PROFILE_AVATAR": "/assets/profile.webp"
  }
}
```

Do **not** commit your real `wrangler.jsonc`.

### 5. Custom domain options

Gaspool can run on the default `workers.dev` URL, but a custom domain is recommended for real GPS tracking because browser location APIs require HTTPS and the URL is easier to share.

For a Worker custom domain such as:

```text
https://your-domain.com
```

use:

```jsonc
"routes": [
  {
    "pattern": "your-domain.com",
    "custom_domain": true
  }
]
```

Alternative classic route under a Cloudflare zone:

```jsonc
"routes": [
  {
    "pattern": "your-domain.com/*",
    "zone_name": "your-domain.com"
  }
]
```

Important:

- Keep route/domain config in `wrangler.jsonc` aligned with the Cloudflare Dashboard.
- `wrangler deploy` can overwrite remote Worker route settings with your local config.
- If Wrangler shows a warning that local routes differ from remote routes, fix `wrangler.jsonc` before confirming deploy.

### 6. Put production secrets

Generate a strong JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Store secrets in Cloudflare:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ORS_API_KEY
```

Never put these secrets inside `wrangler.jsonc`.

### 7. Apply D1 schema

Apply the project schema before first deploy.

For a fresh Gaspool install, use the bundled `schema.sql`:

```bash
npx wrangler d1 execute gaspool-db --remote --file schema.sql
```

This creates the base Gaspool tables:

- `settings`
- `users`
- `login_logs`
- `rides`
- `planned_routes`
- `personal_segments`

If you are updating an existing instance that was installed before these features existed, apply only the missing feature migrations instead of re-running the full schema. Example:

```bash
npx wrangler d1 execute gaspool-db --remote --file MIGRATION_ACTIVITY_NOTES.sql
npx wrangler d1 execute gaspool-db --remote --file MIGRATION_ROUTE_FAVORITES.sql
```

If the repo later ships Wrangler migration files, you can also run:

```bash
npx wrangler d1 migrations apply gaspool-db --remote
```

### 8. Generate types and deploy

```bash
npm run cf-typegen
npm run deploy
```

### 9. First login

Open:

```text
https://your-domain.com/login
```

The first successful login creates the first captain account automatically if the `users` table is empty.

After login:

- `/` opens the private dashboard.
- `/route_plan` opens the route planner.
- `/routes` opens saved routes.
- `/:PUBLIC_PROFILE_SLUG` opens the public profile.

### 10. Smoke test checklist

After deploy, test:

- Login with Turnstile.
- Open `/route_plan` and search a location.
- Generate a route with OpenRouteService.
- Start a tracker from the route.
- Save one short activity.
- Toggle the activity to `PUBLIC`.
- Open the public profile URL in a private browser window.

---

## Cloudflare Configuration

Copy the example Wrangler config:

### Windows

```bash
copy wrangler.example.jsonc wrangler.jsonc
```

### macOS / Linux

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Then edit `wrangler.jsonc` and replace all placeholder values with your own Cloudflare resources.

Example resources needed:

```text
D1 database
R2 bucket
KV namespace
Turnstile site key
OpenRouteService API key
Custom domain, optional
```

Do **not** commit your real `wrangler.jsonc`.

If you are using a custom domain such as `your-domain.com`, make sure the `routes` block exists locally before running `npm run deploy`. Wrangler treats the local config as the source of truth.

---

## Environment Variables and Secrets

Gaspool uses these bindings and secrets:

### Public variable

```text
TURNSTILE_SITE_KEY
ROUTING_PROVIDER
PUBLIC_PROFILE_SLUG
PUBLIC_PROFILE_NAME
PUBLIC_PROFILE_AVATAR
```

These can be placed inside `wrangler.jsonc` under `vars`.

Recommended value:

```text
ROUTING_PROVIDER=ors
PUBLIC_PROFILE_SLUG=rider
PUBLIC_PROFILE_NAME=Gaspool Rider
PUBLIC_PROFILE_AVATAR=/assets/profile.webp
```

### Secret variables

```text
JWT_SECRET
TURNSTILE_SECRET_KEY
ORS_API_KEY
```

Set production secrets with Wrangler:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ORS_API_KEY
```

Generate a strong JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Use the generated value for `JWT_SECRET`.

`TURNSTILE_SECRET_KEY` must be taken from your Cloudflare Turnstile dashboard.

`ORS_API_KEY` must be taken from your OpenRouteService dashboard.

Do not put `ORS_API_KEY` inside `wrangler.jsonc`.

---

## Public Profile

Gaspool includes a single-owner public profile page for activity sharing.

The private dashboard stays behind login at:

```text
https://your-domain.com/
```

The public profile is a separate URL controlled by `PUBLIC_PROFILE_SLUG`.

The public URL is controlled by `PUBLIC_PROFILE_SLUG`:

```text
https://your-domain.com/PUBLIC_PROFILE_SLUG
```

Example:

```text
PUBLIC_PROFILE_SLUG=rider
PUBLIC_PROFILE_NAME=Gaspool Rider
PUBLIC_PROFILE_AVATAR=/assets/profile.webp
```

This makes the public page available at:

```text
https://your-domain.com/rider
```

For example, on a custom domain:

```text
https://your-domain.com/rider
```

For open source installs, change these values in `wrangler.jsonc` so cloned deployments do not all use the same public URL. The default-style URL `/rider` should be treated as an example, not a required project default.

`PUBLIC_PROFILE_AVATAR` should point to an image inside `/assets/` or an `https://` image URL.

Public profile visibility rules:

- New activities are private by default.
- Private activities do not appear on the public profile.
- Public activities can appear on `/:PUBLIC_PROFILE_SLUG`.
- The dashboard owner can toggle an activity between `PRIVATE` and `PUBLIC`.

Related routes:

```text
GET /:PUBLIC_PROFILE_SLUG
GET /api/public_rides/:PUBLIC_PROFILE_SLUG
```

Recommended public profile config:

```jsonc
"vars": {
  "PUBLIC_PROFILE_SLUG": "yourname",
  "PUBLIC_PROFILE_NAME": "Your Name",
  "PUBLIC_PROFILE_AVATAR": "/assets/profile.webp"
}
```

---

## Generate Cloudflare Types

After configuring `wrangler.jsonc`, generate Worker binding types:

```bash
npm run cf-typegen
```

This creates `worker-configuration.d.ts`.

The file is generated automatically and should not be committed.

---

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

---

## R2 Object Storage

Gaspool stores route JSON files in Cloudflare R2.

Recommended object prefixes:

```text
gaspool/
gaspool/routes/
gaspool/audio/
```

Example object key:

```text
gaspool/gaspool_ride_1720000000000_123.json
gaspool/routes/route_1720000000000_123.json
gaspool/audio/ROOM123/radio_RIDER_1720000000000.webm
```

R2 is used for:

- Route JSON files
- Planned route JSON files
- Peleton radio audio files

The public route JSON URL is stored in D1, so if an object is moved in R2, the related D1 record must also be updated.

### R2 Lifecycle For Temporary Audio

Peleton radio audio is temporary. Gaspool tries to clean it up when the captain finishes or aborts a peleton session, but browser/network interruptions can prevent cleanup from running.

Add an R2 lifecycle rule as a safety net:

```bash
npx wrangler r2 bucket lifecycle add gaspool-media delete-peleton-audio gaspool/audio/ --expire-days 1
```

This means:

- only objects under `gaspool/audio/` are affected,
- ride JSON under `gaspool/` is kept,
- planned route JSON under `gaspool/routes/` is kept,
- audio leftovers are automatically expired after 1 day.

You can also configure this from the Cloudflare dashboard:

1. Open Cloudflare Dashboard.
2. Go to **R2 Object Storage**.
3. Select your Gaspool bucket.
4. Open **Settings**.
5. Find **Object lifecycle rules**.
6. Add a rule with prefix:

```text
gaspool/audio/
```

7. Set expiration to `1 day`.
8. Save the rule.

Cloudflare lifecycle deletion is not instant. Objects are typically removed within about 24 hours after they become eligible for expiration.

---

## D1 Database

Gaspool uses Cloudflare D1 to store app data such as:

- Users
- Activities
- Ride statistics
- Route references
- Planned route references
- Participants
- Activity metadata

Make sure your D1 database is connected to the Worker using the `DB` binding in `wrangler.jsonc`.

Fresh installs should apply the bundled schema:

```bash
npx wrangler d1 execute gaspool-db --remote --file schema.sql
```

The schema includes current Gaspool tables and columns for:

- private/public activities via `rides.is_public`
- activity notes via `rides.notes`
- route planner links via `rides.planned_route_id`
- saved route favorites via `planned_routes.is_favorite`
- personal segments via `personal_segments`

To generate a fresh schema from a live D1 database:

```bash
npx wrangler d1 export gaspool-db --remote --output=./schema.sql --no-data --y
```

Review exported schemas before committing them. They should contain table/index structure only, not user data.

---

## Dependency Updates

To update only Hono:

```bash
npm install hono@latest
```

Or pin the version detected by `npm-check-updates`:

```bash
npm install hono@4.12.28
```

Then verify and deploy:

```bash
npm run cf-typegen
npm run deploy
```

---

## Route Planner

Route planner pages and APIs:

```text
GET  /route_plan
POST /api/route_plan
GET  /api/route_plans
GET  /api/route_plan/:id
GET  /api/route_plan/:id/gpx
POST /api/route_plan/:id/favorite
```

Basic route creation flow:

1. Open `/route_plan`.
2. Add a start point, destination, and optional waypoints.
3. Generate the route.
4. Start tracking from the generated route.
5. The tracker opens as `/record?type=ride&route=ROUTE_ID`.

The route planner stores normalized route data in R2 and metadata in D1.
Saved routes can be pinned to the top of the library and exported back to GPX.

### Offline Route Pack

Gaspool can prepare saved routes for limited offline use on the same device.

An offline route pack stores:

- route coordinates,
- turn-by-turn instructions,
- route waypoints,
- checkpoint/resupply points,
- route distance, duration, provider, and profile metadata.

Offline route packs are stored locally in the browser with `localStorage`. They are intended for route guidance when the network drops after the route has already been prepared.

How to prepare one:

1. Open `/route_plan`, generate or load a route, and wait until it says the route is packed offline.
2. Or open `/routes` and press `PACK` on a saved route.
3. Open the tracker once while online before a long ride so the PWA shell and route page are warmed up.

Important limitations:

- Offline route pack does not generate new routes offline.
- Offline route pack does not include mass-downloaded OpenStreetMap map tiles.
- If the browser storage is cleared, route packs are removed.
- Peleton radar, radio, weather, geocoding, upload, and reroute still need network access.

Supported routing profiles:

```text
cycling-regular
cycling-road
cycling-mountain
cycling-electric
foot-walking
foot-hiking
```

---

## Voice Navigation

Gaspool uses the browser Web Speech API for route voice guidance.

The tracker gives spoken prompts when the rider approaches the next instruction:

```text
Around 300 meters
Around 80 meters
Near the turn point
```

Voice navigation runs locally in the browser. The actual voice quality depends on the rider's device and installed browser voices.

If an Indonesian voice is available, Gaspool tries to use it. Otherwise, the browser default voice is used.

### Water And Food Reminders

The tracker can give local voice reminders for hydration and food during long activities.

Reminders use moving time and distance, not wall-clock time, so long stops and auto-pause periods should not spam the rider.

Default reminder intervals:

| Activity | Water reminder | Food reminder |
|---|---:|---:|
| Ride | 20 minutes or 10 km | 60 minutes or 25 km |
| Run | 20 minutes or 4 km | 45 minutes or 10 km |
| Walk | 25 minutes or 2.5 km | 60 minutes or 6 km |
| Hike | 25 minutes or 2 km | 60 minutes or 5 km |

The reminder can be toggled from the tracker. Reminder counts are saved in the activity JSON as `nutrition_summary`.

### Timezone And Multi-Day Timing

Gaspool stores activity point timestamps as ISO/UTC values and sends the activity `start_date` from the moment tracking starts, not from the upload/finish moment.

This matters for long trips and cross-timezone activities, for example starting in Bali (WITA) and finishing in Banyuwangi (WIB).

The activity JSON stores a `metadata.time_context` block:

```json
{
  "start_date": "2026-07-07T00:30:00.000Z",
  "finish_date": "2026-07-07T09:15:00.000Z",
  "start_timezone_offset_min": 480,
  "finish_timezone_offset_min": 420,
  "start_timezone_name": "Asia/Makassar",
  "finish_timezone_name": "Asia/Jakarta"
}
```

The D1 `rides.start_date` column uses the start timestamp, so multi-day uploads should still be sorted and grouped by when the activity began.

Timezone names and offsets come from the browser/device. If the phone does not automatically update timezone while crossing regions, Gaspool still keeps UTC timestamps correctly, but the timezone label follows the device setting.

### Rest Blocks And Finish Later

Gaspool can separate long stops from moving time by recording `rest_blocks` in the activity JSON.

Rest blocks can come from:

- long auto-pause periods,
- long browser/system gaps,
- resume after a long blackbox gap,
- manual Lanjut Nanti / Finish Later mode.

Lanjut Nanti / Finish Later saves the current blackbox session without uploading the activity. When the user resumes later, Gaspool records the rest block and starts a new etape when appropriate.

No D1 migration is required. Rest blocks are stored inside the R2 activity JSON and shown in the dashboard activity modal.

### Dashboard Calendar View

The dashboard includes a monthly calendar view for scanning activity consistency.

The calendar uses the existing `rides.start_date` data and follows the current dashboard filters where possible.

### Activity Doctor

Activity Doctor can scan and auto-repair saved activities without manual point editing.

```text
GET /api/activity_doctor/:id
POST /api/activity_doctor/:id/apply
```

The `GET` endpoint is a dry-run scanner. It reads the saved route JSON, detects old route formats, invalid or duplicate GPS points, obvious lng/lat coordinate order, extreme GPS jumps, long timestamp gaps, missing metadata, sparse route-node JSON, missing timestamps, and mismatch between D1 stats and route-derived estimates.

The `POST` apply endpoint only runs when the scan result has safe automatic fixes. Guard v4 uses **partial stat trust**: distance, moving time, average speed, max speed, and elevation are judged separately. If a field is risky, for example route nodes are sparse, timestamps are missing, max speed looks like a GPS spike, or elevation samples are missing, Doctor preserves the D1 value for that field instead of overwriting it with a bad recalculation. It requires an explicit confirmation payload from the UI, optionally checks that the expected repair action list still matches the latest scan, creates an R2 backup under `gaspool/repair-backups/`, writes the repaired activity JSON, then updates D1 stats last. The repaired JSON includes normalized points, rest blocks, metadata summaries, stat trust notes, acknowledged repair actions, and `repair_history`.

Activity Doctor hardening rules:

- GET is dry-run only. It never writes R2 or D1.
- POST apply refuses broken scans, missing confirmation, stale repair plans, and routes with too many raw GPS points.
- Sparse route-node data, missing timestamps, missing elevation samples, and suspicious max-speed spikes no longer force a full repair. Guard v4 switches to safe partial repair and preserves untrusted D1 fields.
- Route payload loading uses the bound R2 object whenever possible. External arbitrary fetch is blocked; only the configured public R2 host, `gaspool/` object path, and recognized legacy root activity JSON names are accepted. If an old root URL points to a file now stored under `gaspool/`, Doctor tries the safe folder fallback first.
- Repair writes backup first, repaired JSON second, and D1 stats last.

The activity detail Studio page includes a **CEK & PERBAIKI AKTIVITAS INI** button for logged-in users. The modal shows Doctor status, a recommendation badge, source shape, point counts, timestamp/elevation sample counts, preview of D1 vs safe proposed stats, issues, planned changes, guardrails, and safe auto-repair actions. The recommendation badge summarizes the decision, for example **AMAN DIREPAIR**, **AMAN DENGAN BACKUP**, **AMAN SEBAGIAN**, **JANGAN REPAIR STATISTIK**, **MANUAL CHECK**, or **SEHAT**. Applying repair reloads the page after the backup and update complete so the refreshed D1 stats are visible.

The tracker also includes a **Finish Review** screen before a new activity is uploaded. When the captain taps **TERMINATE & SAVE**, Gaspool pauses the live engines, scans the local GPS points, shows distance, moving time, GPS point count, stages, rest blocks, no-signal logs, privacy, and warning rows, then offers **SAVE FINAL** or **AUTO REPAIR & SAVE** when the issue is safe to fix automatically. Finish Review metadata is stored in the R2 activity JSON under `metadata.finish_review`.

For Strava/Garmin-like moving-time statistics, choose **AUTO REPAIR & SAVE** from Finish Review when the review says the data is safe. This lets Gaspool ignore long rest gaps from moving time, clean safe GPS anomalies, and recalculate average speed or pace from repaired moving-time data. When Doctor shows **AMAN SEBAGIAN**, applying repair is still safe because untrusted fields are preserved. When Doctor shows **JANGAN REPAIR STATISTIK** or **MANUAL CHECK**, keep the existing D1 stats instead of applying repair.


Manual trim, split, merge, and point-by-point editing are not part of Activity Doctor v1.

---

## Webapp Limitations and Mitigations

Gaspool is a webapp/PWA, not a native Android or iOS application. This keeps deployment simple and self-hosted, but it also means some behavior is controlled by the browser and operating system.

The project tries to mitigate those limits where possible.

| Limitation | Possible impact | What Gaspool does | What users can do |
|---|---|---|---|
| Browser background tracking | GPS updates may slow down or stop when the screen is off, the tab is hidden, or battery saver is active. | Uses Wake Lock API, stealth mode, local blackbox storage, and resume session. | Use HTTPS, keep the browser/PWA active, avoid force-closing the browser, and disable aggressive battery optimization for the browser. |
| OS battery optimization | Android/iOS can suspend browser work during long rides. | Stealth mode throttles visual rendering while keeping GPS/TTS/session logic running. | Use Android Chrome/PWA for best stability, turn off extreme battery saver, and test a short ride first. |
| Voice navigation depends on browser voices | Indonesian TTS quality varies by device/browser. | Uses the browser Web Speech API and tries to select Indonesian voices when available. | Install or enable Indonesian system voices if available, test voice before a long ride, and keep media volume audible. |
| Nutrition needs are personal | Water and food needs vary by heat, intensity, body size, sweat rate, and terrain. | Provides configurable local reminder timing based on activity type, moving time, and distance. | Treat reminders as prompts, bring enough supplies, and adjust your own fueling plan for long or hot routes. |
| Cross-timezone display | Local date labels may follow the device timezone, especially if the phone does not auto-update timezone while traveling. | Stores UTC start/finish timestamps and browser timezone context in the activity JSON, and saves D1 `start_date` from tracking start. | Keep automatic date/time/timezone enabled on the phone when crossing regions. |
| GPS accuracy depends on hardware and placement | Tracks may jump near buildings, under trees, in bad weather, or when the phone is deep inside a bag. | Filters large GPS jumps and records GPS accuracy status. | Place the phone where GPS can breathe, avoid thick bags, and give the device time to lock satellites before starting. |
| Offline behavior is partial | Route generation, geocoding, peleton radar, radio, weather, reroute, and upload need network access. | Stores GPS points locally with IndexedDB blackbox, supports resume after interruption, and can keep prepared route packs for guidance fallback. | Generate and pack routes before riding, open the tracker once while online, keep mobile data available for live features, and verify the saved activity after finishing. |
| No-signal events can happen on long trips | GPS, browser ticks, or network access may disappear in forests, mountains, bad weather, tunnels, or aggressive battery saver. | Records no-signal logs for network offline, GPS error, poor GPS accuracy, and long browser/system gaps. Logs are saved in the activity JSON metadata. | Use expedition mode, pack routes before leaving signal, and review the activity modal after finishing to understand where signal was weak. |
| iOS/Safari restrictions | Wake lock, audio, background behavior, and PWA lifecycle can be stricter than Android Chrome. | Uses progressive browser APIs and falls back where possible. | Prefer Android Chrome/PWA for serious long tracking, or test your exact iOS/Safari setup before relying on it. |
| Upload/network failure | Saving a long activity may fail if the network drops. | Uses chunked upload and local queue patterns so data is not immediately lost. | Do not close the browser immediately after finish; wait until upload completes or retry when the connection is stable. |

### Recommended Setup Before A Long Ride

- Use the deployed HTTPS custom domain, not an insecure local URL.
- Allow browser location permission.
- Open Gaspool once before the ride and confirm GPS lock.
- Test voice navigation on the same device.
- Turn off aggressive battery saver for the browser/PWA.
- Use stealth mode if you want to save power while riding.
- Do not force-close the browser during tracking.
- After finishing, wait until the save/upload process completes.

### Browser Recommendation

For the most reliable long-ride experience, Gaspool is currently best used on:

```text
Android + Chrome + installed PWA/custom domain HTTPS
```

Other modern browsers can work, but GPS background behavior and TTS support may vary.

---

## KV Namespace

Gaspool uses Cloudflare KV for temporary live peleton radar data.

KV binding name:

```text
GASPOOL_RADAR
```

KV is used for:

- Live peleton member location
- Temporary speed data
- Temporary radar room data
- Temporary peleton radio metadata

Live radar data is temporary and expires automatically.

---

## Turnstile

Gaspool uses Cloudflare Turnstile for bot protection.

Required values:

```text
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
```

`TURNSTILE_SITE_KEY` is public.

`TURNSTILE_SECRET_KEY` must be stored as a Cloudflare Worker secret.

---

## Open Source Notes

This repository does not include private Cloudflare resource IDs or production secrets.

To run your own instance, you need to create your own Cloudflare resources and update `wrangler.jsonc` based on `wrangler.example.jsonc`.
