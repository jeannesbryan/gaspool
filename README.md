# Gaspool

**Gaspool** is a lightweight activity tracker and peleton companion app built on **Cloudflare Workers** and **Hono**.

It helps cyclists, runners, walkers, and hikers record routes, share activity summaries, export GPX files, track peleton members live, and generate cinematic route recap videos.

Gaspool is designed to run serverlessly on Cloudflare using **Workers**, **D1**, **R2**, **KV**, and **Turnstile**.

---

## Features

### Activity Tracking

- Record cycling, running, walking, and hiking activities
- GPS-based route tracking
- Distance, moving time, speed, pace, elevation, and temperature display
- Activity detail page with map and statistics
- Offline-friendly PWA shell

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

## Project Structure

```text
gaspool/
├── public/
│   ├── assets/
│   ├── manifest.json
│   ├── offline.html
│   └── sw.js
├── src/
│   ├── index.ts
│   ├── routes/
│   └── ...
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
└── wrangler.example.jsonc
```

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

---

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/gaspool.git
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
Custom domain, optional
```

Do **not** commit your real `wrangler.jsonc`.

---

## Environment Variables and Secrets

Gaspool uses these bindings and secrets:

### Public variable

```text
TURNSTILE_SITE_KEY
```

This can be placed inside `wrangler.jsonc` under `vars`.

### Secret variables

```text
JWT_SECRET
TURNSTILE_SECRET_KEY
```

Set production secrets with Wrangler:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Generate a strong JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Use the generated value for `JWT_SECRET`.

`TURNSTILE_SECRET_KEY` must be taken from your Cloudflare Turnstile dashboard.

---

## Generate Cloudflare Types

After configuring `wrangler.jsonc`, generate Worker binding types:

```bash
npm run cf-typegen
```

This creates `worker-configuration.d.ts`.

The file is generated automatically and should not be committed.

---

## Development

Run the local development server:

```bash
npm run dev
```

Then open the local URL shown by Wrangler.

Common pages:

```text
/login
/
/record?type=ride
/record?type=run
/record?type=walk
/record?type=hike
/detail/:id
/video_flex/:id
/radar/:room
```

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
```

Example object key:

```text
gaspool/gaspool_ride_1720000000000_123.json
```

R2 is used for:

- Route JSON files
- Peleton radio audio files

The public route JSON URL is stored in D1, so if an object is moved in R2, the related D1 record must also be updated.

---

## D1 Database

Gaspool uses Cloudflare D1 to store app data such as:

- Users
- Activities
- Ride statistics
- Route references
- Participants
- Activity metadata

Make sure your D1 database is connected to the Worker using the `DB` binding in `wrangler.jsonc`.

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

## Available Scripts

```bash
npm run dev
```

Run the app locally with Wrangler.

```bash
npm run deploy
```

Deploy the Worker to Cloudflare.

```bash
npm run cf-typegen
```

Generate Cloudflare Worker binding types.

---

## Recommended `.gitignore`

Make sure these files and folders are not committed:

```gitignore
# Dependencies
node_modules/

# Wrangler local state
.wrangler/

# Real Cloudflare config
wrangler.jsonc

# Generated Cloudflare types
worker-configuration.d.ts

# Env / secrets
.env
.env.*
.dev.vars
.dev.vars.*

# Logs
*.log
npm-debug.log*

# OS / editor
.DS_Store
Thumbs.db
.vscode/
.idea/
```

---

## Files That Should Be Committed

Recommended files for the public repository:

```text
src/
public/
package.json
package-lock.json
tsconfig.json
README.md
.gitignore
wrangler.example.jsonc
```

---

## Files That Should Not Be Committed

Do not commit:

```text
node_modules/
.wrangler/
wrangler.jsonc
worker-configuration.d.ts
.env
.dev.vars
```

Also never commit:

```text
JWT_SECRET
TURNSTILE_SECRET_KEY
real Cloudflare database IDs
real KV namespace IDs
private API keys
private tokens
```

---

## Open Source Notes

This repository does not include private Cloudflare resource IDs or production secrets.

To run your own instance, you need to create your own Cloudflare resources and update `wrangler.jsonc` based on `wrangler.example.jsonc`.

---

## Repository Topics

Suggested GitHub topics:

```text
cloudflare-workers
hono
typescript
pwa
d1
r2
kv
serverless
cycling
running
gps-tracking
live-tracking
leaflet
gpx
turnstile
fitness
route-tracking
webapp
```

---

## About

Cloudflare Workers + Hono PWA for cycling/running tracking, live peleton radar, GPX export, route sharing, and cinematic video recap.
