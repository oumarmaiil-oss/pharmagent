import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  Check,
  CheckCircle2,
  Coins,
  Layers,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import {
  OfficineRecord,
  QuotaRequestKind,
  QuotaTopUpRequest,
  SubscriptionPlanId,
  SubscriptionPlanSpec,
} from '../types/pharmagent';
import { PanelIllustration } from './Illustrations';

interface SubscriptionPlansPanelProps {
  pharmacies: OfficineRecord[];
  plans: SubscriptionPlanSpec[];
  quotaRequests?: QuotaTopUpRequest[];
  ownerToken: string;
  onUpdated: () => void;
  onIntervenePharmacy: (pharmacyId: string) => void;
}

const DEFAULT_PLANS: SubscriptionPlanSpec[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Petite Officine · ~5 BL / jour (Tarif provisoire)',
    monthlyPriceFCFA: 39000,
    monthlyQuotaLimit: 450000,
    estimatedDailyBL: '~5 BL / jour',
    estimatedMonthlyDocs: 150,
    maxUsers: 2,
    allowDesktopAgent: false,
    features: [
      'Capacité 100 % calibrée pour ~5 BL/jour (~150 docs/mois)',
      'Suivi en pourcentage (%) · tolérance réessais incluse',
      '2 comptes équipe (Titulaire + 1 collaborateur)',
      'Excel (.xlsx) & ERP Intégré sans installation + Audit PDF',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Officine Active · ~10 BL / jour (Recommandé)',
    monthlyPriceFCFA: 75000,
    monthlyQuotaLimit: 900000,
    estimatedDailyBL: '~10 BL / jour',
    estimatedMonthlyDocs: 300,
    maxUsers: 5,
    allowDesktopAgent: true,
    features: [
      'Capacité 100 % calibrée pour ~10 BL/jour (~300 docs/mois)',
      'Suivi en pourcentage (%) · packs recharge +25% / +50% à la demande',
      '5 comptes équipe (Titulaire, Adjoints, Assistants)',
      'Agent Local PC/Mac auto-démarré + UI Grounding + Intervention',
    ],
  },
  {
    id: 'enterprise',
    name: 'Réseau',
    tagline: 'Grande Officine · ~15 à 20 BL / jour',
    monthlyPriceFCFA: 135000,
    monthlyQuotaLimit: 1800000,
    estimatedDailyBL: '~15 à 20 BL / jour',
    estimatedMonthlyDocs: 600,
    maxUsers: 50,
    allowDesktopAgent: true,
    features: [
      'Capacité 100 % calibrée pour ~15–20 BL/jour (~600 docs/mois)',
      'Budget IA personnalisable + comptes illimités (50 postes)',
      'Supervision multi-officines + Sauvegarde JSON dédiée',
      'Intervention à distance & déblocage prioritaire',
    ],
  },
];

const REQUEST_KIND_LABELS: Record<QuotaRequestKind, string> = {
  topup_25: 'Recharge +25 % de capacité mensuelle',
  topup_50: 'Recharge +50 % de capacité mensuelle',
  upgrade_pro: 'Passage au forfait Pro (~10 BL/j)',
  upgrade_enterprise: 'Passage au forfait Réseau (~15-20 BL/j)',
};

export const SubscriptionPlansPanel: React.FC<SubscriptionPlansPanelProps> = ({
  pharmacies,
  plans,
  quotaRequests = [],
  ownerToken,
  onUpdated,
  onIntervenePharmacy,
}) => {
  const effectivePlans = plans.length > 0 ? plans : DEFAULT_PLANS;
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resolvingReqId, setResolvingReqId] = useState<string | null>(null);
  const [customLimits, setCustomLimits] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingRequests = quotaRequests.filter((r) => r.status === 'EN_ATTENTE');
  const recentResolved = quotaRequests.filter((r) => r.status !== 'EN_ATTENTE').slice(0, 5);

  const totalUsed = pharmacies.reduce((s, p) => s + (p.monthlyQuotaUsed || 0), 0);
  const totalLimit = pharmacies.reduce((s, p) => s + (p.monthlyQuotaLimit || 0), 0);
  const globalPct = Math.min(100, Math.round((totalUsed / Math.max(totalLimit, 1)) * 100));

  const patchSubscription = async (
    pharmacyId: string,
    payload: {
      subscriptionPlan?: SubscriptionPlanId;
      monthlyQuotaLimit?: number;
      subscriptionStatus?: 'active' | 'suspended';
      resetUsage?: boolean;
      addBonusPercent?: number;
    },
    successMsg: string
  ) => {
    setSavingId(pharmacyId);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/pharmacies/${pharmacyId}/subscription`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Échec de mise à jour du quota.');
      }
      setFeedback(successMsg);
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSavingId(null);
    }
  };

  const handleResolveRequest = async (reqItem: QuotaTopUpRequest, action: 'approve' | 'reject') => {
    setResolvingReqId(reqItem.id);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/quota-requests/${reqItem.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          action,
          resolutionNote:
            action === 'approve'
              ? 'Validé à distance par le Superviseur'
              : 'Refusé par le Superviseur',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Impossible de traiter cette demande.');
      }
      setFeedback(
        action === 'approve'
          ? `Demande approuvée pour ${reqItem.pharmacyName} (${REQUEST_KIND_LABELS[reqItem.requestedKind]}). Capacité débloquée immédiatement.`
          : `Demande refusée pour ${reqItem.pharmacyName}.`
      );
      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setResolvingReqId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Split Dark Illustrated Subscription Hero */}
      <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-8 p-6 sm:p-7 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Coins className="h-4 w-4 shrink-0" />
              <span>Capacité IA en Pourcentage (%) · Formules Provisoires &amp; Boucle de Recharge</span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              3 Formules Calibrées (~5, ~10, ~15–20 BL/jour) &amp; Jauge Équitable
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              Les officines suivent une <strong className="text-slate-100">jauge en %</strong>{' '}
              (style IA standardisée). Une tâche en erreur avant réponse IA consomme{' '}
              <strong className="text-emerald-300">0 %</strong>, et chaque enveloppe inclut ~15 %
              de marge pour les photos floues tout en protégeant votre budget réel côté serveur.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/80 px-4 py-3">
            <div>
              <div className="text-[11px] text-slate-400">Charge globale du parc ce mois</div>
              <div className="font-mono text-base font-semibold text-emerald-400 tabular-nums">
                {globalPct} % utilisé · {Math.max(0, 100 - globalPct)} % libre
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-400 tabular-nums">
              {totalUsed.toLocaleString('fr-FR')} / {totalLimit.toLocaleString('fr-FR')} unités IA
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] lg:block [mask-image:linear-gradient(to_left,black_30%,transparent)]">
          <PanelIllustration bare variant="subscription" label="Niveaux d'abonnements et capacité IA en pourcentage PharmAgent" />
        </div>
      </section>

      {/* Pending Closed-Loop Top-Up / Upgrade Requests */}
      {(pendingRequests.length > 0 || recentResolved.length > 0) && (
        <section
          className={`rounded-xl border p-5 space-y-4 ${
            pendingRequests.length > 0
              ? 'border-amber-700/70 bg-amber-950/20'
              : 'border-slate-800 bg-slate-900/95'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <BellRing
                className={`h-4 w-4 shrink-0 ${
                  pendingRequests.length > 0 ? 'text-amber-400' : 'text-slate-400'
                }`}
              />
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Boucle de Renouvellement · Demandes des Officines ({pendingRequests.length} en
                  attente)
                </h3>
                <p className="text-xs text-slate-400">
                  Lorsqu’une officine atteint 80 % ou 100 %, sa demande de recharge ou de changement
                  de forfait arrive ici pour validation en 1 clic
                </p>
              </div>
            </div>
          </div>

          {pendingRequests.length > 0 && (
            <div className="space-y-2.5">
              {pendingRequests.map((reqItem) => {
                const isResolving = resolvingReqId === reqItem.id;
                return (
                  <div
                    key={reqItem.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-800/60 bg-slate-950/90 px-4 py-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-100">{reqItem.pharmacyName}</span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-emerald-400">{reqItem.agentKey}</span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-amber-300 tabular-nums">
                          {reqItem.currentPercentUsed} % utilisé
                        </span>
                      </div>
                      <div className="text-xs font-medium text-amber-200">
                        {REQUEST_KIND_LABELS[reqItem.requestedKind]}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Demandé par {reqItem.requestedBy} ·{' '}
                        {new Date(reqItem.createdAt).toLocaleString('fr-FR')}
                        {reqItem.note && (
                          <span className="text-slate-300"> — « {reqItem.note} »</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => handleResolveRequest(reqItem, 'approve')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approuver &amp; Créditer
                      </button>
                      <button
                        type="button"
                        disabled={isResolving}
                        onClick={() => handleResolveRequest(reqItem, 'reject')}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-red-600 hover:text-red-300 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                        Refuser
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {recentResolved.length > 0 && (
            <div className="border-t border-slate-800/80 pt-3 space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400">
                Dernières demandes traitées
              </div>
              {recentResolved.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"
                >
                  <span>
                    <strong className="text-slate-200">{r.pharmacyName}</strong> ·{' '}
                    {REQUEST_KIND_LABELS[r.requestedKind]}
                  </span>
                  <span
                    className={
                      r.status === 'APPROUVEE'
                        ? 'font-semibold text-emerald-400'
                        : 'font-semibold text-red-400'
                    }
                  >
                    {r.status === 'APPROUVEE' ? 'Approuvée et créditée' : 'Refusée'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3 Subscription Tiers Comparison */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3 items-stretch">
        {effectivePlans.map((plan) => {
          const isPro = plan.id === 'pro';
          const subscribersCount = pharmacies.filter((p) => p.subscriptionPlan === plan.id).length;
          return (
            <div
              key={plan.id}
              className={`rounded-xl border p-6 flex flex-col justify-between bg-slate-900/95 ${
                isPro ? 'border-emerald-600/80' : 'border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Layers className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span>{plan.tagline}</span>
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-100">{plan.name}</h3>
                  </div>
                  <span className="font-mono text-xs text-slate-400 tabular-nums shrink-0">
                    {subscribersCount} officine(s)
                  </span>
                </div>

                <div className="border-y border-slate-800/90 py-3.5 flex items-baseline justify-between gap-2">
                  <div>
                    <span className="font-mono text-2xl font-bold text-slate-100 tabular-nums">
                      {plan.monthlyPriceFCFA.toLocaleString('fr-FR')}
                    </span>
                    <span className="ml-1.5 text-xs text-slate-400">FCFA / mois</span>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-mono font-semibold text-emerald-400 tabular-nums">
                      {plan.estimatedDailyBL}
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      ~{plan.estimatedMonthlyDocs} docs ·{' '}
                      {plan.maxUsers >= 50 ? 'Comptes illimités' : `${plan.maxUsers} comptes`}
                    </div>
                  </div>
                </div>

                <ul className="space-y-2.5 text-xs text-slate-300">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  Agent Local PC/Mac :{' '}
                  <strong className={plan.allowDesktopAgent ? 'text-emerald-400' : 'text-slate-400'}>
                    {plan.allowDesktopAgent ? 'Inclus' : 'Navigateur uniquement'}
                  </strong>
                </span>
                <span className="font-mono text-slate-500 tabular-nums">
                  Budget {(plan.monthlyQuotaLimit / 1000).toFixed(0)}k u.IA
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {feedback && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/60 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/60 px-4 py-2.5 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Real Quota Allocation Table per Pharmacy */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/95 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-emerald-400" />
              Pilotage des Jauges (%) &amp; Budgets Réels par Officine
            </h3>
            <p className="text-xs text-slate-400">
              Changez de forfait, ajoutez une recharge (+25 % / +50 %), ajustez le budget IA ou
              suspendez l’accès à distance
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span>0 % facturé sur appel IA échoué</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-medium">
                <th className="px-6 py-3">Officine &amp; Clé</th>
                <th className="px-4 py-3">Abonnement</th>
                <th className="px-4 py-3">Jauge Capacité (%)</th>
                <th className="px-4 py-3">Budget IA interne</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-6 py-3 text-right">Recharges &amp; Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {pharmacies.map((ph) => {
                const used = ph.monthlyQuotaUsed || 0;
                const limit = Math.max(ph.monthlyQuotaLimit || 1, 1);
                const pctUsed = Math.min(100, Math.round((used / limit) * 100));
                const pctLeft = Math.max(0, 100 - pctUsed);
                const isSuspended = ph.subscriptionStatus === 'suspended';
                const barColor =
                  isSuspended || pctUsed >= 100
                    ? 'bg-red-500'
                    : pctUsed >= 80
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';
                const draftLimitVal = customLimits[ph.id] ?? String(ph.monthlyQuotaLimit);
                const isSaving = savingId === ph.id;

                return (
                  <tr key={ph.id} className="hover:bg-slate-800/35">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-100">{ph.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {ph.city} · <span className="font-mono text-emerald-400">{ph.agentKey}</span>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <select
                        value={ph.subscriptionPlan}
                        disabled={isSaving}
                        onChange={(e) => {
                          const planId = e.target.value as SubscriptionPlanId;
                          const matched = effectivePlans.find((p) => p.id === planId);
                          patchSubscription(
                            ph.id,
                            { subscriptionPlan: planId },
                            `Forfait ${matched?.name || planId} (${matched?.estimatedDailyBL || ''}) appliqué à ${ph.name}.`
                          );
                        }}
                        className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs font-medium text-slate-100 focus:border-emerald-500 focus:outline-none"
                      >
                        {effectivePlans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.estimatedDailyBL} · {p.monthlyPriceFCFA.toLocaleString('fr-FR')} F)
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-4 min-w-[220px]">
                      <div className="flex items-center justify-between font-mono text-[11px] mb-1.5 tabular-nums">
                        <span
                          className={
                            pctUsed >= 100
                              ? 'text-red-400 font-semibold'
                              : pctUsed >= 80
                              ? 'text-amber-400 font-semibold'
                              : 'text-emerald-400 font-semibold'
                          }
                        >
                          {pctUsed} % utilisé
                        </span>
                        <span className="text-slate-400">{pctLeft} % libre</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${pctUsed}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-slate-500 tabular-nums">
                        {(used / 1000).toFixed(1)}k / {(limit / 1000).toFixed(0)}k u.IA ·{' '}
                        {ph.estimatedCostFCFA.toLocaleString('fr-FR')} FCFA réel
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step={50000}
                          value={draftLimitVal}
                          onChange={(e) =>
                            setCustomLimits((prev) => ({ ...prev, [ph.id]: e.target.value }))
                          }
                          className="h-8 w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => {
                            const parsed = Number(draftLimitVal);
                            if (!Number.isFinite(parsed) || parsed < 0) return;
                            patchSubscription(
                              ph.id,
                              { monthlyQuotaLimit: parsed },
                              `Budget interne de ${ph.name} ajusté à ${parsed.toLocaleString('fr-FR')} unités IA.`
                            );
                          }}
                          className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500 whitespace-nowrap shrink-0"
                        >
                          Appliquer
                        </button>
                      </div>
                    </td>

                    <td className="px-4 py-4 whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          isSuspended ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {isSuspended ? 'Suspendue' : 'Active'}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            patchSubscription(
                              ph.id,
                              { addBonusPercent: 25 },
                              `Recharge +25 % créditée pour ${ph.name}.`
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:border-emerald-500 whitespace-nowrap shrink-0"
                          title="Ajouter +25 % de la capacité mensuelle du forfait"
                        >
                          +25 %
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            patchSubscription(
                              ph.id,
                              { addBonusPercent: 50 },
                              `Recharge +50 % créditée pour ${ph.name}.`
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:border-sky-500 whitespace-nowrap shrink-0"
                          title="Ajouter +50 % de la capacité mensuelle du forfait"
                        >
                          +50 %
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            patchSubscription(
                              ph.id,
                              { resetUsage: true },
                              `Jauge mensuelle remise à 0 % pour ${ph.name}.`
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-sky-500 whitespace-nowrap shrink-0"
                          title="Réinitialiser la jauge mensuelle à 0 %"
                        >
                          <RefreshCw className="h-3 w-3" />
                          RAZ 0%
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() =>
                            patchSubscription(
                              ph.id,
                              { subscriptionStatus: isSuspended ? 'active' : 'suspended' },
                              isSuspended
                                ? `Officine ${ph.name} réactivée à distance.`
                                : `Officine ${ph.name} suspendue à distance.`
                            )
                          }
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                            isSuspended
                              ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60'
                              : 'border-red-800/70 bg-red-950/40 text-red-300 hover:bg-red-950/80'
                          }`}
                        >
                          {isSuspended ? (
                            <>
                              <PlayCircle className="h-3 w-3" />
                              Réactiver
                            </>
                          ) : (
                            <>
                              <PauseCircle className="h-3 w-3" />
                              Suspendre
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onIntervenePharmacy(ph.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                        >
                          Intervenir
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
