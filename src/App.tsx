import { useEffect, useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from './types/pharmagent.ts';
import AgentDeployment from './components/AgentDeployment.tsx';
import AuditLog from './components/AuditLog.tsx';
import Layout from './components/Layout.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import PharmacistWorkspace from './components/PharmacistWorkspace.tsx';
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
  | 'deployment';

export interface SessionState {
  token: string;
  owner: OwnerAccount;
}

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<AppTab>('dashboard');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Restauration de session depuis le localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pharmagent_session');
      if (saved) {
        const parsed = JSON.parse(saved) as SessionState;
        // Vérification rapide côté serveur
        fetch('/api/owner/auth/me', { headers: { Authorization: `Bearer ${parsed.token}` } })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.owner) {
              setSession({ token: parsed.token, owner: data.owner });
            } else {
              localStorage.removeItem('pharmagent_session');
            }
          })
          .catch(() => localStorage.removeItem('pharmagent_session'));
      }
    } catch {}
  }, []);

  const fetchDashboard = async (token: string) => {
    setLoading(true);
    try {
      const r = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const data = await r.json() as DashboardSnapshot;
        setSnapshot(data);
        if (!selectedPharmacyId && data.pharmacies.length > 0) {
          setSelectedPharmacyId(data.pharmacies[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (s: SessionState) => {
    setSession(s);
    try { localStorage.setItem('pharmagent_session', JSON.stringify(s)); } catch {}
  };

  const handleLogout = () => {
    setSession(null);
    setSnapshot(null);
    try { localStorage.removeItem('pharmagent_session'); } catch {}
    setTab('dashboard');
  };

  useEffect(() => {
    if (session) fetchDashboard(session.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const commonProps = {
    token: session.token,
    owner: session.owner,
    snapshot,
    onRefresh: () => fetchDashboard(session.token),
    selectedPharmacyId,
    onSelectPharmacy: setSelectedPharmacyId,
  };

  return (
    <Layout
      tab={tab}
      onTabChange={setTab}
      owner={session.owner}
      onLogout={handleLogout}
      pendingCount={snapshot?.pendingDrafts.length ?? 0}
      loading={loading}
    >
      {tab === 'dashboard' && <SupervisionDashboard {...commonProps} onChangeTab={setTab} />}
      {tab === 'pharmacies' && <PharmacyManagement {...commonProps} />}
      {tab === 'workspace' && <PharmacistWorkspace {...commonProps} />}
      {tab === 'training' && <TrainingCenter {...commonProps} />}
      {tab === 'grounding' && <UIGrounding token={session.token} />}
      {tab === 'audit' && <AuditLog token={session.token} />}
      {tab === 'deployment' && <AgentDeployment token={session.token} snapshot={snapshot} />}
    </Layout>
  );
}
