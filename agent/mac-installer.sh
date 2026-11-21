#!/bin/bash
# PharmAgent — application d'installation pour Mac (double-clic, rien à taper, pas de Terminal pendant l'installation)
SERVER="__SERVER_URL__"
APP_DIR="$HOME/Library/Application Support/PharmAgent"
LOG="$HOME/Library/Logs/PharmAgent-installation.log"
mkdir -p "$APP_DIR" "$(dirname "$LOG")"

say() { osascript -e "display notification \"$1\" with title \"PharmAgent\"" >/dev/null 2>&1 || true; }
ask() {
  osascript -e "button returned of (display dialog \"$1\" with title \"PharmAgent\" buttons {$2} default button $3 with icon $4)" 2>/dev/null
}

choice=$(ask "Installer l'agent PharmAgent sur ce Mac ?\n\nDurée : 1 à 3 minutes. Rien à taper, Python est installé automatiquement." '"Annuler", "Installer"' '"Installer"' note) || exit 0
[ "$choice" = "Installer" ] || exit 0

# Ancienne version : arrêtée, ancien démarrage automatique retiré (l'agent recrée le bon)
launchctl unload "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" "$APP_DIR/launcher.sha"
pkill -f "pharmagent_agent.py" >/dev/null 2>&1 || true

say "Installation en cours (1 à 3 minutes)…"
SCRIPT="$APP_DIR/install.sh"
: >"$LOG"
if curl -fsSL "$SERVER/install/install.sh" -o "$SCRIPT" 2>>"$LOG"; then
  PHARMAGENT_INSTALL_NO_LAUNCH=1 bash "$SCRIPT" >>"$LOG" 2>&1 &
  pid=$!
  last=""
  # Une notification à chaque étape (« 2/5 Python… ») lue dans le journal
  while kill -0 "$pid" 2>/dev/null; do
    step=$(grep -o '[0-9]/5 [^[:cntrl:]]*' "$LOG" | tail -1)
    if [ -n "$step" ] && [ "$step" != "$last" ]; then say "Étape $step"; last="$step"; fi
    sleep 2
  done
  wait "$pid"; status=$?
else
  status=1
  echo "Serveur PharmAgent injoignable : $SERVER" >>"$LOG"
fi

if [ "$status" -ne 0 ]; then
  choice=$(ask "L'installation n'a pas abouti.\n\nVérifiez la connexion Internet puis relancez. Si cela recommence, envoyez le journal au support." '"Fermer", "Voir le journal"' '"Voir le journal"' stop)
  [ "$choice" = "Voir le journal" ] && open -e "$LOG"
  exit 1
fi

PY="$APP_DIR/venv/bin/python"
AGENT="$APP_DIR/pharmagent_agent.py"
ask "PharmAgent est installé.\n\nLe panneau va s'ouvrir dans le navigateur avec un code à 6 chiffres : saisissez-le dans PharmAgent › Agent local.\n\nUne fenêtre Terminal reste ouverte : c'est l'agent qui tourne. Réduisez-la, ne la fermez pas." '"Lancer PharmAgent"' '"Lancer PharmAgent"' note >/dev/null
# Même lancement que l'application PharmAgent créée ensuite dans Applications (autorisations clavier déjà accordées au Terminal)
osascript -e "tell application \"Terminal\" to do script \"clear; '$PY' '$AGENT' --server '$SERVER'\"" -e 'tell application "Terminal" to activate' >/dev/null 2>&1
exit 0
