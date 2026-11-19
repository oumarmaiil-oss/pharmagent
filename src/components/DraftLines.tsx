import { Check, Loader2, PackagePlus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { DraftRecord, ExtractedLineItem } from '../types/pharmagent.ts';

interface Props {
  draft: DraftRecord;
  token: string;
  onUpdated: (draft: DraftRecord) => void;
}

const METHOD_LABEL: Record<string, string> = {
  cip: 'CIP', memory: 'Mémoire', score: 'Score', ai: 'IA', manual: 'Manuel', none: '—',
};

export function countToReview(draft: DraftRecord): number {
  return draft.extractedData.lineItems.filter((l) => l.match?.status === 'to_review').length;
}

export default function DraftLines({ draft, token, onUpdated }: Props) {
  const [busy, setBusy] = useState<number | 'rematch' | null>(null);
  const [error, setError] = useState('');
  const editable = draft.status === 'pending';
  const lines = draft.extractedData.lineItems;
  const toReview = countToReview(draft);

  const call = async (url: string, body: unknown, key: number | 'rematch') => {
    setBusy(key); setError('');
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await r.json() as { draft?: DraftRecord; error?: string };
      if (!r.ok || !data.draft) { setError(data.error ?? 'Erreur.'); return; }
      onUpdated(data.draft);
    } catch {
      setError('Erreur réseau.');
    } finally {
      setBusy(null);
    }
  };

  const choose = (i: number, body: { productId?: string; erpLabel?: string; newProduct?: boolean }) =>
    call(`/api/drafts/${draft.id}/lines/${i}/match`, body, i);

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <div className="bg-slate-800 px-3 py-2 flex items-center gap-2 text-xs">
        <span className="text-slate-300 font-medium">{lines.length} ligne{lines.length > 1 ? 's' : ''}</span>
        {toReview > 0
          ? <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">{toReview} à vérifier</span>
          : <span className="bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">toutes reconnues</span>}
        {editable && (
          <button
            onClick={() => call(`/api/drafts/${draft.id}/rematch`, {}, 'rematch')}
            disabled={busy !== null}
            title="Relancer la correspondance (après import du catalogue)"
            className="ml-auto text-slate-400 hover:text-white disabled:opacity-40"
          >
            {busy === 'rematch' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        )}
      </div>

      {error && <div className="bg-red-500/10 text-red-400 text-xs px-3 py-1.5">{error}</div>}

      <div className="divide-y divide-slate-800 max-h-[28rem] overflow-y-auto">
        {lines.map((line, i) => (
          <LineRow key={i} line={line} editable={editable} busy={busy === i} onChoose={(b) => choose(i, b)} />
        ))}
      </div>
    </div>
  );
}

function LineRow({ line, editable, busy, onChoose }: {
  line: ExtractedLineItem;
  editable: boolean;
  busy: boolean;
  onChoose: (body: { productId?: string; erpLabel?: string; newProduct?: boolean }) => void;
}) {
  const [manual, setManual] = useState('');
  const m = line.match;
  const review = m?.status === 'to_review';

  return (
    <div className={`px-3 py-2 text-xs ${review ? 'bg-amber-500/5' : ''}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-amber-200/90 break-words min-w-0 flex-1">{line.designation}</span>
        <span className="text-slate-400 flex-shrink-0">×{line.quantity}</span>
        <span className="text-slate-400 flex-shrink-0 w-16 text-right">{line.unitPriceFCFA.toLocaleString('fr-FR')}</span>
      </div>

      {m && !review && (
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-slate-500">→</span>
          <span className={`break-words min-w-0 ${m.status === 'new_product' ? 'text-sky-300' : 'text-emerald-300'}`}>{m.erpLabel}</span>
          <span className="ml-auto flex-shrink-0 text-[10px] text-slate-500">
            {m.status === 'new_product' ? 'Nouveau produit' : `${METHOD_LABEL[m.method]} · ${Math.round(m.score * 100)}%`}
          </span>
        </div>
      )}

      {review && editable && (
        <div className="mt-1.5 space-y-1.5">
          {m!.candidates.slice(0, 3).map((c) => (
            <button
              key={c.productId}
              onClick={() => onChoose({ productId: c.productId })}
              disabled={busy}
              className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded border transition-colors disabled:opacity-50 ${
                c.productId === m!.productId
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 bg-slate-800/60 text-slate-200 hover:border-slate-500'
              }`}
            >
              <Check size={12} className="flex-shrink-0 opacity-60" />
              <span className="break-words min-w-0 flex-1">{c.erpLabel}</span>
              <span className="text-[10px] text-slate-400">{Math.round(c.score * 100)}%</span>
            </button>
          ))}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onChoose({ erpLabel: manual.trim() }); }}
          >
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Libellé exact dans l'ERP"
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
            />
            <button type="submit" disabled={busy || !manual.trim()} className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 rounded disabled:opacity-40">OK</button>
            <button
              type="button"
              onClick={() => onChoose({ newProduct: true, erpLabel: manual.trim() || undefined })}
              disabled={busy}
              title="Produit absent de l'ERP"
              className="flex items-center gap-1 bg-sky-500/15 border border-sky-500/30 text-sky-300 px-2 rounded disabled:opacity-40"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <PackagePlus size={11} />} Nouveau
            </button>
          </form>
        </div>
      )}

      {review && !editable && <div className="mt-1 text-amber-300">Non vérifié</div>}
    </div>
  );
}
