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
- Offline-friendly PWA shell

### Route Plan & Navigator

- Create a route plan from map points
- Use OpenRouteService Directions for cycling, walking, running, and hiking routes
- Save planned routes to Cloudflare R2 and D1
- Start tracking from a saved route plan
- Display planned route and actual GPS track together in the tracker
- Voice navigation using the browser Web Speech API
- Basic spoken turn prompts around 300m, 80m, and near the turn point

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

---

## Environment Variables and Secrets

Gaspool uses these bindings and secrets:

### Public variable

```text
TURNSTILE_SITE_KEY
ROUTING_PROVIDER
```

These can be placed inside `wrangler.jsonc` under `vars`.

Recommended value:

```text
ROUTING_PROVIDER=ors
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

Recommended object prefix:

```text
gaspool/
gaspool/routes/
```

Example object key:

```text
gaspool/gaspool_ride_1720000000000_123.json
gaspool/routes/route_1720000000000_123.json
```

R2 is used for:

- Route JSON files
- Planned route JSON files
- Peleton radio audio files

The public route JSON URL is stored in D1, so if an object is moved in R2, the related D1 record must also be updated.

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

Route planning requires a `planned_routes` table and a `planned_route_id` column on `rides`.

If you use Wrangler migrations, apply the migration before deploying the route planner feature:

```bash
npx wrangler d1 migrations apply gaspool-db --remote
```

Manual SQL shape:

```sql
CREATE TABLE IF NOT EXISTS planned_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  distance REAL DEFAULT 0,
  duration INTEGER DEFAULT 0,
  route_url TEXT NOT NULL,
  provider TEXT DEFAULT 'ors',
  profile TEXT DEFAULT 'cycling-regular',
  waypoints TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rides ADD COLUMN planned_route_id INTEGER;
```

---

## Route Planner

Route planner pages and APIs:

```text
GET  /route_plan
POST /api/route_plan
GET  /api/route_plans
GET  /api/route_plan/:id
```

Basic route creation flow:

1. Open `/route_plan`.
2. Add a start point, destination, and optional waypoints.
3. Generate the route.
4. Start tracking from the generated route.
5. The tracker opens as `/record?type=ride&route=ROUTE_ID`.

The route planner stores normalized route data in R2 and metadata in D1.

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
