// Accès d'une officine (identifiant + mot de passe) affichés une seule fois, au centre de l'écran
export interface Credentials { name: string; code: string; password: string }

export default function CredentialsDialog({ c, onClose }: { c: Credentials; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-5 space-y-3 shadow-2xl">
        <div className="text-base font-semibold text-white">Connexion de {c.name}</div>
        <p className="text-xs text-slate-400">Sur l'écran de connexion, tapez simplement ces deux informations (majuscules ou minuscules).</p>
        <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><span className="text-slate-400">Identifiant</span><span className="font-mono font-bold tracking-widest text-emerald-300" data-testid="cred-code">{c.code}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-400">Mot de passe</span><span className="font-mono font-bold tracking-wider text-emerald-300" data-testid="cred-password">{c.password}</span></div>
        </div>
        <p className="text-xs text-amber-300">Notez-le maintenant : il ne sera plus affiché. Le pharmacien peut le changer ensuite dans « Mon compte ».</p>
        <div className="flex gap-2">
          <button
            onClick={() => { void navigator.clipboard?.writeText(`Identifiant : ${c.code}\nMot de passe : ${c.password}`); }}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm py-2 rounded-lg"
          >Copier</button>
          <button onClick={onClose} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 rounded-lg">J'ai noté</button>
        </div>
      </div>
    </div>
  );
}
