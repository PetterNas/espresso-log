# Espresso Log

Tiny app for logging home espresso shots — grinder setting, dose, extraction time, beans (plus optional yield, rating, notes) — with a beans library, history and charts. Installable as a PWA on your phone.

**Stack:** .NET 10 Minimal API · EF Core + SQLite · vanilla HTML/JS · Chart.js (vendored, no npm/build step).

## Run locally

```sh
cd src/EspressoLog
dotnet run            # http://localhost:5080
```

Dev data goes to `src/EspressoLog/db/espresso.db` (git-ignored).

## Run on your Mac as a service + open on your phone

```sh
./scripts/install-launchd.sh
```

This publishes a Release build to `~/Library/Application Support/EspressoLog/app`, starts it on login via launchd on `127.0.0.1:5080`, and runs `tailscale serve --bg 5080`, which gives you `https://<your-mac>.<tailnet>.ts.net`.

On the phone (with Tailscale connected) open that URL, then:
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app*

Re-run the script after code changes to redeploy. `./scripts/install-launchd.sh uninstall` removes the service (data is kept).

- Database: `~/Library/Application Support/EspressoLog/espresso.db` — back it up by copying the file.
- Logs: `~/Library/Application Support/EspressoLog/app.log`
- No auth: the app listens on localhost only and is reachable solely through your tailnet.

## Run on the home server (Docker)

Every push to `main` builds the image and publishes it as `ghcr.io/petternas/espresso-log:latest`
(see `.github/workflows/docker.yml`). It listens on port 8080 and keeps everything (shots, beans,
photos) in `/data/espresso.db`. The compose service and Caddy route live in `homeserver-infra`.

To deploy a new version, on the server:

```bash
docker compose pull espresso && docker compose up -d espresso
```

Schema migrations run automatically when the container starts.

## Using it

- **Beans** — add each bag: name, roaster, origin, roast date, purchase date, where you bought it, price, amount (g), plus a 1–5 rating, a review of what you like about them, and a photo of the bag or beans. Cards show roast age, roughly how many grams are left, shot count and last grind. Toggle *Finished* when the bag is empty: it leaves the Log picker but keeps its shots and review. (Beans with shots can't be deleted.)
- **Log** — pick the beans; the grind starts at the last setting you used with those beans (or your most recent shot's for a new bag), dose defaults to 18 g. Type the time from your scale and *Save*. Yield/rating/notes are under the collapsible section. Commas work as decimal separators.
- **History** — tap a shot to edit or delete it; filter by beans; *Export CSV*.
- **Charts** — time vs grind (per bean), time per shot, brew ratio vs time.
- **Offline** — the app shell is cached; shots saved without a connection are queued on the device and synced automatically when you're back online.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/shots?beanId=&limit=` | newest first, includes `beanName` |
| GET | `/api/shots/{id}` | |
| POST | `/api/shots` | `{ beanId, grindSetting, doseGrams, timeSeconds, yieldGrams?, rating?, notes?, createdAt? }` |
| PUT | `/api/shots/{id}` | same body |
| DELETE | `/api/shots/{id}` | |
| GET | `/api/beans?includeFinished=` | active first, most recently used first; includes `shotCount`, `usedGrams`, `lastUsedAt`, `lastGrind` |
| GET | `/api/beans/{id}` | |
| POST | `/api/beans` | `{ name, roaster?, origin?, purchasedFrom?, roastDate?, purchaseDate?, price?, amountGrams?, rating?, review?, finished }` |
| PUT | `/api/beans/{id}` | same body |
| DELETE | `/api/beans/{id}` | 409 if the beans have shots |
| GET | `/api/beans/{id}/photo` | the bag's photo (cacheable; beans carry `photoUpdatedAt` for the `?v=` URL) |
| PUT | `/api/beans/{id}/photo` | raw JPEG/PNG/WebP body, max 8 MB (the app uploads a ≤1600 px JPEG) |
| DELETE | `/api/beans/{id}/photo` | |
| GET | `/api/shots.csv` | CSV export |

## Schema changes

```sh
cd src/EspressoLog
dotnet ef migrations add <Name>
```

Migrations are applied automatically on startup.
