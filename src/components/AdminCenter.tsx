// ============================================================
// PharmAgent — Administration (superviseur) : sauvegarde, mémoire, inspecteur d'écran, journal
// ============================================================

import { BookOpen, DatabaseBackup, Monitor, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from '../types/pharmagent.ts';
import AuditLog from './AuditLog.tsx';
import { BackupCard } from './PharmacyManagement.tsx';
import TrainingCenter from './TrainingCenter.tsx';
import UIGrounding from './UIGrounding.tsx';

type AdminTab = 'journal' | 'memoire' | 'inspecteur' | 'sauvegarde';
const TABS: Array<[AdminTab, string, React.ReactNode]> = [
  ['journal', 'Journal', <ShieldAlert key="j" size={15} />], ['memoire', 'Mémoire & catalogues', <BookOpen key="m" size={15} />],
  ['inspecteur', "Inspecteur d'écran", <Monitor key="i" size={15} />], ['sauvegarde', 'Sauvegarde', <DatabaseBackup key="s" size={15} />],
];

interface Props {
  token: string; owner: OwnerAccount; snapshot: DashboardSnapshot | null; onRefresh: () => void;
  selectedPharmacyId: string; onSelectPharmacy: (id: string) => void;
}

export default function AdminCenter(props: Props) {
  const [tab, setTab] = useState<AdminTab>('journal');
  return (
    <div>
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-bold text-white">Administration</h1>
        <div className="mt-3 flex gap-1 border-b border-slate-800 overflow-x-auto">
          {TABS.map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-emerald-400 text-white font-semibold' : 'border-transparent text-slate-400 hover:text-white'}`}>
              {icon}{label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'journal' && <AuditLog token={props.token} />}
      {tab === 'memoire' && <TrainingCenter {...props} />}
      {tab === 'inspecteur' && <UIGrounding token={props.token} />}
      {tab === 'sauvegarde' && <div className="p-4 sm:p-6 max-w-5xl mx-auto"><BackupCard token={props.token} /></div>}
    </div>
  );
}
