import { Filter, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuditLogEntry } from '../types/pharmagent.ts';

interface Props {
  token: string;
}

const LEVEL_META: Record<string, { label: string; dot: string; badge: string }> = {
  info: { label: 'Info', dot: 'bg-slate-500', badge: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  warning: { label: 'Alerte', dot: 'bg-amber-400', badge: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  blocked: { label: 'Bloqué', dot: 'bg-red-500', badge: 'text-red-400 bg-red-500/10 border-red-500/30' },
  approved: { label: 'Approuvé', dot: 'bg-emerald-400', badge: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  rejected: { label: 'Rejeté', dot: 'bg-orange-400', badge: 'text-orange-400 bg-orange-400/10 border-orange-400/30' },
};

export default function AuditLog({ token }: Props) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterPharmacy, setFilterPharmacy] = useState('all');
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/audit', { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json() as { logs: AuditLogEntry[] };
      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const pharmacies = Array.from(new Set(logs.map((l) => l.pharmacyName))).filter(Boolean);

  const filtered = logs.filter((l) => {
    if (filterLevel !== 'all' && l.level !== filterLevel) return false;
    if (filterPharmacy !== 'all' && l.pharmacyName !== filterPharmacy) return false;
    if (search && !l.action.toLowerCase().includes(search.toLowerCase()) && !l.pharmacyName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Journal d'Audit</h1>
          <p className="text-slate-400 text-sm">{logs.length} entrée{logs.length > 1 ? 's' : ''} · filtré : {filtered.length}</p>
        </div>
        <button onClick={fetchLogs} disabled={loading} className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <Filter size={15} className="text-slate-500 flex-shrink-0" />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="flex-1 min-w-36 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
        />

        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none"
        >
          <option value="all">Tous niveaux</option>
          {Object.entries(LEVEL_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select
          value={filterPharmacy}
          onChange={(e) => setFilterPharmacy(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none"
        >
          <option value="all">Toutes officines</option>
          {pharmacies.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="px-4 py-2.5 text-left font-medium">Horodatage</th>
                <th className="px-4 py-2.5 text-left font-medium">Niveau</th>
                <th className="px-4 py-2.5 text-left font-medium">Officine</th>
                <th className="px-4 py-2.5 text-left font-medium">Utilisateur</th>
                <th className="px-4 py-2.5 text-left font-medium">Action</th>
                <th className="px-4 py-2.5 text-left font-medium">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Chargement…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Aucune entrée correspondant aux filtres.</td>
                </tr>
              ) : (
                filtered.map((log) => {
                  const meta = LEVEL_META[log.level] ?? LEVEL_META.info;
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border w-fit ${meta.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 max-w-32 truncate">{log.pharmacyName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400 max-w-24 truncate">{log.actorName ?? 'système'}</td>
                      <td className="px-4 py-2.5 text-slate-200 max-w-48 truncate">{log.action}</td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details).slice(0, 80) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
