import React, { lazy, useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Code2,
  Coins,
  Download,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { BrandLogo } from './components/BrandLogo';
import { LegalContactFooter } from './components/LegalContactFooter';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OwnerLoginScreen } from './components/OwnerLoginScreen';
import { PWAInstallButton } from './components/PWAInstallButton';
import {
  AuditLogEntry,
  DashboardSnapshot,
  DraftRecord,
  OfficineRecord,
  OwnerAccount,
  OwnerAuthSession,
  PharmacyAuthSession,
  QueuedDesktopTask,
  QuotaTopUpRequest,
  StockItemRecord,
} from './types/pharmagent';

type ActiveTab =
  | 'supervision'
  | 'subscriptions'
  | 'remote_intervention'
  | 'training'
  | 'grounding'
  | 'audit'
  | 'team'
  | 'fastapi';

interface PortalDataPayload {
  pharmacy: OfficineRecord;
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  auditLogs: AuditLogEntry[];
  quotaRequests?: QuotaTopUpRequest[];
}

function getInitialPortalParams(): { mode: string | null; key: string | null } {
  if (typeof window === 'undefined') return { mode: null, key: null };
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get('mode'),
    key: params.get('key'),
  };
}

const AgentStudio = lazy(() => import('./components/AgentStudio').then((m) => ({ default: m.AgentStudio })));
const AuditLogView = lazy(() => import('./components/AuditLogView').then((m) => ({ default: m.AuditLogView })));
const FastApiCodeView = lazy(() => import('./components/FastApiCodeView').then((m) => ({ default: m.FastApiCodeView })));
const PharmacistWorkspace = lazy(() => import('./components/PharmacistWorkspace').then((m) => ({ default: m.PharmacistWorkspace })));
const SubscriptionPlansPanel = lazy(() => import('./components/SubscriptionPlansPanel').then((m) => ({ default: m.SubscriptionPlansPanel })));
const SupervisionDashboard = lazy(() => import('./components/SupervisionDashboard').then((m) => ({ default: m.SupervisionDashboard })));
const SupervisorTeamPanel = lazy(() => import('./components/SupervisorTeamPanel').then((m) => ({ default: m.SupervisorTeamPanel })));
const TrainingCenter = lazy(() => import('./components/TrainingCenter').then((m) => ({ default: m.TrainingCenter })));

export default function App() {
  const initialPortal = getInitialPortalParams();
  const [isolatedKey, setIsolatedKey] = useState<string | null>(
    initialPortal.mode === 'officine' && initialPortal.key ? initialPortal.key : null
  );

  // Owner Authentication State
  const [ownerSession, setOwnerSession] = useState<OwnerAuthSession | null>(null);
  const [ownerAuthChecking, setOwnerAuthChecking] = useState(true);
  const [showOwnerAccountModal, setShowOwnerAccountModal] = useState(false);
  const [ownerLoginInput, setOwnerLoginInput] = useState('');
  const [ownerFullNameInput, setOwnerFullNameInput] = useState('');
  const [ownerCurrentPwd, setOwnerCurrentPwd] = useState('');
  const [ownerNewPwd, setOwnerNewPwd] = useState('');
  const [ownerConfirmPwd, setOwnerConfirmPwd] = useState('');
  const [ownerAccountSaving, setOwnerAccountSaving] = useState(false);
  const [ownerAccountError, setOwnerAccountError] = useState<string | null>(null);
  const [ownerAccountSuccess, setOwnerAccountSuccess] = useState<string | null>(null);

  // Main SaaS Dashboard State (Owner only)
  const [activeTab, setActiveTab] = useState<ActiveTab>('supervision');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('officine-alpha');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Isolated Pharmacy Portal State
  const [isolatedPharmacy, setIsolatedPharmacy] = useState<OfficineRecord | null>(null);
  const [portalResolveLoading, setPortalResolveLoading] = useState(false);
  const [portalResolveError, setPortalResolveError] = useState<string | null>(null);
  const [portalAuthSession, setPortalAuthSession] = useState<PharmacyAuthSession | null>(null);
  const [portalData, setPortalData] = useState<PortalDataPayload | null>(null);

  // Verify saved Owner Session on mount
  useEffect(() => {
    let cancelled = false;
    const raw =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('pharmagent_owner_auth')
        : null;
    if (!raw) {
      setOwnerAuthChecking(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as OwnerAuthSession;
      fetch('/api/owner/auth/me', {
        headers: { Authorization: `Bearer ${parsed.token}` },
      })
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) {
            window.sessionStorage.removeItem('pharmagent_owner_auth');
            setOwnerSession(null);
            return;
          }
          const data = (await res.json()) as { owner: OwnerAccount };
          const verified: OwnerAuthSession = { token: parsed.token, owner: data.owner };
          window.sessionStorage.setItem('pharmagent_owner_auth', JSON.stringify(verified));
          setOwnerSession(verified);
        })
        .catch(() => {
          if (!cancelled) setOwnerSession(null);
        })
        .finally(() => {
          if (!cancelled) setOwnerAuthChecking(false);
        });
    } catch {
      window.sessionStorage.removeItem('pharmagent_owner_auth');
      setOwnerSession(null);
      setOwnerAuthChecking(false);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!ownerSession?.token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard', {
        headers: { Authorization: `Bearer ${ownerSession.token}` },
      });
      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('pharmagent_owner_auth');
        }
        setOwnerSession(null);
        setSnapshot(null);
        return;
      }
      if (!res.ok) return;
      const data: DashboardSnapshot = await res.json();
      setSnapshot(data);
      if (data.pharmacies?.length > 0) {
        setSelectedPharmacyId((prev) =>
          data.pharmacies.some((p) => p.id === prev) ? prev : data.pharmacies[0].id
        );
      }
    } finally {
      setLoading(false);
    }
  }, [ownerSession?.token]);

  useEffect(() => {
    if (ownerSession?.token && !isolatedKey) {
      fetchDashboard();
    }
  }, [ownerSession?.token, isolatedKey, fetchDashboard]);

  // Resolve Isolated Portal Pharmacy (public minimal lookup)
  useEffect(() => {
    if (!isolatedKey) {
      setIsolatedPharmacy(null);
      setPortalResolveError(null);
      setPortalData(null);
      return;
    }

    let cancelled = false;
    setPortalResolveLoading(true);
    setPortalResolveError(null);

    fetch(`/api/portal/resolve?key=${encodeURIComponent(isolatedKey)}`)
      .then(async (res) => {
        const payload = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setIsolatedPharmacy(null);
          setPortalResolveError(payload.error || `Clé d’officine « ${isolatedKey} » introuvable.`);
          return;
        }
        setIsolatedPharmacy(payload.pharmacy);
      })
      .catch(() => {
        if (!cancelled) {
          setIsolatedPharmacy(null);
          setPortalResolveError('Impossible de joindre le serveur PharmAgent.');
        }
      })
      .finally(() => {
        if (!cancelled) setPortalResolveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isolatedKey]);

  const fetchIsolatedPortalData = useCallback(async () => {
    if (!isolatedPharmacy?.id || !portalAuthSession?.token) {
      setPortalData(null);
      return;
    }
    try {
      const res = await fetch(`/api/pharmacies/${isolatedPharmacy.id}/portal-data`, {
        headers: { Authorization: `Bearer ${portalAuthSession.token}` },
      });
      if (!res.ok) return;
      const data: PortalDataPayload = await res.json();
      setPortalData(data);
      setIsolatedPharmacy(data.pharmacy);
    } catch {
      // Ignore transient refresh failure
    }
  }, [isolatedPharmacy?.id, portalAuthSession?.token]);

  useEffect(() => {
    if (isolatedKey && isolatedPharmacy?.id && portalAuthSession?.token) {
      fetchIsolatedPortalData();
    } else if (!portalAuthSession?.token) {
      setPortalData(null);
    }
  }, [isolatedKey, isolatedPharmacy?.id, portalAuthSession?.token, fetchIsolatedPortalData]);

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
    setPortalAuthSession(null);
    setPortalData(null);
    setActiveTab('supervision');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleOwnerLogout = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('pharmagent_owner_auth');
    }
    setOwnerSession(null);
    setSnapshot(null);
    setShowOwnerAccountModal(false);
  };

  const openOwnerAccountSettings = () => {
    if (!ownerSession) return;
    setOwnerLoginInput(ownerSession.owner.loginId);
    setOwnerFullNameInput(ownerSession.owner.fullName);
    setOwnerCurrentPwd('');
    setOwnerNewPwd('');
    setOwnerConfirmPwd('');
    setOwnerAccountError(null);
    setOwnerAccountSuccess(null);
    setShowOwnerAccountModal(true);
  };

  const handleSaveOwnerCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerSession) return;
    setOwnerAccountError(null);
    setOwnerAccountSuccess(null);

    if (ownerNewPwd.trim() && ownerNewPwd !== ownerConfirmPwd) {
      setOwnerAccountError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }

    setOwnerAccountSaving(true);
    try {
      const res = await fetch('/api/owner/auth/change-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerSession.token}`,
        },
        body: JSON.stringify({
          currentPassword: ownerCurrentPwd,
          newLoginId: ownerLoginInput.trim(),
          newFullName: ownerFullNameInput.trim(),
          newPassword: ownerNewPwd.trim() || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Modification impossible.');

      const nextSession: OwnerAuthSession = {
        token: payload.token || ownerSession.token,
        owner: payload.owner,
      };
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('pharmagent_owner_auth', JSON.stringify(nextSession));
      }
      setOwnerSession(nextSession);
      setOwnerCurrentPwd('');
      setOwnerNewPwd('');
      setOwnerConfirmPwd('');
      setOwnerAccountSuccess('Identifiants du Pharmacien propriétaire mis à jour.');
    } catch (err: unknown) {
      setOwnerAccountError(err instanceof Error ? err.message : 'Erreur mise à jour.');
    } finally {
      setOwnerAccountSaving(false);
    }
  };

  const handleOpenPharmacistWorkspace = (pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
    setActiveTab('remote_intervention');
    setMobileMenuOpen(false);
  };

  const handleOpenGroundingStudio = (pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
    setActiveTab('grounding');
    setMobileMenuOpen(false);
  };

  // Isolated Single-Pharmacy Portal View (?mode=officine&key=PA-...)
  if (isolatedKey) {
    const canDownloadInstaller = Boolean(
      portalAuthSession?.token && portalAuthSession.user.role === 'titulaire'
    );
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
                Portail Officine Isolé · Clé {isolatedPharmacy?.agentKey || isolatedKey}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            {isolatedPharmacy && canDownloadInstaller && portalAuthSession && (
              <a
                href={`/api/pharmacies/${isolatedPharmacy.id}/installer?token=${encodeURIComponent(
                  portalAuthSession.token
                )}`}
                download={`pharmagent_${isolatedPharmacy.id}.py`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                Agent Poste Local (.py)
              </a>
            )}
            {ownerSession && (
              <button
                type="button"
                onClick={handleExitIsolatedPortal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Retour Supervision
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1320px] w-full mx-auto">
          {portalResolveLoading && !isolatedPharmacy ? (
            <div className="h-64 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
          ) : !isolatedPharmacy ? (
            <div className="rounded-xl border border-red-800 bg-red-950/40 p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-red-300">
                {portalResolveError || `Clé d’officine « ${isolatedKey} » introuvable.`}
              </p>
              <p className="text-xs text-slate-400">
                Vérifiez le lien complet transmis par votre superviseur PharmAgent (+221 77 414 47 99).
              </p>
            </div>
          ) : (
            <PharmacistWorkspace
              pharmacies={[isolatedPharmacy]}
              selectedPharmacyId={isolatedPharmacy.id}
              onChangePharmacyId={() => {}}
              drafts={portalData?.drafts || []}
              stock={portalData?.stock || []}
              taskQueue={portalData?.taskQueue || []}
              auditLogs={portalData?.auditLogs || []}
              quotaRequests={portalData?.quotaRequests || []}
              onDataUpdated={fetchIsolatedPortalData}
              lockedPharmacy
              onPortalAuthChange={(session) => setPortalAuthSession(session)}
            />
          )}
        </main>
        <LegalContactFooter />
        <OfflineIndicator />
      </div>
    );
  }

  // Checking existing owner session
  if (ownerAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 text-center space-y-3">
          <BrandLogo className="h-8 w-8 mx-auto" />
          <p className="text-xs text-slate-400">Vérification de votre session PharmAgent...</p>
        </div>
      </div>
    );
  }

  // Gate main Console Superviseur behind Owner Login Screen
  if (!ownerSession) {
    return (
      <>
        <OwnerLoginScreen onOwnerAuthenticated={(session) => setOwnerSession(session)} />
        <OfflineIndicator />
      </>
    );
  }

  const pendingQuotaReqCount = snapshot?.summary.pendingQuotaRequestsCount || 0;
  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'supervision', label: 'Console Superviseur', icon: Activity },
    {
      id: 'subscriptions',
      label:
        pendingQuotaReqCount > 0
          ? `Abonnements & Quotas (${pendingQuotaReqCount})`
          : 'Abonnements & Quotas',
      icon: Coins,
    },
    { id: 'training', label: 'Entraînement & Mémoire', icon: FileSpreadsheet },
    { id: 'grounding', label: 'Inspecteur UI Grounding', icon: Bot },
    { id: 'audit', label: 'Journal & Garde-Fous', icon: ShieldCheck },
    { id: 'team', label: 'Équipe Supervision', icon: Users },
    { id: 'fastapi', label: 'Agent Local & Mobile', icon: Code2 },
  ];

  const breadcrumbLabels: Record<ActiveTab, string> = {
    supervision: 'Console Superviseur Multi-Officines (SaaS)',
    subscriptions: 'Abonnements (Starter · Pro · Réseau) & Quotas Réels',
    remote_intervention: 'Intervention Superviseur à Distance sur Officine',
    training: 'Modèles Excel d’Entraînement & Mémoire Persistante',
    grounding: 'Inspecteur Visuel & Apprentissage UI Grounding',
    audit: 'Journal d’Audit & Garde-Fou Brouillon',
    team: 'Équipe Supervision (2–3 accès cloisonnés)',
    fastapi: 'Centre de Déploiement, Mobile PWA / Store & Agent Local',
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

        <div className="border-t border-slate-800 p-4 text-xs text-slate-400 space-y-3">
          <div>
            <div className="font-semibold text-slate-100 truncate">{ownerSession.owner.fullName}</div>
            <div className="text-[11px] font-mono text-emerald-400 truncate">
              @{ownerSession.owner.loginId} · {ownerSession.owner.title}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openOwnerAccountSettings}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500"
            >
              <KeyRound className="h-3 w-3 text-emerald-400" />
              Mon compte
            </button>
            <button
              type="button"
              onClick={handleOwnerLogout}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-red-500/70 hover:text-red-300"
              title="Se déconnecter"
            >
              <LogOut className="h-3 w-3" />
            </button>
          </div>
          <div className="pt-2 border-t border-slate-800/70 text-[11px] text-emerald-400/90 font-medium">
            Licence Commerciale · Dr. Oumar (SN)
          </div>
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
            <div className="border-t border-slate-800 p-4 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openOwnerAccountSettings();
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200"
              >
                <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                Mon compte &amp; identifiants
              </button>
              <button
                type="button"
                onClick={handleOwnerLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-300"
              >
                <LogOut className="h-3.5 w-3.5" />
                Déconnexion
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-6">
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

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={openOwnerAccountSettings}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
              Mon accès Supervision
            </button>
            <button
              type="button"
              onClick={() =>
                setActiveTab(activeTab === 'subscriptions' ? 'supervision' : 'subscriptions')
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
            >
              {activeTab === 'subscriptions' ? 'Console Superviseur' : 'Quotas & Abonnements'}
            </button>
          </div>
        </header>

        {/* Provisional Owner Password Warning Banner */}
        {ownerSession.owner.mustChangePassword && (
          <div className="border-b border-amber-800/70 bg-amber-950/35 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <KeyRound className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Vous utilisez actuellement vos <strong>identifiants provisoires</strong> de Supervision
                PharmAgent. Pensez à définir votre mot de passe personnel.
              </span>
            </div>
            <button
              type="button"
              onClick={openOwnerAccountSettings}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500 whitespace-nowrap"
            >
              Modifier mes identifiants
            </button>
          </div>
        )}

        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">
          {activeTab === 'supervision' && (
            <SupervisionDashboard
              snapshot={snapshot}
              loading={loading}
              ownerToken={ownerSession.token}
              onSelectPharmacyForWorkspace={handleOpenPharmacistWorkspace}
              onOpenIsolatedPortal={handleOpenIsolatedPortal}
              onSelectPharmacyForGrounding={handleOpenGroundingStudio}
              onOpenSubscriptions={() => setActiveTab('subscriptions')}
              onPharmacyCreated={fetchDashboard}
            />
          )}

          {activeTab === 'subscriptions' && (
            <SubscriptionPlansPanel
              pharmacies={snapshot?.pharmacies || []}
              plans={snapshot?.subscriptionPlans || []}
              quotaRequests={snapshot?.quotaRequests || []}
              ownerToken={ownerSession.token}
              onUpdated={fetchDashboard}
              onIntervenePharmacy={handleOpenPharmacistWorkspace}
            />
          )}

          {activeTab === 'remote_intervention' && (
            <PharmacistWorkspace
              pharmacies={snapshot?.pharmacies || []}
              selectedPharmacyId={selectedPharmacyId}
              onChangePharmacyId={setSelectedPharmacyId}
              drafts={snapshot?.drafts || []}
              stock={snapshot?.stock || []}
              taskQueue={snapshot?.taskQueue || []}
              auditLogs={snapshot?.auditLogs || []}
              quotaRequests={snapshot?.quotaRequests || []}
              onDataUpdated={fetchDashboard}
              ownerSession={ownerSession}
              onExitRemoteIntervention={() => setActiveTab('supervision')}
            />
          )}

          {activeTab === 'training' && snapshot?.learnedMemory && (
            <TrainingCenter
              memory={snapshot.learnedMemory}
              ownerToken={ownerSession.token}
              onMemoryUpdated={fetchDashboard}
              onGoToPharmacistTest={() => handleOpenPharmacistWorkspace(selectedPharmacyId)}
            />
          )}

          {activeTab === 'grounding' && (
            <AgentStudio
              pharmacies={snapshot?.pharmacies || []}
              selectedPharmacyId={selectedPharmacyId}
              ownerToken={ownerSession.token}
              onChangePharmacyId={setSelectedPharmacyId}
              onRunCompleted={fetchDashboard}
            />
          )}

          {activeTab === 'audit' && (
            <AuditLogView
              logs={snapshot?.auditLogs || []}
              pharmacies={snapshot?.pharmacies || []}
              signatoryName={`${ownerSession.owner.fullName} (${
                ownerSession.owner.role === 'co_supervisor' ? 'Co-Superviseur' : 'Propriétaire'
              })`}
            />
          )}

          {activeTab === 'team' && (
            <SupervisorTeamPanel
              currentSupervisor={ownerSession.owner}
              ownerToken={ownerSession.token}
              onOpenMyCredentials={openOwnerAccountSettings}
            />
          )}

          {activeTab === 'fastapi' && (
            <FastApiCodeView
              ownerToken={ownerSession.token}
              pharmacies={snapshot?.pharmacies || []}
              selectedPharmacyId={selectedPharmacyId}
              onChangePharmacyId={setSelectedPharmacyId}
            />
          )}
        </main>
        <LegalContactFooter />
        <OfflineIndicator />
      </div>

      {/* Supervisor Own Credentials Management Modal */}
      {showOwnerAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <KeyRound className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Mon compte Supervision
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Modifie uniquement vos propres identifiants Supervision (aucune officine modifiée).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOwnerAccountModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOwnerCredentials} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Identifiant (ID)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={ownerLoginInput}
                  onChange={(e) => setOwnerLoginInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom complet affiché
                </label>
                <input
                  type="text"
                  required
                  value={ownerFullNameInput}
                  onChange={(e) => setOwnerFullNameInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mot de passe actuel
                </label>
                <input
                  type="password"
                  required
                  value={ownerCurrentPwd}
                  onChange={(e) => setOwnerCurrentPwd(e.target.value)}
                  placeholder="Mot de passe actuel"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nouveau mot de passe (min. 6 caractères)
                </label>
                <input
                  type="password"
                  required={ownerSession.owner.mustChangePassword}
                  minLength={6}
                  value={ownerNewPwd}
                  onChange={(e) => setOwnerNewPwd(e.target.value)}
                  placeholder="Laisser vide pour ne modifier que l’ID/nom"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirmer le nouveau mot de passe
                </label>
                <input
                  type="password"
                  required={Boolean(ownerNewPwd.trim()) || ownerSession.owner.mustChangePassword}
                  value={ownerConfirmPwd}
                  onChange={(e) => setOwnerConfirmPwd(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {ownerAccountError && (
                <div className="rounded-lg border border-red-800 bg-red-950/60 p-2.5 text-xs text-red-300">
                  {ownerAccountError}
                </div>
              )}
              {ownerAccountSuccess && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/50 p-2.5 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{ownerAccountSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOwnerAccountModal(false)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={ownerAccountSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {ownerAccountSaving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
