import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Building2,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  FileText,
  Monitor,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import {
  DashboardSnapshot,
  OfficineRecord,
  SubscriptionPlanId,
  TargetSoftwareType,
} from '../types/pharmagent';
import { SupervisionAnalyticsChart } from './SupervisionAnalyticsChart';
import { PanelIllustration } from './Illustrations';

interface SupervisionDashboardProps {
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  ownerToken: string;
  onSelectPharmacyForWorkspace: (pharmacyId: string) => void;
  onOpenIsolatedPortal: (pharmacy: OfficineRecord) => void;
  onSelectPharmacyForGrounding: (pharmacyId: string) => void;
  onOpenSubscriptions: () => void;
  onPharmacyCreated: () => void;
}

const PLAN_LABELS: Record<SubscriptionPlanId, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Réseau',
};

const PLAN_DAILY_VOLUME: Record<SubscriptionPlanId, string> = {
  starter: '~5 BL/j',
  pro: '~10 BL/j',
  enterprise: '~15–20 BL/j',
};

export const SupervisionDashboard: React.FC<SupervisionDashboardProps> = ({
  snapshot,
  loading,
  ownerToken,
  onSelectPharmacyForWorkspace,
  onOpenIsolatedPortal,
  onSelectPharmacyForGrounding,
  onOpenSubscriptions,
  onPharmacyCreated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'idle' | 'guardrail_halted'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPharmacist, setNewPharmacist] = useState('');
  const [newSoftware, setNewSoftware] = useState<TargetSoftwareType>('ERP Officine Intégré');
  const [newPlan, setNewPlan] = useState<SubscriptionPlanId>('pro');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<{
    pharmacy: OfficineRecord;
    credentials: {
      titulaire: { loginId: string; password: string };
      adjoint: { loginId: string; password: string };
      assistant: { loginId: string; password: string };
    };
  } | null>(null);

  const filteredPharmacies = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.pharmacies.filter((ph) => {
      const matchesQuery =
        ph.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ph.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ph.targetSoftware.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ph.pharmacist.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ph.agentKey.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || ph.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [snapshot, searchQuery, statusFilter]);

  const handleCopySeparateLink = async (ph: OfficineRecord) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('mode', 'officine');
    url.searchParams.set('key', ph.agentKey);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedKey(ph.id);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard permission failure
    }
  };

  const handleCreatePharmacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/pharmacies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          name: newName,
          city: newCity,
          region: newCity,
          pharmacist: newPharmacist,
          targetSoftware: newSoftware,
          subscriptionPlan: newPlan,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur création officine.');
      if (payload.pharmacy && payload.provisionalCredentials) {
        setCreatedNotice({
          pharmacy: payload.pharmacy,
          credentials: payload.provisionalCredentials,
        });
      }
      setNewName('');
      setNewCity('');
      setNewPharmacist('');
      setShowAddForm(false);
      onPharmacyCreated();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-28 rounded-xl border border-slate-800 bg-slate-900 p-5 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
        <div className="h-80 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-400">
          Impossible de charger les données de supervision multi-officines.
        </p>
      </div>
    );
  }

  const { summary } = snapshot;
  const globalQuotaPct = Math.min(
    100,
    Math.round(((summary.totalQuotaUsed || 0) / Math.max(summary.totalQuotaAllocated || 1, 1)) * 100)
  );
  const pendingReqCount = summary.pendingQuotaRequestsCount || 0;

  const renderStatus = (ph: OfficineRecord) => {
    if (ph.subscriptionStatus === 'suspended') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
          <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
          Suspendue
        </span>
      );
    }
    if (ph.status === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          Actif
        </span>
      );
    }
    if (ph.status === 'guardrail_halted') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
          <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
          Garde-fou déclenché
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <Activity className="h-3.5 w-3.5 text-slate-500" />
        En veille
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Split Dark Illustrated Supervision Hero Banner */}
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Centre Superviseur · Liens Officines Séparés &amp; Intervention à Distance</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-100">
              Pilotez vos officines à distance et attribuez leurs quotas réels
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              Chaque officine reçoit son <strong className="text-slate-100">lien séparé</strong>{' '}
              strictement isolé. Depuis cette console, vous gardez un accès complet pour{' '}
              <strong className="text-emerald-300">intervenir à distance</strong> (brouillons,
              utilisateurs de l’officine, agent local) et gérer les abonnements Starter, Pro ou Réseau.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenSubscriptions}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/70 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/70 transition-colors whitespace-nowrap shrink-0 tabular-nums"
            >
              <Coins className="h-3.5 w-3.5" />
              Abonnements &amp; Jauges ({globalQuotaPct}%)
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvelle officine
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[180px] bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-800 overflow-hidden">
          <PanelIllustration variant="network" label="Réseau de supervision multi-officines PharmAgent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent px-4 py-3 text-[11px] font-medium text-slate-200">
            Supervision centralisée · {summary.activeAgents} officine(s) active(s)
          </div>
        </div>
      </section>

      {pendingReqCount > 0 && (
        <section className="rounded-xl border border-amber-700/70 bg-amber-950/30 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-200">
            <BellRing className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong className="tabular-nums">{pendingReqCount}</strong> demande(s) de recharge ou
              changement de forfait en attente de votre validation.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSubscriptions}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            Traiter les demandes
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </section>
      )}

      {/* KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Officines supervisées</span>
            <Activity className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-100 tabular-nums">
              {summary.totalPharmacies}
            </span>
            <span className="text-xs text-emerald-400 tabular-nums">
              {summary.activeAgents} actives
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {summary.pendingDraftsCount} brouillon(s) en attente de validation
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Documents traités</span>
            <FileText className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-100 tabular-nums">
              {summary.totalDocuments.toLocaleString('fr-FR')}
            </span>
            <span className="text-xs text-slate-400">BL · Factures · Mutuelles</span>
          </div>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            {summary.totalDraftsCreated.toLocaleString('fr-FR')} brouillons générés
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Capacité IA &amp; Coût Réel</span>
            <Coins className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-100 tabular-nums">
              {globalQuotaPct} %
            </span>
            <span className="text-xs text-emerald-400 tabular-nums">
              {Math.max(0, 100 - globalQuotaPct)} % libre sur le parc
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400 tabular-nums">
            {(summary.totalTokensUsed / 1000).toFixed(1)} k unités IA ·{' '}
            {summary.totalCostFCFA.toLocaleString('fr-FR')} FCFA
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Garde-Fou Sécurité Absolu</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-100 tabular-nums">
              {summary.totalGuardrailBlocks}
            </span>
            <span className="text-xs text-red-400 font-medium">validations bloquées</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">100 % des agents arrêtés au stade Brouillon</p>
        </div>
      </section>

      {/* Volume & Consumption Chart (Recharts) + Breakdown */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SupervisionAnalyticsChart pharmacies={snapshot.pharmacies} />

        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Répartition par logiciel cible
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Adaptation visuelle sans connecteur API propriétaire
            </p>

            <div className="mt-5 space-y-4">
              {(
                [
                  'ERP Officine Intégré',
                  'Tableur Excel Stock',
                  'Logiciel Comptoir Local',
                  'Progiciel Gestion Stock',
                ] as const
              ).map((soft) => {
                const matching = snapshot.pharmacies.filter((p) => p.targetSoftware === soft);
                const docs = matching.reduce((s, p) => s + p.documentsProcessed, 0);
                const share = Math.round((docs / Math.max(summary.totalDocuments, 1)) * 100);
                return (
                  <div key={soft} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-200">{soft}</span>
                      <span className="text-slate-400 tabular-nums">
                        {docs} docs · {share}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <p className="font-medium text-slate-200">Séparation &amp; Intervention</p>
            <p className="mt-1 leading-relaxed">
              Envoyez à chaque pharmacie son lien isolé, tout en conservant votre accès à distance
              pour intervenir ou ajuster ses quotas.
            </p>
          </div>
        </div>
      </section>

      {/* Vignettes des Officines & Aperçus Visuels Pipeline */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5 xl:col-span-8">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Officines Connectées · Liens Séparés &amp; Quotas
              </h2>
              <p className="text-xs text-slate-400">
                Copiez le lien dédié de chaque officine ou lancez une intervention à distance
              </p>
            </div>
            <span className="font-mono text-xs text-emerald-400 tabular-nums">
              {snapshot.pharmacies.length} officines
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.pharmacies.map((ph) => {
              const quotaUsed = ph.monthlyQuotaUsed || 0;
              const quotaLimit = Math.max(ph.monthlyQuotaLimit || 1, 1);
              const quotaPct = Math.min(100, Math.round((quotaUsed / quotaLimit) * 100));
              return (
                <div
                  key={ph.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/85 p-3.5 flex flex-col justify-between gap-3 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950/60 text-emerald-400">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-slate-100">{ph.name}</div>
                        <div className="truncate text-[11px] text-slate-400">{ph.city}</div>
                      </div>
                    </div>
                    {renderStatus(ph)}
                  </div>

                  {/* Quota bar in % */}
                  <div className="space-y-1 border-t border-slate-800/80 pt-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-medium">
                        {PLAN_LABELS[ph.subscriptionPlan || 'pro']} ·{' '}
                        {PLAN_DAILY_VOLUME[ph.subscriptionPlan || 'pro']}
                      </span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          quotaPct >= 100
                            ? 'text-red-400'
                            : quotaPct >= 80
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {quotaPct} % utilisé
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          quotaPct >= 100 || ph.subscriptionStatus === 'suspended'
                            ? 'bg-red-500'
                            : quotaPct >= 80
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${quotaPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectPharmacyForWorkspace(ph.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600/90 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                      title="Prendre la main à distance sur cette officine"
                    >
                      <Wrench className="h-3 w-3" />
                      Intervenir
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySeparateLink(ph)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:border-sky-500 transition-colors whitespace-nowrap shrink-0"
                      title={`Copier le lien isolé (?mode=officine&key=${ph.agentKey})`}
                    >
                      {copiedKey === ph.id ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3 text-sky-400" />
                      )}
                      Lien
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenIsolatedPortal(ph)}
                      className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:border-emerald-500 transition-colors shrink-0"
                      title={`Ouvrir le portail séparé de ${ph.name}`}
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/95 p-5 xl:col-span-4">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Vignettes Documents &amp; Écrans
              </h2>
              <p className="text-xs text-slate-400">Aperçus actifs du pipeline visuel</p>
            </div>
            <Monitor className="h-4 w-4 text-slate-500" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              {
                title: 'Bon de livraison (Démo)',
                sub: 'Document source',
                src: '/src/assets/images/sample_bon_livraison_1795017387838.jpg',
                action: () =>
                  onSelectPharmacyForWorkspace(snapshot.pharmacies[0]?.id || 'officine-alpha'),
              },
              {
                title: 'Facture Mutuelle (Démo)',
                sub: 'Document source',
                src: '/src/assets/images/sample_facture_mutuelle_1795017386332.jpg',
                action: () =>
                  onSelectPharmacyForWorkspace(
                    snapshot.pharmacies[1]?.id || snapshot.pharmacies[0]?.id || 'officine-beta'
                  ),
              },
              {
                title: 'Interface ERP cible',
                sub: 'UI Grounding',
                src: '/src/assets/images/target_erp_screenshot_1795017387811.jpg',
                action: () =>
                  onSelectPharmacyForGrounding(snapshot.pharmacies[0]?.id || 'officine-alpha'),
              },
              {
                title: 'Grille Tableur Excel',
                sub: 'Mapping colonnes',
                src: '/src/assets/images/target_excel_screenshot_1795017389210.jpg',
                action: () =>
                  onSelectPharmacyForGrounding(
                    snapshot.pharmacies[1]?.id || snapshot.pharmacies[0]?.id || 'officine-beta'
                  ),
              },
            ].map((thumb) => (
              <button
                key={thumb.title}
                type="button"
                onClick={thumb.action}
                className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-left hover:border-emerald-500/80 transition-colors"
              >
                <div className="h-20 w-full overflow-hidden bg-slate-900">
                  <img
                    src={thumb.src}
                    alt={thumb.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
                <div className="p-2">
                  <div className="truncate text-[11px] font-semibold text-slate-100">
                    {thumb.title}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">{thumb.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Multi-Pharmacy Supervision Table */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/95">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Parc d’officines, Liens Séparés &amp; Quotas Réels
            </h2>
            <p className="text-xs text-slate-400">
              Envoyez à chaque pharmacie son lien séparé ou intervenez à distance en un clic
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher officine, secteur, clé..."
                className="h-9 w-56 rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
              {(
                [
                  { id: 'all', label: 'Toutes' },
                  { id: 'active', label: 'Actives' },
                  { id: 'guardrail_halted', label: 'Alertes' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === tab.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showAddForm ? 'Fermer' : 'Ajouter une officine'}
            </button>
          </div>
        </div>

        {/* Inline Add New Pharmacy Form */}
        {showAddForm && (
          <form
            onSubmit={handleCreatePharmacy}
            className="border-b border-slate-800 bg-slate-950/70 px-6 py-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom de la pharmacie
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Pharmacie Gamma"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Localité / Secteur</label>
                <input
                  type="text"
                  required
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="Ex: Dakar Plateau"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Pharmacien titulaire
                </label>
                <input
                  type="text"
                  required
                  value={newPharmacist}
                  onChange={(e) => setNewPharmacist(e.target.value)}
                  placeholder="Ex: Dr. Diallo"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Logiciel cible
                </label>
                <select
                  value={newSoftware}
                  onChange={(e) => setNewSoftware(e.target.value as TargetSoftwareType)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="ERP Officine Intégré">ERP Officine Intégré</option>
                  <option value="Tableur Excel Stock">Tableur Excel Stock</option>
                  <option value="Logiciel Comptoir Local">Logiciel Comptoir Local</option>
                  <option value="Progiciel Gestion Stock">Progiciel Gestion Stock</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Abonnement initial
                </label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value as SubscriptionPlanId)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="starter">Starter (~5 BL/j · 39 000 F)</option>
                  <option value="pro">Pro (~10 BL/j · 75 000 F)</option>
                  <option value="enterprise">Réseau (~15-20 BL/j · 135 000 F)</option>
                </select>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={creating}
                  className="h-9 w-full rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {creating ? 'Création...' : 'Créer & Générer Lien'}
                </button>
              </div>
            </div>
            {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
          </form>
        )}

        {createdNotice && (
          <div className="border-b border-emerald-800/70 bg-emerald-950/30 px-6 py-4 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-emerald-300">
                  Officine créée : {createdNotice.pharmacy.name} · Clé{' '}
                  <span className="font-mono">{createdNotice.pharmacy.agentKey}</span> · Forfait{' '}
                  {PLAN_LABELS[createdNotice.pharmacy.subscriptionPlan]}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-300">
                  Lien séparé à envoyer à cette officine :{' '}
                  <span className="font-mono text-emerald-400">
                    ?mode=officine&amp;key={createdNotice.pharmacy.agentKey}
                  </span>{' '}
                  · Transmettez ces identifiants provisoires à l’équipe :
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreatedNotice(null)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
              >
                Fermer
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px]">
              <div className="rounded border border-emerald-800/50 bg-slate-950 px-3 py-2">
                <span className="text-emerald-400 font-semibold">Titulaire :</span>{' '}
                <span className="font-mono text-slate-100">
                  {createdNotice.credentials.titulaire.loginId} / {createdNotice.credentials.titulaire.password}
                </span>
              </div>
              <div className="rounded border border-amber-800/50 bg-slate-950 px-3 py-2">
                <span className="text-amber-400 font-semibold">Adjoint :</span>{' '}
                <span className="font-mono text-slate-100">
                  {createdNotice.credentials.adjoint.loginId} / {createdNotice.credentials.adjoint.password}
                </span>
              </div>
              <div className="rounded border border-sky-800/50 bg-slate-950 px-3 py-2">
                <span className="text-sky-400 font-semibold">Assistant :</span>{' '}
                <span className="font-mono text-slate-100">
                  {createdNotice.credentials.assistant.loginId} / {createdNotice.credentials.assistant.password}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="px-6 py-3">Officine &amp; Titulaire</th>
                <th className="px-4 py-3">Logiciel &amp; Clé</th>
                <th className="px-4 py-3">Abonnement &amp; Quota</th>
                <th className="px-4 py-3">État</th>
                <th className="px-4 py-3 text-right">Docs</th>
                <th className="px-4 py-3 text-right">Coût FCFA</th>
                <th className="px-6 py-3 text-right">Liens &amp; Intervention à distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredPharmacies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">
                    Aucune officine ne correspond aux critères de recherche actuels.
                  </td>
                </tr>
              ) : (
                filteredPharmacies.map((ph) => {
                  const used = ph.monthlyQuotaUsed || 0;
                  const limit = Math.max(ph.monthlyQuotaLimit || 1, 1);
                  const pctUsed = Math.min(100, Math.round((used / limit) * 100));
                  const pctLeft = Math.max(0, 100 - pctUsed);
                  return (
                    <tr key={ph.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-3.5">
                        <div className="font-medium text-slate-100">{ph.name}</div>
                        <div className="text-xs text-slate-400">
                          {ph.pharmacist} · {ph.city}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <div className="font-mono text-slate-300">{ph.targetSoftware}</div>
                        <div className="font-mono font-semibold text-emerald-400">{ph.agentKey}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <button
                          type="button"
                          onClick={onOpenSubscriptions}
                          className="text-left hover:underline"
                        >
                          <div className="font-semibold text-slate-200">
                            {PLAN_LABELS[ph.subscriptionPlan || 'pro']} ·{' '}
                            {PLAN_DAILY_VOLUME[ph.subscriptionPlan || 'pro']}
                          </div>
                          <div
                            className={`font-mono text-[11px] tabular-nums ${
                              pctUsed >= 100
                                ? 'text-red-400'
                                : pctUsed >= 80
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {pctUsed} % utilisé · {pctLeft} % libre
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">{renderStatus(ph)}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-100 tabular-nums">
                        {ph.documentsProcessed}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-300 tabular-nums">
                        {ph.estimatedCostFCFA.toLocaleString('fr-FR')}
                      </td>
                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectPharmacyForWorkspace(ph.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
                            title="Prendre la main à distance sur cette officine"
                          >
                            <Wrench className="h-3.5 w-3.5" />
                            Intervenir à distance
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopySeparateLink(ph)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500 transition-colors"
                            title={`Copier le lien séparé : ?mode=officine&key=${ph.agentKey}`}
                          >
                            {copiedKey === ph.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                Copié
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5 text-sky-400" />
                                Lien séparé
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenIsolatedPortal(ph)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-300 transition-colors"
                            title="Ouvrir la vue Portail Isolé"
                          >
                            Ouvrir
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={`/api/pharmacies/${ph.id}/installer?token=${encodeURIComponent(ownerToken)}`}
                            download={`pharmagent_${ph.id}.py`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-medium text-slate-300 hover:border-emerald-500 transition-colors"
                            title={`Télécharger l’agent poste local (.py)`}
                          >
                            <Download className="h-3.5 w-3.5 text-emerald-400" />
                          </a>
                          <button
                            type="button"
                            onClick={() => onSelectPharmacyForGrounding(ph.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                          >
                            UI
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
