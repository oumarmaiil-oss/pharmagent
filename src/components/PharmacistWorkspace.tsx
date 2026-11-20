import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText, Loader2, RefreshCw, ScanLine,
  ShieldCheck, ThumbsDown, ThumbsUp, Upload, XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { DashboardSnapshot, DraftRecord, OwnerAccount } from '../types/pharmagent.ts';
import DraftLines, { countToReview } from './DraftLines.tsx';
import { blockingReason, draftChecks } from './draftChecks.ts';
import { downloadWithAuth } from './download.ts';
import GenericFill from './GenericFill.tsx';
import { ExecutionBadge, ExecutionDetail } from './ExecutionStatus.tsx';

interface Props {
  token: string;
  owner?: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
  selectedPharmacyId: string;
  onSelectPharmacy: (id: string) => void;
}

type DocType = 'bon_livraison' | 'facture' | 'mutuelle';

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

async function shrinkImage(file: File, maxSide = 1600): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

// Deux agrandissements (moitié haute, moitié basse) de la photo d'origine : lots et petits chiffres lisibles par l'IA
async function zoomTiles(file: File, target = 1568): Promise<string[]> {
  try {
    const bmp = await createImageBitmap(file);
    const vertical = bmp.height >= bmp.width;
    const out: string[] = [];
    for (const start of [0, 0.45]) {
      const sx = vertical ? 0 : Math.round(bmp.width * start), sy = vertical ? Math.round(bmp.height * start) : 0;
      const sw = vertical ? bmp.width : Math.round(bmp.width * 0.55), sh = vertical ? Math.round(bmp.height * 0.55) : bmp.height;
      const scale = Math.min(2, target / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return out;
  } catch {
    return [];
  }
}

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
  const [doc, setDoc] = useState<{ dataUrl: string; name: string; isPdf: boolean; zooms?: string[] } | null>(null);
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
  const pending = (snapshot?.pendingDrafts ?? []).filter((d) => d.pharmacyId === selectedPharmacyId).map(fresh).filter((d) => d.extractionStatus !== 'processing');
  const sent = (snapshot?.recentDrafts ?? []).filter((d) => d.pharmacyId === selectedPharmacyId).map(fresh);
  const allKnown = [...pending, ...sent];
  const current = currentId ? (allKnown.find((d) => d.id === currentId) ?? localDrafts[currentId] ?? null) : null;

  const remember = (d: DraftRecord) => setLocalDrafts((m) => ({ ...m, [d.id]: d }));

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { setError('Fichier trop lourd (20 Mo maximum).'); return; }
    // PDF, Excel, CSV : envoyés tels quels (lecture exacte) ; seule une photo est réduite et agrandie
    const isPdf = !file.type.startsWith('image/') || /\.(pdf|csv|xlsx|xls|ods|numbers)$/i.test(file.name);
    // Photo réduite sur le téléphone : envoi plus rapide, et sous la limite de 5 Mo de l'IA
    const dataUrl = (!isPdf && await shrinkImage(file)) || await readAsDataUrl(file);
    const zooms = isPdf ? [] : await zoomTiles(file);
    setDoc({ dataUrl, name: file.name, isPdf, zooms });
    setSamplePath('');
    setError('');
  };

  const handleExtract = async () => {
    if (!selectedPharmacyId) { setError('Choisissez une officine.'); return; }
    if (!doc && !samplePath) { setError('Prenez une photo ou importez un document.'); return; }
    setError(''); setLoading(true); setCurrentId(null);
    let polling = false;
    try {
      const body: Record<string, unknown> = { pharmacyId: selectedPharmacyId, documentHint: docType, taskPrompt: taskPrompt || undefined };
      if (doc) { body.imageBase64 = doc.dataUrl; body.fileName = doc.name; if (doc.zooms?.length) body.zoomBase64 = doc.zooms; } else body.sampleAssetPath = samplePath;
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
      // Si l'extraction est en cours (IA asynchrone), on poll toutes les 4s
      if (data.draft.extractionStatus === 'processing') {
        const pollId = data.draft.id;
        const poll = async () => {
          for (let i = 0; i < 45; i++) {
            await new Promise((res) => setTimeout(res, 4000));
            let pd: { draft?: DraftRecord };
            try {
              const pr = await fetch(`/api/drafts/${pollId}`, { headers: { Authorization: `Bearer ${token}` } });
              if (!pr.ok) continue;
              pd = await pr.json() as { draft?: DraftRecord };
            } catch { continue; }
            if (!pd.draft) continue;
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
    if (action === 'approve') {
      const errs = draftChecks(d).filter((c) => c.level === 'error');
      if (errs.length && !window.confirm(`${errs.length} alerte(s) importante(s) :\n\n- ${errs.map((c) => c.text).join('\n- ')}\n\nApprouver quand même ?`)) return;
    }
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

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 text-sm font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white py-3 rounded-xl">
                <Upload size={17} /> Fichier ou scan
              </button>
              <button onClick={() => cameraRef.current?.click()} className="flex items-center justify-center gap-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 py-3 rounded-xl">
                <Camera size={17} /> Photo
              </button>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf,.xlsx,.xls,.ods,.csv,.numbers,image/*" className="hidden" onChange={handleFile} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
              Le plus fiable : le <b>fichier du grossiste</b> (PDF, Excel, CSV reçu par mail). Bon en papier : <b>numérisez-le</b>
              {' '}(iPhone : Notes › Numériser des documents ; Android : Google Drive › Numériser) et importez le PDF. La photo est le dernier recours.
            </p>

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
                Aucun document choisi.
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
              <span>Analyse en cours… L'IA lit le document, cela peut prendre quelques secondes.</span>
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

          {selectedPharmacy && <GenericFill token={token} pharmacyId={selectedPharmacy.id} />}

          {/* Envoyés à l'agent */}
          {selectedPharmacy && sent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-white mb-2">Envoyés à l'agent</h2>
              {!(selectedPharmacy.agent && Date.now() - Date.parse(selectedPharmacy.agent.lastSeen) < 70_000) && (
                <div className="mb-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-amber-200 leading-relaxed">
                  {selectedPharmacy.agent ? "L'ordinateur de la pharmacie est hors ligne" : "Aucun ordinateur n'est encore relié"} : les bons approuvés attendent ici.
                  {' '}La saisie dans le logiciel se fait <b>automatiquement</b> dès que l'agent tourne sur cet ordinateur (installation : onglet <b>Agent local</b>, compte Pharmacien).
                  {' '}En attendant, vous pouvez <b>remplir un fichier Excel</b> avec le bouton prévu sur chaque bon.
                </div>
              )}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800">
                {sent.slice(0, 10).map((d) => (
                  <div key={d.id} className="p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex-1 min-w-0 text-sm text-white truncate">{d.extractedData.documentNumber || d.id} · <span className="text-slate-400">{d.extractedData.supplierOrOrg}</span></div>
                      <button onClick={() => void downloadWithAuth(`/api/drafts/${d.id}/download`, token, 'brouillon.xlsx')} className="text-slate-400 hover:text-white" title="Excel"><Download size={14} /></button>
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
          <div className="text-sm font-semibold text-white break-words">{draft.extractedData.documentNumber || 'Nouveau document'} · {draft.extractedData.supplierOrOrg}</div>
          <div className="text-xs text-slate-500">{draft.extractedData.documentDate} · {draft.extractedData.totalAmountFCFA?.toLocaleString('fr-FR')} {draft.extractedData.currency || 'FCFA'}</div>
          <div className="text-[11px] text-slate-500">Lancé par {draft.actorName}{draft.approvedBy ? ` · approuvé par ${draft.approvedBy}` : ''}</div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium whitespace-nowrap ${status[1]}`}>{status[0]}</span>
      </div>
      <DraftChecks draft={draft} />
      <DraftBody {...props} />
    </section>
  );
}

function DraftChecks({ draft }: { draft: DraftRecord }) {
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') return null;
  const checks = draftChecks(draft);
  if (!checks.length) {
    return <div className="mb-3 flex items-center gap-2 text-[11px] text-emerald-300"><CheckCircle2 size={13} /> Contrôles OK : total, péremptions, doublon, quantités et prix.</div>;
  }
  return (
    <div className="mb-3 space-y-1.5">
      {checks.map((c, i) => (
        <div key={i} className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 border ${c.level === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> <span>{c.text}</span>
        </div>
      ))}
    </div>
  );
}

interface FillReportView { sheet: string; linesWritten: number; headerFilled: string[]; missingLabels: string[]; converted?: 'ods' | 'csv' | 'xls' | 'numbers' | 'simplifie' }

function FillExcelButton({ draftId, token }: { draftId: string; token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/drafts/${draftId}/fill-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileBase64: await readAsDataUrl(file) }),
      });
      const data = await r.json() as { fileBase64?: string; report?: FillReportView; error?: string };
      if (!r.ok || !data.fileBase64 || !data.report) { setMsg({ ok: false, text: data.error ?? 'Remplissage impossible.' }); return; }
      const bytes = Uint8Array.from(atob(data.fileBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = file.name.replace(/\.(xlsx|xls|ods|csv)$/i, '') + '_rempli.xlsx';
      a.click(); URL.revokeObjectURL(url);
      const rep = data.report;
      setMsg({ ok: true, text: `${rep.linesWritten} ligne(s) ajoutée(s) dans « ${rep.sheet} »` + (rep.headerFilled.length ? ` · en-tête : ${rep.headerFilled.join(', ')}` : '') + (rep.missingLabels.length ? ` · colonnes non trouvées : ${rep.missingLabels.join(', ')}` : '') + (rep.converted ? ` · fichier ${rep.converted === 'simplifie' ? 'recopié' : '.' + rep.converted + ' converti'} en .xlsx (mise en forme simplifiée)` : '') + '. Le fichier rempli a été téléchargé : ouvrez-le pour vérifier.' });
    } catch {
      setMsg({ ok: false, text: 'Connexion impossible. Réessayez.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium px-3 py-2 rounded-xl disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Remplir mon fichier Excel
      </button>
      <input ref={input} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.numbers" className="hidden" onChange={onFile} />
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </div>
  );
}

function DraftBody({ draft, token, busy, onDecide, onUpdated, onRefresh }: DraftProps) {
  const toReview = countToReview(draft);
  const blocked = !!blockingReason(draft);
  return (
    <div className="space-y-3">
      <DraftLines draft={draft} token={token} onUpdated={onUpdated} />

      <FillExcelButton draftId={draft.id} token={token} />

      {draft.extractedData.agentObservations && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-blue-200">💡 {draft.extractedData.agentObservations}</div>
      )}

      {draft.status === 'pending' && (
        <>
          <div className="flex items-start gap-2 text-[11px] text-slate-400">
            <ShieldCheck size={14} className="text-emerald-400 flex-shrink-0" />
            {toReview > 0
              ? <>Pour approuver, chaque ligne doit être rattachée à un produit : choisissez-le ligne par ligne, ou cliquez <b className="text-slate-300">Garder les libellés du bon</b> (en haut des lignes).</>
              : "Approuver envoie le bon à l'agent installé sur l'ordinateur de la pharmacie : il remplit le logiciel tout seul, sans jamais valider. La validation finale reste dans le logiciel."}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onDecide(draft, 'approve')}
              disabled={busy || toReview > 0 || blocked}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ThumbsUp size={15} />} {blocked ? 'Non saisissable' : toReview > 0 ? `${toReview} ligne(s) à vérifier` : 'Approuver'}
            </button>
            <button
              onClick={() => onDecide(draft, 'reject')}
              disabled={busy}
              className="flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-semibold px-4 py-2.5 rounded-xl"
            >
              <ThumbsDown size={15} /> Rejeter
            </button>
            <button onClick={() => void downloadWithAuth(`/api/drafts/${draft.id}/download`, token, 'brouillon.xlsx')} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm px-3 py-2.5 rounded-xl" title="Télécharger Excel">
              <Download size={15} />
            </button>
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
