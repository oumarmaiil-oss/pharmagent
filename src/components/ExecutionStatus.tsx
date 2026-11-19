import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { DraftExecution } from '../types/pharmagent.ts';

const STYLE: Record<DraftExecution['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  queued: { label: "En attente de l'agent", cls: 'text-sky-300 bg-sky-500/10 border-sky-500/30', icon: <Clock size={12} /> },
  running: { label: 'Saisie en cours…', cls: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30', icon: <Loader2 size={12} className="animate-spin" /> },
  done: { label: "Saisi dans l'ERP", cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle2 size={12} /> },
  failed: { label: 'Saisie interrompue', cls: 'text-red-300 bg-red-500/10 border-red-500/30', icon: <AlertTriangle size={12} /> },
};

export function ExecutionBadge({ execution }: { execution?: DraftExecution }) {
  if (!execution) return null;
  const s = STYLE[execution.status];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

// Détail + bouton « Relancer » quand la saisie a échoué
export function ExecutionDetail({ draftId, execution, token, onChanged }: {
  draftId: string; execution?: DraftExecution; token: string; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!execution) return null;

  const requeue = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/drafts/${draftId}/requeue`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json() as { error?: string };
      if (!r.ok) setError(d.error ?? 'Erreur.');
      else onChanged();
    } finally {
      setBusy(false);
    }
  };

  const failedLines = (execution.lines ?? []).filter((l) => !l.ok);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ExecutionBadge execution={execution} />
        {execution.durationMs != null && execution.status === 'done' && (
          <span className="text-[11px] text-slate-500">en {(execution.durationMs / 1000).toFixed(1)} s</span>
        )}
        {execution.status === 'failed' && (
          <button onClick={requeue} disabled={busy} className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-sky-300 hover:text-sky-200 disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Relancer la saisie
          </button>
        )}
      </div>
      {execution.message && <p className={`text-xs ${execution.status === 'failed' ? 'text-red-300' : 'text-slate-400'}`}>{execution.message}</p>}
      {execution.status === 'done' && failedLines.length > 0 && (
        <ul className="text-[11px] text-amber-300 list-disc pl-4">
          {failedLines.map((l) => <li key={l.index}>Ligne {l.index + 1} : {l.message}</li>)}
        </ul>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
