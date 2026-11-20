import { AlertTriangle, CheckCircle2, Clock, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
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

// Détail + actions : Renvoyer à l'agent · Corriger · Supprimer (Pharmacien)
export function ExecutionDetail({ draftId, execution, token, onChanged, canDelete = true }: {
  draftId: string; execution?: DraftExecution; token: string; onChanged: () => void; canDelete?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!execution) return null;

  const act = async (action: 'requeue' | 'reopen' | 'delete', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/drafts/${draftId}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setError(data.error ?? 'Action impossible.'); return; }
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const started = Date.parse(execution.startedAt ?? execution.queuedAt);
  const stuck = execution.status === 'running' && Date.now() - started > 3 * 60 * 1000;
  const canAct = execution.status !== 'running' || stuck;
  const link = 'inline-flex items-center gap-1 text-[11px] font-medium disabled:opacity-50';
  const failedLines = (execution.lines ?? []).filter((l) => !l.ok);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ExecutionBadge execution={execution} />
        {execution.durationMs != null && execution.status === 'done' && (
          <span className="text-[11px] text-slate-500">en {(execution.durationMs / 1000).toFixed(1)} s</span>
        )}
        {stuck && <span className="text-[11px] text-amber-300">bloquée depuis plus de 3 min</span>}
      </div>
      {canAct && (
        <div className="flex flex-wrap items-center gap-3">
          {execution.status !== 'queued' && (
            <button onClick={() => void act('requeue')} disabled={busy} className={`${link} text-sky-300 hover:text-sky-200`}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Renvoyer à l'agent
            </button>
          )}
          <button onClick={() => void act('reopen', 'Reprendre ce bon pour le corriger ? Il revient « à valider » ; il faudra l\'approuver à nouveau.')} disabled={busy} className={`${link} text-amber-300 hover:text-amber-200`}>
            <Pencil size={11} /> Corriger
          </button>
          {canDelete && (
            <button onClick={() => void act('delete', 'Supprimer définitivement ce bon de PharmAgent ? (Rien n\'est effacé dans votre logiciel.)')} disabled={busy} className={`${link} text-red-300 hover:text-red-200`}>
              <Trash2 size={11} /> Supprimer
            </button>
          )}
        </div>
      )}
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
