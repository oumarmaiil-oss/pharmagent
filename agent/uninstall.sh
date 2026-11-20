#!/bin/bash
# PharmAgent — suppression complète de l'agent local (macOS / Linux)
# Aucun droit administrateur requis : tout est installé dans le dossier de l'utilisateur.
set -uo pipefail

OS="$(uname)"
removed=0

say()  { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
gone() { printf '  supprimé : %s\n' "$1"; removed=$((removed + 1)); }

drop() {  # drop <chemin> : efface un fichier ou un dossier s'il existe
  if [ -e "$1" ]; then
    rm -rf "$1" && gone "$1"
  fi
}

printf '\n\033[1m PharmAgent — suppression de l'"'"'agent local\033[0m\n'

say "1/4 Arrêt de l'agent"
pkill -f "pharmagent_agent.py" >/dev/null 2>&1 && echo "  agent arrêté" || echo "  (l'agent ne tournait pas)"
sleep 1

say "2/4 Démarrage automatique"
if [ "$OS" = "Darwin" ]; then
  launchctl unload "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist" >/dev/null 2>&1
  drop "$HOME/Library/LaunchAgents/com.pharmagent.agent.plist"
else
  drop "$HOME/.config/autostart/pharmagent.desktop"
  drop "$HOME/.local/share/applications/pharmagent.desktop"
fi

say "3/4 Application et données"
if [ "$OS" = "Darwin" ]; then
  drop "$HOME/Applications/PharmAgent.app"
  drop "/Applications/PharmAgent.app"
  drop "$HOME/Library/Application Support/PharmAgent"
  drop "$HOME/Library/Caches/ms-playwright"
else
  drop "$HOME/.local/share/PharmAgent"
  drop "$HOME/.cache/ms-playwright"
fi

say "4/4 Rafraîchissement du menu"
if [ "$OS" = "Darwin" ]; then
  # Sans ceci l'icône reste visible dans le Launchpad alors que l'application n'existe plus.
  killall Dock >/dev/null 2>&1 && echo "  Launchpad rafraîchi" || true
fi

printf '\n\033[1;32m✓ Terminé — %d élément(s) supprimé(s).\033[0m\n' "$removed"
echo "  Plus aucune trace de l'agent PharmAgent sur cet ordinateur."
echo "  (L'outil « uv » reste installé : il peut servir à d'autres logiciels.)"
