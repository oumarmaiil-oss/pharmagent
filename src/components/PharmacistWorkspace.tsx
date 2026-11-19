import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, ChevronUp, Download, FileText, Loader2, RefreshCw, ScanLine,
  ShieldCheck, ThumbsDown, ThumbsUp, Upload, XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { DashboardSnapshot, DraftRecord, OwnerAccount } from '../types/pharmagent.ts';
import DraftLines, { countToReview } from './DraftLines.tsx';
import { ExecutionBadge, ExecutionDetail } from './ExecutionStatus.tsx';

interface Props {
  token: string;
  owner: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
  selectedPharmacyId: string;
  onSelectPharmacy: (id: string) => void;
}

type DocType = 'bon_livraison' | 'facture' | 'mutuelle';

const DOC_LABELS: Record<DocType, string> = {
  bon_livraison: 'Bon de livraison',
  facture: 'Facture fournisseur',
  mutuelle: 'Feuille mutuelle',
};

const SAMPLE_IMAGES = [
  { path: 'src/assets/images/sample_bon_livraison_1795017387838.jpg', label: 'Exemple : bon de livraison', type: 'bon_livraison' as DocType },
  { path: 'src/assets/images/sample_facture_mutuelle_1795017386332.jpg', label: 'Exemple : facture', type: 'facture' as DocType },
];

const MAX_BYTES = 20 * 1024 * 1024;

export default function PharmacistWorkspace({ token, snapshot, onRefresh, selectedPharmacyId, onSelectPharmacy }: Props) {
  const [doc, setDoc] = useState<{ dataUrl: string; name: string; isPdf: boolean } | null>(null);
  const [samplePath, setSamplePath] = useState('');
  const [docType, setDocType] = useState<DocType>('bon_livraison');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [localDrafts, setLocalDrafts] = useState<Record<string, DraftRecord>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const pharmacies = snapshot?.pharmacies ?? [];
  const selectedPharmacy = pharmacies.find((p) => p.id === selectedPharmacyId);

  // Version la plus fraîche d'un brouillon : réponse locale ou tableau de bord (rafraîchi toutes les 8 s)
  const fresh = (d: DraftRecord): DraftRecord => {
    const local = localDrafts[d.id];
    if (!local) return d;
    return Date.parse(local.updatedAt) >= Date.parse(d.updatedAt) ? local : d;
  };
  const pending = (snapshot?.pendingDrafts ?? []).filter((d) => d.pharmacyId === selectedPharmacyId).map(fresh);
  const sent = (snapshot?.recentDrafts ?? []).filter((d) => d.pharmacyId === selectedPharmacyId).map(fresh);
  const allKnown = [...pending, ...sent];
  const current = currentId ? (allKnown.find((d) => d.id === currentId) ?? localDrafts[currentId] ?? null) : null;

  const remember = (d: DraftRecord) => setLocalDrafts((m) => ({ ...m, [d.id]: d }));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { setError('Fichier trop lourd (20 Mo maximum).'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setDoc({ dataUrl: reader.result as string, name: file.name, isPdf: file.type === 'application/pdf' });
      setSamplePath('');
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = async () => {
    if (!selectedPharmacyId) { setError('Choisissez une officine.'); return; }
    if (!doc && !samplePath) { setError('Prenez une photo ou importez un document.'); return; }
    setError(''); setLoading(true); setCurrentId(null);
    let polling = false;
    try {
      const body: Record<string, unknown> = { pharmacyId: selectedPharmacyId, documentHint: docType, taskPrompt: taskPrompt || undefined };
      if (doc) body.imageBase64 = doc.dataUrl; else body.sampleAssetPath = samplePath;
      const r = await fetch('/api/agent/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { draft?: DraftRecord; error?: string };
      if (!r.ok || !data.draft) { setError(data.error ?? "Erreur pendant l'analyse."); return; }
      remember(data.draft);
      setCurrentId(data.draft.id);
      setDoc(null); setSamplePath('');
      onRefresh();
      // Si l'extraction est en cours (Gemini asynchrone), on poll toutes les 4s
      if (data.draft.extractionStatus === 'processing') {
        const pollId = data.draft.id;
        const poll = async () => {
          for (let i = 0; i < 45; i++) {
            await new Promise((res) => setTimeout(res, 4000));
            const pr = await fetch(`/api/drafts/${pollId}`, { headers: { Authorization: `Bearer ${token}` } });
            if (!pr.ok) break;
            const pd = await pr.json() as { draft?: DraftRecord };
            if (!pd.draft) break;
            remember(pd.draft);
            setCurrentId(pd.draft.id);
            onRefresh();
            if (pd.draft.extractionStatus !== 'processing') break;
          }
          setLoading(false);
        };
        polling = true;
        poll();
        return;
      }
    } catch {
      setError('Connexion impossible. Vérifiez Internet et réessayez.');
    } finally {
      if (!polling) setLoading(false);
    }
  };

  const decide = async (d: DraftRecord, action: 'approve' | 'reject') => {
    setBusyId(d.id); setError('');
    try {
      const r = await fetch(`/api/drafts/${d.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(action === 'reject' ? { reason: 'Rejeté par le pharmacien' } : {}),
      });
      const data = await r.json() as { draft?: DraftRecord; error?: string };
      if (!r.ok) { setError(data.error ?? 'Erreur.'); return; }
      if (data.draft) remember(data.draft);
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const preview = doc ? (doc.isPdf ? null : doc.dataUrl) : samplePath ? `/${samplePath}` : null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Poste Pharmacien</h1>
          <p className="text-slate-400 text-sm">Photo du bon → vérification → approbation → saisie automatique dans l'ERP</p>
        </div>
        <select
          value={selectedPharmacyId}
          onChange={(e) => onSelectPharmacy(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
        >
          <option value="">— Choisir une officine —</option>
          {pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Analyse */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><ScanLine size={16} className="text-emerald-400" /> Analyser un document</h2>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {(Object.keys(DOC_LABELS) as DocType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setDocType(t)}
                  className={`py-2 px-2 text-xs rounded-lg border font-medium ${docType === t ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' : 'bg-slate-800/70 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                >
                  {DOC_LABELS[t]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} className="flex items-center justify-center gap-2 text-sm font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white py-3 rounded-xl">
                <Camera size={17} /> Photo
              </button>
              <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 py-3 rounded-xl">
                <Upload size={17} /> Image ou PDF
              </button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
            </div>

            {preview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-700 mb-3">
                <img src={preview} alt="Document" className="w-full max-h-56 object-contain bg-slate-950" />
                <button onClick={() => { setDoc(null); setSamplePath(''); }} className="absolute top-2 right-2 bg-slate-900/80 p-1 rounded-full text-slate-400 hover:text-white"><XCircle size={18} /></button>
              </div>
            ) : doc?.isPdf ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3 mb-3">
                <FileText size={28} className="text-red-300" />
                <div className="flex-1 min-w-0 text-sm text-slate-200 truncate">{doc.name}</div>
                <button onClick={() => setDoc(null)} className="text-slate-400 hover:text-white"><XCircle size={18} /></button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center text-slate-500 text-xs mb-3">
                Photographiez le bon à plat, bien éclairé, en entier.
              </div>
            )}

            <div className="flex gap-2 flex-wrap mb-3">
              {SAMPLE_IMAGES.map((s) => (
                <button
                  key={s.path}
                  onClick={() => { setSamplePath(s.path); setDoc(null); setDocType(s.type); }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${samplePath === s.path ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-slate-800/70 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="Consigne particulière (optionnel) : ex. signale les péremptions < 6 mois"
              className="w-full bg-slate-800/70 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 outline-none mb-3"
            />

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs px-3 py-2 rounded-lg mb-3">{error}</div>}

            <button
              onClick={handleExtract}
              disabled={loading || !selectedPharmacyId || (!doc && !samplePath)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={17} className="animate-spin" /> : <ScanLine size={17} />}
              {loading ? 'Lecture du document…' : 'Analyser'}
            </button>
          </section>

          {current?.extractionStatus === 'processing' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm">
              <Loader2 size={18} className="animate-spin text-emerald-400 shrink-0" />
              <span>Analyse en cours… Gemini lit le document, cela peut prendre une minute.</span>
            </div>
          )}
          {current?.extractionStatus === 'error' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-900/30 border border-red-800 text-red-300 text-sm">
              <AlertCircle size={18} className="shrink-0" />
              <span>{current.extractionError ?? "Erreur d'analyse."}</span>
            </div>
          )}
          {current && current.extractionStatus !== 'processing' && current.extractionStatus !== 'error' && (
            <DraftPanel draft={current} token={token} busy={busyId === current.id} onDecide={decide} onUpdated={remember} onRefresh={onRefresh} />
          )}
        </div>

        <div className="space-y-5">
          {/* À valider */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                À valider
                {pending.length > 0 && <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{pending.length}</span>}
              </h2>
              <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300" title="Actualiser"><RefreshCw size={14} /></button>
            </div>
            {!selectedPharmacy ? (
              <div className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-8 text-center text-slate-500 text-sm">Choisissez une officine.</div>
            ) : pending.filter((d) => d.id !== current?.id).length === 0 ? (
              <div className="bg-slate-900 border border-dashed border-slate-700 rounded-2xl p-6 text-center">
                <CheckCircle2 size={26} className="text-emerald-500/50 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Rien en attente pour {selectedPharmacy.name}.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pending.filter((d) => d.id !== current?.id).map((d) => (
                  <div key={d.id} className="bg-slate-900 border border-amber-500/25 rounded-2xl overflow-hidden">
                    <button className="w-full flex items-center gap-3 p-4 text-left" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                      <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{d.extractedData.documentNumber || `Document ${d.id.slice(-6)}`} · {d.extractedData.supplierOrOrg}</div>
                        <div className="text-xs text-slate-500">{DOC_LABELS[d.documentCategory]} · {d.extractedData.lineItems.length} lignes · {new Date(d.createdAt).toLocaleDateString('fr-FR')}</div>
                      </div>
                      {expanded === d.id ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                    </button>
                    {expanded === d.id && (
                      <div className="border-t border-slate-800 p-4">
                        <DraftBody draft={d} token={token} busy={busyId === d.id} onDecide={decide} onUpdated={remember} onRefresh={onRefresh} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Envoyés à l'agent */}
          {selectedPharmacy && sent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-white mb-2">Envoyés à l'agent</h2>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800">
                {sent.slice(0, 10).map((d) => (
                  <div key={d.id} className="p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex-1 min-w-0 text-sm text-white truncate">{d.extractedData.documentNumber || d.id} · <span className="text-slate-400">{d.extractedData.supplierOrOrg}</span></div>
                      <a href={`/api/drafts/${d.id}/download?token=${token}`} className="text-slate-400 hover:text-white" title="Excel"><Download size={14} /></a>
                    </div>
                    <ExecutionDetail draftId={d.id} execution={d.execution} token={token} onChanged={onRefresh} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

interface DraftProps {
  draft: DraftRecord;
  token: string;
  busy: boolean;
  onDecide: (d: DraftRecord, action: 'approve' | 'reject') => void;
  onUpdated: (d: DraftRecord) => void;
  onRefresh: () => void;
}

function DraftPanel(props: DraftProps) {
  const { draft } = props;
  const status = { pending: ['À valider', 'text-amber-300 border-amber-500/30 bg-amber-500/10'], approved: ['Approuvé', 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'], rejected: ['Rejeté', 'text-red-300 border-red-500/30 bg-red-500/10'] }[draft.status];
  return (
    <section className="bg-slate-900 border border-slate-700 rounded-2xl p-5 animate-in">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{draft.extractedData.documentNumber || 'Nouveau document'} · {draft.extractedData.supplierOrOrg}</div>
          <div className="text-xs text-slate-500">{draft.extractedData.documentDate} · {draft.extractedData.totalAmountFCFA?.toLocaleString('fr-FR')} FCFA</div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${status[1]}`}>{status[0]}</span>
      </div>
      <DraftBody {...props} />
    </section>
  );
}

function DraftBody({ draft, token, busy, onDecide, onUpdated, onRefresh }: DraftProps) {
  const toReview = countToReview(draft);
  return (
    <div className="space-y-3">
      <DraftLines draft={draft} token={token} onUpdated={onUpdated} />

      {draft.extractedData.agentObservations && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-blue-200">💡 {draft.extractedData.agentObservations}</div>
      )}

      {draft.status === 'pending' && (
        <>
          <div className="flex items-start gap-2 text-[11px] text-slate-400">
            <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0" />
            Approuver envoie le bon à l'agent, qui remplit l'ERP sans jamais valider : la validation finale reste dans l'ERP.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onDecide(draft, 'approve')}
              disabled={busy || toReview > 0}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ThumbsUp size={15} />} {toReview > 0 ? `${toReview} ligne(s) à vérifier` : 'Approuver'}
            </button>
            <button
              onClick={() => onDecide(draft, 'reject')}
              disabled={busy}
              className="flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-semibold px-4 py-2.5 rounded-xl"
            >
              <ThumbsDown size={15} /> Rejeter
            </button>
            <a href={`/api/drafts/${draft.id}/download?token=${token}`} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm px-3 py-2.5 rounded-xl" title="Télécharger Excel">
              <Download size={15} />
            </a>
          </div>
        </>
      )}

      {draft.status === 'approved' && (
        <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3">
          {draft.execution ? <ExecutionDetail draftId={draft.id} execution={draft.execution} token={token} onChanged={onRefresh} /> : <ExecutionBadge execution={draft.execution} />}
        </div>
      )}
      {draft.status === 'rejected' && <p className="text-xs text-red-300">Rejeté{draft.rejectionReason ? ` : ${draft.rejectionReason}` : ''}.</p>}
    </div>
  );
}
