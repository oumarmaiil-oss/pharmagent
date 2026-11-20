import {
  Activity,
  BookOpen,
  CircleHelp,
  Building2,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Monitor,
  ShieldAlert,
  Stethoscope, ShoppingCart, Settings } from 'lucide-react';
import type { AppTab } from '../App.tsx';
import ServerStatus from './ServerStatus.tsx';

const LOGO = (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="8" fill="#059669" />
    <path d="M16 6v20M6 16h20" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);

interface NavItem { id: AppTab; label: string; icon: React.ReactNode; badge?: number }

interface Props {
  tab: AppTab;
  onTabChange: (t: AppTab) => void;
  tabs: AppTab[];
  userName: string;
  userRole: string;
  onLogout: () => void;
  pendingCount: number;
  loading: boolean;
  children: React.ReactNode;
}

export default function Layout({ tab, onTabChange, tabs, userName, userRole, onLogout, pendingCount, loading, children }: Props) {
  const allItems: NavItem[] = [
    { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard size={18} /> },
    { id: 'workspace', label: 'Poste Pharmacien', icon: <Stethoscope size={18} />, badge: pendingCount || undefined },
    { id: 'orders', label: 'Commande', icon: <ShoppingCart size={18} /> },
    { id: 'pharmacies', label: tabs.includes('admin') ? 'Officines' : 'Mes Officines', icon: <Building2 size={18} />, badge: tabs.includes('admin') ? pendingCount || undefined : undefined },
    { id: 'admin', label: 'Administration', icon: <Settings size={18} /> },
    { id: 'training', label: 'Mémoire & Entraînement', icon: <BookOpen size={18} /> },
    { id: 'grounding', label: 'Inspecteur UI', icon: <Monitor size={18} /> },
    { id: 'audit', label: 'Journal Garde-Fou', icon: <ShieldAlert size={18} /> },
    { id: 'deployment', label: 'Agent local', icon: <HardDrive size={18} /> },
    { id: 'account', label: 'Mon compte', icon: <KeyRound size={18} /> },
    { id: 'guide', label: 'Guide', icon: <CircleHelp size={18} /> },
  ];
  const navItems = allItems.filter((i) => tabs.includes(i.id));

  return (
    <div className="flex flex-col md:flex-row h-dvh overflow-hidden bg-slate-950">
      {/* En-tête mobile */}
      <header className="md:hidden flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-800 bg-slate-900">
        {LOGO}
        <span className="font-semibold text-sm text-white">PharmAgent</span>
        {loading && <Activity size={13} className="text-emerald-400 animate-pulse" />}
        <span className="ml-2"><ServerStatus /></span>
        <button onClick={onLogout} className="ml-auto text-slate-500 hover:text-red-400 p-1.5" title="Déconnexion">
          <LogOut size={16} />
        </button>
      </header>

      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-900 motif-molecule">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-800">
          {LOGO}
          <div>
            <div className="font-semibold text-sm text-white leading-tight">PharmAgent</div>
            <div className="text-xs text-emerald-400 leading-tight">Supervision v2</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative
                ${tab === item.id
                  ? 'bg-emerald-500/15 text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge ? (
                <span className="ml-auto bg-amber-500 text-black text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 px-3 py-3">
          <div className="px-2 pb-2"><ServerStatus /></div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 px-2 py-1 mb-2">
              <Activity size={12} className="animate-pulse" />
              <span>Chargement…</span>
            </div>
          )}
          <div className="flex items-center justify-between px-2 py-1.5">
            <div>
              <div className="text-xs font-medium text-white">{userName}</div>
              <div className="text-xs text-slate-500">{userRole}</div>
            </div>
            <button onClick={onLogout} className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10" title="Déconnexion">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="animate-in">
          {children}
        </div>
      </main>

      {/* Navigation mobile */}
      <nav className="md:hidden flex border-t border-slate-800 bg-slate-900 pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            title={item.label}
            className={`relative flex-1 flex justify-center py-3 ${tab === item.id ? 'text-emerald-400' : 'text-slate-500'}`}
          >
            {item.icon}
            {item.badge ? (
              <span className="absolute top-1.5 right-1/2 translate-x-4 bg-amber-500 text-black text-[10px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
