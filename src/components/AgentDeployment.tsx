import { ChevronDown, ChevronUp, Download, ExternalLink, Monitor, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { DashboardSnapshot } from '../types/pharmagent.ts';

interface Props {
  token: string;
  snapshot: DashboardSnapshot | null;
}

const PYTHON_AGENT = `#!/usr/bin/env python3
"""
PharmAgent — Agent Local Officine
Se connecte au SaaS PharmAgent, envoie des images de documents
et crée des brouillons pour validation pharmacien.

GUARDRAIL ABSOLU : cet agent ne valide, ne soumet, ne confirme JAMAIS.
Il crée uniquement des brouillons (statut 'pending').
"""
import os, sys, base64, json, time
from pathlib import Path
import requests

SAAS_URL  = os.environ.get("PHARMAGENT_URL", "https://pharmagent.onrender.com")
AGENT_KEY = os.environ.get("PHARMAGENT_AGENT_KEY", "")
WATCH_DIR = Path(os.environ.get("PHARMAGENT_WATCH_DIR", "./documents"))

def send_document(image_path: Path, doc_type: str = "bon_livraison") -> dict:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    r = requests.post(
        f"{SAAS_URL}/api/agent-client/extract",
        headers={"X-Agent-Key": AGENT_KEY, "Content-Type": "application/json"},
        json={"imageBase64": b64, "documentCategory": doc_type, "mimeType": "image/jpeg"},
        timeout=60
    )
    r.raise_for_status()
    return r.json()

def watch_folder():
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    processed = set()
    print(f"[PharmAgent] Surveillance : {WATCH_DIR}")
    while True:
        for f in WATCH_DIR.glob("*.jpg"):
            if f.name not in processed:
                try:
                    print(f"[PharmAgent] Traitement : {f.name}")
                    result = send_document(f)
                    draft_id = result.get("draftId", "?")
                    print(f"[PharmAgent] Brouillon créé : {draft_id} (en attente validation)")
                    processed.add(f.name)
                except Exception as e:
                    print(f"[PharmAgent] Erreur {f.name}: {e}", file=sys.stderr)
        time.sleep(10)

if __name__ == "__main__":
    if not AGENT_KEY:
        print("ERREUR: définissez PHARMAGENT_AGENT_KEY", file=sys.stderr)
        sys.exit(1)
    watch_folder()
`;

const MAC_GUIDE = `# Installation PharmAgent — macOS

## 1. Prérequis
\`\`\`bash
brew install python@3.12
pip3 install requests
\`\`\`

## 2. Configurer les variables d'environnement
Ajoutez dans ~/.zshrc (ou ~/.bashrc) :
\`\`\`bash
export PHARMAGENT_URL="https://pharmagent.onrender.com"
export PHARMAGENT_AGENT_KEY="votre_cle_agent_ici"
export PHARMAGENT_WATCH_DIR="$HOME/Desktop/PharmAgent_Docs"
\`\`\`

## 3. Lancer l'agent
\`\`\`bash
source ~/.zshrc
python3 pharmagent_agent.py
\`\`\`

## 4. Utilisation
Déposez vos photos de bons de livraison dans ~/Desktop/PharmAgent_Docs/
L'agent les envoie automatiquement et crée des brouillons côté SaaS.`;

const WIN_GUIDE = `# Installation PharmAgent — Windows (PC Officine)

## 1. Prérequis
Téléchargez Python 3.12+ sur python.org, cochez "Add to PATH".
\`\`\`
pip install requests
\`\`\`

## 2. Configurer les variables d'environnement
Panneau de configuration → Système → Variables d'environnement :
- PHARMAGENT_URL = https://pharmagent.onrender.com
- PHARMAGENT_AGENT_KEY = votre_cle_agent_ici
- PHARMAGENT_WATCH_DIR = C:\\PharmAgent_Docs

## 3. Lancer l'agent
\`\`\`
python pharmagent_agent.py
\`\`\`

## 4. Automatiser au démarrage
Créez un raccourci vers pharmagent_agent.py dans :
C:\\Users\\VotreNom\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;

export default function AgentDeployment({ token, snapshot }: Props) {
  const [openGuide, setOpenGuide] = useState<'mac' | 'win' | null>(null);
  const [showCode, setShowCode] = useState(false);

  const pharmacies = snapshot?.pharmacies ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Déploiement Agent</h1>
        <p className="text-slate-400 text-sm">Installez l'agent local Python sur chaque PC officine pour automatiser l'envoi des documents</p>
      </div>

      {/* Guardrail notice */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex gap-3">
        <Monitor size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-200/80">
          <span className="font-semibold text-emerald-300">Guardrail Draft-Only.</span>{' '}
          L'agent local ne fait que scanner des documents et envoyer les données au SaaS. Il crée uniquement des{' '}
          <strong className="text-white">brouillons en attente</strong> — jamais de validation, jamais de soumission définitive.
          Le pharmacien valide ou rejette chaque brouillon depuis l'interface web.
        </div>
      </div>

      {/* Téléchargements par officine */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <span className="text-sm font-semibold text-white">Scripts personnalisés par officine</span>
        </div>
        {pharmacies.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 text-sm">Aucune officine. Créez-en une depuis l'onglet "Mes Officines".</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {pharmacies.map((ph) => (
              <div key={ph.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-800/40">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{ph.name}</div>
                  <div className="text-xs text-slate-500">{ph.city} · clé : <span className="font-mono">{ph.agentKey.slice(0, 16)}…</span></div>
                </div>
                <a
                  href={`/api/pharmacies/${ph.id}/installer?token=${token}`}
                  className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg whitespace-nowrap"
                >
                  <Download size={12} />
                  pharmagent_agent.py
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code source */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowCode(!showCode)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40"
        >
          <div className="flex items-center gap-2">
            <Terminal size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-white">Code source de l'agent</span>
          </div>
          {showCode ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </button>
        {showCode && (
          <div className="border-t border-slate-800">
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed bg-slate-950/50 max-h-96 overflow-y-auto">
              {PYTHON_AGENT}
            </pre>
          </div>
        )}
      </div>

      {/* Guides installation */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Guides d'installation</h2>

        {([
          { key: 'mac' as const, label: 'macOS', icon: '🍎', content: MAC_GUIDE },
          { key: 'win' as const, label: 'Windows', icon: '🪟', content: WIN_GUIDE },
        ]).map(({ key, label, icon, content }) => (
          <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenGuide(openGuide === key ? null : key)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40"
            >
              <div className="flex items-center gap-2">
                <span>{icon}</span>
                <span className="text-sm font-medium text-white">Guide installation {label}</span>
              </div>
              {openGuide === key ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
            </button>
            {openGuide === key && (
              <div className="border-t border-slate-800">
                <pre className="p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-950/50">
                  {content}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lien FastAPI */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="text-sm font-medium text-white">Version FastAPI (avancée)</div>
          <div className="text-xs text-slate-500 mt-0.5">Serveur local avec API REST complète pour intégration ERP</div>
        </div>
        <a href="/api/guide/mac-pc" className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg whitespace-nowrap">
          <ExternalLink size={12} />
          Guide FastAPI
        </a>
      </div>
    </div>
  );
}
