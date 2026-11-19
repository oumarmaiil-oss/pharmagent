import React, { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { OfficineRecord } from '../types/pharmagent';

interface SupervisionAnalyticsChartProps {
  pharmacies: OfficineRecord[];
}

interface ChartDataPoint {
  label: string;
  fullName?: string;
  factures: number;
  erreurs: number;
}

const DAY_LABELS = ['J-6', 'J-5', 'J-4', 'J-3', 'J-2', 'Hier', "Aujourd'hui"];

export const SupervisionAnalyticsChart: React.FC<SupervisionAnalyticsChartProps> = ({
  pharmacies,
}) => {
  const [viewMode, setViewMode] = useState<'timeline' | 'by_pharmacy'>('timeline');
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('all');

  const activePharmacies = useMemo(() => {
    if (selectedPharmacyId === 'all') return pharmacies;
    return pharmacies.filter((p) => p.id === selectedPharmacyId);
  }, [pharmacies, selectedPharmacyId]);

  const timelineData = useMemo<ChartDataPoint[]>(() => {
    return DAY_LABELS.map((day, idx) => {
      const factures = activePharmacies.reduce(
        (sum, ph) =>
          sum + (ph.dailyInvoices?.[idx] ?? Math.round((ph.dailyVolume[idx] || 0) * 0.25)),
        0
      );
      const erreurs = activePharmacies.reduce(
        (sum, ph) => sum + (ph.dailyErrors?.[idx] ?? 0),
        0
      );
      return {
        label: day,
        factures,
        erreurs,
      };
    });
  }, [activePharmacies]);

  const byPharmacyData = useMemo<ChartDataPoint[]>(() => {
    return pharmacies.map((ph) => {
      const factures = (ph.dailyInvoices || ph.dailyVolume.map((v) => Math.round(v * 0.25))).reduce(
        (s, n) => s + n,
        0
      );
      const erreurs = (ph.dailyErrors || [0, 0, 0, 0, 0, 0, 0]).reduce((s, n) => s + n, 0);
      const shortName =
        ph.name.replace(/^Pharmacie\s+/i, '').replace(/^Officine\s+/i, '') || ph.name;
      return {
        label: shortName,
        fullName: `${ph.name} (${ph.city})`,
        factures,
        erreurs,
      };
    });
  }, [pharmacies]);

  const chartData: ChartDataPoint[] = viewMode === 'timeline' ? timelineData : byPharmacyData;

  const totals = useMemo(() => {
    const totalInvoices = chartData.reduce((s, row) => s + row.factures, 0);
    const totalErrors = chartData.reduce((s, row) => s + row.erreurs, 0);
    const errorRate =
      totalInvoices > 0 ? ((totalErrors / totalInvoices) * 100).toFixed(1) : '0.0';
    return { totalInvoices, totalErrors, errorRate };
  }, [chartData]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2 flex flex-col justify-between">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Factures traitées et erreurs de saisie (7 derniers jours)
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span className="text-emerald-400 font-semibold">
                {totals.totalInvoices} factures
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400 font-semibold">
                {totals.totalErrors} erreurs / blocages
              </span>
              <span aria-hidden="true">·</span>
              <span>Taux d’incident : {totals.errorRate}%</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewMode === 'timeline' && (
              <select
                aria-label="Filtrer par officine"
                value={selectedPharmacyId}
                onChange={(e) => setSelectedPharmacyId(e.target.value)}
                className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">Toutes les officines ({pharmacies.length})</option>
                {pharmacies.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name} — {ph.city}
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('timeline')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'timeline'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Évolution 7j
              </button>
              <button
                type="button"
                onClick={() => setViewMode('by_pharmacy')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'by_pharmacy'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Par officine
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="invoices"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="errors"
                orientation="right"
                stroke="#f59e0b"
                tick={{ fill: '#fbbf24', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(30, 41, 59, 0.45)' }}
                contentStyle={{
                  backgroundColor: '#020617',
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                  color: '#f1f5f9',
                }}
                labelFormatter={(_label, payload) => {
                  const row = payload?.[0]?.payload as { fullName?: string; label?: string } | undefined;
                  return row?.fullName || row?.label || '';
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                iconType="circle"
              />
              <Bar
                yAxisId="invoices"
                dataKey="factures"
                name="Factures traitées"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              />
              <Line
                yAxisId="errors"
                type="monotone"
                dataKey="erreurs"
                name="Erreurs de saisie / blocages"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#f59e0b', stroke: '#020617', strokeWidth: 1.5 }}
                activeDot={{ r: 6, fill: '#fbbf24' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
