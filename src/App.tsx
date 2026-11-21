import { useEffect, useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from './types/pharmagent.ts';
import AgentDeployment from './components/AgentDeployment.tsx';
import GuideCenter from './components/GuideCenter.tsx';
import Layout from './components/Layout.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import PharmacistWorkspace from './components/PharmacistWorkspace.tsx';
import AdminCenter from './components/AdminCenter.tsx';
import OrderPlanner from './components/OrderPlanner.tsx';
import PharmacyAccount from './components/PharmacyAccount.tsx';
import PharmacySpace, { type SpaceTab } from './components/PharmacySpace.tsx';
import PharmacyManagement from './components/PharmacyManagement.tsx';
import SupervisionDashboard from './components/SupervisionDashboard.tsx';

export type AppTab =
  | 'dashboard'
  | 'workspace'
  | 'pharmacies'
  | 'training'
  | 'grounding'
  | 'audit'
  | 'deployment'
  | 'account'
  | 'orders'
  | 'admin'
  | 'mutuelle'
  | 'autre'
  | 'guide';

export interface PharmacySession {
  user: { id: string; pharmacyId: string; fullName: string; profile: 'pharmacien' | 'equipe' };
  pharmacy: { id: string; name: string; city: string; code?: string };
  teamAccount: boolean;
}

export type SessionState =
  | { kind: 'owner'; token: string; owner: OwnerAccount }
  | ({ kind: 'pharmacy'; token: string } & PharmacySession);

// Superviseur : 4 entrées. On entre dans une officine depuis « Officines » (Bons · Commande · Agent · Fiche).
const OWNER_TABS: AppTab[] = ['dashboard', 'pharmacies', 'admin', 'guide'];

function tabsFor(s: SessionState): AppTab[] {
  if (s.kind === 'owner') return OWNER_TABS;
  // Pharmacie : Bons · Mutuelle · Commande · Autre (+ Agent pour le Pharmacien), Mon compte, Guide
  return s.user.profile === 'pharmacien'
    ? ['workspace', 'mutuelle', 'orders', 'autre', 'deployment', 'account', 'guide']
    : ['workspace', 'mutuelle', 'orders', 'autre', 'account', 'guide'];
}

const firstTab = (s: SessionState): AppTab => (s.kind === 'owner' ? 'dashboard' : 'workspace');

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<AppTab>('dashboard');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('');
  const [space, setSpace] = useState<{ id: string; tab: SpaceTab } | null>(null);
  const [loading, setLoading] = useState(false);

  // Restauration de session depuis le localStorage (vérifiée par le serveur)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pharmagent_session');
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<SessionState> & { token: string };
      const isPharmacy = parsed.kind === 'pharmacy';
      fetch(isPharmacy ? '/api/pharmacy/auth/me' : '/api/owner/auth/me', { headers: { Authorization: `Bearer ${parsed.token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (isPharmacy && data?.user) {
            const s: SessionState = { kind: 'pharmacy', token: parsed.token, user: data.user, pharmacy: data.pharmacy, teamAccount: !!data.teamAccount };
            setSession(s); setTab(firstTab(s));
          } else if (!isPharmacy && data?.owner) {
            setSession({ kind: 'owner', token: parsed.token, owner: data.owner });
          } else {
            localStorage.removeItem('pharmagent_session');
          }
        })
        .catch(() => localStorage.removeItem('pharmagent_session'));
    } catch { /* stockage indisponible */ }
  }, []);

  const fetchDashboard = async (s: SessionState, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(s.kind === 'owner' ? '/api/dashboard' : '/api/pharmacy/dashboard', { headers: { Authorization: `Bearer ${s.token}` } });
      if (r.ok) {
        const data = await r.json() as DashboardSnapshot;
        setSnapshot(data);
        if (data.pharmacies.length > 0) setSelectedPharmacyId((prev) => prev || data.pharmacies[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveSession = (s: SessionState) => {
    setSession(s);
    try { localStorage.setItem('pharmagent_session', JSON.stringify(s)); } catch { /* navigation privée */ }
  };

  const handleLogin = (s: SessionState) => {
    saveSession(s);
    setSelectedPharmacyId(s.kind === 'pharmacy' ? s.pharmacy.id : '');
    setTab(firstTab(s));
  };

  const handleLogout = () => {
    setSession(null);
    setSnapshot(null);
    setSelectedPharmacyId('');
    try { localStorage.removeItem('pharmagent_session'); } catch { /* navigation privée */ }
    setTab('dashboard');
  };

  useEffect(() => {
    if (!session) return;
    fetchDashboard(session);
    // Rafraîchit l'état des saisies (agent) sans recharger la page
    const t = setInterval(() => { if (document.visibilityState === 'visible') fetchDashboard(session, true); }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  if (window.location.pathname.replace(/\/+$/, '') === '/guide') {
    return <GuideCenter standalone />;
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const tabs = tabsFor(session);
  const current = tabs.includes(tab) ? tab : firstTab(session);
  const commonProps = {
    token: session.token,
    snapshot,
    onRefresh: () => fetchDashboard(session),
    selectedPharmacyId,
    onSelectPharmacy: setSelectedPharmacyId,
  };
  const userName = session.kind === 'owner' ? session.owner.fullName : session.user.fullName;
  const userRole = session.kind === 'owner'
    ? (session.owner.role === 'owner' ? 'Propriétaire' : 'Co-Superviseur')
    : `${session.user.profile === 'pharmacien' ? 'Pharmacien' : 'Équipe'} · ${session.pharmacy.name}`;

  return (
    <Layout
      tab={current}
      onTabChange={setTab}
      tabs={tabs}
      userName={userName}
      userRole={userRole}
      onLogout={handleLogout}
      pendingCount={snapshot?.pendingDrafts.length ?? 0}
      loading={loading}
    >
      {session.kind === 'owner' && current === 'dashboard' && (
        <SupervisionDashboard {...commonProps} owner={session.owner}
          onSelectPharmacy={(id) => { setSelectedPharmacyId(id); setSpace({ id, tab: 'bons' }); }}
          onChangeTab={(t) => setTab(t === 'workspace' ? 'pharmacies' : t === 'audit' ? 'admin' : t)} />
      )}
      {session.kind === 'owner' && current === 'pharmacies' && (space
        ? <PharmacySpace pharmacyId={space.id} tab={space.tab} onTab={(t) => setSpace({ ...space, tab: t })} onBack={() => setSpace(null)}
            token={session.token} snapshot={snapshot} onRefresh={commonProps.onRefresh} />
        : <PharmacyManagement {...commonProps} owner={session.owner} onOpen={(id) => { setSelectedPharmacyId(id); setSpace({ id, tab: 'bons' }); }} />)}
      {session.kind === 'owner' && current === 'admin' && <AdminCenter {...commonProps} owner={session.owner} />}
      {session.kind === 'pharmacy' && (current === 'workspace' || current === 'mutuelle' || current === 'autre') && (
        <PharmacistWorkspace key={current} {...commonProps} embedded canDelete={session.user.profile === 'pharmacien'}
          docMode={current === 'workspace' ? 'bon_livraison' : current === 'mutuelle' ? 'mutuelle' : 'autre'} />
      )}
      {session.kind === 'pharmacy' && current === 'orders' && (
        <OrderPlanner token={session.token} pharmacyId={session.pharmacy.id}
          canImport={session.user.profile === 'pharmacien'} />
      )}
      {session.kind === 'pharmacy' && current === 'deployment' && <AgentDeployment token={session.token} snapshot={snapshot} selectedPharmacyId={selectedPharmacyId} onSelectPharmacy={setSelectedPharmacyId} />}
      {session.kind === 'pharmacy' && current === 'account' && (
        <PharmacyAccount token={session.token} session={session} onTeamAccountCreated={() => saveSession({ ...session, teamAccount: true })} />
      )}
      {current === 'guide' && <GuideCenter />}
    </Layout>
  );
}
