# Guide complet d’installation & démarrage automatique — PC Neuf & Mac Neuf

Ce guide explique pas à pas comment configurer un **ordinateur neuf sans aucune dépendance préalable** pour piloter un **logiciel local hors navigateur** sur Windows (PC) ou macOS (Mac), puis **activer le démarrage automatique** afin de **ne plus jamais avoir à ouvrir le terminal**.

> **Rappel important :** Si votre officine travaille avec **Excel (.xlsx)** ou l’**ERP Officine Intégré**, **aucune installation Python n’est nécessaire** — tout fonctionne directement dans votre navigateur web (PC, Mac, tablette ou smartphone).

---

## 1. Vue d’ensemble des fichiers d’une officine

Depuis le **Portail Officine** (onglet **« Agent Local (PC / Mac) »**, réservé au Titulaire ou au Propriétaire), vous pouvez télécharger :
1. `pharmagent_<id>.py` : Le script local déjà pré-configuré avec l’URL de votre serveur et la clé d’appairage (`PA-XXX-0000`).
2. `Installer_AutoStart_<id>.bat` (Windows) ou `Installer_AutoStart_<id>.command` (Mac) : L’installateur automatique qui prépare l’environnement et configure le lancement automatique à l’allumage du poste.

---

## 2. Procédure PC Neuf (Windows 10 / 11 — Zéro dépendance)

### Étape 1 — Ouvrir le terminal PowerShell
1. Appuyez simultanément sur **`Win + R`**.
2. Tapez **`powershell`** et appuyez sur **Entrée**.

### Étape 2 — Installer Python 3.12 (si le PC est neuf)
Copiez-collez ce bloc dans PowerShell et appuyez sur **Entrée** :

```powershell
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

*(Si `winget` indique qu’il n’est pas disponible sur un ancien Windows 10, exécutez cette commande de secours à la place :)*

```powershell
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile "$env:TEMP\py312.exe"; Start-Process -Wait -FilePath "$env:TEMP\py312.exe" -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0"; $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")
```

### Étape 3 — Préparer le dossier `C:\PharmAgent` et les dépendances
Après avoir téléchargé `pharmagent_<id>.py` depuis l’application :

```powershell
New-Item -ItemType Directory -Force -Path C:\PharmAgent | Out-Null
Move-Item -Force "$env:USERPROFILE\Downloads\pharmagent_*.py" C:\PharmAgent\
cd C:\PharmAgent
python -m venv C:\PharmAgent\.venv
C:\PharmAgent\.venv\Scripts\python.exe -m pip install --upgrade pip
C:\PharmAgent\.venv\Scripts\python.exe -m pip install requests pyautogui pillow
```

### Étape 4 — Tester une première fois (optionnel)
```powershell
C:\PharmAgent\.venv\Scripts\python.exe C:\PharmAgent\pharmagent_<id>.py
```
*(Appuyez sur `Ctrl + C` pour arrêter le test manuel.)*

### Étape 5 — Activer le DÉMARRAGE AUTOMATIQUE (plus besoin d’ouvrir le terminal !)
Cette commande crée un lanceur silencieux (`pythonw.exe`) dans le dossier Démarrage Windows et lance immédiatement l’agent en arrière-plan :

```powershell
$startup = [Environment]::GetFolderPath('Startup')
$vbs = "CreateObject(`"WScript.Shell`").Run `"`"`"C:\PharmAgent\.venv\Scripts\pythonw.exe`"`" `"`"C:\PharmAgent\pharmagent_<id>.py`"`"`", 0, False"
Set-Content -Path "$startup\PharmAgent_<id>.vbs" -Value $vbs -Encoding ASCII
Start-Process "wscript.exe" -ArgumentList "`"$startup\PharmAgent_<id>.vbs`""
```

**Vérifier le journal en direct :**
```powershell
Get-Content C:\PharmAgent\pharmagent.log -Wait -Tail 20
```

**Désactiver le démarrage automatique :**
```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\PharmAgent_<id>.vbs" -Force
```

---

## 3. Procédure Mac Neuf (macOS Apple Silicon / Intel — Zéro dépendance)

### Étape 1 — Ouvrir le Terminal
1. Appuyez sur **`Cmd + Espace`**.
2. Tapez **`Terminal`** et appuyez sur **Entrée**.

### Étape 2 — Installer Python 3.12 (si le Mac est neuf)
```bash
curl -L "https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg" -o /tmp/python3.pkg
sudo installer -pkg /tmp/python3.pkg -target /
rm -f /tmp/python3.pkg
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 --version
```
*(Saisissez votre mot de passe Mac lorsqu’il est demandé — rien ne s’affiche pendant la frappe, validez par **Entrée**.)*

### Étape 3 — Préparer `~/PharmAgent` et l’environnement virtuel `.venv`
Après avoir téléchargé `pharmagent_<id>.py` depuis l’application :

```bash
mkdir -p ~/PharmAgent
mv ~/Downloads/pharmagent_*.py ~/PharmAgent/
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 -m venv ~/PharmAgent/.venv
~/PharmAgent/.venv/bin/pip install --upgrade pip
~/PharmAgent/.venv/bin/pip install requests pyautogui pillow
```

### Étape 4 — Autorisations macOS indispensables (à faire une seule fois)
1. **Réglages Système → Confidentialité et sécurité → Accessibilité** : activez **Terminal** et **Python** (`Python.app`).
2. **Réglages Système → Confidentialité et sécurité → Enregistrement de l’écran** : activez **Terminal** et **Python**.

### Étape 5 — Activer le DÉMARRAGE AUTOMATIQUE (`LaunchAgent`, sans terminal !)
```bash
mkdir -p ~/Library/LaunchAgents
cat << EOF > ~/Library/LaunchAgents/com.pharmagent.<id>.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pharmagent.<id></string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/PharmAgent/.venv/bin/python3</string>
    <string>$HOME/PharmAgent/pharmagent_<id>.py</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/PharmAgent/pharmagent.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/PharmAgent/pharmagent.log</string>
</dict>
</plist>
EOF
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.<id>.plist 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.pharmagent.<id>.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.<id>.plist 2>/dev/null || launchctl load -w ~/Library/LaunchAgents/com.pharmagent.<id>.plist
```

**Vérifier le journal en direct :**
```bash
tail -f ~/PharmAgent/pharmagent.log
```

**Désactiver le démarrage automatique :**
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.<id>.plist 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.pharmagent.<id>.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.pharmagent.<id>.plist
```

---

## 4. Apprentissage visuel & Garde-Fou absolu

1. Ouvrez votre logiciel de comptoir sur le poste, faites une capture (`Win + Shift + S` sur PC, `Cmd + Ctrl + Shift + 4` sur Mac).
2. Dans l’onglet **« Agent Local (PC / Mac) »**, cliquez dans la zone pointillée et collez (`Ctrl + V` / `Cmd + V`), puis cliquez sur **« Analyser & Mémoriser pour de bon »**.
3. L’agent remplit uniquement les champs et enregistre au maximum un **Brouillon**. Tout bouton de validation définitive (`Valider`, `Clôturer`, `Facturer`, `Finaliser`, `Payer`) est verrouillé par `DraftOnlyGuardrail`.
