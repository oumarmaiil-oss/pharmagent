import {
  AlertCircle, Camera, CheckCircle2, ChevronDown, ChevronUp,
  Download, FileText, Loader2, Play, RefreshCw, ThumbsDown, ThumbsUp, Upload, XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { DashboardSnapshot, DraftRecord, OwnerAccount } from '../types/pharmagent.ts';
import DraftLines, { countToReview } from './DraftLines.tsx';

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
  { path: 'src/assets/images/sample_bon_livraison_1795017387838.jpg', label: 'Exemple : Bon de livraison', type: 'bon_livraison' as DocType },
  { path: 'src/assets/images/sample_facture_mutuelle_1795017386332.jpg', label: 'Exemple : Facture mutuelle', type: 'facture' as DocType },
];

export default function PharmacistWorkspace({ token, snapshot, onRefresh, selectedPharmacyId, onSelectPharmacy }: Props) {
  const [imageBase64, setImageBase64] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [docType, setDocType] = useState<DocType>('bon_livraison');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDraft, setCurrentDraft] = useState<DraftRecord | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<any>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const pharmacies = snapshot?.pharmacies ?? [];
  const drafts = snapshot?.pendingDrafts.filter((d) => d.pharmacyId === selectedPharmacyId) ?? [];
  const allDrafts = snapshot ? (snapshot as any).drafts?.filter((d: DraftRecord) => d.pharmacyId === selectedPharmacyId) : drafts;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImageBase64(result);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSampleImage = (img: typeof SAMPLE_IMAGES[0]) => {
    setImageBase64('');
    setImagePreview(`/${img.path}`);
    setDocType(img.type);
  };

  const handleExtract = async () => {
    if (!selectedPharmacyId) { setError('Sélectionnez une officine.'); return; }
    if (!imageBase64 && !imagePreview.startsWith('/')) { setError('Chargez ou sélectionnez une image.'); return; }
    setError(''); setLoading(true); setCurrentDraft(null); setExecResult(null);
    try {
      const body: Record<string, unknown> = {
        pharmacyId: selectedPharmacyId,
        documentHint: docType,
        taskPrompt: taskPrompt || undefined,
      };
      if (imageBase64) {
        body.imageBase64 = imageBase64;
      } else {
        body.sampleAssetPath = imagePreview.replace(/^\//, '');
      }
      const r = await fetch('/api/agent/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { draft?: DraftRecord; error?: string };
      if (!r.ok || !data.draft) { setError(data.error ?? 'Erreur extraction.'); return; }
      setCurrentDraft(data.draft);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (draftId: string) => {
    setApproveLoading(true);
    try {
      const r = await fetch(`/api/drafts/${draftId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setError(data.error ?? 'Erreur approbation.'); return; }
      if (currentDraft?.id === draftId) setCurrentDraft({ ...currentDraft, status: 'approved' });
      onRefresh();
    } finally {
      setApproveLoading(false);
    }
  };

  const handleReject = async (draftId: string, reason = '') => {
    try {
      await fetch(`/api/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (currentDraft?.id === draftId) setCurrentDraft({ ...currentDraft, status: 'rejected', rejectionReason: reason });
      onRefresh();
    } catch {}
  };

  const handleExecute = async (draftId: string) => {
    setExecuting(true); setExecResult(null);
    try {
      const r = await fetch('/api/agent/execute-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ draftId }),
      });
      const data = await r.json() as { result?: any; error?: string };
      if (r.ok) setExecResult(data.result);
      else setError(data.error ?? 'Erreur exécution.');
    } finally {
      setExecuting(false);
    }
  };

  const handleDraftUpdated = (d: DraftRecord) => {
    if (currentDraft?.id === d.id) setCurrentDraft(d);
    onRefresh();
  };

  const selectedPharmacy = pharmacies.find((p) => p.id === selectedPharmacyId);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Poste Pharmacien</h1>
          <p className="text-slate-400 text-sm">Extraction IA de documents + validation brouillons</p>
        </div>
        {/* Sélection officine */}
        <select
          value={selectedPharmacyId}
          onChange={(e) => onSelectPharmacy(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
        >
          <option value="">— Choisir une officine —</option>
          {pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panneau gauche : Extraction */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">📄 Analyser un document</h2>

            {/* Type de document */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Type de document</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(DOC_LABELS) as DocType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDocType(t)}
                    className={`py-2 px-2 text-xs rounded-lg border font-medium transition-all ${docType === t ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                  >
                    {DOC_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Zone d'image */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Image du document</label>
              <div className="flex gap-2 mb-2">
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg">
                  <Upload size={13} /> Importer
                </button>
                <button onClick={() => cameraRef.current?.click()} className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-3 py-2 rounded-lg">
                  <Camera size={13} /> Photo
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              </div>

              {imagePreview ? (
                <div className="relative rounded-lg overflow-hidden border border-slate-700">
                  <img src={imagePreview} alt="Document" className="w-full max-h-48 object-contain bg-slate-800" />
                  <button onClick={() => { setImageBase64(''); setImagePreview(''); }} className="absolute top-2 right-2 bg-slate-900/80 p-1 rounded-full text-slate-400 hover:text-white">
                    <XCircle size={16} />
                  </button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center text-slate-500 text-xs">
                  Importez ou photographiez le document
                </div>
              )}
            </div>

            {/* Exemples */}
            <div className="mb-3">
              <div className="text-xs text-slate-500 mb-1.5">Ou utilisez un exemple :</div>
              <div className="flex gap-2 flex-wrap">
                {SAMPLE_IMAGES.map((s) => (
                  <button
                    key={s.path}
                    onClick={() => handleSampleImage(s)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${imagePreview === `/${s.path}` ? 'bg-blue-500/15 border-blue-500/40 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Instruction optionnelle */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Instruction spécifique (optionnel)</label>
              <input
                type="text"
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                placeholder="Ex: Vérifie les dates d'expiration proches"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
              />
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg mb-3">{error}</div>}

            <button
              onClick={handleExtract}
              disabled={loading || !selectedPharmacyId}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              {loading ? 'Analyse IA en cours…' : 'Analyser avec Gemini Vision'}
            </button>
          </div>

          {/* Résultat du brouillon courant */}
          {currentDraft && <DraftCard draft={currentDraft} token={token} onApprove={handleApprove} onReject={handleReject} onExecute={handleExecute} onUpdated={handleDraftUpdated} approveLoading={approveLoading} executing={executing} execResult={execResult} />}
        </div>

        {/* Panneau droit : Brouillons en attente */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">
              🗂 Brouillons en attente
              {drafts.length > 0 && <span className="ml-2 bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{drafts.length}</span>}
            </h2>
            <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300">
              <RefreshCw size={14} />
            </button>
          </div>

          {!selectedPharmacy ? (
            <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-8 text-center text-slate-500 text-sm">
              Sélectionnez une officine ci-dessus.
            </div>
          ) : drafts.length === 0 ? (
            <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-8 text-center">
              <CheckCircle2 size={28} className="text-emerald-500/40 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">Aucun brouillon en attente pour {selectedPharmacy.name}.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {drafts.map((d) => (
                <div key={d.id} className="bg-slate-900 border border-amber-500/20 rounded-xl overflow-hidden">
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer"
                    onClick={() => setExpandedDraft(expandedDraft === d.id ? null : d.id)}
                  >
                    <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{d.extractedData.documentNumber || `Doc ${d.id.slice(-6)}`}</div>
                      <div className="text-xs text-slate-500">{DOC_LABELS[d.documentCategory]} · {d.extractedData.lineItems.length} lignes · {new Date(d.createdAt).toLocaleDateString('fr-FR')}</div>
                    </div>
                    {expandedDraft === d.id ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </div>

                  {expandedDraft === d.id && (
                    <div className="border-t border-slate-800 p-4 space-y-3">
                      {/* Résumé */}
                      <div className="text-xs text-slate-400">
                        <span className="font-medium text-slate-300">Fournisseur :</span> {d.extractedData.supplierOrOrg}
                        <br /><span className="font-medium text-slate-300">Date :</span> {d.extractedData.documentDate}
                        <br /><span className="font-medium text-slate-300">Total :</span> {d.extractedData.totalAmountFCFA.toLocaleString('fr-FR')} FCFA
                      </div>

                      <DraftLines draft={d} token={token} onUpdated={handleDraftUpdated} />

                      {d.extractedData.agentObservations && (
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-blue-300">
                          💡 {d.extractedData.agentObservations}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(d.id)}
                          disabled={approveLoading || countToReview(d) > 0}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg"
                        >
                          <ThumbsUp size={12} /> {countToReview(d) > 0 ? `${countToReview(d)} à vérifier` : 'Approuver'}
                        </button>
                        <button
                          onClick={() => handleReject(d.id, 'Rejeté par le pharmacien')}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium py-2 rounded-lg border border-red-500/30"
                        >
                          <ThumbsDown size={12} /> Rejeter
                        </button>
                        {d.hasExcelFile && (
                          <a
                            href={`/api/drafts/${d.id}/download?token=${token}`}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium px-3 py-2 rounded-lg"
                          >
                            <Download size={12} /> Excel
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({ draft, token, onApprove, onReject, onExecute, onUpdated, approveLoading, executing, execResult }: {
  draft: DraftRecord;
  token: string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
  onExecute: (id: string) => void;
  onUpdated: (d: DraftRecord) => void;
  approveLoading: boolean;
  executing: boolean;
  execResult: any;
}) {
  const statusColor = {
    pending: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    approved: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    rejected: 'text-red-400 border-red-500/30 bg-red-500/10',
  }[draft.status];

  const statusLabel = { pending: 'En attente', approved: 'Approuvé', rejected: 'Rejeté' }[draft.status];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 animate-in">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-white">Nouveau brouillon</div>
          <div className="text-xs text-slate-500 mono">{draft.id}</div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Données extraites */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div><span className="text-slate-500">Type :</span> <span className="text-slate-200">{draft.documentCategory}</span></div>
        <div><span className="text-slate-500">N° :</span> <span className="text-slate-200">{draft.extractedData.documentNumber}</span></div>
        <div><span className="text-slate-500">Fournisseur :</span> <span className="text-slate-200 truncate">{draft.extractedData.supplierOrOrg}</span></div>
        <div><span className="text-slate-500">Total :</span> <span className="text-slate-200">{draft.extractedData.totalAmountFCFA.toLocaleString('fr-FR')} FCFA</span></div>
      </div>

      <div className="mb-3">
        <DraftLines draft={draft} token={token} onUpdated={onUpdated} />
      </div>

      {/* Observations IA */}
      {draft.extractedData.agentObservations && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-blue-300 mb-3">
          💡 {draft.extractedData.agentObservations}
        </div>
      )}

      {/* Garde-fou notice */}
      <div className="badge-draft text-xs px-3 py-2 rounded-lg mb-3">
        🛡 Garde-fou actif — Brouillon uniquement. Validation réservée au pharmacien.
      </div>

      {/* Actions */}
      {draft.status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => onApprove(draft.id)}
            disabled={approveLoading || countToReview(draft) > 0}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg"
          >
            <ThumbsUp size={14} /> {countToReview(draft) > 0 ? `${countToReview(draft)} à vérifier` : 'Approuver'}
          </button>
          <button
            onClick={() => onReject(draft.id, 'Données incorrectes')}
            className="flex-1 flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-sm font-semibold py-2.5 rounded-lg"
          >
            <ThumbsDown size={14} /> Rejeter
          </button>
        </div>
      )}

      {draft.status === 'approved' && (
        <div className="flex gap-2">
          <button
            onClick={() => onExecute(draft.id)}
            disabled={executing}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg"
          >
            {executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {executing ? 'Exécution…' : 'Exécuter (simulation)'}
          </button>
          {draft.hasExcelFile && (
            <a
              href={`/api/drafts/${draft.id}/download?token=${token}`}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold px-4 py-2.5 rounded-lg"
            >
              <Download size={14} /> Excel
            </a>
          )}
        </div>
      )}

      {/* Résultat d'exécution */}
      {execResult && (
        <div className={`mt-3 rounded-lg p-3 text-xs border ${execResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          <div className="font-semibold mb-2 flex items-center gap-1.5">
            {execResult.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {execResult.success ? `Simulation réussie (${execResult.steps.length} étapes)` : 'Simulation interrompue par le garde-fou'}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {execResult.steps?.map((s: any, i: number) => (
              <div key={i} className={`flex items-start gap-1.5 ${s.status === 'blocked' ? 'text-red-400' : s.status === 'done' ? 'text-emerald-400' : 'text-slate-400'}`}>
                <span className="font-mono flex-shrink-0">{s.status === 'done' ? '✓' : s.status === 'blocked' ? '✗' : '·'}</span>
                <span>{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
