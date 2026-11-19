import { AlertCircle, Building2, CheckCircle2, Clock, TrendingUp, XCircle } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { AppTab } from '../App.tsx';
import type { DashboardSnapshot, OwnerAccount, Pharmacy } from '../types/pharmagent.ts';

interface Props {
  token: string;
  owner: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
  selectedPharmacyId: string;
  onSelectPharmacy: (id: string) => void;
  onChangeTab: (t: AppTab) => void;
}

const PLAN_COLORS: Record<string, string> = {
  trial: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  standard: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  premium: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  suspended: 'text-red-400 bg-red-400/10 border-red-400/30',
};

const PLAN_LABEL: Record<string, string> = {
  trial: 'Essai', standard: 'Standard', premium: 'Premium', suspended: 'Suspendu',
};

function StatCard({ label, value, icon, color = 'text-emerald-400' }: { label: string; value: number | string; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

export default function SupervisionDashboard({ snapshot, onRefresh, selectedPharmacyId, onSelectPharmacy, onChangeTab }: Props) {
  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        Chargement du tableau de bord…
      </div>
    );
  }

  const { pharmacies, stats, pendingDrafts, totalDraftsToday, totalApprovedMonth } = snapshot;
  const totalPending = pendingDrafts.length;
  const totalPharmacies = pharmacies.length;

  const pieData = [
    { name: 'Approuvés', value: totalApprovedMonth, color: '#10b981' },
    { name: 'En attente', value: totalPending, color: '#f59e0b' },
    { name: "Aujourd'hui", value: totalDraftsToday, color: '#6366f1' },
  ].filter((d) => d.value > 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Tableau de bord</h1>
          <p className="text-slate-400 text-sm mt-0.5">{totalPharmacies} officine{totalPharmacies > 1 ? 's' : ''} supervisée{totalPharmacies > 1 ? 's' : ''}</p>
        </div>
        <button onClick={onRefresh} className="text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20">
          ↻ Actualiser
        </button>
      </div>

      {/* Statistiques globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Officines" value={totalPharmacies} icon={<Building2 size={18} />} />
        <StatCard label="En attente" value={totalPending} icon={<Clock size={18} />} color="text-amber-400" />
        <StatCard label="Approuvés ce mois" value={totalApprovedMonth} icon={<CheckCircle2 size={18} />} color="text-emerald-400" />
        <StatCard label="Brouillons aujourd'hui" value={totalDraftsToday} icon={<TrendingUp size={18} />} color="text-indigo-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Officines */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-slate-300">Officines</h2>
          {pharmacies.length === 0 ? (
            <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-8 text-center">
              <Building2 size={32} className="text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">Aucune officine. Ajoutez-en une depuis l'onglet "Mes Officines".</p>
            </div>
          ) : (
            pharmacies.map((ph: Pharmacy) => {
              const stat = stats.find((s) => s.pharmacyId === ph.id);
              return (
                <div
                  key={ph.id}
                  onClick={() => { onSelectPharmacy(ph.id); onChangeTab('workspace'); }}
                  className={`bg-slate-900 border rounded-xl p-4 cursor-pointer transition-all hover:border-emerald-500/40
                    ${selectedPharmacyId === ph.id ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5' : 'border-slate-800'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm truncate">{ph.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${PLAN_COLORS[ph.subscription]}`}>
                          {PLAN_LABEL[ph.subscription]}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{ph.city} · {ph.targetSoftware}</div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                      {(stat?.pendingDrafts ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <AlertCircle size={12} />
                          {stat!.pendingDrafts} en attente
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Barre de quota */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Quota mensuel</span>
                      <span>{ph.usedThisMonth} / {ph.monthlyQuota}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (ph.usedThisMonth / ph.monthlyQuota) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Graphique + brouillons en attente */}
        <div className="space-y-4">
          {pieData.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Répartition brouillons</h2>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 justify-center">
                {pieData.map((d) => (
                  <span key={d.name} className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
                    {d.name} ({d.value})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Brouillons en attente */}
          {pendingDrafts.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-400" />
                Brouillons en attente ({pendingDrafts.length})
              </h2>
              <div className="space-y-2">
                {pendingDrafts.slice(0, 5).map((d) => {
                  const ph = pharmacies.find((p) => p.id === d.pharmacyId);
                  return (
                    <div
                      key={d.id}
                      onClick={() => { onSelectPharmacy(d.pharmacyId); onChangeTab('workspace'); }}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-800/60 cursor-pointer hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">{ph?.name ?? d.pharmacyId}</div>
                        <div className="text-xs text-slate-500">{d.documentCategory} · {d.extractedData.lineItems.length} lignes</div>
                      </div>
                      <span className="badge-pending text-xs px-2 py-0.5 rounded-full whitespace-nowrap">En attente</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Audit récent */}
      {snapshot.recentAudit.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Activité récente</h2>
            <button onClick={() => onChangeTab('audit')} className="text-xs text-emerald-400 hover:text-emerald-300">
              Tout voir →
            </button>
          </div>
          <div className="divide-y divide-slate-800">
            {snapshot.recentAudit.slice(0, 5).map((log) => (
              <div key={log.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  log.level === 'approved' ? 'bg-emerald-400' :
                  log.level === 'rejected' ? 'bg-red-400' :
                  log.level === 'blocked' ? 'bg-red-500' :
                  log.level === 'warning' ? 'bg-amber-400' : 'bg-slate-600'
                }`} />
                <span className="text-slate-400 flex-shrink-0">{log.pharmacyName}</span>
                <span className="text-slate-300 flex-1 truncate">{log.action}</span>
                <span className="text-slate-600 flex-shrink-0">{new Date(log.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
