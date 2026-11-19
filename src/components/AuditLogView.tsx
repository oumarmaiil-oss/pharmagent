import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileDown,
  Lock,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { AuditLogEntry, OfficineRecord } from '../types/pharmagent';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
  pharmacies?: OfficineRecord[];
  defaultPharmacyId?: string;
  lockedPharmacy?: boolean;
  signatoryName?: string;
  canExportPdf?: boolean;
}

type StatusFilter =
  | 'all'
  | 'BROUILLON_CREE'
  | 'VALIDATION_BLOQUEE'
  | 'VALIDE_HUMAIN'
  | 'BROUILLON_REJETE';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tous les événements',
  BROUILLON_CREE: 'Brouillons créés',
  VALIDE_HUMAIN: 'Validés par pharmacien',
  BROUILLON_REJETE: 'Brouillons rejetés',
  VALIDATION_BLOQUEE: 'Validations bloquées (Garde-Fou)',
};

export const AuditLogView: React.FC<AuditLogViewProps> = ({
  logs,
  pharmacies = [],
  defaultPharmacyId = 'all',
  lockedPharmacy = false,
  signatoryName,
  canExportPdf = true,
}) => {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>(defaultPharmacyId);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    fileName: string;
    exportedCount: number;
    integrityHash: string;
    referenceId: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const availablePharmacies = useMemo(() => {
    if (pharmacies.length > 0) return pharmacies;
    const map = new Map<string, OfficineRecord>();
    for (const log of logs) {
      if (!map.has(log.pharmacyId)) {
        map.set(log.pharmacyId, {
          id: log.pharmacyId,
          name: log.pharmacyName,
          city: log.city,
          region: log.city,
          pharmacist: 'Pharmacien Titulaire',
          targetSoftware: 'ERP Officine Intégré',
          agentKey: '—',
          status: 'active',
          subscriptionPlan: 'pro',
          monthlyQuotaLimit: 1500,
          monthlyQuotaUsed: 0,
          subscriptionStatus: 'active',
          quotaCycleStart: log.timestamp,
          documentsProcessed: 0,
          bonsLivraisonCount: 0,
          facturesCount: 0,
          mutuellesCount: 0,
          draftsCreated: 0,
          guardrailBlocks: 0,
          tokensUsed: 0,
          estimatedCostFCFA: 0,
          lastActiveAt: log.timestamp,
          dailyVolume: [],
        });
      }
    }
    return Array.from(map.values());
  }, [pharmacies, logs]);

  const effectivePharmacyId =
    lockedPharmacy && availablePharmacies.length === 1
      ? availablePharmacies[0].id
      : selectedPharmacyId;

  const selectedPharmacy = useMemo(() => {
    if (effectivePharmacyId === 'all') return null;
    return availablePharmacies.find((p) => p.id === effectivePharmacyId) || null;
  }, [availablePharmacies, effectivePharmacyId]);

  const scopedLogs = useMemo(() => {
    if (effectivePharmacyId === 'all') return logs;
    return logs.filter((l) => l.pharmacyId === effectivePharmacyId);
  }, [logs, effectivePharmacyId]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return scopedLogs.filter((entry) => {
      if (filter !== 'all' && entry.finalState !== filter) return false;

      if (dateFrom) {
        const entryDay = new Date(entry.timestamp).toISOString().slice(0, 10);
        if (entryDay < dateFrom) return false;
      }
      if (dateTo) {
        const entryDay = new Date(entry.timestamp).toISOString().slice(0, 10);
        if (entryDay > dateTo) return false;
      }

      if (query) {
        const haystack = [
          entry.id,
          entry.documentNumber,
          entry.pharmacyName,
          entry.city,
          entry.targetSoftware,
          entry.guardrailMessage,
          entry.actorName || '',
          entry.actorRole || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [scopedLogs, filter, dateFrom, dateTo, searchQuery]);

  const stats = useMemo(() => {
    return {
      total: scopedLogs.length,
      drafts: scopedLogs.filter((l) => l.finalState === 'BROUILLON_CREE').length,
      human: scopedLogs.filter((l) => l.finalState === 'VALIDE_HUMAIN').length,
      blocked: scopedLogs.filter((l) => l.finalState === 'VALIDATION_BLOQUEE').length,
    };
  }, [scopedLogs]);

  const hasActiveFilters =
    filter !== 'all' ||
    (!lockedPharmacy && effectivePharmacyId !== 'all') ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(searchQuery.trim());

  const handleResetFilters = () => {
    setFilter('all');
    if (!lockedPharmacy) setSelectedPharmacyId('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    setExportError(null);
    setExportFeedback(null);
    try {
      const { exportAuditLogsToPdf } = await import('../utils/auditPdfExport');
      const result = await exportAuditLogsToPdf({
        logs: filtered,
        pharmacy: selectedPharmacy,
        filterLabel: FILTER_LABELS[filter],
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        searchQuery: searchQuery || undefined,
        signatoryName,
      });
      setExportFeedback(result);
    } catch (err: unknown) {
      setExportError(
        err instanceof Error
          ? `Erreur lors de la génération du PDF : ${err.message}`
          : 'Impossible de générer le document PDF.'
      );
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-8 p-6 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Traçabilité &amp; Garde-Fou Brouillon</span>
            </div>
            <h2 className="text-base font-semibold text-slate-100">
              Journal d’Audit Réglementaire &amp; Preuves Signées
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              Chaque document analysé, validation humaine ou blocage de sécurité est archivé avec
              l’identité de l’opérateur et exportable au format PDF horodaté.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="text-[11px] text-slate-400">Contrôles exécutés</div>
              <div className="mt-1 text-xl font-semibold text-slate-100 tabular-nums">
                {stats.total}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="text-[11px] text-amber-400">Brouillons arrêtés</div>
              <div className="mt-1 text-xl font-semibold text-slate-100 tabular-nums">
                {stats.drafts}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="text-[11px] text-emerald-400">Validés humain</div>
              <div className="mt-1 text-xl font-semibold text-slate-100 tabular-nums">
                {stats.human}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="text-[11px] text-red-400">Validations bloquées</div>
              <div className="mt-1 text-xl font-semibold text-slate-100 tabular-nums">
                {stats.blocked}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 relative min-h-[160px] bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-800 overflow-hidden">
          <img
            src="/src/assets/images/banner_audit_security_1795081857803.jpg"
            alt="Contrôle et sécurité d'audit PharmAgent"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-90"
          />
        </div>
      </section>

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
              · Export PDF officiel avec empreinte SHA-256 et bloc de visa
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
              {(
                [
                  { id: 'all', label: 'Tous' },
                  { id: 'BROUILLON_CREE', label: 'Brouillons' },
                  { id: 'VALIDE_HUMAIN', label: 'Validés (Humain)' },
                  { id: 'BROUILLON_REJETE', label: 'Rejetés' },
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

            {canExportPdf ? (
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={exportingPdf || filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <FileDown className="h-3.5 w-3.5" />
                {exportingPdf
                  ? 'Génération PDF...'
                  : `Exporter PDF officiel (${filtered.length})`}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300">
                <Lock className="h-3.5 w-3.5" />
                Export PDF officiel réservé aux Pharmaciens
              </span>
            )}
          </div>
        </div>

        {/* Filter Bar: Officine, Période, Recherche */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-800/80 bg-slate-950/40 px-6 py-3">
          {!lockedPharmacy && availablePharmacies.length > 0 && (
            <div className="min-w-[200px]">
              <label
                htmlFor="audit-pharmacy-filter"
                className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-400"
              >
                <Building2 className="h-3 w-3 text-slate-500" />
                Officine
              </label>
              <select
                id="audit-pharmacy-filter"
                value={effectivePharmacyId}
                onChange={(e) => setSelectedPharmacyId(e.target.value)}
                className="h-8 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">Toutes les officines ({logs.length})</option>
                {availablePharmacies.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name} — {ph.city}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="audit-date-from"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              Du
            </label>
            <input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="audit-date-to"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              Au
            </label>
            <input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="audit-search-input"
              className="mb-1 block text-[11px] font-medium text-slate-400"
            >
              Rechercher dans le registre
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                id="audit-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="N° document, acteur, logiciel, message..."
                className="h-8 w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100"
            >
              <RotateCcw className="h-3 w-3" />
              Réinitialiser
            </button>
          )}
        </div>

        {exportError && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/60 px-4 py-2.5 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{exportError}</span>
          </div>
        )}

        {exportFeedback && (
          <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-800/80 bg-emerald-950/50 px-4 py-2.5 text-xs text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Registre PDF officiel téléchargé :{' '}
                <strong className="font-mono text-emerald-300">{exportFeedback.fileName}</strong> (
                {exportFeedback.exportedCount} événement(s))
              </span>
            </div>
            <span className="font-mono text-[11px] text-emerald-400">
              Réf. {exportFeedback.referenceId} · SHA-256 : {exportFeedback.integrityHash.slice(0, 16)}…
            </span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="px-6 py-3">Horodatage</th>
                <th className="px-4 py-3">Officine</th>
                <th className="px-4 py-3">N° de document</th>
                <th className="px-4 py-3">Logiciel cible</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3">Décision Garde-Fou</th>
                <th className="px-4 py-3">Acteur</th>
                <th className="px-6 py-3">Détail d’exécution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-xs text-slate-500">
                    Aucun événement d’audit ne correspond aux critères sélectionnés.
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-3.5 font-mono text-xs text-slate-400 whitespace-nowrap tabular-nums">
                      <div>
                        {new Date(entry.timestamp).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="text-[10px] text-slate-500">{entry.id}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-xs font-medium text-slate-100">{entry.pharmacyName}</div>
                      <div className="text-xs text-slate-400">{entry.city}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-200 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <img
                          src={
                            entry.documentType === 'mutuelle'
                              ? '/src/assets/images/sample_facture_mutuelle_1795017386332.jpg'
                              : '/src/assets/images/sample_bon_livraison_1795017387838.jpg'
                          }
                          alt={entry.documentNumber}
                          referrerPolicy="no-referrer"
                          className="h-7 w-7 rounded border border-slate-800 object-cover shrink-0"
                        />
                        <span>{entry.documentNumber}</span>
                      </div>
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
                      ) : entry.finalState === 'BROUILLON_REJETE' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
                          <ShieldAlert className="h-3.5 w-3.5 text-slate-500" />
                          Brouillon rejeté
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
                          <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                          Validation bloquée
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                      {entry.actorName ? (
                        <div className="inline-flex items-center gap-1.5 text-slate-200">
                          <UserCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <div>
                            <div className="font-medium">{entry.actorName}</div>
                            {entry.actorRole && (
                              <div className="text-[10px] text-slate-400 capitalize">
                                {entry.actorRole}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Agent / Superviseur</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-400 max-w-md">
                      {entry.guardrailMessage}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
