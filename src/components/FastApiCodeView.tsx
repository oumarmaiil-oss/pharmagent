import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Laptop,
  Server,
  Smartphone,
  Store,
} from 'lucide-react';
import { OfficineRecord } from '../types/pharmagent';
import { DesktopAgentSetupGuide } from './DesktopAgentSetupGuide';
import { PWAInstallButton } from './PWAInstallButton';

interface FastApiSourceFile {
  path: string;
  language: string;
  content: string;
}

interface FastApiCodeViewProps {
  ownerToken: string;
  pharmacies: OfficineRecord[];
  selectedPharmacyId: string;
  onChangePharmacyId: (id: string) => void;
}

export const FastApiCodeView: React.FC<FastApiCodeViewProps> = ({
  ownerToken,
  pharmacies,
  selectedPharmacyId,
  onChangePharmacyId,
}) => {
  const [activeSection, setActiveSection] = useState<
    'desktop_setup' | 'mobile_stores' | 'export_deploy' | 'sources'
  >('desktop_setup');
  const [files, setFiles] = useState<FastApiSourceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('backend-fastapi/app/main.py');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedDeploy, setCopiedDeploy] = useState(false);
  const [copiedCapacitor, setCopiedCapacitor] = useState(false);
  const [bannerImgError, setBannerImgError] = useState(false);

  useEffect(() => {
    fetch('/api/fastapi-sources', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files || []);
        if (data.files?.length > 0) {
          const mainFile = data.files.find((f: FastApiSourceFile) => f.path.endsWith('main.py'));
          setSelectedPath(mainFile ? mainFile.path : data.files[0].path);
        }
      })
      .finally(() => setLoading(false));
  }, [ownerToken]);

  const selectedPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || pharmacies[0],
    [pharmacies, selectedPharmacyId]
  );

  const activeFile = files.find((f) => f.path === selectedPath);

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeFile.path.split('/').pop() || 'pharmagent.py';
    link.click();
    URL.revokeObjectURL(url);
  };

  const serverDeployCmd = `# Installation & démarrage en production du serveur central PharmAgent (Node 22+)
npm install
npm run build
GEMINI_API_KEY="VOTRE_CLE_API_GEMINI" PORT=3000 NODE_ENV=production npm start`;

  const capacitorStoreCmd = `# 1. Installer Capacitor CLI dans le projet exporté PharmAgent (ID: sn.pharmagent.app)
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# 2. Compiler l'application web PWA
npm run build

# 3. Générer le projet Android (.aab pour Google Play Console)
npx cap add android
npx cap sync android
npx cap open android   # Android Studio -> Build -> Generate Signed App Bundle (.aab)

# 4. Générer le projet iOS (sur Mac avec Xcode -> App Store Connect .ipa)
npx cap add ios
npx cap sync ios
npx cap open ios       # Xcode -> Product -> Archive -> Distribute App`;

  const handleCopyDeploy = async () => {
    await navigator.clipboard.writeText(serverDeployCmd);
    setCopiedDeploy(true);
    setTimeout(() => setCopiedDeploy(false), 1800);
  };

  const handleCopyCapacitor = async () => {
    await navigator.clipboard.writeText(capacitorStoreCmd);
    setCopiedCapacitor(true);
    setTimeout(() => setCopiedCapacitor(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Crisp Split Visual Header & Section Switcher */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-8 p-6 flex flex-col justify-between gap-4">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Déploiement · Mobile PWA &amp; Stores
              </div>
              <h2 className="text-lg font-semibold text-slate-100">
                Centre de Déploiement, Agent Local, PWA &amp; Stores Mobile
              </h2>
              <p className="text-xs leading-relaxed text-slate-400 max-w-2xl">
                Équipez un poste Windows/Mac neuf, installez PharmAgent directement en application mobile
                PWA, préparez vos paquets Google Play Store &amp; Apple App Store ou exportez vos données.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs w-fit">
              <button
                type="button"
                onClick={() => setActiveSection('desktop_setup')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'desktop_setup'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Laptop className="h-3.5 w-3.5" />
                Poste PC / Mac
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('mobile_stores')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'mobile_stores'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Mobile PWA &amp; Stores
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('export_deploy')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'export_deploy'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Archive className="h-3.5 w-3.5" />
                Export &amp; Serveur
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('sources')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeSection === 'sources'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                Sources Python / FastAPI
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 relative min-h-[180px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 overflow-hidden">
            {!bannerImgError ? (
              <img
                src="/src/assets/images/banner_mobile_deploy_1795081856917.jpg"
                alt="Déploiement mobile et poste officinal PharmAgent"
                referrerPolicy="no-referrer"
                onError={() => setBannerImgError(true)}
                className="h-full w-full object-cover opacity-90"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-slate-950 p-6">
                <Store className="h-10 w-10 text-emerald-500/40" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex items-end p-4">
              <div className="text-[11px] text-slate-200 leading-snug">
                <div className="font-semibold text-emerald-300">Packager Multi-Plateformes</div>
                <div className="text-slate-300">Desktop Auto-Start · PWA Mobile · Capacitor Store Kit</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {activeSection === 'desktop_setup' && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Préparer le poste local d’une officine
              </h3>
              <p className="text-xs text-slate-400">
                Sélectionnez l’officine pour générer ses fichiers et commandes exactes avec sa clé
                d’appairage
              </p>
            </div>
            <select
              value={selectedPharmacyId}
              onChange={(e) => onChangePharmacyId(e.target.value)}
              className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {pharmacies.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.name} — {ph.city} ({ph.agentKey})
                </option>
              ))}
            </select>
          </div>

          <DesktopAgentSetupGuide
            pharmacy={selectedPharmacy}
            token={ownerToken}
            canDownloadScripts
          />
        </section>
      )}

      {activeSection === 'mobile_stores' && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 space-y-5">
            <div className="flex items-start gap-4">
              <img
                src="/pwa-192x192.png"
                alt="Icône officielle PharmAgent"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
                className="h-14 w-14 rounded-xl border border-emerald-700/60 bg-slate-950 object-cover shrink-0"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Smartphone className="h-4 w-4 text-emerald-400" />
                  <span>Application Installable (PWA)</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  PharmAgent inclut un manifeste PWA complet, un Service Worker hors-ligne et ses
                  icônes adaptatives (192px, 512px maskable &amp; Apple Touch 180px).
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-3 text-xs">
              <div className="font-semibold text-slate-200">Installation immédiate sans Store</div>
              <ul className="space-y-2 text-[11px] text-slate-400">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">Android (Chrome / Edge) :</strong> cliquez sur
                    le bouton « Installer l’app » dans l’en-tête ou via le menu Chrome « Ajouter à
                    l’écran d’accueil ».
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">iPhone / iPad (Safari) :</strong> appuyez sur
                    l’icône Partager puis « Sur l’écran d’accueil » pour lancer PharmAgent en plein
                    écran.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">Liens officines isolés :</strong> chaque
                    pharmacien qui installe son lien dédié reste verrouillé sur son officine.
                  </span>
                </li>
              </ul>

              <div className="pt-1 flex items-center gap-3">
                <PWAInstallButton />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Store className="h-4 w-4 text-emerald-400" />
                <span>Packager Google Play (.aab) &amp; Apple App Store (.ipa)</span>
              </div>
              <button
                type="button"
                onClick={handleCopyCapacitor}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-emerald-500"
              >
                {copiedCapacitor ? (
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

            <p className="text-xs leading-relaxed text-slate-400">
              Le fichier <span className="font-mono text-emerald-400">capacitor.config.ts</span>{' '}
              (identifiant <span className="font-mono text-slate-200">sn.pharmagent.app</span>) est
              pré-configuré pour empaqueter PharmAgent vers les stores natifs après export du projet.
              La soumission finale s’effectue ensuite depuis vos comptes développeur Google Play
              Console et Apple App Store Connect.
            </p>

            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-emerald-300 leading-relaxed">
              <code>{capacitorStoreCmd}</code>
            </pre>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-slate-400">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                <div className="font-semibold text-slate-200">Google Play Console (Android)</div>
                <p className="text-[11px] leading-relaxed">
                  Générez un fichier signé <span className="font-mono text-slate-300">.aab</span>{' '}
                  via Android Studio puis publiez-le sur votre fiche PharmAgent (ID{' '}
                  <span className="font-mono text-emerald-400">sn.pharmagent.app</span>).
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                <div className="font-semibold text-slate-200">Apple App Store Connect (iOS)</div>
                <p className="text-[11px] leading-relaxed">
                  Compilez l’archive depuis Xcode sur Mac avec votre compte Apple Developer pour
                  déploiement TestFlight &amp; App Store.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'export_deploy' && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Archive className="h-4 w-4 text-emerald-400" />
              <span>Export des données &amp; Documentation</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Exportez une archive complète JSON (officines, mémoire IA apprise, profils logiciels,
              brouillons, stocks et journal d’audit) ou téléchargez le guide complet Mac &amp; PC.
            </p>

            <div className="space-y-2.5 pt-1">
              <a
                href={`/api/export/saas-backup?token=${encodeURIComponent(ownerToken)}`}
                download="PharmAgent_Sauvegarde.json"
                className="flex w-full items-center justify-between rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                <span>Télécharger Sauvegarde SaaS complète (.json)</span>
                <Download className="h-4 w-4 shrink-0" />
              </a>

              <a
                href="/api/guide/mac-pc"
                download="GUIDE_MAC_ET_PC.md"
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-sky-500 transition-colors"
              >
                <span>Télécharger Guide PC &amp; Mac complet (.md)</span>
                <Download className="h-4 w-4 text-sky-400 shrink-0" />
              </a>

              <a
                href="/api/training/download/memory"
                download="PharmAgent_1_Memoire_Agent.xlsx"
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors"
              >
                <span>Exporter Mémoire Produits &amp; Colonnes (.xlsx)</span>
                <Download className="h-4 w-4 text-emerald-400 shrink-0" />
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Server className="h-4 w-4 text-emerald-400" />
                <span>Déploiement &amp; Export du serveur web PharmAgent</span>
              </div>
              <button
                type="button"
                onClick={handleCopyDeploy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-emerald-500"
              >
                {copiedDeploy ? (
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
            <p className="text-xs leading-relaxed text-slate-400">
              Pour héberger votre application exportée sur votre propre serveur Linux / VPS / Cloud
              Run (Node.js 22+ avec strip-types natif) :
            </p>
            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-emerald-300 leading-relaxed">
              <code>{serverDeployCmd}</code>
            </pre>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-slate-400">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                <div className="font-semibold text-slate-200">Modes Navigateur (0 Python)</div>
                <p className="text-[11px] leading-relaxed">
                  Excel (.xlsx) et ERP Intégré fonctionnent sans aucune installation cliente sur
                  tous les postes dès que le serveur est en ligne.
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1">
                <div className="font-semibold text-slate-200">Base persistante multi-officines</div>
                <p className="text-[11px] leading-relaxed">
                  Actuellement sur stockage JSON local disque ; prête à basculer vers PostgreSQL
                  (Cloud SQL) ou Firestore selon votre choix.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'sources' && (
        <>
          {loading ? (
            <div className="h-96 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="mb-3 px-2 text-xs font-semibold text-slate-400">
                  Arborescence FastAPI &amp; Agent
                </div>
                <div className="space-y-1">
                  {files.map((file) => {
                    const isSelected = file.path === selectedPath;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-mono transition-colors ${
                          isSelected
                            ? 'bg-emerald-950/70 font-semibold text-emerald-300 border border-emerald-800/70'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        <FileCode2 className="h-4 w-4 shrink-0" />
                        <span className="truncate">{file.path.replace('backend-fastapi/', '')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 text-slate-100 lg:col-span-3 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
                  <span className="font-mono text-xs text-slate-300">{activeFile?.path}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? 'Copié' : 'Copier'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadFile}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Télécharger
                    </button>
                  </div>
                </div>
                <pre className="overflow-x-auto p-5 text-xs font-mono leading-relaxed text-slate-200 max-h-[620px]">
                  <code>{activeFile?.content}</code>
                </pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
