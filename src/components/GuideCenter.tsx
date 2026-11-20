import { BookOpen, Building2, CheckCircle2, ClipboardCheck, Laptop, LifeBuoy, Printer, Smartphone, Wrench } from 'lucide-react';
import { useState } from 'react';

type Part = 'config' | 'usage' | 'help';

function Step({ n, title, children }: { n: number | string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 print-clean">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold text-sm flex items-center justify-center">{n}</div>
      <div className="flex-1 pb-5 border-b border-slate-800/80 last:border-0">
        <h4 className="font-semibold text-white mb-1">{title}</h4>
        <div className="text-sm text-slate-300 space-y-1.5 leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

function Block({ icon, title, who, children }: { icon: React.ReactNode; title: string; who: string; children: React.ReactNode }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 print-clean break-inside-avoid">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">{icon}</div>
        <div>
          <h3 className="text-base font-bold text-white">{title}</h3>
          <div className="text-xs text-slate-400">{who}</div>
        </div>
      </div>
      <ol className="space-y-4">{children}</ol>
    </section>
  );
}

const K = ({ children }: { children: React.ReactNode }) => (
  <code className="text-[12px] px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-700 text-emerald-200 break-all">{children}</code>
);

export default function GuideCenter({ standalone = false }: { standalone?: boolean }) {
  const [part, setPart] = useState<Part>('config');
  const site = typeof window !== 'undefined' ? window.location.origin : 'https://pharmagent.onrender.com';

  return (
    <div className={`${standalone ? 'min-h-dvh' : ''} p-4 sm:p-6`}>
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="motif-hero rounded-2xl p-5 sm:p-7 print-clean">
          <div className="relative z-10 flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <BookOpen size={24} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white">Guide PharmAgent</h1>
              <p className="text-sm text-slate-300">Mise en place d'une officine et utilisation au quotidien.</p>
            </div>
            <button onClick={() => window.print()} className="no-print w-full sm:w-auto justify-center flex items-center gap-2 text-sm text-slate-200 bg-slate-900/70 border border-slate-700 hover:border-emerald-500/50 px-3 py-2 rounded-lg">
              <Printer size={15} /> Imprimer / PDF
            </button>
          </div>
        </div>

        <div className="no-print grid grid-cols-3 sm:flex gap-1 sm:gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800 w-full sm:w-fit">
          {([['config', 'Configuration', <Wrench key="c" size={14} />], ['usage', 'Utilisation', <ClipboardCheck key="u" size={14} />], ['help', 'Dépannage', <LifeBuoy key="h" size={14} />]] as const).map(([k, label, icon]) => (
            <button
              key={k}
              onClick={() => setPart(k)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium ${part === k ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-white border border-transparent'}`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {part === 'config' && (
          <div className="space-y-5">
            <Block icon={<Building2 size={20} />} title="1. Côté superviseur (vous)" who="Une fois par officine, depuis votre téléphone ou votre ordinateur · 5 minutes">
              <Step n={1} title="Se connecter">
                <p>Ouvrez <K>{site}</K> et connectez-vous avec votre identifiant superviseur.</p>
                <p className="text-slate-400">Astuce téléphone : menu du navigateur › « Ajouter à l'écran d'accueil » pour l'avoir comme une application.</p>
              </Step>
              <Step n={2} title="Créer l'officine">
                <p>Onglet <b>Mes Officines</b> › <b>Nouvelle officine</b> : nom, titulaire, ville. Les comptes titulaire / adjoint / assistant sont créés automatiquement.</p>
              </Step>
              <Step n={3} title="Importer le catalogue produits (recommandé)">
                <p>Demandez au pharmacien d'exporter la liste des produits de son ERP (Excel ou CSV), puis onglet <b>Mémoire & Entraînement</b> › choisissez l'officine › <b>Importer le catalogue</b>.</p>
                <p className="text-slate-400">Les colonnes (désignation, CIP, prix d'achat, prix de vente, stock) sont reconnues automatiquement. Sans import, PharmAgent apprend le catalogue au fil des saisies.</p>
              </Step>
            </Block>

            <Block icon={<Laptop size={20} />} title="2. Chez le pharmacien : nouvel ordinateur" who="Sur le PC où l'ERP est utilisé · 10 minutes, une seule fois">
              <Step n={1} title="Installer l'agent">
                <p><b>Windows :</b> sur ce PC, ouvrez <K>{site}/install/windows</K> : le fichier <b>PharmAgent-Installer.bat</b> se télécharge. Double-cliquez dessus.</p>
                <p className="text-slate-400">Si Windows affiche « Windows a protégé votre ordinateur » : <b>Informations complémentaires</b> › <b>Exécuter quand même</b>. Si le navigateur bloque le téléchargement : <b>Conserver</b>.</p>
                <p><b>Mac :</b> sur ce Mac, ouvrez <K>{site}/install/mac.zip</K> : ouvrez le fichier téléchargé, puis double-cliquez sur <b>PharmAgent-Mac.command</b> (la première fois : clic droit › Ouvrir). Le Terminal s'ouvre et installe tout seul : laissez-le ouvert, réduisez-le.</p>
                <p className="text-slate-400">Ensuite, l'application <b>PharmAgent</b> (dossier Applications) relance tout par un double-clic. Autre méthode, dans le Terminal : <K>curl -fsSL {site}/install/install.sh | bash</K></p>
                <p className="text-slate-400">Aucun droit administrateur, rien d'autre à installer : Python est géré automatiquement (1 à 3 minutes selon la connexion).</p>
              </Step>
              <Step n={2} title="Relier l'ordinateur à l'officine">
                <p>À la fin, le panneau <b>PharmAgent — Agent local</b> s'ouvre dans le navigateur et affiche un <b>code à 6 chiffres</b>.</p>
                <p>Sur votre téléphone : onglet <b>Agent local</b> › choisissez l'officine › saisissez le code › <b>Relier</b>. Le panneau du PC passe à l'étape suivante tout seul.</p>
              </Step>
              <Step n={3} title="Indiquer l'ERP">
                <p><b>ERP web</b> (s'ouvre dans un navigateur) : choisissez « Site web », collez l'adresse de l'ERP. Un navigateur PharmAgent s'ouvre : <b>connectez-vous à l'ERP une fois</b>, la session est mémorisée.</p>
                <p><b>Logiciel installé</b> : ouvrez d'abord l'ERP, puis choisissez « Logiciel installé » et sélectionnez sa fenêtre dans la liste.</p>
                <p className="text-slate-400">Mac + logiciel installé : autorisez PharmAgent dans Réglages Système › Confidentialité et sécurité › Accessibilité.</p>
              </Step>
              <Step n={4} title="La démonstration (une seule fois)">
                <p>Dans l'ERP, ouvrez l'écran de <b>réception d'un bon de livraison</b>. Dans le panneau, cliquez <b>Commencer la démo</b>.</p>
                <p>Le pharmacien saisit <b>l'en-tête</b> (fournisseur, n° de bon, date) avec les valeurs d'exemple affichées, puis <b>En-tête terminé</b>. Ensuite <b>une ligne produit</b> : début du nom → choix dans la liste de l'ERP, quantité, lot, péremption, prix… puis <b>Ligne terminée</b>.</p>
                <p className="text-slate-400">Logiciel installé : passer d'un champ à l'autre uniquement au clavier (Tab, Entrée). Ne cliquez jamais sur Valider : PharmAgent l'ignore de toute façon.</p>
              </Step>
              <Step n={5} title="Vérifier et enregistrer">
                <p>Le panneau affiche ce qu'il a compris (« Saisie 19/11/2026 → Date du bon »…). Corrigez un champ si besoin, puis <b>Enregistrer la démo</b>.</p>
                <p>Cliquez <b>Tester avec l'exemple</b> : l'agent remplit l'écran tout seul en quelques secondes. Effacez ce brouillon de test dans l'ERP.</p>
              </Step>
              <Step n={6} title="C'est prêt">
                <p>Une icône <b>PharmAgent</b> est sur le Bureau (ou dans Applications sur Mac) et l'agent démarre avec l'ordinateur. Dans votre onglet <b>Agent local</b>, l'officine apparaît <b>En ligne</b>.</p>
              </Step>
            </Block>
          </div>
        )}

        {part === 'usage' && (
          <Block icon={<Smartphone size={20} />} title="Utilisation au quotidien" who="Pharmacien, adjoint ou superviseur · depuis le téléphone ou le PC">
            <Step n={1} title="Photographier le bon">
              <p>Onglet <b>Poste Pharmacien</b> › choisissez l'officine › <b>Photo</b> (ou <b>Importer</b> une image / un PDF) › <b>Analyser</b>.</p>
            </Step>
            <Step n={2} title="Contrôler les lignes">
              <p>Chaque ligne affiche le libellé du grossiste et, en vert, le produit de l'ERP trouvé. Les lignes en orange sont <b>à vérifier</b> : touchez le bon produit proposé, tapez le libellé exact, ou marquez <b>Nouveau</b> s'il n'existe pas encore dans l'ERP.</p>
              <p>Le crayon ✎ permet de corriger une quantité, un lot, une péremption ou un prix mal lu.</p>
            </Step>
            <Step n={3} title="Approuver">
              <p><b>Approuver</b> envoie le bon à l'agent. Les correspondances sont mémorisées : le prochain bon du même grossiste est reconnu tout seul.</p>
            </Step>
            <Step n={4} title="La saisie se fait seule">
              <p>Sur le PC de l'officine, l'agent remplit l'écran de réception de l'ERP en quelques secondes. Le statut passe à <b>Saisi dans l'ERP</b>.</p>
            </Step>
            <Step n={5} title="Valider dans l'ERP">
              <p>Le pharmacien relit l'écran de l'ERP et <b>valide lui-même</b>. PharmAgent ne valide jamais à sa place.</p>
            </Step>
            <li className="flex gap-3 items-start rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm text-emerald-200 print-clean">
              <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
              Le fichier Excel de chaque bon reste téléchargeable (bouton Excel) pour un tableur ou une archive.
            </li>
          </Block>
        )}

        {part === 'help' && (
          <Block icon={<LifeBuoy size={20} />} title="En cas de problème" who="Solutions rapides">
            <Step n="?" title="L'officine apparaît « Hors ligne »">
              <p>Le PC est éteint ou l'agent est fermé : double-cliquez sur l'icône <b>PharmAgent</b> du Bureau. Il redémarre aussi tout seul avec l'ordinateur.</p>
            </Step>
            <Step n="?" title="« Saisie interrompue : produit introuvable »">
              <p>Le produit n'existe pas dans l'ERP ou porte un autre nom. Créez-le dans l'ERP, puis <b>Relancer la saisie</b>.</p>
            </Step>
            <Step n="?" title="« Champ introuvable à l'écran »">
              <p>L'ERP n'était pas sur l'écran de réception, ou il a changé d'aspect. Ouvrez l'écran de réception puis <b>Relancer</b>. Si cela se répète : panneau de l'agent › <b>Refaire la démo</b>.</p>
            </Step>
            <Step n="?" title="Arrêter une saisie en cours">
              <p>Logiciel installé : touche <b>Échap</b>. ERP web : bouton <b>Mettre en pause</b> du panneau.</p>
            </Step>
            <Step n="?" title="Rouvrir le panneau de l'agent">
              <p>Icône <b>PharmAgent</b> du Bureau, ou adresse <K>http://127.0.0.1:8765</K> sur le PC de l'officine.</p>
            </Step>
            <Step n="?" title="Changer d'ordinateur">
              <p>Installez l'agent sur le nouveau PC et saisissez le nouveau code : la démo déjà enregistrée est reprise automatiquement.</p>
            </Step>
          </Block>
        )}

        {standalone && (
          <p className="no-print text-center text-xs text-slate-500 pb-6">
            <a href="/" className="text-emerald-400 hover:text-emerald-300">← Retour à PharmAgent</a>
          </p>
        )}
      </div>
    </div>
  );
}
