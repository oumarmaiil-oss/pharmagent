#!/bin/bash
# PharmAgent — installation de l'agent local (macOS / Linux)
# Aucun droit administrateur requis. Python est fourni par « uv » (pas d'installation manuelle).
set -euo pipefail

SERVER="${PHARMAGENT_SERVER:-__SERVER_URL__}"
PY_VERSION="${PHARMAGENT_PYTHON_VERSION:-3.12}"
OS="$(uname)"
if [ "$OS" = "Darwin" ]; then
  APP_DIR="$HOME/Library/Application Support/PharmAgent"
else
  APP_DIR="$HOME/.local/share/PharmAgent"
fi

step() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

printf '\n\033[1m PharmAgent — installation de l'"'"'agent local\033[0m\n Serveur : %s\n' "$SERVER"
mkdir -p "$APP_DIR"

step "1/5 Outil Python (uv)"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh || fail "Téléchargement impossible : vérifiez la connexion Internet."
  export PATH="$HOME/.local/bin:$PATH"
fi
UV="$(command -v uv)" || fail "uv introuvable après installation."

step "2/5 Python $PY_VERSION et dépendances (1 à 3 minutes la première fois)"
"$UV" venv --quiet --allow-existing --python "$PY_VERSION" "$APP_DIR/venv"
PY="$APP_DIR/venv/bin/python"
"$UV" pip install --quiet --python "$PY" --upgrade "playwright>=1.47" pynput

step "3/5 Navigateur pour les ERP web"
if [ -n "${PHARMAGENT_SKIP_BROWSER:-}" ]; then
  echo "  (ignoré)"
elif [ "$OS" = "Darwin" ] && { [ -d "/Applications/Google Chrome.app" ] || [ -d "/Applications/Microsoft Edge.app" ]; }; then
  echo "  Google Chrome / Edge déjà présent : rien à télécharger."
else
  "$PY" -m playwright install chromium
fi

step "4/5 Agent PharmAgent"
curl -fsSL "$SERVER/agent/pharmagent_agent.py" -o "$APP_DIR/pharmagent_agent.py.new" || fail "Serveur PharmAgent injoignable : $SERVER"
mv "$APP_DIR/pharmagent_agent.py.new" "$APP_DIR/pharmagent_agent.py"
AGENT="$APP_DIR/pharmagent_agent.py"

step "5/5 Raccourci et démarrage automatique"
if [ "$OS" = "Darwin" ]; then
  mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents"
  rm -rf "$HOME/Applications/PharmAgent.app"
  osacompile -o "$HOME/Applications/PharmAgent.app" \
    -e "do shell script quoted form of \"$PY\" & \" \" & quoted form of \"$AGENT\" & \" --server $SERVER > /dev/null 2>&1 &\"" >/dev/null
  PLIST="$HOME/Library/LaunchAgents/com.pharmagent.agent.plist"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pharmagent.agent</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$AGENT</string><string>--background</string><string>--server</string><string>$SERVER</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  echo "  Application « PharmAgent » ajoutée dans votre dossier Applications (Launchpad)."
else
  mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"
  cat > "$HOME/.local/share/applications/pharmagent.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=PharmAgent
Comment=Agent local de saisie PharmAgent
Exec="$PY" "$AGENT" --server $SERVER
Terminal=false
EOF
  sed 's/--server/--background --server/' "$HOME/.local/share/applications/pharmagent.desktop" > "$HOME/.config/autostart/pharmagent.desktop"
fi

if [ -z "${PHARMAGENT_INSTALL_NO_LAUNCH:-}" ]; then
  nohup "$PY" "$AGENT" --server "$SERVER" >/dev/null 2>&1 &
fi

printf '\n\033[1;32m✓ Installation terminée.\033[0m\n'
echo "  Le panneau PharmAgent s'ouvre dans le navigateur (http://127.0.0.1:8765)."
echo "  Il affiche un code à 6 chiffres : saisissez-le dans PharmAgent › Agent local."
