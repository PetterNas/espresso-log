#!/usr/bin/env bash
# Publishes the app and installs it as a macOS login service (launchd),
# then exposes it to your tailnet over HTTPS with `tailscale serve`.
#
#   ./scripts/install-launchd.sh            # install / update
#   ./scripts/install-launchd.sh uninstall  # remove the service (keeps your data)
set -euo pipefail

LABEL="com.espressolog.app"
PORT="${PORT:-5080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$HOME/Library/Application Support/EspressoLog"
BIN_DIR="$APP_DIR/app"
DB_PATH="$APP_DIR/espresso.db"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOTNET="$(command -v dotnet)"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Service removed. Data kept at: $DB_PATH"
  exit 0
fi

echo "→ Publishing to $BIN_DIR"
mkdir -p "$APP_DIR"
dotnet publish "$ROOT/src/EspressoLog" -c Release -o "$BIN_DIR" --nologo -v quiet

echo "→ Writing $PLIST"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DOTNET</string>
    <string>$BIN_DIR/EspressoLog.dll</string>
  </array>
  <key>WorkingDirectory</key><string>$BIN_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ASPNETCORE_URLS</key><string>http://127.0.0.1:$PORT</string>
    <key>ConnectionStrings__Db</key><string>Data Source=$DB_PATH</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/app.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/app.log</string>
</dict>
</plist>
PLIST

echo "→ (Re)starting service"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for _ in {1..20}; do
  curl -sf "http://127.0.0.1:$PORT/api/beans" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/api/beans" >/dev/null \
  && echo "✓ Running on http://127.0.0.1:$PORT (data: $DB_PATH)" \
  || { echo "✗ Service didn't come up — see $APP_DIR/app.log"; exit 1; }

if command -v tailscale >/dev/null; then
  echo "→ Exposing via tailscale serve"
  tailscale serve --bg "$PORT"
  tailscale serve status
else
  echo "Tailscale CLI not found — run: tailscale serve --bg $PORT"
fi
