import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Laptop,
  Lock,
  Play,
  Power,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { OfficineRecord } from '../types/pharmagent';

interface DesktopAgentSetupGuideProps {
  pharmacy?: OfficineRecord;
  token: string;
  canDownloadScripts: boolean;
}

interface CommandStepProps {
  stepNumber: string;
  title: string;
  description: string;
  command: string;
  accent?: 'emerald' | 'sky' | 'amber';
  note?: string;
}

const CommandStep: React.FC<CommandStepProps> = ({
  stepNumber,
  title,
  description,
  command,
  accent = 'emerald',
  note,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  const textAccent =
    accent === 'sky'
      ? 'text-sky-300'
      : accent === 'amber'
      ? 'text-amber-300'
      : 'text-emerald-300';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
            <span className="font-mono text-emerald-400">{stepNumber}.</span>
            <span>{title}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              Copié
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copier
            </>
          )}
        </button>
      </div>

      <pre
        className={`overflow-x-auto rounded-md border border-slate-800/90 bg-slate-900/90 p-3 font-mono text-[11px] leading-relaxed ${textAccent}`}
      >
        <code>{command}</code>
      </pre>

      {note && <p className="text-[11px] leading-relaxed text-slate-400">{note}</p>}
    </div>
  );
};

export const DesktopAgentSetupGuide: React.FC<DesktopAgentSetupGuideProps> = ({
  pharmacy,
  token,
  canDownloadScripts,
}) => {
  const [desktopOs, setDesktopOs] = useState<'windows' | 'mac'>('windows');
  const [showUninstall, setShowUninstall] = useState(false);

  const pharmacyId = pharmacy?.id || 'officine-alpha';
  const scriptFile = `pharmagent_${pharmacyId}.py`;
  const encodedToken = encodeURIComponent(token);

  // Windows Commands (Brand new PC, zero dependencies)
  const winInstallPythonCmd = `winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`;

  const winFallbackPythonCmd = `Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile "$env:TEMP\\py312.exe"; Start-Process -Wait -FilePath "$env:TEMP\\py312.exe" -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0"; $env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")`;

  const winSetupVenvCmd = `New-Item -ItemType Directory -Force -Path C:\\PharmAgent | Out-Null
Move-Item -Force "$env:USERPROFILE\\Downloads\\${scriptFile}" "C:\\PharmAgent\\${scriptFile}"
cd C:\\PharmAgent
python -m venv C:\\PharmAgent\\.venv
C:\\PharmAgent\\.venv\\Scripts\\python.exe -m pip install --upgrade pip
C:\\PharmAgent\\.venv\\Scripts\\python.exe -m pip install requests pyautogui pillow`;

  const winManualTestCmd = `C:\\PharmAgent\\.venv\\Scripts\\python.exe C:\\PharmAgent\\${scriptFile}`;

  const winAutoStartCmd = `$startup = [Environment]::GetFolderPath('Startup')
$vbs = "CreateObject(\`"WScript.Shell\`").Run \`"\`"\`"C:\\PharmAgent\\.venv\\Scripts\\pythonw.exe\`"\`" \`"\`"C:\\PharmAgent\\${scriptFile}\`"\`"\`", 0, False"
Set-Content -Path "$startup\\PharmAgent_${pharmacyId}.vbs" -Value $vbs -Encoding ASCII
Start-Process "wscript.exe" -ArgumentList "\`"$startup\\PharmAgent_${pharmacyId}.vbs\`""`;

  const winLogsCmd = `Get-Content C:\\PharmAgent\\pharmagent.log -Wait -Tail 20`;
  const winRemoveAutoStartCmd = `Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\PharmAgent_${pharmacyId}.vbs" -Force`;

  // macOS Commands (Brand new Mac, zero dependencies)
  const macInstallPythonCmd = `curl -L "https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg" -o /tmp/python3.pkg
sudo installer -pkg /tmp/python3.pkg -target /
rm -f /tmp/python3.pkg
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 --version`;

  const macSetupVenvCmd = `mkdir -p ~/PharmAgent
mv ~/Downloads/${scriptFile} ~/PharmAgent/${scriptFile}
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 -m venv ~/PharmAgent/.venv
~/PharmAgent/.venv/bin/pip install --upgrade pip
~/PharmAgent/.venv/bin/pip install requests pyautogui pillow`;

  const macManualTestCmd = `~/PharmAgent/.venv/bin/python3 ~/PharmAgent/${scriptFile}`;

  const macAutoStartCmd = `mkdir -p ~/Library/LaunchAgents
cat << EOF > ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pharmagent.${pharmacyId}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/PharmAgent/.venv/bin/python3</string>
    <string>$HOME/PharmAgent/${scriptFile}</string>
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
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist 2>/dev/null || launchctl load -w ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist`;

  const macLogsCmd = `tail -f ~/PharmAgent/pharmagent.log`;
  const macRemoveAutoStartCmd = `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.pharmagent.${pharmacyId}.plist`;

  return (
    <div className="space-y-5">
      {/* Scope & Zero-Terminal Clarity */}
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Power className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                Installation complète sur ordinateur neuf &amp; Démarrage automatique (sans terminal)
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Les modes <strong className="text-slate-200">Excel (.xlsx)</strong> et{' '}
              <strong className="text-slate-200">ERP Officine Intégré</strong> fonctionnent 100 %
              dans le navigateur sans rien installer. Utilisez cette procédure{' '}
              <strong className="text-emerald-300">uniquement</strong> sur le poste de comptoir qui
              exécute un logiciel Windows ou Mac hors navigateur. Une fois configuré,{' '}
              <strong className="text-slate-200">
                vous n’avez plus besoin d’ouvrir le terminal au redémarrage
              </strong>
              .
            </p>
          </div>

          {/* OS Toggle */}
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs shrink-0">
            <button
              type="button"
              onClick={() => setDesktopOs('windows')}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                desktopOs === 'windows'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              PC Windows 10 / 11 (Neuf)
            </button>
            <button
              type="button"
              onClick={() => setDesktopOs('mac')}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                desktopOs === 'mac'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Mac macOS (Neuf)
            </button>
          </div>
        </div>

        {/* Pre-configured 1-Click Downloads */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <div className="text-xs text-slate-400">
            Poste ciblé :{' '}
            <span className="font-semibold text-slate-100">{pharmacy?.name || pharmacyId}</span>
            <span className="mx-1.5 text-slate-600">·</span>
            Clé :{' '}
            <span className="font-mono font-semibold text-emerald-400">
              {pharmacy?.agentKey || 'PA-XXX'}
            </span>
          </div>

          {canDownloadScripts && pharmacy ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/pharmacies/${pharmacy.id}/installer?token=${encodedToken}`}
                download={scriptFile}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                <FileCode2 className="h-3.5 w-3.5 text-emerald-400" />
                1. Script {scriptFile}
              </a>

              <a
                href={`/api/pharmacies/${pharmacy.id}/launcher/${desktopOs}?token=${encodedToken}`}
                download={
                  desktopOs === 'windows'
                    ? `Installer_AutoStart_${pharmacy.id}.bat`
                    : `Installer_AutoStart_${pharmacy.id}.command`
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                2. Installateur Auto-Démarrage (
                {desktopOs === 'windows' ? '.bat' : '.command'})
              </a>

              <a
                href={`/api/pharmacies/${pharmacy.id}/launcher/${desktopOs}?mode=manual&token=${encodedToken}`}
                download={
                  desktopOs === 'windows'
                    ? `Tester_PharmAgent_${pharmacy.id}.bat`
                    : `Tester_PharmAgent_${pharmacy.id}.command`
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-sky-500 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5 text-sky-400" />
                Test manuel ({desktopOs === 'windows' ? '.bat' : '.command'})
              </a>

              <a
                href="/api/guide/mac-pc"
                download="GUIDE_MAC_ET_PC.md"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" />
                Guide (.md)
              </a>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <Lock className="h-3.5 w-3.5" />
              Téléchargement des scripts réservé au Pharmacien Titulaire ou Propriétaire
            </div>
          )}
        </div>
      </div>

      {/* Step-by-Step Terminal Copy-Paste Commands */}
      {desktopOs === 'windows' ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                Étape 0 (PC Windows neuf) : Ouvrez PowerShell en appuyant sur{' '}
                <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                  Win + R
                </kbd>
                , tapez <code className="font-mono text-emerald-300">powershell</code> puis{' '}
                <strong>Entrée</strong>.
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              Téléchargez d’abord « 1. Script {scriptFile} » ci-dessus.
            </span>
          </div>

          <CommandStep
            stepNumber="01"
            title="Installer Python 3.12 sur un PC Windows neuf (zéro dépendance)"
            description="Installe Python 3.12 officiellement (avec module Tkinter pour les accents français) et rafraîchit le PATH immédiatement dans votre terminal."
            command={winInstallPythonCmd}
            note="Si winget n'est pas présent sur un ancien Windows 10, utilisez cette commande directe de secours :"
          />

          <CommandStep
            stepNumber="01b"
            title="Commande de secours Windows (si winget est absent)"
            description="Télécharge et installe silencieusement Python 3.12 officiel depuis python.org puis met à jour le PATH."
            command={winFallbackPythonCmd}
            accent="amber"
          />

          <CommandStep
            stepNumber="02"
            title="Créer C:\\PharmAgent, isoler l’environnement (.venv) et installer les bibliothèques"
            description="Déplace votre script téléchargé, crée un environnement Python propre et installe requests, pyautogui et pillow."
            command={winSetupVenvCmd}
          />

          <CommandStep
            stepNumber="03"
            title="Vérifier le fonctionnement une première fois (test en direct)"
            description="Affiche la connexion au serveur et la résolution d’écran (DPI Windows géré automatiquement). Appuyez sur Ctrl + C pour arrêter le test."
            command={winManualTestCmd}
            accent="sky"
          />

          <CommandStep
            stepNumber="04"
            title="Activer le DÉMARRAGE AUTOMATIQUE à l’allumage du PC (sans terminal !)"
            description="Enregistre un lanceur invisible (pythonw.exe) dans le dossier Démarrage Windows et démarre l’agent tout de suite en arrière-plan. Plus jamais besoin d’ouvrir de terminal."
            command={winAutoStartCmd}
            note={`Astuce 1-clic : vous pouvez aussi télécharger puis double-cliquer directement sur « Installer_AutoStart_${pharmacyId}.bat » ci-dessus.`}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CommandStep
              stepNumber="05"
              title="Voir le journal d’activité en direct (pharmagent.log)"
              description="Permet de contrôler à tout moment ce que l’agent exécute en arrière-plan."
              command={winLogsCmd}
              accent="sky"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Gestion du démarrage automatique Windows
                </span>
                <button
                  type="button"
                  onClick={() => setShowUninstall((v) => !v)}
                  className="text-[11px] text-slate-400 underline hover:text-slate-200"
                >
                  {showUninstall ? 'Masquer commande' : 'Afficher commande d’arrêt'}
                </button>
              </div>
              {showUninstall ? (
                <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-900 p-2.5 font-mono text-[11px] text-red-300">
                  <code>{winRemoveAutoStartCmd}</code>
                </pre>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Pour stopper définitivement le lancement automatique au démarrage de Windows,
                  affichez la commande de suppression du script Startup.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <Terminal className="h-4 w-4 text-sky-400 shrink-0" />
              <span>
                Étape 0 (Mac neuf) : Ouvrez le Terminal via{' '}
                <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
                  Cmd + Espace
                </kbd>
                , tapez <code className="font-mono text-sky-300">Terminal</code> puis{' '}
                <strong>Entrée</strong>.
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              Téléchargez d’abord « 1. Script {scriptFile} » ci-dessus.
            </span>
          </div>

          <CommandStep
            stepNumber="01"
            title="Installer Python 3.12 sur un Mac neuf (Apple Silicon / Intel, zéro dépendance)"
            description="Télécharge l'installeur universel officiel python.org (inclut pip et Tkinter pour les accents). Votre mot de passe Mac sera demandé une fois."
            command={macInstallPythonCmd}
            accent="sky"
            note="Lors de la saisie du mot de passe Mac après sudo, aucun caractère ne s'affiche à l'écran : c'est normal, tapez-le et appuyez sur Entrée."
          />

          <CommandStep
            stepNumber="02"
            title="Créer ~/PharmAgent/.venv et installer les bibliothèques sans erreur PEP 668"
            description="Déplace le script depuis Téléchargements, crée un environnement virtuel isolé et installe requests, pyautogui et pillow."
            command={macSetupVenvCmd}
          />

          <div className="rounded-lg border border-amber-800/70 bg-amber-950/25 p-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Étape 03 (Obligatoire sur macOS — 1 seule fois) : Autorisations Système</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300 leading-relaxed">
              <li>
                Ouvrez <strong>Réglages Système → Confidentialité et sécurité → Accessibilité</strong>{' '}
                et activez <strong>Terminal</strong> ainsi que <strong>Python</strong>.
              </li>
              <li>
                Ouvrez <strong>Réglages Système → Confidentialité et sécurité → Enregistrement de l’écran</strong>{' '}
                et activez <strong>Terminal</strong> ainsi que <strong>Python</strong>.
              </li>
            </ol>
          </div>

          <CommandStep
            stepNumber="04"
            title="Vérifier le fonctionnement une première fois (test dans le Terminal)"
            description="Vérifie que l'agent se connecte au serveur PharmAgent. Appuyez sur Ctrl + C pour arrêter le test."
            command={macManualTestCmd}
            accent="sky"
          />

          <CommandStep
            stepNumber="05"
            title="Activer le DÉMARRAGE AUTOMATIQUE macOS (LaunchAgent — zéro terminal au boot !)"
            description="Crée un service macOS LaunchAgent (RunAtLoad + KeepAlive). Dès le démarrage du Mac, PharmAgent tourne silencieusement en arrière-plan."
            command={macAutoStartCmd}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <CommandStep
              stepNumber="06"
              title="Consulter le journal en direct (pharmagent.log)"
              description="Permet de vérifier les saisies brouillon effectuées en arrière-plan."
              command={macLogsCmd}
              accent="sky"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Désactiver le démarrage automatique macOS
                </span>
                <button
                  type="button"
                  onClick={() => setShowUninstall((v) => !v)}
                  className="text-[11px] text-slate-400 underline hover:text-slate-200"
                >
                  {showUninstall ? 'Masquer commande' : 'Afficher commande'}
                </button>
              </div>
              {showUninstall ? (
                <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-900 p-2.5 font-mono text-[11px] text-red-300">
                  <code>{macRemoveAutoStartCmd}</code>
                </pre>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Vous pouvez décharger et supprimer le LaunchAgent macOS à tout moment en une seule
                  commande.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Safety reminder */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200">
        <div className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            Garde-fou actif sur PC et Mac : même en mode arrière-plan automatique,{' '}
            <strong>DraftOnlyGuardrail</strong> bloque tout clic de validation finale.
          </span>
        </div>
      </div>
    </div>
  );
};
