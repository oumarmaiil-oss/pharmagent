import type { SubscriptionPlanId, SubscriptionPlanSpec } from '../types/pharmagent.ts';

/**
 * Formules provisoires calibrées sur le volume réel des officines :
 * - Petite officine : ~5 BL/jour (~150 docs/mois)
 * - Officine active : ~10 BL/jour (~300 docs/mois)
 * - Grande officine / Réseau : ~15 à 20 BL/jour (~600 docs/mois)
 *
 * Chaque enveloppe est suivie en pourcentage (%) côté officine à partir d'un budget
 * d'unités IA réel incluant ~15 % de tolérance pour les réessais / photos floues.
 */
export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlanSpec> = {
  starter: {
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
  pro: {
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
  enterprise: {
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
};

export const SUBSCRIPTION_PLAN_LIST: SubscriptionPlanSpec[] = [
  SUBSCRIPTION_PLANS.starter,
  SUBSCRIPTION_PLANS.pro,
  SUBSCRIPTION_PLANS.enterprise,
];
