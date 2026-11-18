import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  DashboardSnapshot,
  OfficineRecord,
  TargetSoftwareType,
} from '../types/pharmagent';

interface SupervisionDashboardProps {
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  onSelectPharmacyForWorkspace: (pharmacyId: string) => void;
  onOpenIsolatedPortal: (pharmacy: OfficineRecord) => void;
  onSelectPharmacyForGrounding: (pharmacyId: string) => void;
  onPharmacyCreated: () => void;
}

export const SupervisionDashboard: React.FC<SupervisionDashboardProps> = ({
  snapshot,
  loading,
  onSelectPharmacyForWorkspace,
  onOpenIsolatedPortal,
  onSelectPharmacyForGrounding,
  onPharmacyCreated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'idle' | 'guardrail_halted'>('all');
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPharmacist, setNewPharmacist] = useState('');
  const [newSoftware, setNewSoftware] = useState<TargetSoftwareType>('ERP Officine Intégré');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  const handleCreatePharmacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          city: newCity,
          region: newCity,
          pharmacist: newPharmacist,
          targetSoftware: newSoftware,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur création officine.');
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

  const { summary, dailyTrend } = snapshot;
  const maxDocs = Math.max(...dailyTrend.map((d) => d.documents), 1);

  const renderStatus = (status: OfficineRecord['status']) => {
    if (status === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          Actif
        </span>
      );
    }
    if (status === 'guardrail_halted') {
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
      {/* KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
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
          <p className="mt-1 text-xs text-slate-500">
            {summary.pendingDraftsCount} brouillon(s) en attente de validation
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
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
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.totalDraftsCreated.toLocaleString('fr-FR')} brouillons générés
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Consommation Gemini Vision</span>
            <span className="font-mono text-xs text-slate-500">Tokens</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-slate-100 tabular-nums">
              {(summary.totalTokensUsed / 1000).toFixed(1)} k
            </span>
            <span className="text-xs text-slate-400 tabular-nums">
              {summary.totalCostFCFA.toLocaleString('fr-FR')} FCFA
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Comptabilisation réelle par appel API</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
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
          <p className="mt-1 text-xs text-slate-500">100 % des agents arrêtés au stade Brouillon</p>
        </div>
      </section>

      {/* Volume & Consumption Chart + Breakdown */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Volume documentaire et consommation IA (7 derniers jours)
              </h2>
              <p className="text-xs text-slate-400">
                Documents analysés par les agents visuels sur l’ensemble du réseau d’officines
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                Documents (Brouillons)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-700" />
                Tokens Vision (k)
              </span>
            </div>
          </div>

          <div className="mt-6">
            <div className="grid grid-cols-7 gap-3 items-end h-48 pt-6 border-b border-slate-800 pb-2">
              {dailyTrend.map((point, idx) => {
                const heightPct = Math.max(12, Math.round((point.documents / maxDocs) * 100));
                const isHovered = hoveredDayIndex === idx;
                return (
                  <div
                    key={point.day}
                    onMouseEnter={() => setHoveredDayIndex(idx)}
                    onMouseLeave={() => setHoveredDayIndex(null)}
                    className="relative flex h-full flex-col items-center justify-end gap-2 cursor-default"
                  >
                    {isHovered && (
                      <div className="absolute -top-2 z-10 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 shadow-sm tabular-nums">
                        {point.documents} docs · {point.tokensK}k tokens
                      </div>
                    )}
                    <span className="text-xs font-medium text-slate-300 tabular-nums">
                      {point.documents}
                    </span>
                    <div className="flex w-full max-w-[44px] items-end justify-center gap-1 h-32">
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-6 rounded-t transition-colors ${
                          isHovered ? 'bg-emerald-400' : 'bg-emerald-600'
                        }`}
                      />
                      <div
                        style={{ height: `${Math.max(10, Math.round(heightPct * 0.85))}%` }}
                        className="w-2.5 rounded-t bg-slate-700"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-3 text-center">
              {dailyTrend.map((point) => (
                <span key={point.day} className="text-xs text-slate-400">
                  {point.day}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 flex flex-col justify-between">
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
              ).map(
                (soft) => {
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
                }
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-4 text-xs text-slate-400">
            <p className="font-medium text-slate-200">Règle de supervision active</p>
            <p className="mt-1 leading-relaxed">
              Chaque pharmacie dispose d’une clé d’appairage unique pour connecter son poste local ou
              son outil mobile terrain.
            </p>
          </div>
        </div>
      </section>

      {/* Multi-Pharmacy Supervision Table */}
      <section className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Parc d’officines et clés d’appairage
            </h2>
            <p className="text-xs text-slate-400">
              Ajoutez une nouvelle officine ou ouvrez directement son Poste Pharmacien
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher Dakar, Tamba, Clé..."
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom de la pharmacie
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Pharmacie Soleil"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Ville</label>
                <input
                  type="text"
                  required
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="Ex: Kaolack"
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
                  placeholder="Ex: Dr. Oumar Diallo"
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
                <button
                  type="submit"
                  disabled={creating}
                  className="h-9 w-full rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {creating ? 'Création...' : 'Créer & Générer Clé'}
                </button>
              </div>
            </div>
            {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-xs font-medium text-slate-400">
                <th className="px-6 py-3">Officine &amp; Titulaire</th>
                <th className="px-4 py-3">Ville</th>
                <th className="px-4 py-3">Logiciel cible</th>
                <th className="px-4 py-3">Clé Agent</th>
                <th className="px-4 py-3">État</th>
                <th className="px-4 py-3 text-right">Docs</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3 text-right">Coût FCFA</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredPharmacies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-sm text-slate-500">
                    Aucune officine ne correspond aux critères de recherche actuels.
                  </td>
                </tr>
              ) : (
                filteredPharmacies.map((ph) => (
                  <tr key={ph.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-100">{ph.name}</div>
                      <div className="text-xs text-slate-400">{ph.pharmacist}</div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-300 whitespace-nowrap">
                      {ph.city}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono text-slate-300 whitespace-nowrap">
                      {ph.targetSoftware}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono font-semibold text-emerald-400 whitespace-nowrap">
                      {ph.agentKey}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{renderStatus(ph.status)}</td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-100 tabular-nums">
                      {ph.documentsProcessed}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {(ph.tokensUsed / 1000).toFixed(1)} k
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {ph.estimatedCostFCFA.toLocaleString('fr-FR')}
                    </td>
                    <td className="px-6 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenIsolatedPortal(ph)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-950/80 border border-emerald-700/70 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/70 transition-colors"
                          title={`Ouvrir le portail isolé de ${ph.name} (?mode=officine&key=${ph.agentKey})`}
                        >
                          Portail Officine
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={`/api/pharmacies/${ph.id}/installer`}
                          download={`pharmagent_${ph.id}.py`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-300 transition-colors"
                          title={`Télécharger l’installeur Python pré-configuré pour ${ph.name}`}
                        >
                          <Download className="h-3.5 w-3.5 text-emerald-400" />
                          Agent PC (.py)
                        </a>
                        <button
                          type="button"
                          onClick={() => onSelectPharmacyForGrounding(ph.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors"
                        >
                          UI Grounding
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectPharmacyForWorkspace(ph.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
                          title="Tester depuis la vue Poste Pharmacien"
                        >
                          Tester
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
