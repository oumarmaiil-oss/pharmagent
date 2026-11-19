// ============================================================
// PharmAgent v2 — Serveur Express principal
// ============================================================

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import {
  extractDocumentWithGemini,
  groundTargetInterfaceWithGemini,
  mapToTargetColumnsWithGemini,
} from './src/server/geminiAgent.ts';
import { SafetyViolationError, guardrail } from './src/server/guardrail.ts';
import { store } from './src/server/store.ts';
import type {
  DocumentCategory,
  DraftRecord,
  TargetSoftwareType,
} from './src/types/pharmagent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ─── Sécurité de base ─────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '30mb' }));

// ─── Rate limiting simple ────────────────────────────────

const loginAttempts = new Map<string, { count: number; until: number }>();

function loginRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = req.ip ?? 'unknown';
  const rec = loginAttempts.get(ip);
  if (rec && Date.now() < rec.until) {
    res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 5 minutes.' });
    return;
  }
  next();
}

function recordFailedLogin(ip: string): void {
  const rec = loginAttempts.get(ip) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) rec.until = Date.now() + 5 * 60 * 1000;
  loginAttempts.set(ip, rec);
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// ─── Auth middleware ──────────────────────────────────────

function extractToken(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  if (typeof req.query.token === 'string') return req.query.token;
  return undefined;
}

function getOwnerSession(req: express.Request) {
  const t = extractToken(req);
  if (!t) return null;
  return store.verifyOwnerToken(t);
}

function getPharmacySession(req: express.Request) {
  const t = extractToken(req);
  if (!t) return null;
  return store.verifyPharmacyUserToken(t);
}

function requireOwner(req: express.Request, res: express.Response) {
  const owner = getOwnerSession(req);
  if (!owner) { res.status(401).json({ error: 'Authentification du superviseur requise.' }); return null; }
  return owner;
}

function requirePharmacyOrOwner(req: express.Request, res: express.Response, pharmacyId: string) {
  const owner = getOwnerSession(req);
  if (owner) return { kind: 'owner' as const, actor: owner, displayName: owner.fullName };
  const user = getPharmacySession(req);
  if (!user) { res.status(401).json({ error: 'Connexion requise.' }); return null; }
  if (user.pharmacyId !== pharmacyId) { res.status(403).json({ error: 'Accès interdit à une autre officine.' }); return null; }
  return { kind: 'pharmacy_user' as const, actor: user, displayName: user.fullName };
}

function requireApprover(req: express.Request, res: express.Response, pharmacyId: string) {
  const owner = getOwnerSession(req);
  if (owner) return { actor: owner, displayName: owner.fullName };
  const user = getPharmacySession(req);
  if (!user) { res.status(401).json({ error: 'Connexion requise.' }); return null; }
  if (user.pharmacyId !== pharmacyId) { res.status(403).json({ error: 'Accès interdit.' }); return null; }
  if (user.role === 'assistant') { res.status(403).json({ error: "Seul le titulaire ou l'adjoint peut approuver." }); return null; }
  return { actor: user, displayName: user.fullName };
}

// ─── Utilitaire image ─────────────────────────────────────

function resolveImage(
  base64Input?: string,
  sampleAssetPath?: string,
  fallbackMime = 'image/jpeg'
): { base64: string; mimeType: string } {
  if (base64Input) {
    const m = base64Input.match(/^data:([^;]+);base64,(.+)$/);
    if (m) return { mimeType: m[1], base64: m[2] };
    return { mimeType: fallbackMime, base64: base64Input };
  }
  if (sampleAssetPath) {
    const rel = sampleAssetPath.replace(/^\/+/, '');
    const imagesDir = path.resolve(__dirname, 'src/assets/images');
    const abs = path.resolve(__dirname, rel);
    if (!abs.startsWith(imagesDir + path.sep)) throw new Error('Chemin image non autorisé.');
    if (!fs.existsSync(abs)) throw new Error(`Image introuvable : ${rel}`);
    const buffer = fs.readFileSync(abs);
    return { mimeType: rel.endsWith('.png') ? 'image/png' : 'image/jpeg', base64: buffer.toString('base64') };
  }
  throw new Error('Aucune image fournie.');
}

// ─── Routes santé ─────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PharmAgent', version: '2.0.0' });
});

// ─── Authentification propriétaire ───────────────────────

app.post('/api/owner/auth/login', loginRateLimit, (req, res) => {
  const { loginId, password } = req.body as { loginId: string; password: string };
  if (!loginId || !password) { res.status(400).json({ error: 'Identifiant et mot de passe requis.' }); return; }
  const token = store.loginOwner(loginId, password);
  if (!token) {
    recordFailedLogin(req.ip ?? 'unknown');
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  clearLoginAttempts(req.ip ?? 'unknown');
  res.json({ token, owner: store.getOwner() });
});

app.get('/api/owner/auth/me', (req, res) => {
  const owner = requireOwner(req, res);
  if (!owner) return;
  res.json({ owner });
});

app.post('/api/owner/auth/change-credentials', (req, res) => {
  const owner = requireOwner(req, res);
  if (!owner) return;
  const { newLoginId, newFullName, currentPassword, newPassword } = req.body as Record<string, string>;
  if (!currentPassword) { res.status(400).json({ error: 'Mot de passe actuel requis.' }); return; }
  const ok = store.changeOwnerCredentials(newLoginId, newFullName, currentPassword, newPassword);
  if (!ok) { res.status(401).json({ error: 'Mot de passe actuel incorrect.' }); return; }
  res.json({ ok: true });
});

// ─── Dashboard ────────────────────────────────────────────

app.get('/api/dashboard', (req, res) => {
  if (!requireOwner(req, res)) return;
  res.json(store.getDashboard());
});

// ─── Pharmacies ───────────────────────────────────────────

app.post('/api/pharmacies', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { name, city, region, pharmacist, targetSoftware } = req.body as {
    name: string; city: string; region?: string;
    pharmacist: string; targetSoftware: TargetSoftwareType;
  };
  if (!name?.trim() || !city?.trim() || !pharmacist?.trim()) {
    res.status(400).json({ error: 'Nom, ville et titulaire sont obligatoires.' });
    return;
  }
  const pharmacy = store.createPharmacy({ name, city, region, pharmacist, targetSoftware: targetSoftware ?? 'ERP Officine Intégré' });
  store.addAuditLog({ pharmacyId: pharmacy.id, actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: `Création de l'officine ${pharmacy.name}`, level: 'info' });
  res.status(201).json({ pharmacy });
});

app.patch('/api/pharmacies/:id/subscription', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { plan, quota } = req.body as { plan: string; quota?: number };
  store.updatePharmacySubscription(req.params.id, plan as any, quota);
  res.json({ ok: true });
});

// ─── Auth officine ────────────────────────────────────────

app.post('/api/pharmacies/:id/auth/login', loginRateLimit, (req, res) => {
  const { loginId, password } = req.body as { loginId: string; password: string };
  if (!loginId || !password) { res.status(400).json({ error: 'Identifiant et mot de passe requis.' }); return; }
  const token = store.loginPharmacyUser(req.params.id, loginId, password);
  if (!token) {
    recordFailedLogin(req.ip ?? 'unknown');
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  clearLoginAttempts(req.ip ?? 'unknown');
  const user = store.verifyPharmacyUserToken(token);
  res.json({ token, user });
});

app.get('/api/pharmacies/:id/users', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ users: store.getPharmacyUsers(req.params.id) });
});

// ─── Portail officine (par clé officine) ─────────────────

app.get('/api/portal/resolve', (req, res) => {
  const key = req.query.key as string;
  if (!key) { res.status(400).json({ error: 'Clé officine manquante.' }); return; }
  const ph = store.getPharmacyByAgentKey(key);
  if (!ph) { res.status(404).json({ error: 'Officine introuvable.' }); return; }
  res.json({ pharmacyId: ph.id, pharmacyName: ph.name, targetSoftware: ph.targetSoftware });
});

// ─── Entraînement & Mémoire ───────────────────────────────

app.get('/api/training/download/:type', (req, res) => {
  // La mémoire est privée : réservée aux superviseurs connectés
  if (req.params.type === 'memory' && !requireOwner(req, res)) return;

  const memory = store.getMemory();
  const wb = XLSX.utils.book_new();

  if (req.params.type === 'memory') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      memory.productAliases.map((a) => ({ 'Libellé Brut (Document)': a.rawLabel, 'Désignation Canonique (Stock)': a.canonicalName }))
    ), 'Dictionnaire_Produits');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      memory.columnRules.map((r) => ({ 'Champ Source (Agent)': r.sourceField, 'Colonne Cible (Logiciel)': r.targetColumn }))
    ), 'Regles_Colonnes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="PharmAgent_Memoire_Agent.xlsx"');
    return res.send(buffer);
  }

  if (req.params.type === 'target') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'Date Réception': '', 'N° Bon Livraison': '', 'Fournisseur': '', 'Désignation Médicament': '', 'Quantité Reçue': '', 'N° Lot Fabricant': '', 'Date Péremption': '', 'Prix Achat Unitaire (FCFA)': '', 'Total Ligne (FCFA)': '', 'Statut Validation': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN' },
    ]), 'Modele_Reception_Stock');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="PharmAgent_Modele_Cible_Stock.xlsx"');
    return res.send(buffer);
  }

  if (req.params.type === 'custom_kit') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'Médicament (DCI)': '', 'Qté Livrée': '', 'N° Lot Fabricant': '', 'Date Péremption': '', 'Prix Achat Unitaire (FCFA)': '', 'Contrôle Garde-Fou': 'BROUILLON UNIQUEMENT' },
    ]), 'Kit_Test_Officine');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="PharmAgent_Kit_Test_Officine.xlsx"');
    return res.send(buffer);
  }

  res.status(404).json({ error: 'Type de template inconnu.' });
});

app.post('/api/training/rules', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { type, rawLabel, canonicalName, sourceField, targetColumn } = req.body as Record<string, string>;
  if (type === 'alias') {
    if (!rawLabel || !canonicalName) { res.status(400).json({ error: 'rawLabel et canonicalName requis.' }); return; }
    const a = store.addProductAlias(rawLabel, canonicalName);
    return res.json({ alias: a });
  }
  if (type === 'column') {
    if (!sourceField || !targetColumn) { res.status(400).json({ error: 'sourceField et targetColumn requis.' }); return; }
    const r = store.addColumnRule(sourceField, targetColumn);
    return res.json({ rule: r });
  }
  res.status(400).json({ error: 'type doit être "alias" ou "column".' });
});

app.delete('/api/training/rules/:id', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { type } = req.query as { type: string };
  if (type === 'alias') store.removeProductAlias(req.params.id);
  else store.removeColumnRule(req.params.id);
  res.json({ ok: true });
});

app.post('/api/training/import-memory', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { productAliases, columnRules } = req.body as { productAliases?: any[]; columnRules?: any[] };
  store.importMemoryFromJson({ productAliases, columnRules });
  res.json({ ok: true, memory: store.getMemory() });
});

// ─── Script installeur Python ─────────────────────────────

app.get('/api/pharmacies/:id/installer', (req, res) => {
  if (!requireOwner(req, res)) return;
  const ph = store.getPharmacy(req.params.id);
  if (!ph) { res.status(404).json({ error: 'Officine introuvable.' }); return; }

  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const appUrl = host ? `${proto}://${host}` : (process.env.APP_URL ?? 'http://localhost:3000');

  const script = `#!/usr/bin/env python3
"""
PharmAgent RPA — Agent Local Robotique
Officine  : ${ph.name}
Généré le : ${new Date().toLocaleDateString('fr-FR')}

GUARDRAIL ABSOLU : ne valide, ne soumet, ne confirme JAMAIS.
Le pharmacien approuve chaque brouillon depuis l'interface web.
"""
import os, sys, time, base64, subprocess
from io import BytesIO

# ── Vérification dépendances ──────────────────────────────────────────────────
def _install_missing():
    for pkg, imp in [("requests","requests"),("pyautogui","pyautogui"),("Pillow","PIL")]:
        try:
            __import__(imp)
        except ImportError:
            print(f"[Setup] Installation de {pkg}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])
_install_missing()

import requests
import pyautogui
from PIL import ImageGrab

SAAS_URL   = "${appUrl}"
AGENT_KEY  = "${ph.agentKey}"
PHARMACY_ID = "${ph.id}"
DELAY      = float(os.environ.get("PHARMAGENT_DELAY", "0.5"))
POLL_SEC   = int(os.environ.get("PHARMAGENT_POLL", "15"))
pyautogui.FAILSAFE = True

def screenshot_b64() -> str:
    img = ImageGrab.grab()
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def execute_action(action: dict) -> bool:
    kind, label, safety = action.get("action"), action.get("fieldLabel","?"), action.get("safetyStatus","UNKNOWN")
    if safety == "FORBIDDEN_BY_GUARDRAIL":
        print(f"  [BLOQUÉ-GUARDRAIL] {label}")
        return False
    x, y, text, keys = action.get("x"), action.get("y"), action.get("text",""), action.get("keys",[])
    if kind == "click" and x and y:
        print(f"  [CLIC] {label} ({x},{y})")
        pyautogui.click(x, y)
    elif kind == "type" and text:
        print(f"  [SAISIE] {label} = {text!r}")
        pyautogui.typewrite(str(text), interval=0.05)
    elif kind == "hotkey" and keys:
        print(f"  [TOUCHE] {'+'.join(keys)}")
        pyautogui.hotkey(*keys)
    elif kind == "screenshot_verify":
        print(f"  [VÉRIF] Capture intermédiaire")
    time.sleep(DELAY)
    return True

def process_task(task: dict) -> None:
    draft, draft_id = task["draft"], task["id"]
    lines = draft["extractedData"]["lineItems"]
    headers = {"X-Agent-Key": AGENT_KEY}
    print(f"\\n[RPA] Brouillon {draft_id} — {len(lines)} ligne(s)")
    print("      Ouvrez le logiciel cible et positionnez-le sur l'écran.\\n")
    time.sleep(3)
    for i, line in enumerate(lines):
        print(f"\\n── Ligne {i+1}/{len(lines)} : {line.get('designation','?')} ──")
        ss = screenshot_b64()
        try:
            r = requests.post(
                f"{SAAS_URL}/api/agent-client/rpa-actions",
                headers={**headers, "Content-Type": "application/json"},
                json={"screenshotBase64": ss, "mimeType": "image/png",
                      "draftId": draft_id, "lineIndex": i},
                timeout=60
            )
            r.raise_for_status()
            result = r.json()
        except Exception as e:
            print(f"  [ERREUR] {e}")
            continue
        if not result.get("allSafe"):
            print(f"  [ALERTE] {result.get('observations','')}")
        for action in result.get("actions", []):
            execute_action(action)
        time.sleep(0.5)
    requests.post(f"{SAAS_URL}/api/agent-client/report",
                  headers={**headers, "Content-Type": "application/json"},
                  json={"taskId": draft_id, "agentKey": AGENT_KEY,
                        "success": True, "message": f"{len(lines)} ligne(s) saisies en brouillon"},
                  timeout=15)
    print("\\n[RPA] Saisie terminée. Validez depuis l'interface web PharmAgent.")

def main() -> None:
    print(f"[RPA] PharmAgent démarré — {SAAS_URL}")
    print(f"[RPA] Vérification des tâches toutes les {POLL_SEC}s\\n")
    while True:
        try:
            r = requests.get(f"{SAAS_URL}/api/agent-client/next-task",
                             headers={"X-Agent-Key": AGENT_KEY}, timeout=15)
            r.raise_for_status()
            task = r.json().get("task")
            if task:
                process_task(task)
            else:
                print(f"[RPA] Aucune tâche. Prochaine vérification dans {POLL_SEC}s...")
        except KeyboardInterrupt:
            print("\\n[RPA] Arrêt.")
            sys.exit(0)
        except Exception as e:
            print(f"[RPA] Erreur : {e}")
        time.sleep(POLL_SEC)

if __name__ == "__main__":
    main()
`;

  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pharmagent_${ph.id}.py"`);
  res.send(script);
});

// ─── Sources FastAPI (visualisation) ─────────────────────

app.get('/api/fastapi-sources', (req, res) => {
  if (!requireOwner(req, res)) return;
  const fastapiDir = path.resolve(__dirname, 'backend-fastapi');
  const files = [
    'requirements.txt', 'pharmagent_local_agent.py',
    'app/main.py', 'app/vision_extractor.py',
    'app/ui_grounding.py', 'app/safety_guardrail.py', 'app/executor.py',
  ].map((rel) => {
    const full = path.join(fastapiDir, rel);
    if (!fs.existsSync(full)) return null;
    return { path: `backend-fastapi/${rel}`, language: rel.endsWith('.py') ? 'python' : 'text', content: fs.readFileSync(full, 'utf-8') };
  }).filter(Boolean);
  res.json({ files });
});

// ─── Guide Mac/PC ─────────────────────────────────────────

app.get('/api/guide/mac-pc', (_req, res) => {
  res.type('text/markdown; charset=utf-8').send(`# Guide d'installation PharmAgent — Agent Local

## Prérequis

- Python 3.10 ou supérieur
- pip
- Connexion Internet (pour télécharger le script)

## Installation automatique

### Windows
1. Téléchargez le script \`.py\` depuis la console superviseur
2. Ouvrez PowerShell et exécutez : \`python pharmagent_<id>.py\`

### macOS
1. Téléchargez le script \`.py\`
2. Ouvrez Terminal et exécutez : \`python3 pharmagent_<id>.py\`

## Configuration

Le script se connecte automatiquement au serveur PharmAgent avec la clé de votre officine.
Aucune configuration supplémentaire n'est nécessaire.

## Arrêt

Appuyez sur \`Ctrl+C\` pour arrêter l'agent.
`);
});

// ─── Brouillons ───────────────────────────────────────────

app.get('/api/drafts', (req, res) => {
  if (!requireOwner(req, res)) return;
  res.json({ drafts: store.getDrafts() });
});

app.get('/api/pharmacies/:id/drafts', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ drafts: store.getDrafts(req.params.id) });
});

app.patch('/api/drafts/:draftId/items', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  const { items } = req.body;
  if (!Array.isArray(items)) { res.status(400).json({ error: 'items doit être un tableau.' }); return; }
  store.updateDraftItems(req.params.draftId, items);
  res.json({ ok: true });
});

app.post('/api/drafts/:draftId/approve', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  const actor = requireApprover(req, res, draft.pharmacyId);
  if (!actor) return;
  store.updateDraftStatus(req.params.draftId, 'approved', actor.displayName);
  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Brouillon ${req.params.draftId} approuvé`, level: 'approved' });
  res.json({ ok: true });
});

app.post('/api/drafts/:draftId/reject', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  const actor = requireApprover(req, res, draft.pharmacyId);
  if (!actor) return;
  const { reason } = req.body as { reason?: string };
  store.updateDraftStatus(req.params.draftId, 'rejected', actor.displayName, reason);
  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Brouillon ${req.params.draftId} rejeté`, level: 'rejected', details: reason });
  res.json({ ok: true });
});

app.get('/api/drafts/:draftId/download', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  const file = store.getDraftFile(req.params.draftId);
  if (!file) { res.status(404).json({ error: 'Fichier Excel brouillon introuvable.' }); return; }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.buffer);
});

// ─── Agent IA : extraction document ──────────────────────

app.post('/api/agent/extract', async (req, res) => {
  const { pharmacyId, imageBase64, sampleAssetPath, documentHint, taskPrompt } = req.body as {
    pharmacyId?: string;
    imageBase64?: string;
    sampleAssetPath?: string;
    documentHint: DocumentCategory;
    taskPrompt?: string;
  };

  // Accepte la session superviseur OU la session officine
  const owner = getOwnerSession(req);
  const pharmacyUser = getPharmacySession(req);
  if (!owner && !pharmacyUser) { res.status(401).json({ error: 'Connexion requise.' }); return; }

  const effPharmacyId = pharmacyId ?? pharmacyUser?.pharmacyId;
  if (!effPharmacyId) { res.status(400).json({ error: 'pharmacyId requis.' }); return; }

  try {
    const { base64, mimeType } = resolveImage(imageBase64, sampleAssetPath);
    const memory = store.getMemory();
    const { data, tokensConsumed } = await extractDocumentWithGemini({
      imageBase64: base64, mimeType, documentHint: documentHint ?? 'bon_livraison',
      taskPrompt, learnedMemory: memory,
    });

    // Mapping vers colonnes cibles
    const ph = store.getPharmacy(effPharmacyId);
    const { mappings } = await mapToTargetColumnsWithGemini({
      extractedData: data,
      targetSoftware: ph?.targetSoftware ?? 'ERP Officine Intégré',
      knownColumns: memory.columnRules.map((r) => r.targetColumn),
    });

    // Création du brouillon
    const actorId = owner?.id ?? pharmacyUser!.id;
    const actorName = owner?.fullName ?? pharmacyUser!.fullName;

    const draft = store.createDraft({
      pharmacyId: effPharmacyId,
      status: 'pending',
      documentCategory: documentHint ?? 'bon_livraison',
      extractedData: data,
      columnMapping: mappings,
      actorId, actorName,
      tokensConsumed,
      hasExcelFile: false,
    });

    // Génération du fichier Excel brouillon
    try {
      const wb = XLSX.utils.book_new();
      const rows = data.lineItems.map((item) => ({
        'Date Réception': data.documentDate,
        'N° Document': data.documentNumber,
        'Fournisseur': data.supplierOrOrg,
        'Désignation Médicament': item.designation,
        'Quantité Reçue': item.quantity,
        'N° Lot': item.lotNumber ?? '',
        'Date Péremption': item.expiryDate ?? '',
        'Prix Unitaire (FCFA)': item.unitPriceFCFA,
        'Total Ligne (FCFA)': item.quantity * item.unitPriceFCFA,
        'Confiance IA': `${Math.round(item.confidence * 100)}%`,
        'Statut': 'BROUILLON — EN ATTENTE VALIDATION PHARMACIEN',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Brouillon_Stock');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      store.saveDraftFile(draft.id, `Brouillon_${draft.id}.xlsx`, buffer);
    } catch {}

    store.addAuditLog({ pharmacyId: effPharmacyId, actorId, actorName, action: `Extraction ${documentHint} — ${data.lineItems.length} lignes — Brouillon ${draft.id}`, level: 'info' });
    res.json({ draft });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur extraction.';
    res.status(500).json({ error: msg });
  }
});

// ─── Agent IA : UI Grounding ──────────────────────────────

app.post('/api/agent/ground', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { imageBase64, sampleAssetPath, targetSoftware } = req.body as {
    imageBase64?: string;
    sampleAssetPath?: string;
    targetSoftware: TargetSoftwareType;
  };
  try {
    const { base64, mimeType } = resolveImage(imageBase64, sampleAssetPath);
    const result = await groundTargetInterfaceWithGemini({ imageBase64: base64, mimeType, targetSoftware });
    store.addAuditLog({ pharmacyId: 'OWNER', actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: `UI Grounding "${targetSoftware}" — ${result.overallSafe ? 'SÉCURISÉ' : 'ALERTE'}`, level: result.overallSafe ? 'info' : 'warning', details: result.observations });
    res.json({ result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur grounding.';
    res.status(500).json({ error: msg });
  }
});

// ─── Agent IA : exécution brouillon (simulation locale) ──

app.post('/api/agent/execute-draft', (req, res) => {
  const { draftId } = req.body as { draftId: string };
  const draft = store.getDraft(draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }

  const actor = requirePharmacyOrOwner(req, res, draft.pharmacyId);
  if (!actor) return;

  if (draft.status !== 'approved') {
    res.status(400).json({ error: 'Le brouillon doit être approuvé avant exécution.' });
    return;
  }

  // Simulation des étapes — le garde-fou bloque toute action finale
  const steps = draft.columnMapping.map((m, i) => {
    try {
      const check = guardrail.classifyElement(m.targetColumn);
      if (check === 'FORBIDDEN_BY_GUARDRAIL') {
        throw new SafetyViolationError(`Colonne "${m.targetColumn}" interdite par le garde-fou.`);
      }
      return { stepIndex: i, action: `Remplir "${m.targetColumn}" ← ${m.sourceField}`, status: 'done' as const, timestamp: new Date().toISOString() };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `[GARDE-FOU] ${msg}`, level: 'blocked' });
      return { stepIndex: i, action: `Remplir "${m.targetColumn}"`, status: 'blocked' as const, message: msg, timestamp: new Date().toISOString() };
    }
  });

  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Exécution brouillon ${draftId} — ${steps.length} étapes`, level: 'info' });

  res.json({
    result: {
      draftId,
      success: steps.every((s) => s.status === 'done'),
      steps,
      tokensConsumed: 0,
      hasExcelFile: draft.hasExcelFile,
      excelFileName: draft.hasExcelFile ? `Brouillon_${draftId}.xlsx` : undefined,
    },
  });
});

// ─── Tâches agent Python local ────────────────────────────

app.get('/api/agent-client/next-task', (req, res) => {
  const agentKey = req.headers['x-agent-key'] as string;
  if (!agentKey) { res.status(400).json({ error: 'En-tête X-Agent-Key manquant.' }); return; }
  const ph = store.getPharmacyByAgentKey(agentKey);
  if (!ph) { res.status(403).json({ error: 'Clé agent invalide.' }); return; }
  const pending = store.getDrafts(ph.id).filter((d) => d.status === 'approved').slice(0, 1);
  if (!pending.length) { res.json({ task: null }); return; }
  res.json({ task: { id: pending[0].id, type: 'fill_stock', pharmacyId: ph.id, draft: pending[0] } });
});

app.post('/api/agent-client/report', (req, res) => {
  const { taskId, agentKey, success, message } = req.body as { taskId: string; agentKey: string; success: boolean; message: string };
  if (!agentKey) { res.status(400).json({ error: 'agentKey manquant.' }); return; }
  const ph = store.getPharmacyByAgentKey(agentKey);
  if (!ph) { res.status(403).json({ error: 'Clé agent invalide.' }); return; }
  store.addAuditLog({ pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent Local', action: `Rapport tâche ${taskId} : ${success ? 'succès' : 'échec'} — ${message}`, level: success ? 'info' : 'warning' });
  res.json({ ok: true });
});

// ─── RPA : actions sur l'écran ────────────────────────────

app.post('/api/agent-client/rpa-actions', async (req, res) => {
  const agentKey = req.headers['x-agent-key'] as string;
  const { screenshotBase64, mimeType, draftId, lineIndex } =
    req.body as { screenshotBase64: string; mimeType: string; draftId: string; lineIndex: number };

  if (!agentKey) { res.status(400).json({ error: 'X-Agent-Key manquant.' }); return; }
  const ph = store.getPharmacyByAgentKey(agentKey);
  if (!ph) { res.status(403).json({ error: 'Clé agent invalide.' }); return; }

  const draft = store.getDraft(draftId);
  if (!draft || draft.pharmacyId !== ph.id) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (draft.status !== 'approved') { res.status(400).json({ error: 'Brouillon non approuvé.' }); return; }

  try {
    const { getRPAActionsFromGemini } = await import('./src/server/geminiAgent.ts');
    const result = await getRPAActionsFromGemini({
      screenshotBase64,
      mimeType: mimeType ?? 'image/png',
      targetSoftware: ph.targetSoftware,
      extractedData: draft.extractedData,
      currentLineIndex: lineIndex ?? 0,
    });

    store.addAuditLog({
      pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent RPA',
      action: `RPA ligne ${(lineIndex ?? 0) + 1}/${draft.extractedData.lineItems.length} — ${result.actions.length} actions — ${result.allSafe ? 'sûr' : 'alerte'}`,
      level: result.allSafe ? 'info' : 'warning',
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Logs d'audit ─────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { pharmacyId, limit } = req.query as { pharmacyId?: string; limit?: string };
  res.json({ logs: store.getAuditLogs(pharmacyId, limit ? parseInt(limit) : 100) });
});

app.get('/api/pharmacies/:id/audit', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ logs: store.getAuditLogs(req.params.id) });
});

// ─── Export sauvegarde SaaS ───────────────────────────────

app.get('/api/export/saas-backup', (req, res) => {
  if (!requireOwner(req, res)) return;
  const data = store.getDashboard();
  res.json({ exportedAt: new Date().toISOString(), data });
});

// ─── Démarrage serveur ────────────────────────────────────

async function startServer(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';

  // Catch-all API 404 (avant le middleware statique)
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API introuvable.' });
  });

  if (!isProd) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(__dirname, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PharmAgent v2 — http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => { console.error('Erreur démarrage serveur :', err); process.exit(1); });
