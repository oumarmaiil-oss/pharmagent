// ============================================================
// PharmAgent — Intérieur d'une officine (superviseur) : Bons · Commande · Agent · Fiche
// ============================================================

import { ArrowLeft, Building2, ClipboardList, Laptop, Settings2, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot } from '../types/pharmagent.ts';
import AgentDeployment from './AgentDeployment.tsx';
import CredentialsDialog, { type Credentials } from './CredentialsDialog.tsx';
import OrderPlanner from './OrderPlanner.tsx';
import PharmacistWorkspace from './PharmacistWorkspace.tsx';
import PharmacyAdmin from './PharmacyAdmin.tsx';

export type SpaceTab = 'bons' | 'commande' | 'agent' | 'fiche';

interface Props {
  pharmacyId: string;
  tab: SpaceTab;
  onTab: (t: SpaceTab) => void;
  onBack: () => void;
  token: string;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
}

const TABS: Array<[SpaceTab, string, React.ReactNode]> = [
  ['bons', 'Bons', <ClipboardList key="b" size={15} />], ['commande', 'Commande', <ShoppingCart key="c" size={15} />],
  ['agent', 'Agent', <Laptop key="a" size={15} />], ['fiche', 'Fiche', <Settings2 key="f" size={15} />],
];

export default function PharmacySpace({ pharmacyId, tab, onTab, onBack, token, snapshot, onRefresh }: Props) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const ph = snapshot?.pharmacies.find((p) => p.id === pharmacyId);
  if (!ph) {
    return <div className="p-6 text-sm text-slate-400">Officine introuvable. <button onClick={onBack} className="text-emerald-300 underline">Retour aux officines</button></div>;
  }
  const pending = snapshot?.pendingDrafts.filter((d) => d.pharmacyId === ph.id).length ?? 0;
  const online = !!ph.agent && Date.now() - Date.parse(ph.agent.lastSeen) < 70_000;
  const noop = () => undefined;
  return (
    <div className="space-y-0">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 max-w-6xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3"><ArrowLeft size={14} /> Toutes les officines</button>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center"><Building2 size={20} className="text-emerald-400" /></div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{ph.name}</h1>
            <p className="text-xs text-slate-400">{ph.city} · identifiant <span className="font-mono text-slate-300">{ph.code}</span> · agent {online ? <span className="text-emerald-300">en ligne</span> : ph.agent ? 'hors ligne' : 'non installé'}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-1 border-b border-slate-800 overflow-x-auto">
          {TABS.map(([id, label, icon]) => (
            <button key={id} onClick={() => onTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-emerald-400 text-white font-semibold' : 'border-transparent text-slate-400 hover:text-white'}`}>
              {icon}{label}{id === 'bons' && pending > 0 && <span className="ml-1 text-[10px] bg-amber-500/20 text-amber-300 px-1.5 rounded-full">{pending}</span>}
            </button>
          ))}
        </div>
      </div>
      {tab === 'bons' && <PharmacistWorkspace token={token} snapshot={snapshot} onRefresh={onRefresh} selectedPharmacyId={ph.id} onSelectPharmacy={noop} embedded />}
      {tab === 'commande' && <div className="p-4 sm:p-6 max-w-6xl mx-auto"><OrderPlanner token={token} pharmacyId={ph.id} canImport /></div>}
      {tab === 'agent' && <AgentDeployment token={token} snapshot={snapshot} selectedPharmacyId={ph.id} onSelectPharmacy={noop} embedded />}
      {tab === 'fiche' && (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <PharmacyAdmin key={ph.id} ph={ph} token={token} onChanged={onRefresh}
              onCredentials={(c) => setCredentials({ name: c.account === 'equipe' ? `${c.name} — compte Équipe` : c.name, code: c.code, password: c.password })} />
          </div>
        </div>
      )}
      {credentials && <CredentialsDialog c={credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}
