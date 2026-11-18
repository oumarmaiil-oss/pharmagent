import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  Camera,
  Code2,
  Download,
  FileSpreadsheet,
  Menu,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AgentStudio } from './components/AgentStudio';
import { AuditLogView } from './components/AuditLogView';
import { BrandLogo } from './components/BrandLogo';
import { FastApiCodeView } from './components/FastApiCodeView';
import { PharmacistWorkspace } from './components/PharmacistWorkspace';
import { SupervisionDashboard } from './components/SupervisionDashboard';
import { TrainingCenter } from './components/TrainingCenter';
import { DashboardSnapshot, OfficineRecord } from './types/pharmagent';

type ActiveTab = 'supervision' | 'pharmacist' | 'training' | 'grounding' | 'audit' | 'fastapi';

function getInitialPortalParams(): { mode: string | null; key: string | null } {
  if (typeof window === 'undefined') return { mode: null, key: null };
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('mode'),
    key: params.get('key'),
  };
}

export default function App() {
  const initialPortal = useMemo(() => getInitialPortalParams(), []);
  const [isolatedKey, setIsolatedKey] = useState<string | null>(
    initialPortal.mode === 'officine' && initialPortal.key ? initialPortal.key : null
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('supervision');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('dkr-centre');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) return;
      const data: DashboardSnapshot = await res.json();
      setSnapshot(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const isolatedPharmacy = useMemo(() => {
    if (!isolatedKey || !snapshot?.pharmacies) return null;
    return (
      snapshot.pharmacies.find(
        (p) => p.agentKey.toLowerCase() === isolatedKey.toLowerCase() || p.id === isolatedKey
      ) || null
    );
  }, [isolatedKey, snapshot]);

  const handleOpenIsolatedPortal = (pharmacy: OfficineRecord) => {
    setIsolatedKey(pharmacy.agentKey);
    setSelectedPharmacyId(pharmacy.id);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'officine');
      url.searchParams.set('key', pharmacy.agentKey);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleExitIsolatedPortal = () => {
    setIsolatedKey(null);
    setActiveTab('supervision');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleOpenPharmacistWorkspace = (pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
    setActiveTab('pharmacist');
    setMobileMenuOpen(false);
  };

  const handleOpenGroundingStudio = (pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
    setActiveTab('grounding');
    setMobileMenuOpen(false);
  };

  // Isolated Single-Pharmacy Portal View (Installed/Opened in each pharmacy)
  if (isolatedKey) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-6">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo className="h-7 w-7 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-100 truncate">
                <span>PharmAgent Officine</span>
                {isolatedPharmacy && (
                  <span className="font-normal text-emerald-400 truncate">
                    · {isolatedPharmacy.name}
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Portail Comptoir Isolé · Clé {isolatedPharmacy?.agentKey || isolatedKey}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isolatedPharmacy && (
              <a
                href={`/api/pharmacies/${isolatedPharmacy.id}/installer`}
                download={`pharmagent_${isolatedPharmacy.id}.py`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                Télécharger Agent PC (.py)
              </a>
            )}
            <button
              type="button"
              onClick={handleExitIsolatedPortal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Console Superviseur
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1320px] w-full mx-auto">
          {loading && !snapshot ? (
            <div className="h-64 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
          ) : !isolatedPharmacy ? (
            <div className="rounded-xl border border-red-800 bg-red-950/40 p-8 text-center">
              <p className="text-sm font-semibold text-red-300">
                Clé d’officine « {isolatedKey} » introuvable.
              </p>
              <button
                type="button"
                onClick={handleExitIsolatedPortal}
                className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                Revenir à la Console Superviseur
              </button>
            </div>
          ) : (
            <PharmacistWorkspace
              pharmacies={[isolatedPharmacy]}
              selectedPharmacyId={isolatedPharmacy.id}
              onChangePharmacyId={() => {}}
              drafts={snapshot?.drafts || []}
              stock={snapshot?.stock || []}
              taskQueue={snapshot?.taskQueue || []}
              onDataUpdated={fetchDashboard}
              lockedPharmacy
            />
          )}
        </main>
      </div>
    );
  }

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'supervision', label: 'Supervision Centrale', icon: Activity },
    { id: 'pharmacist', label: 'Poste Pharmacien', icon: Camera },
    { id: 'training', label: 'Entraînement & Mémoire', icon: FileSpreadsheet },
    { id: 'grounding', label: 'Inspecteur UI Grounding', icon: Bot },
    { id: 'audit', label: 'Journal Garde-Fou', icon: ShieldCheck },
    { id: 'fastapi', label: 'Backend FastAPI & PC', icon: Code2 },
  ];

  const breadcrumbLabels: Record<ActiveTab, string> = {
    supervision: 'Supervision Centrale Multi-Officines (SaaS)',
    pharmacist: 'Simulateur Poste Pharmacien — Caméra, Missions & Brouillons',
    training: 'Fichiers Excel d’Entraînement & Mémoire Logicielle',
    grounding: 'Inspecteur Visuel & Apprentissage UI Grounding',
    audit: 'Audit & Garde-Fou Brouillon',
    fastapi: 'Architecture Python FastAPI & Agent Desktop',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-800 bg-slate-900">
        <div className="flex h-16 items-center px-5 border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('supervision')}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            <BrandLogo className="h-7 w-7 shrink-0" />
            <span>PharmAgent</span>
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/70'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
          <div className="font-medium text-slate-200">Console Superviseur SaaS</div>
          <p className="mt-1 leading-relaxed text-slate-500">
            1 serveur central + 1 portail isolé et installeur .py par pharmacie. Arrêt strict au
            Brouillon.
          </p>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex w-64 flex-col bg-slate-900 border-r border-slate-800">
            <div className="flex h-16 items-center justify-between px-5 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-100">
                <BrandLogo className="h-7 w-7 shrink-0" />
                <span>PharmAgent</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-950/70 text-emerald-300'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-8 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="font-medium text-slate-400 hidden sm:inline">PharmAgent</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-100 truncate">
                {breadcrumbLabels[activeTab]}
              </h1>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() =>
                setActiveTab(activeTab === 'training' ? 'pharmacist' : 'training')
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
            >
              {activeTab === 'training' ? 'Ouvrir Poste Pharmacien' : 'Kit Excel & Mémoire'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">
          {activeTab === 'supervision' && (
            <SupervisionDashboard
              snapshot={snapshot}
              loading={loading}
              onSelectPharmacyForWorkspace={handleOpenPharmacistWorkspace}
              onOpenIsolatedPortal={handleOpenIsolatedPortal}
              onSelectPharmacyForGrounding={handleOpenGroundingStudio}
              onPharmacyCreated={fetchDashboard}
            />
          )}

          {activeTab === 'pharmacist' && (
            <PharmacistWorkspace
              pharmacies={snapshot?.pharmacies || []}
              selectedPharmacyId={selectedPharmacyId}
              onChangePharmacyId={setSelectedPharmacyId}
              drafts={snapshot?.drafts || []}
              stock={snapshot?.stock || []}
              taskQueue={snapshot?.taskQueue || []}
              onDataUpdated={fetchDashboard}
            />
          )}

          {activeTab === 'training' && snapshot?.learnedMemory && (
            <TrainingCenter
              memory={snapshot.learnedMemory}
              onMemoryUpdated={fetchDashboard}
              onGoToPharmacistTest={() => setActiveTab('pharmacist')}
            />
          )}

          {activeTab === 'grounding' && (
            <AgentStudio
              pharmacies={snapshot?.pharmacies || []}
              selectedPharmacyId={selectedPharmacyId}
              onChangePharmacyId={setSelectedPharmacyId}
              onRunCompleted={fetchDashboard}
            />
          )}

          {activeTab === 'audit' && (
            <AuditLogView logs={snapshot?.auditLogs || []} />
          )}

          {activeTab === 'fastapi' && <FastApiCodeView />}
        </main>
      </div>
    </div>
  );
}
