import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { OwnerAccount } from '../types/pharmagent';
import { PanelIllustration } from './Illustrations';

interface SupervisorTeamPanelProps {
  currentSupervisor: OwnerAccount;
  ownerToken: string;
  onOpenMyCredentials: () => void;
}

export const SupervisorTeamPanel: React.FC<SupervisorTeamPanelProps> = ({
  currentSupervisor,
  ownerToken,
  onOpenMyCredentials,
}) => {
  const [supervisors, setSupervisors] = useState<OwnerAccount[]>([]);
  const [maxAccounts, setMaxAccounts] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [loginId, setLoginId] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('Co-Superviseur Réseau · PharmAgent');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [bannerImgFailed, setBannerImgFailed] = useState(false);

  const isPrimaryOwner = currentSupervisor.role === 'owner';

  const fetchSupervisors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/supervisors', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chargement impossible.');
      setSupervisors(data.supervisors || []);
      setMaxAccounts(data.maxAccounts || 3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement équipe Supervision.');
    } finally {
      setLoading(false);
    }
  }, [ownerToken]);

  useEffect(() => {
    fetchSupervisors();
  }, [fetchSupervisors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch('/api/supervisors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          loginId: loginId.trim(),
          fullName: fullName.trim(),
          title: title.trim(),
          password,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Création refusée.');
      setSupervisors(payload.supervisors || []);
      setLoginId('');
      setFullName('');
      setPassword('');
      setFeedback(`Accès Co-Superviseur « @${payload.supervisor.loginId} » créé.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur création.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (sup: OwnerAccount) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/supervisors/${sup.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ active: !sup.active }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Modification impossible.');
      setSupervisors(payload.supervisors || []);
      setFeedback(
        `Accès @${sup.loginId} ${!sup.active ? 'réactivé' : 'suspendu'} pour la Supervision.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur statut.');
    }
  };

  const handleResetPassword = async (targetId: string) => {
    if (!resetPassword.trim()) return;
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/supervisors/${targetId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ password: resetPassword.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Réinitialisation impossible.');
      setSupervisors(payload.supervisors || []);
      setResetTargetId(null);
      setResetPassword('');
      setFeedback('Nouveau mot de passe provisoire défini pour ce superviseur.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur réinitialisation.');
    }
  };

  const handleDelete = async (sup: OwnerAccount) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/supervisors/${sup.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Suppression refusée.');
      setSupervisors(payload.supervisors || []);
      setFeedback(`Accès @${sup.loginId} retiré de la Supervision.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur suppression.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Split Hero Card */}
      <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Gouvernance Cloisonnée · Équipe Supervision ({supervisors.length}/{maxAccounts})</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-100">
              Accès personnels &amp; Co-Superviseurs (2 à 3 accès max)
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              Cet espace gère uniquement les comptes de la <strong className="text-slate-100">Console Supervision</strong>.
              Vos identifiants personnels sont strictement séparés des officines : pour modifier
              les accès d’une pharmacie, ouvrez cette officine via le bouton <strong className="text-emerald-300">Intervenir</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onOpenMyCredentials}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Modifier mes propres identifiants (@{currentSupervisor.loginId})
            </button>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] lg:block [mask-image:linear-gradient(to_left,black_30%,transparent)]">
          {!bannerImgFailed ? (
            <PanelIllustration bare variant="audit" label="Contrôle d'accès supervision PharmAgent" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-slate-950 text-slate-500 text-xs">
              Contrôle d’accès Supervision
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-3.5 text-xs text-red-300">
          {error}
        </div>
      )}
      {feedback && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/50 p-3.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Accounts Table */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 lg:col-span-7 overflow-hidden">
          <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                Comptes Supervision actifs ({supervisors.length} / {maxAccounts})
              </h3>
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((n) => (
                <div key={n} className="h-14 rounded-lg bg-slate-800/60 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {supervisors.map((sup) => {
                const isSelf = sup.id === currentSupervisor.id;
                const isMain = sup.role === 'owner';
                return (
                  <div key={sup.id} className="px-6 py-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                          <span>{sup.fullName}</span>
                          {isSelf && (
                            <span className="text-[11px] font-medium text-emerald-400">
                              · Session actuelle
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="font-mono text-slate-300">@{sup.loginId}</span>
                          <span>·</span>
                          <span>{isMain ? 'Propriétaire principal' : 'Co-Superviseur'}</span>
                          <span>·</span>
                          <span className={sup.active ? 'text-emerald-400' : 'text-red-400'}>
                            {sup.active ? 'Actif' : 'Suspendu'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isSelf && (
                          <button
                            type="button"
                            onClick={onOpenMyCredentials}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/70 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60 whitespace-nowrap"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Modifier mon accès
                          </button>
                        )}
                        {isPrimaryOwner && !isMain && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setResetTargetId(resetTargetId === sup.id ? null : sup.id);
                                setResetPassword('');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 whitespace-nowrap"
                            >
                              <KeyRound className="h-3.5 w-3.5 text-sky-400" />
                              Mot de passe
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(sup)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500 whitespace-nowrap"
                            >
                              {sup.active ? (
                                <>
                                  <PauseCircle className="h-3.5 w-3.5 text-amber-400" />
                                  Suspendre
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="h-3.5 w-3.5 text-emerald-400" />
                                  Activer
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(sup)}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-red-400 hover:border-red-500"
                              title="Retirer cet accès co-superviseur"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {resetTargetId === sup.id && isPrimaryOwner && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                        <input
                          type="password"
                          minLength={6}
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="Nouveau mot de passe provisoire (min. 6 car.)"
                          className="h-9 flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleResetPassword(sup.id)}
                          className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                        >
                          Appliquer
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Add Co-Supervisor Form */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Ajouter un Co-Superviseur
            </h3>
          </div>

          {!isPrimaryOwner ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 flex items-start gap-2.5">
              <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Seul le Propriétaire principal (<strong>Dr. Oumar</strong>) peut créer ou révoquer
                des comptes Co-Superviseur. Vous pouvez modifier votre propre mot de passe à gauche.
              </span>
            </div>
          ) : supervisors.length >= maxAccounts ? (
            <div className="rounded-lg border border-amber-800/70 bg-amber-950/30 p-4 text-xs text-amber-200">
              Plafond atteint : <strong>{maxAccounts} comptes Supervision</strong> actifs. Suspendez
              ou retirez un Co-Superviseur pour libérer une place.
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Identifiant de connexion (ID)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="Ex: sup.dakar"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom complet
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: Dr. Ndiaye"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Fonction affichée
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mot de passe provisoire (min. 6 caractères)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {creating ? 'Création...' : 'Créer le compte Co-Superviseur'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
};
