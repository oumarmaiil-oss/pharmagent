import React, { useMemo, useState } from 'react';
import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AuditLogEntry } from '../types/pharmagent';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs }) => {
  const [filter, setFilter] = useState<'all' | 'BROUILLON_CREE' | 'VALIDATION_BLOQUEE' | 'VALIDE_HUMAIN'>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter((l) => l.finalState === filter);
  }, [logs, filter]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-100">
              Politique de Garde-Fou Absolu (Arrêt strict au stade Brouillon)
            </h2>
            <p className="mt-1 text-sm text-slate-400 leading-relaxed">
              Chaque requête d’automatisation passe par le module déterministe{' '}
              <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">
                DraftOnlyGuardrail
              </code>
              . Toute action ciblant un bouton de validation comptable, de clôture ou d’encaissement
              lève immédiatement une erreur{' '}
              <code className="rounded bg-red-950 border border-red-800 px-1.5 py-0.5 font-mono text-xs text-red-300">
                SafetyViolationError
              </code>{' '}
              et requiert la signature manuelle du pharmacien titulaire.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <Lock className="h-4 w-4 text-emerald-500" />
            Verrouillage matériel &amp; logiciel actif
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Journal d’audit des exécutions agents
            </h3>
            <p className="text-xs text-slate-400">
              Traçabilité horodatée de chaque document extrait, brouillon créé et validation humaine
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
            {(
              [
                { id: 'all', label: 'Tous' },
                { id: 'BROUILLON_CREE', label: 'Brouillons' },
                { id: 'VALIDE_HUMAIN', label: 'Validés (Humain)' },
                { id: 'VALIDATION_BLOQUEE', label: 'Bloqués' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="px-6 py-3">Horodatage</th>
                <th className="px-4 py-3">Officine</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Logiciel cible</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3">Décision Garde-Fou</th>
                <th className="px-6 py-3">Détail d’exécution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filtered.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-6 py-3.5 font-mono text-xs text-slate-400 whitespace-nowrap tabular-nums">
                    {new Date(entry.timestamp).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="text-xs font-medium text-slate-100">{entry.pharmacyName}</div>
                    <div className="text-xs text-slate-400">{entry.city}</div>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-200 whitespace-nowrap">
                    {entry.documentNumber}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {entry.targetSoftware}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-300 tabular-nums">
                    {entry.tokensUsed.toLocaleString('fr-FR')}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    {entry.finalState === 'BROUILLON_CREE' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                        Brouillon créé
                      </span>
                    ) : entry.finalState === 'VALIDE_HUMAIN' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                        Validé par pharmacien
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
                        <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                        Validation bloquée
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400 max-w-md">
                    {entry.guardrailMessage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
