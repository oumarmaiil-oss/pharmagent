import { useEffect, useState } from 'react';

type State = 'checking' | 'ok' | 'waking' | 'down';

const LABEL: Record<State, string> = {
  checking: 'Vérification du serveur…',
  ok: 'Serveur prêt',
  waking: 'Réveil du serveur… (jusqu’à 1 min)',
  down: 'Serveur injoignable',
};
const DOT: Record<State, string> = {
  checking: 'bg-slate-500',
  ok: 'bg-emerald-400',
  waking: 'bg-amber-400 animate-pulse',
  down: 'bg-red-500',
};

// Le serveur gratuit s'endort après inactivité : l'application (gardée en mémoire) s'ouvre tout de suite,
// mais les données attendent son réveil. Cet indicateur le rend visible.
export default function ServerStatus({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>('checking');
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const check = async () => {
      const t0 = performance.now();
      const slow = window.setTimeout(() => alive && setState('waking'), 2500);
      const ctrl = new AbortController();
      const abort = window.setTimeout(() => ctrl.abort(), 90_000);
      try {
        const r = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
        if (!alive) return;
        setState(r.ok ? 'ok' : 'down');
        setMs(Math.round(performance.now() - t0));
      } catch {
        if (alive) setState('down');
      } finally {
        window.clearTimeout(slow);
        window.clearTimeout(abort);
        if (alive) timer = window.setTimeout(check, 30_000);
      }
    };
    check();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  const title = state === 'ok' && ms !== null ? `${LABEL[state]} (${ms} ms)` : LABEL[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400" title={title} data-server-status={state}>
      <span className={`w-2 h-2 rounded-full ${DOT[state]}`} />
      {!compact && <span>{title}</span>}
    </span>
  );
}
