# Espresso Log

A small self-hosted app for logging home espresso shots and the beans you pull them with. Record grind setting, dose, time, yield and taste for each shot, and get a hint for the next one. It also tracks your bags: roast age, shots left and cost per shot. Install it as an app on your phone and it keeps working offline.

**Stack:** .NET 10 Minimal API · EF Core + SQLite · vanilla HTML/JS · Chart.js (vendored, no npm or build step). Everything, photos included, lives in one SQLite file.

## Features

- **Log a shot in seconds.** The grind starts at the last setting you used with those beans, dose and yield default to 18 → 36 g, and commas work as decimal separators. Add a 1–5 rating, taste tags (sour, bitter, balanced, sweet, watery, syrupy, channeling) and notes.
- **Dial-in help.** Above the form you see the bag's **best recipe** (mark a shot as *Best shot for this bag*; *Use* fills grind/dose/yield) and a **next-shot hint** based on the last shot:
  - sour or watery → go finer
  - bitter → go coarser
  - sour and bitter together, or channeling → fix your puck prep
  - no taste tags → judged by time (target 25–32 s)
- **Beans library.** Save each bag's roaster, origin, roast and purchase dates, where you bought it, price, weight, a photo and your review. Each card shows roast age, roughly how many shots are left (at your average dose), cost per shot and the best recipe. Open a bag to see every shot you made with it. Mark a bag *Finished* when it's empty; it keeps its history.
- **History.** Newest shots first, grouped by day, filterable by beans. Tap a shot to edit or delete it, or use *Export CSV*.
- **Charts.** Time vs grind (per bean), time per shot, and brew ratio vs time.
- **Works offline.** The app is cached on your phone. Shots saved without a connection wait on the device and sync when you're back online.

## Self-hosting with Docker

A multi-arch image (amd64 and arm64) is published to GitHub's container registry. `docker-compose.yml`:

```yaml
services:
  espresso:
    image: ghcr.io/petternas/espresso-log:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - espresso-data:/data

volumes:
  espresso-data:
```

```sh
docker compose up -d
```

Then open `http://<your-server>:8080`.

- **Data:** everything is in `/data/espresso.db`. Back it up by copying that file. If you bind-mount a host folder instead of using a named volume, make it writable by the container user (UID 1654): `sudo chown 1654:1654 ./data`.
- **Updating:** `docker compose pull && docker compose up -d`. Database migrations run on startup.
- **No built-in login.** Don't expose it to the internet as is. Keep it on your LAN or VPN (e.g. Tailscale), or put it behind a reverse proxy with authentication (Authelia, Authentik, Caddy/Traefik with basic auth). The app copes with an expired proxy session: shots are queued and a *Sign in* button appears.
- **HTTPS:** installing the app on your phone and offline mode need HTTPS, except on `localhost`. Your reverse proxy or `tailscale serve` can provide it.

### Install on your phone

Open the app's URL, then:
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app*

## Configuration

| Setting | Default | |
|---|---|---|
| `ConnectionStrings__Db` | `Data Source=/data/espresso.db` (Docker) | SQLite connection string |
| `ASPNETCORE_HTTP_PORTS` | `8080` (Docker) | Port to listen on |

The next-shot hint assumes a **lower grind number is finer**. If your grinder counts the other way, set `FINER = 1` at the top of `src/EspressoLog/wwwroot/app.js`. That file also holds the target time range and the low-bag warning threshold.

## Development

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download).

```sh
cd src/EspressoLog
dotnet run            # http://localhost:5080
```

Dev data goes to `src/EspressoLog/db/espresso.db` (git-ignored). To change the schema:

```sh
dotnet ef migrations add <Name>
```

To build the image yourself: `docker build -t espresso-log .`

## API

The app is a static page on top of a small JSON API, which you can also use directly.

| Method | Path | |
|---|---|---|
| GET | `/api/shots?beanId=&limit=` | newest first, includes `beanName` |
| GET | `/api/shots/{id}` | |
| POST | `/api/shots` | `{ beanId, grindSetting, doseGrams, timeSeconds, yieldGrams?, rating?, notes?, tags?, best?, createdAt? }` |
| PUT | `/api/shots/{id}` | same body |
| DELETE | `/api/shots/{id}` | |
| GET | `/api/beans?includeFinished=` | active first, most recently used first; includes `shotCount`, `usedGrams`, `lastUsedAt`, `lastGrind`, `bestShot` |
| GET | `/api/beans/{id}` | |
| POST | `/api/beans` | `{ name, roaster?, origin?, purchasedFrom?, roastDate?, purchaseDate?, price?, amountGrams?, leftGrams?, rating?, review?, finished }` |
| PUT | `/api/beans/{id}` | same body |
| DELETE | `/api/beans/{id}` | 409 if the beans have shots |
| GET | `/api/beans/{id}/photo` | the bag's photo |
| PUT | `/api/beans/{id}/photo` | raw JPEG/PNG/WebP body, max 8 MB |
| DELETE | `/api/beans/{id}/photo` | |
| GET | `/api/shots.csv` | CSV export |
