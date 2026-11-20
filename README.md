# PilzAtlas NRW

**PilzAtlas NRW** is a mobile-first, offline-capable Progressive Web App (PWA) for predicting wild edible mushroom fruiting habitats across North Rhine-Westphalia (NRW), Germany.

It combines official OpenGeodata.NRW forestry, soil, and nature-reserve layers, live DWD ICON-D2 weather and soil-moisture forecasts via Open-Meteo, a deterministic mycological fruiting model for 8 native German species, and an offline field guide with lookalike warnings.

---

## Repository Structure

```text
.
├── index.html                        # App entry HTML (German locale, PWA meta tags, Leaflet CSS)
├── metadata.json                     # App metadata
├── package.json                      # Dependencies & npm scripts
├── tsconfig.json                     # TypeScript configuration
├── vite.config.ts                    # Vite 8 + Tailwind v4 + vite-plugin-pwa (Workbox) config
├── server.ts                         # Express dev/prod server & /api/nrw/geodata WFS proxy
├── public/                           # Static PWA icons (192px, 512px, maskable, Apple touch, SVG)
└── src/
    ├── main.tsx                      # React root mount + Service Worker registration
    ├── App.tsx                       # Top-level state, tab navigation, weather/geodata orchestration
    ├── index.css                     # Tailwind CSS v4 entry & Leaflet/mobile layout overrides
    ├── assets/images/                # Local botanical photographs for the 8 mushroom species
    ├── types/
    │   └── foraging.ts               # Core TypeScript models (stands, species, weather, predictions)
    ├── data/
    │   ├── nrwForestStands.ts        # 6 NRW Naturräume metadata & curated baseline forest polygons
    │   └── species.ts                # 8 NRW edible species profiles, ecology params & toxic lookalikes
    ├── hooks/
    │   ├── useOnlineStatus.ts        # Browser online/offline connectivity hook
    │   └── usePWAInstall.ts          # beforeinstallprompt + iOS Safari install detection
    ├── services/
    │   ├── ecologyEngine.ts          # Mycological fruiting probability & diagnostic scoring engine
    │   ├── weatherService.ts         # Open-Meteo (DWD ICON) precipitation, soil moisture & temp client
    │   ├── nrwGeodataService.ts      # Frontend client for /api/nrw/geodata
    │   ├── offlineStorage.ts         # IndexedDB storage for offline packs, weather & cached polygons
    │   └── overpassService.ts        # Optional Overpass/OSM helper utilities
    ├── server/
    │   └── nrwGeodataProxy.ts        # Server-side WFS client for Wald & Holz NRW, GD NRW FSK05 & LANUV
    └── components/
        ├── MushroomLogo.tsx          # Custom comic-style mushroom SVG mascot
        ├── TopographicMapView.tsx    # Interactive Leaflet map, filters, 7-day strip, GPS & layers
        ├── StandInspectorPanel.tsx   # Bottom-sheet / sidebar habitat breakdown & legal BArtSchV notes
        ├── ForecastView.tsx          # 6-region NRW weather overview, rainfall chart & top stand ranking
        ├── FieldGuideView.tsx        # Searchable German mushroom guide & toxic lookalike modal
        ├── OfflinePacksView.tsx      # Regional OpenTopoMap tile downloader & IndexedDB manager
        ├── OfflineIndicator.tsx      # Offline mode status banner
        └── PWAInstallButton.tsx      # Native PWA install trigger & iOS Safari install instructions
```

---

## Architecture Overview

### 1. Frontend SPA & PWA (`React 19` + `Vite 8` + `Tailwind CSS v4` + `Leaflet`)
- **Single-Page Application:** All views (*Karte*, *Prognose*, *Pilzführer*, *Offline*) run completely client-side with zero external database or user-account dependencies.
- **Interactive Topographic Map:** Uses Leaflet with **OpenTopoMap** tiles (with automatic OpenStreetMap fallback), custom Naturraum overview labels across all 6 NRW regions (*Bergisches Land*, *Eifel & Hohes Venn*, *Sauerland & Siegerland*, *Teutoburger Wald & Egge*, *Münsterland*, *Niederrhein & Ruhr*), interactive polygon overlays, and browser GPS tracking.
- **Offline-First PWA (`vite-plugin-pwa`):** Generates a Workbox Service Worker (`sw.js`) and Web App Manifest (`manifest.webmanifest`) at build time. App assets and species photos are precached; OpenTopoMap tiles and Open-Meteo responses are cached at runtime; regional tile packs and fetched NRW stands are stored locally in **IndexedDB** (`src/services/offlineStorage.ts`).

### 2. Mycological Ecology Engine (`src/services/ecologyEngine.ts`)
- Evaluates every forest stand polygon against each mushroom species using:
  - **Host tree affinity** (spruce, beech, oak, pine, birch, etc.)
  - **Soil chemistry & substrate** (pH, calcareous vs. acidic slate/sandstone/loam, texture)
  - **Topography** (elevation, aspect, slope)
  - **Microclimate lag** (rolling 14-day rainfall window, volumetric soil moisture, 0–10 cm soil temperature, and air temperature)
  - **Seasonality & legal protection** (Nature Reserves / *Naturschutzgebiete* are hard-flagged as `NSG · Sammelverbot` and excluded from top picking recommendations).
- Supports switching between **Live DWD Weather** and a **Peak-Autumn Reference Mode** (*Okt-Peak*) for off-season scouting.

### 3. Live Data Sources
- **Weather & Soil Moisture (Direct from Browser):** `src/services/weatherService.ts` queries the public **Open-Meteo API** (DWD ICON model) directly from the client over HTTPS—no API key or backend proxy is required.
- **High-Resolution NRW Geodata (Optional Backend Proxy):** `server.ts` + `src/server/nrwGeodataProxy.ts` exposes `GET /api/nrw/geodata?south=...&west=...&north=...&east=...`. When the user taps **NRW-Daten** on the map, the proxy queries official **OpenGeodata.NRW** WFS services in parallel:
  1. **Wald & Holz NRW** — forest stand boundaries and tree composition
  2. **Geologischer Dienst NRW (FSK05, 1:5.000)** — high-resolution forest soil & water balance units
  3. **LANUV NRW** — official *Naturschutzgebiete* (NSG), National Parks, and *Naturwaldzellen*

  The proxy converts coordinates/GML/GeoJSON into compact WGS84 polygons, clips/merges attributes, and caches responses with `Cache-Control: public, max-age=600`.

---

## Local Development

### Prerequisites
- **Node.js 20+** (Node 22 LTS recommended) and **npm**

### Start the Development Server

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (Express API proxy + Vite middleware on port 3000)
npm run dev
```

Open **http://localhost:3000** in your browser.

### Useful Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts `server.ts` via `tsx` with Vite middleware and `/api/nrw/geodata` enabled on port `3000`. |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`). |
| `npm run build` | Builds the production static PWA bundle into `dist/`. |
| `npm run preview` | Previews the static `dist/` bundle locally via Vite (without `/api/nrw/geodata`). |
| `npm run start` | Runs `server.ts` with Node (set `NODE_ENV=production` to serve `dist/` + `/api/nrw/geodata`). |

---

## Deploying on a Linux VPS (Simple Static HTTPS Vhost)

Because **PilzAtlas NRW** is a PWA (Service Workers, GPS geolocation, and iOS/Android home-screen installation all require a secure context), it should always be served over **HTTPS**.

### What works on a pure static HTTPS vhost?

Running `npm run build` produces a self-contained static site in `dist/`. On a pure static web server (Nginx, Caddy, Apache) with **no Node.js runtime required on the server**:
- The interactive topographic map and all 6 NRW *Naturräume* curated forest polygons work out of the box.
- Live DWD ICON-D2 weather and 7-day forecasts work directly via Open-Meteo (browser CORS).
- The 8-species offline field guide, ecological scoring engine, GPS tracking, and regional OpenTopoMap offline pack downloads all work natively.
- **Note on the "NRW-Daten" button:** Only the on-demand high-resolution WFS loader (`GET /api/nrw/geodata`) uses the Node/Express proxy (upstream OpenGeodata.NRW WFS endpoints do not send permissive browser CORS headers). If you want that button active as well, see the optional 5-line proxy section below.

---

### Step 1: Build and Upload the Static Bundle

Build locally (or on the VPS):

```bash
npm ci
npm run build
```

Copy the contents of `dist/` to your VPS web root (for example `/var/www/pilzatlas-nrw`):

```bash
sudo mkdir -p /var/www/pilzatlas-nrw
rsync -avz --delete dist/ user@your-vps:/var/www/pilzatlas-nrw/
```

---

### Step 2: Configure a Static HTTPS Vhost

#### Option A: Nginx + Let's Encrypt (Certbot)

Create `/etc/nginx/sites-available/pilzatlas-nrw`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name pilzatlas.example.com;

    root /var/www/pilzatlas-nrw;
    index index.html;

    # Compression for faster mobile loads
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml application/manifest+json;

    # Never aggressively cache the HTML shell, Service Worker, or PWA manifest
    location ~* ^/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }

    # Long-term immutable cache for hashed Vite build assets
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site and issue an automatic HTTPS certificate with Certbot:

```bash
sudo ln -s /etc/nginx/sites-available/pilzatlas-nrw /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Provision Let's Encrypt TLS certificate and HTTPS redirect
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pilzatlas.example.com
```

#### Option B: Caddy (Automatic HTTPS)

If you use **Caddy**, add this block to `/etc/caddy/Caddyfile` (Caddy obtains and renews Let's Encrypt certificates automatically):

```caddyfile
pilzatlas.example.com {
    root * /var/www/pilzatlas-nrw
    encode zstd gzip

    @nocache path /index.html /sw.js /registerSW.js /manifest.webmanifest
    header @nocache Cache-Control "no-cache, no-store, must-revalidate"

    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"

    try_files {path} /index.html
    file_server
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

---

### Step 3 (Optional): Enable Live High-Resolution OpenGeodata.NRW WFS Proxy

If you also want the **"NRW-Daten"** button to fetch live 1:5.000 `FSK05`, `Wald & Holz NRW`, and `LANUV NSG` polygons on your VPS, run `server.ts` locally on port `3000` and proxy only `/api/` from your static HTTPS vhost.

1. **Create a lightweight systemd unit** (`/etc/systemd/system/pilzatlas-proxy.service`):

```ini
[Unit]
Description=PilzAtlas NRW OpenGeodata WFS Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/pilzatlas-nrw
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pilzatlas-proxy
```

2. **Proxy `/api/` in Nginx** (inside your HTTPS `server { ... }` block, above `location /`):

```nginx
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
```

*(In Caddy, add `handle /api/* { reverse_proxy 127.0.0.1:3000 }` inside the site block.)*

Verify health via `curl https://pilzatlas.example.com/api/health`.

---

## Legal & Foraging Safety Disclaimer

This application is an ecological forecasting and orientation tool. Always verify every wild mushroom using multiple physical characteristics (and consult a certified **DGfM-Pilzsachverständige** when in doubt). Strictly respect German nature-conservation law (**BArtSchV** / **§ 39 BNatSchG**): picking is prohibited in *Naturschutzgebiete* (NSG), National Parks, and *Naturwaldzellen*, and limited to personal household quantities (*Eigenbedarf*) in open forests.
