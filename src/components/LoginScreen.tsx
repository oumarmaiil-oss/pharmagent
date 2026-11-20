import { Building2, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { useState } from 'react';
import type { PharmacySession, SessionState } from '../App.tsx';
import type { OwnerAccount } from '../types/pharmagent.ts';

const LOGO = (
  <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="10" fill="#059669" />
    <path d="M16 6v20M6 16h20" stroke="white" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

export default function LoginScreen({ onLogin }: { onLogin: (s: SessionState) => void }) {
  const [mode, setMode] = useState<'pharmacy' | 'owner'>(() => {
    try { return localStorage.getItem('pharmagent_login_mode') === 'owner' ? 'owner' : 'pharmacy'; } catch { return 'pharmacy'; }
  });
  const [code, setCode] = useState('');
  const [profile, setProfile] = useState<'pharmacien' | 'equipe'>('pharmacien');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      try { localStorage.setItem('pharmagent_login_mode', mode); } catch { /* navigation privée */ }
      if (mode === 'pharmacy') {
        const r = await fetch('/api/pharmacy/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.trim(), profile, password }),
        });
        const data = await r.json() as Partial<PharmacySession> & { token?: string; error?: string };
        if (!r.ok || !data.token || !data.user || !data.pharmacy) {
          setError(data.error ?? 'Code pharmacie ou mot de passe incorrect.');
          return;
        }
        onLogin({ kind: 'pharmacy', token: data.token, user: data.user, pharmacy: data.pharmacy, teamAccount: !!data.teamAccount });
        return;
      }
      const r = await fetch('/api/owner/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      const data = await r.json() as { token?: string; owner?: OwnerAccount; error?: string };
      if (!r.ok || !data.token || !data.owner) {
        setError(data.error ?? 'Identifiant ou mot de passe incorrect.');
        return;
      }
      onLogin({ kind: 'owner', token: data.token, owner: data.owner });
    } catch {
      setError('Impossible de joindre le serveur. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none motif-molecule opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-in">
        {/* Logo + titre */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">{LOGO}</div>
          <h1 className="text-2xl font-bold text-white">PharmAgent</h1>
          <p className="text-slate-400 text-sm mt-1">Saisie automatique des bons de livraison</p>
        </div>

        {/* Formulaire */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-black/40">
          <div className="grid grid-cols-2 gap-1 p-1 mb-5 bg-slate-800/70 rounded-lg text-sm">
            {(['pharmacy', 'owner'] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                className={`py-1.5 rounded-md font-medium ${mode === m ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {m === 'pharmacy' ? 'Pharmacie' : 'Superviseur'}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'pharmacy' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Code pharmacie</label>
                  <div className="relative">
                    <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white tracking-widest placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      placeholder="K7M2QX"
                      autoComplete="organization"
                      autoCapitalize="characters"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Profil</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['pharmacien', 'equipe'] as const).map((p) => (
                      <button key={p} type="button" onClick={() => setProfile(p)}
                        className={`py-2 rounded-lg border text-sm ${profile === p ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}>
                        {p === 'pharmacien' ? 'Pharmacien' : 'Équipe'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Identifiant</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  placeholder="dr.oumar"
                  autoComplete="username"
                  required
                />
              </div>
            </div>
            )}

            {/* Mot de passe */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Mot de passe</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-5">
          <a href="/guide" className="text-emerald-400 hover:text-emerald-300">Guide d'installation et d'utilisation</a>
        </p>
      </div>
    </div>
  );
}
