#!/bin/bash
# PharmAgent — installation de l'agent local (macOS / Linux)
# Aucun droit administrateur requis. Tout est installé dans le dossier de l'utilisateur.
# Le script détecte la version du système et choisit les versions de Python et de
# Playwright qui fonctionnent dessus, puis vérifie que le navigateur démarre vraiment.
set -uo pipefail

SERVER="${PHARMAGENT_SERVER:-__SERVER_URL__}"
OS="$(uname)"

step() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\n\033[1;33m!  %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

printf '\n\033[1m PharmAgent — installation de l'"'"'agent local\033[0m\n Serveur : %s\n' "$SERVER"

# ── Système : la version décide de tout le reste ───────────────────────────
MACOS_MAJOR=0
if [ "$OS" = "Darwin" ]; then
  MACOS_MAJOR=$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)
  case "$MACOS_MAJOR" in ''|*[!0-9]*) MACOS_MAJOR=0 ;; esac
  APP_DIR="$HOME/Library/Application Support/PharmAgent"
else
  APP_DIR="$HOME/.local/share/PharmAgent"
fi

# macOS 12 (Monterey) et antérieur : Playwright ≥ 1.45 embarque un Node qui exige
# macOS 13. Et greenlet, dont dépend Playwright 1.37, n'a pas de paquet précompilé
# pour Python 3.12 sur ces machines — d'où Python 3.11.
OLD_MAC=0
if [ "$OS" = "Darwin" ] && [ "$MACOS_MAJOR" -gt 0 ] && [ "$MACOS_MAJOR" -lt 13 ]; then
  OLD_MAC=1
fi
if [ "$OLD_MAC" = "1" ]; then
  PY_VERSION="${PHARMAGENT_PYTHON_VERSION:-3.11}"
  PW_SPEC="${PHARMAGENT_PLAYWRIGHT:-playwright==1.37.0}"
  info "macOS $MACOS_MAJOR détecté : Python $PY_VERSION et $PW_SPEC (versions compatibles)."
else
  PY_VERSION="${PHARMAGENT_PYTHON_VERSION:-3.12}"
  PW_SPEC="${PHARMAGENT_PLAYWRIGHT:-playwright>=1.47}"
fi

mkdir -p "$APP_DIR" || fail "Impossible d'écrire dans $APP_DIR."

# ── 1. Python ──────────────────────────────────────────────────────────────
step "1/6 Python $PY_VERSION"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
PY=""
USE_UV=0

# Un environnement créé par uv ne contient pas pip : les paquets s'y installent
# avec « uv pip », pas avec « python -m pip ».
pipi() {
  if [ "$USE_UV" = "1" ]; then
    "$UV" pip install --quiet --python "$PY" --upgrade "$@"
  else
    "$PY" -m pip install --quiet --upgrade "$@"
  fi
}

if ! command -v uv >/dev/null 2>&1; then
  info "Installation de l'outil « uv » (fournit Python, sans droits administrateur)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

if command -v uv >/dev/null 2>&1; then
  UV="$(command -v uv)"
  if "$UV" venv --quiet --allow-existing --python "$PY_VERSION" "$APP_DIR/venv" >/dev/null 2>&1; then
    PY="$APP_DIR/venv/bin/python"
    USE_UV=1
    info "Python $PY_VERSION prêt."
  else
    warn "uv n'a pas pu fournir Python $PY_VERSION ; essai avec le Python du système."
  fi
fi

# Repli : le Python déjà présent sur la machine, s'il est assez récent.
if [ -z "$PY" ] || [ ! -x "$PY" ]; then
  for CAND in python3.12 python3.11 python3.10 python3; do
    if command -v "$CAND" >/dev/null 2>&1 && "$CAND" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 9) else 1)' 2>/dev/null; then
      "$CAND" -m venv "$APP_DIR/venv" >/dev/null 2>&1 && PY="$APP_DIR/venv/bin/python" && USE_UV=0 && break
    fi
  done
  [ -n "$PY" ] && info "Python du système utilisé : $("$PY" -V 2>&1)"
fi

[ -n "$PY" ] && [ -x "$PY" ] || fail "Aucun Python utilisable. Vérifiez la connexion Internet puis relancez l'installeur."

# ── 2. Playwright ──────────────────────────────────────────────────────────
step "2/6 Playwright (1 à 3 minutes la première fois)"
if ! pipi "$PW_SPEC" 2>/dev/null; then
  warn "Échec sur « $PW_SPEC » ; essai avec la dernière version compatible disponible."
  pipi playwright || fail "Installation de Playwright impossible."
fi
info "Playwright $("$PY" -c 'import playwright; print(playwright.__version__)' 2>/dev/null || echo 'installé')"

# ── 3. Navigateur ──────────────────────────────────────────────────────────
# Playwright pilote Chrome ou Edge déjà installés ; sinon il télécharge Chromium.
step "3/6 Navigateur"

browser_check() {
  "$PY" - <<'PYEOF' 2>/dev/null
import platform, sys
try:
    from playwright.sync_api import sync_playwright
except Exception as e:
    print("ABSENT|%s" % e); sys.exit(0)
system = platform.system()
if system == "Darwin":
    channels = ["chrome", "msedge", None]
elif system == "Windows":
    channels = ["msedge", "chrome", None]
else:
    channels = [None, "chrome"]
last = "aucun navigateur"
try:
    with sync_playwright() as p:
        for ch in channels:
            try:
                kw = {"headless": True}
                if ch:
                    kw["channel"] = ch
                p.chromium.launch(**kw).close()
                print("OK|%s" % (ch or "Chromium")); sys.exit(0)
            except Exception as e:
                last = str(e).splitlines()[0][:160]
except Exception as e:
    last = str(e).splitlines()[0][:160]
print("ECHEC|%s" % last)
PYEOF
}

RESULT="$(browser_check)"
if [ "${RESULT%%|*}" != "OK" ]; then
  info "Aucun navigateur pilotable pour l'instant : téléchargement de Chromium…"
  "$PY" -m playwright install chromium || warn "Le téléchargement de Chromium a échoué."
  RESULT="$(browser_check)"
fi

BROWSER_OK=0
if [ "${RESULT%%|*}" = "OK" ]; then
  BROWSER_OK=1
  info "Navigateur vérifié : ${RESULT#*|} démarre correctement."
else
  warn "Le navigateur ne démarre pas : ${RESULT#*|}"
fi

# ── 4. Agent ───────────────────────────────────────────────────────────────
step "4/6 Agent PharmAgent"
curl -fsSL "$SERVER/agent/pharmagent_agent.py" -o "$APP_DIR/pharmagent_agent.py.new" \
  || fail "Serveur PharmAgent injoignable : $SERVER"
mv "$APP_DIR/pharmagent_agent.py.new" "$APP_DIR/pharmagent_agent.py"
AGENT="$APP_DIR/pharmagent_agent.py"
info "Agent $("$PY" -c "import re,pathlib;print(re.search(r'AGENT_VERSION\s*=\s*\"([^\"]+)\"', pathlib.Path('$AGENT').read_text()).group(1))" 2>/dev/null || echo "téléchargé")"

# ── 5. Raccourci ───────────────────────────────────────────────────────────
step "5/6 Raccourci et démarrage automatique"
if [ "$OS" = "Darwin" ]; then
  info "L'application « PharmAgent » est créée au premier lancement de l'agent."
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
  sed 's/--server/--background --server/' "$HOME/.local/share/applications/pharmagent.desktop" \
    > "$HOME/.config/autostart/pharmagent.desktop"
fi

# ── 6. Démarrage ───────────────────────────────────────────────────────────
step "6/6 Démarrage"
if [ "$BROWSER_OK" = "1" ]; then
  printf '\n\033[1;32m✓ Installation terminée et vérifiée.\033[0m\n'
else
  printf '\n\033[1;33m✓ Agent installé, mais le navigateur ne démarre pas.\033[0m\n'
  info "L'agent fonctionnera pour tout sauf le remplissage de l'ERP."
  info "Installez Google Chrome puis relancez cet installeur."
fi
info "Le panneau PharmAgent s'ouvre dans le navigateur (http://127.0.0.1:8765)."
info "Il affiche un code à 6 chiffres : saisissez-le dans PharmAgent › Agent local."

if [ -z "${PHARMAGENT_INSTALL_NO_LAUNCH:-}" ]; then
  if [ "$OS" = "Darwin" ]; then
    # Ancien démarrage automatique (versions < 2.2) : l'agent recrée le bon au lancement.
    launchctl unload "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" >/dev/null 2>&1
    rm -f "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" "$APP_DIR/launcher.sha"
  fi
  pkill -f "pharmagent_agent.py" >/dev/null 2>&1
  sleep 1
  if [ "$OS" = "Darwin" ]; then
    info "Laissez cette fenêtre ouverte (réduisez-la) : l'agent y tourne."
    exec "$PY" "$AGENT" --server "$SERVER"
  fi
  nohup "$PY" "$AGENT" --server "$SERVER" >/dev/null 2>&1 &
fi
