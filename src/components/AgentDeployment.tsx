import { Apple, BookOpen, Check, Copy, Download, Globe, Laptop, Link2, Loader2, Monitor, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AgentPresence, DashboardSnapshot, DraftExecution } from '../types/pharmagent.ts';
import { ExecutionDetail } from './ExecutionStatus.tsx';

interface Props {
  token: string;
  snapshot: DashboardSnapshot | null;
  selectedPharmacyId: string;
  onSelectPharmacy: (id: string) => void;
}

interface AgentInfo {
  presence: AgentPresence | null;
  profile: { mode: 'web' | 'desktop' | 'file'; erpUrl?: string; windowTitle?: string; filePath?: string; recordedAt?: string; headerSteps: number; lineSteps: number; fields: string[] } | null;
  queue: Array<{ id: string; documentNumber: string; supplier: string; lines: number; execution: DraftExecution }>;
}

const FIELD_LABEL: Record<string, string> = {
  supplier: 'Fournisseur', documentNumber: 'N° bon', documentDate: 'Date', totalAmount: 'Total', product: 'Produit', cip: 'CIP',
  designation: 'Libellé grossiste', quantity: 'Quantité', lotNumber: 'Lot', expiryDate: 'Péremption', purchasePrice: 'Prix achat',
  salePrice: 'Prix vente', lineTotal: 'Total ligne', const: 'Texte fixe',
};

function since(iso?: string): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString('fr-FR');
}

function CopyLine({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 text-[11px] sm:text-xs bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-emerald-200 overflow-x-auto whitespace-nowrap">{text}</code>
      <button
        onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}
        className="flex-shrink-0 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
        title="Copier"
      >
        {ok ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default function AgentDeployment({ token, snapshot, selectedPharmacyId, onSelectPharmacy, embedded = false }: Props & { embedded?: boolean }) {
  const pharmacies = snapshot?.pharmacies ?? [];
  const phId = selectedPharmacyId || pharmacies[0]?.id || '';
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairMsg, setPairMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    if (!phId) return;
    try {
      const r = await fetch(`/api/pharmacies/${phId}/agent`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setInfo(await r.json() as AgentInfo);
    } catch { /* réseau : on réessaie au prochain tour */ }
  }, [phId, token]);

  useEffect(() => {
    setInfo(null); setPairMsg(null);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairing(true); setPairMsg(null);
    try {
      const r = await fetch(`/api/pharmacies/${phId}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const d = await r.json() as { hostname?: string; error?: string };
      if (!r.ok) { setPairMsg({ ok: false, text: d.error ?? 'Erreur.' }); return; }
      setPairMsg({ ok: true, text: `Ordinateur « ${d.hostname ?? '?'} » relié. Continuez sur cet ordinateur : choix de l'ERP puis démo.` });
      setCode('');
      setTimeout(load, 2500);
    } finally {
      setPairing(false);
    }
  };

  const p = info?.presence;
  const online = !!p && Date.now() - Date.parse(p.lastSeen) < 70_000;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="motif-hero rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3 relative z-10">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center"><Laptop size={22} className="text-emerald-300" /></div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white">Agent local</h1>
            <p className="text-sm text-slate-300">Le petit programme installé sur le PC de l'officine qui saisit les bons approuvés dans l'ERP.</p>
          </div>
          {!embedded && <select
            value={phId}
            onChange={(e) => onSelectPharmacy(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
          >
            {pharmacies.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
          </select>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* État */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Monitor size={15} className="text-emerald-400" /> Ordinateur de l'officine</h2>
          {!info ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
          ) : !p ? (
            <div className="text-sm text-slate-400">
              <div className="flex items-center gap-2 text-slate-300 font-medium mb-1"><WifiOff size={15} className="text-slate-500" /> Aucun ordinateur relié</div>
              Installez l'agent sur le PC de l'officine (ci-dessous), puis saisissez le code affiché.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-slate-600'}`} />
                <span className={`text-sm font-semibold ${online ? 'text-emerald-300' : 'text-slate-400'}`}>{online ? 'En ligne' : 'Hors ligne'}</span>
                <span className="text-xs text-slate-500">· vu {since(p.lastSeen)}</span>
                {online ? <Wifi size={14} className="text-emerald-400 ml-auto" /> : <WifiOff size={14} className="text-slate-500 ml-auto" />}
              </div>
              <div className="text-xs text-slate-400">
                <b className="text-slate-200">{p.hostname ?? '—'}</b> · {p.os ?? '—'} · agent v{p.version ?? '?'}
                {p.state && <div className="mt-1">État : <span className="text-slate-200">{p.state}</span></div>}
              </div>
              <AgentDiagnostic p={p} />
              {info.profile ? (
                <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                    {info.profile.mode === 'web' ? <Globe size={13} className="text-sky-300" /> : <Monitor size={13} className="text-sky-300" />}
                    {info.profile.mode === 'web' ? 'ERP web' : info.profile.mode === 'file' ? 'Fichier Excel / Numbers (sans démo)' : 'Logiciel installé'}
                    <span className="text-slate-500 font-normal truncate">· {info.profile.filePath ?? info.profile.erpUrl ?? info.profile.windowTitle}</span>
                  </div>
                  {info.profile.mode !== 'file' && <div className="text-slate-500">Démo enregistrée {info.profile.recordedAt ? new Date(info.profile.recordedAt).toLocaleString('fr-FR') : ''} · {info.profile.lineSteps} étapes par ligne</div>}
                  <div className="flex flex-wrap gap-1">
                    {info.profile.fields.filter((f) => f !== 'const').map((f) => (
                      <span key={f} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{FIELD_LABEL[f] ?? f}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  Démo pas encore faite : sur le PC de l'officine, suivez les étapes du panneau PharmAgent.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Appairage */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2"><Link2 size={15} className="text-emerald-400" /> Appairer un ordinateur</h2>
          <p className="text-xs text-slate-400 mb-3">Saisissez le code à 6 chiffres affiché par l'agent sur l'ordinateur de l'officine.</p>
          <form onSubmit={pair} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="123 456"
              className="flex-1 min-w-0 bg-slate-950/70 border border-slate-700 rounded-xl px-4 py-3 text-2xl tracking-[0.3em] font-mono text-center text-emerald-200 placeholder-slate-700 outline-none focus:border-emerald-500"
            />
            <button disabled={code.length !== 6 || pairing || !phId} className="px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold text-sm flex items-center gap-2">
              {pairing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Relier
            </button>
          </form>
          {pairMsg && (
            <div className={`mt-3 text-xs rounded-lg px-3 py-2 border ${pairMsg.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-red-300 bg-red-500/10 border-red-500/30'}`}>{pairMsg.text}</div>
          )}
          <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            L'agent remplit l'écran de saisie puis s'arrête : il ne clique jamais sur Valider, Confirmer ou Clôturer.
          </div>
        </section>
      </div>

      {/* Installation */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Download size={15} className="text-emerald-400" /> Installer l'agent sur un ordinateur</h2>
          <a href="/guide" target="_blank" rel="noreferrer" className="ml-auto text-xs text-emerald-300 hover:text-emerald-200 flex items-center gap-1"><BookOpen size={13} /> Guide pas à pas</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Monitor size={16} className="text-sky-300" /> Windows 10 / 11</div>
            <a href="/install/windows" className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">
              <Download size={15} /> Télécharger l'installeur
            </a>
            <p className="text-[11px] text-slate-400">Double-cliquez sur <b>PharmAgent-Installer.bat</b>. Si Windows affiche « Windows a protégé votre ordinateur » : <b>Informations complémentaires › Exécuter quand même</b>.</p>
            <p className="text-[11px] text-slate-500">Ou dans PowerShell :</p>
            <CopyLine text={`irm ${origin}/install/windows.ps1 | iex`} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Apple size={16} className="text-slate-200" /> macOS</div>
            <a href="/install/mac.zip" className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">
              <Download size={15} /> Télécharger l'installeur Mac
            </a>
            <p className="text-[11px] text-slate-400">Ouvrez <b>PharmAgent-Mac.zip</b>, puis double-cliquez sur l'application <b>Installer PharmAgent</b> : des fenêtres vous guident, rien à taper (1 à 3 minutes). La première fois, le Mac demande confirmation : <b>clic droit › Ouvrir</b>.</p>
            <p className="text-[11px] text-slate-400">Ensuite, l'application <b>PharmAgent</b> (Launchpad ou dossier Applications) relance tout par un double-clic.</p>
            <p className="text-[11px] text-slate-500">Autre méthode, dans le Terminal :</p>
            <CopyLine text={`curl -fsSL ${origin}/install/install.sh | bash`} />
          </div>
        </div>
      </section>

      {/* File des saisies */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 text-sm font-semibold text-white">Saisies envoyées à l'agent</div>
        {!info?.queue.length ? (
          <div className="px-5 py-6 text-sm text-slate-500">Aucun bon approuvé pour l'instant. Dès qu'un bon est approuvé, il apparaît ici.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {info.queue.map((q) => (
              <div key={q.id} className="px-5 py-3">
                <div className="text-sm text-white font-medium">{q.documentNumber || q.id} <span className="text-xs text-slate-500 font-normal">· {q.supplier} · {q.lines} ligne(s)</span></div>
                <div className="mt-1.5"><ExecutionDetail draftId={q.id} execution={q.execution} token={token} onChanged={load} /></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Diagnostic envoyé par l'agent : version (à jour ou non), mode, dernier résultat, dernière erreur, journal
function AgentDiagnostic({ p }: { p: AgentPresence }) {
  const [latest, setLatest] = useState<string>('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch('/agent/version').then((r) => r.json()).then((d: { version?: string }) => setLatest(d.version ?? '')).catch(() => setLatest(''));
  }, []);
  const old = latest && p.version && p.version !== latest;
  const modeLabel = p.mode === 'file' ? 'Fichier Excel / Numbers' : p.mode === 'web' ? 'ERP web' : p.mode === 'desktop' ? 'Logiciel installé (clavier)' : '—';
  return (
    <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs space-y-1.5" data-testid="agent-diagnostic">
      <div className="font-medium text-slate-200">Diagnostic de l'agent</div>
      {old && <div className="text-amber-300">Ancienne version (v{p.version}) : la v{latest} est disponible. Fermez la fenêtre de l'agent et relancez l'application PharmAgent.</div>}
      <div className="text-slate-400">Mode : <span className="text-slate-200">{modeLabel}</span>{p.target ? <> · <span className="text-slate-300">{p.target}</span></> : null}</div>
      {p.lastResult && <div className="text-slate-400">Dernier bon : <span className="text-slate-200">{p.lastResult}</span></div>}
      {p.lastError && <div className="text-red-300">Erreur : {p.lastError}</div>}
      {!!p.logs?.length && (
        <div>
          <button onClick={() => setOpen(!open)} className="text-sky-300 hover:text-sky-200">{open ? 'Masquer' : 'Voir'} le journal de l'agent</button>
          {open && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400 bg-black/40 rounded p-2">{p.logs.join('\n')}</pre>}
        </div>
      )}
    </div>
  );
}
