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
# macOS 12 (Monterey) et antérieur : playwright>=1.45 nécessite macOS 13+
# On utilise la dernière version Node 18 (1.37) compatible macOS 12
MACOS_MAJOR=$(sw_vers -productVersion 2>/dev/null | cut -d. -f1 || echo "14")
if [ "$OS" = "Darwin" ] && [ "${MACOS_MAJOR}" -lt 13 ]; then
  PW_SPEC="playwright==1.37.0"
else
  PW_SPEC="playwright>=1.47"
fi
"$UV" pip install --quiet --python "$PY" --upgrade "$PW_SPEC" pynput

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
  echo "  L'application « PharmAgent » (dossier Applications) est créée au premier lancement de l'agent."
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

printf '\n\033[1;32m✓ Installation terminée.\033[0m\n'
echo "  Le panneau PharmAgent s'ouvre dans le navigateur (http://127.0.0.1:8765)."
echo "  Il affiche un code à 6 chiffres : saisissez-le dans PharmAgent › Agent local."

if [ -z "${PHARMAGENT_INSTALL_NO_LAUNCH:-}" ]; then
  # Arrête une ancienne version encore lancée, pour que la nouvelle prenne sa place
  if [ "$OS" = "Darwin" ]; then
    # Ancien démarrage automatique (versions < 2.2) : retiré, l'agent recrée le bon au lancement
    launchctl unload "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" >/dev/null 2>&1 || true
    rm -f "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" "$APP_DIR/launcher.sha"
  fi
  pkill -f "pharmagent_agent.py" >/dev/null 2>&1 || true
  sleep 1
  if [ "$OS" = "Darwin" ]; then
    echo "  Laissez cette fenêtre ouverte (réduisez-la) : l'agent y tourne."
    exec "$PY" "$AGENT" --server "$SERVER"
  fi
  nohup "$PY" "$AGENT" --server "$SERVER" >/dev/null 2>&1 &
fi
