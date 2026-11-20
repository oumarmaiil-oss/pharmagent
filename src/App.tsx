import { useEffect, useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from './types/pharmagent.ts';
import AgentDeployment from './components/AgentDeployment.tsx';
import AuditLog from './components/AuditLog.tsx';
import GuideCenter from './components/GuideCenter.tsx';
import Layout from './components/Layout.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import PharmacistWorkspace from './components/PharmacistWorkspace.tsx';
import PharmacyAccount from './components/PharmacyAccount.tsx';
import PharmacyManagement from './components/PharmacyManagement.tsx';
import SupervisionDashboard from './components/SupervisionDashboard.tsx';
import TrainingCenter from './components/TrainingCenter.tsx';
import UIGrounding from './components/UIGrounding.tsx';

export type AppTab =
  | 'dashboard'
  | 'workspace'
  | 'pharmacies'
  | 'training'
  | 'grounding'
  | 'audit'
  | 'deployment'
  | 'account'
  | 'guide';

export interface PharmacySession {
  user: { id: string; pharmacyId: string; fullName: string; profile: 'pharmacien' | 'equipe' };
  pharmacy: { id: string; name: string; city: string; code?: string };
  teamAccount: boolean;
}

export type SessionState =
  | { kind: 'owner'; token: string; owner: OwnerAccount }
  | ({ kind: 'pharmacy'; token: string } & PharmacySession);

const OWNER_TABS: AppTab[] = ['dashboard', 'workspace', 'pharmacies', 'training', 'grounding', 'audit', 'deployment', 'guide'];

function tabsFor(s: SessionState): AppTab[] {
  if (s.kind === 'owner') return OWNER_TABS;
  return s.user.profile === 'pharmacien' ? ['workspace', 'deployment', 'account', 'guide'] : ['workspace', 'account', 'guide'];
}

const firstTab = (s: SessionState): AppTab => (s.kind === 'owner' ? 'dashboard' : 'workspace');

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<AppTab>('dashboard');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('');
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
      {session.kind === 'owner' && current === 'dashboard' && <SupervisionDashboard {...commonProps} owner={session.owner} onChangeTab={setTab} />}
      {session.kind === 'owner' && current === 'pharmacies' && <PharmacyManagement {...commonProps} owner={session.owner} />}
      {session.kind === 'owner' && current === 'training' && <TrainingCenter {...commonProps} owner={session.owner} />}
      {session.kind === 'owner' && current === 'grounding' && <UIGrounding token={session.token} />}
      {session.kind === 'owner' && current === 'audit' && <AuditLog token={session.token} />}
      {current === 'workspace' && <PharmacistWorkspace {...commonProps} />}
      {current === 'deployment' && <AgentDeployment token={session.token} snapshot={snapshot} selectedPharmacyId={selectedPharmacyId} onSelectPharmacy={setSelectedPharmacyId} />}
      {session.kind === 'pharmacy' && current === 'account' && (
        <PharmacyAccount token={session.token} session={session} onTeamAccountCreated={() => saveSession({ ...session, teamAccount: true })} />
      )}
      {current === 'guide' && <GuideCenter />}
    </Layout>
  );
}
