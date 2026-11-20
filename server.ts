// ============================================================
// PharmAgent v2 — Serveur Express principal
// ============================================================

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import * as XLSX from 'xlsx';
import {
  extractDocument,
  SECOND_LOOK_EFFORT,
  groundTargetInterface,
  resolveProductMatches,
} from './src/server/aiAgent.ts';
import { fillWorkbook, FIELD_LABELS } from './src/server/excelFill.ts';
import { matchColumn, type ColumnField } from './src/server/vocabulary.ts';
import { parseAmount, readWorkbook, SHEET_MIME, sheetToDelivery } from './src/server/sheetDocument.ts';
import { DEFAULT_ORDER_PARAMS, orderFile, parseSalesJournal, proposeOrder, type OrderParams, type SalesSummary } from './src/server/orders.ts';
import { blockingReason, needsSecondLook } from './src/components/draftChecks.ts';
import { checkTextSafety } from './src/server/guardrail.ts';
import { attachReference, AUTO_THRESHOLD, matchLines, normalizeSupplier } from './src/server/productMatcher.ts';
import { store, type CatalogRowInput } from './src/server/store.ts';
import type {
  AgentProfile,
  DocumentCategory,
  DraftRecord,
  ExtractedDocumentData,
  ExtractedLineItem,
  Pharmacy,
  PharmacyUser,
  RecipeStep,
  TargetSoftwareType,
} from './src/types/pharmagent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_DIR = path.resolve(__dirname, 'agent');

const app = express();
// Render place un proxy devant le service : sans ceci toutes les requêtes partagent la même IP
app.set('trust proxy', 1);

// ─── Sécurité de base ─────────────────────────────────────

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '30mb' }));

// ─── Limitation des tentatives (connexion, appairage) ────

const attempts = new Map<string, { count: number; until: number }>();

function rateLimited(req: express.Request, res: express.Response, scope: string): boolean {
  const rec = attempts.get(`${scope}:${req.ip}`);
  if (rec && Date.now() < rec.until) {
    res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 5 minutes.' });
    return true;
  }
  return false;
}

function recordFailure(req: express.Request, scope: string): void {
  const key = `${scope}:${req.ip}`;
  const rec = attempts.get(key) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.count = 0; }
  attempts.set(key, rec);
}

function clearFailures(req: express.Request, scope: string): void {
  attempts.delete(`${scope}:${req.ip}`);
}

// ─── Authentification ────────────────────────────────────

function extractToken(req: express.Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  if (typeof req.query.token === 'string') return req.query.token;
  return undefined;
}

function getOwnerSession(req: express.Request) {
  const t = extractToken(req);
  return t ? store.verifyOwnerToken(t) : null;
}

function getPharmacySession(req: express.Request) {
  const t = extractToken(req);
  return t ? store.verifyPharmacyUserToken(t) : null;
}

function requireOwner(req: express.Request, res: express.Response) {
  const owner = getOwnerSession(req);
  if (!owner) { res.status(401).json({ error: 'Authentification du superviseur requise.' }); return null; }
  return owner;
}

function requirePharmacyOrOwner(req: express.Request, res: express.Response, pharmacyId: string) {
  const owner = getOwnerSession(req);
  if (owner && !store.getPharmacy(pharmacyId)) { res.status(404).json({ error: 'Officine inconnue.' }); return null; }
  if (owner) return { actor: owner, displayName: owner.fullName };
  const user = getPharmacySession(req);
  if (!user) { res.status(401).json({ error: 'Connexion requise.' }); return null; }
  if (user.pharmacyId !== pharmacyId) { res.status(403).json({ error: 'Accès interdit à une autre officine.' }); return null; }
  return { actor: user, displayName: user.fullName };
}

function requireApprover(req: express.Request, res: express.Response, pharmacyId: string) {
  const owner = getOwnerSession(req);
  if (owner && !store.getPharmacy(pharmacyId)) { res.status(404).json({ error: 'Officine inconnue.' }); return null; }
  if (owner) return { actor: owner, displayName: owner.fullName };
  const user = getPharmacySession(req);
  if (!user) { res.status(401).json({ error: 'Connexion requise.' }); return null; }
  if (user.pharmacyId !== pharmacyId) { res.status(403).json({ error: 'Accès interdit.' }); return null; }
  return { actor: user, displayName: user.fullName };
}
// Réglages de la pharmacie (agent, compte Équipe) : propriétaire ou compte Pharmacien
function requirePharmacist(req: express.Request, res: express.Response, pharmacyId: string) {
  const r = requireApprover(req, res, pharmacyId);
  if (r && !getOwnerSession(req) && 'role' in r.actor && r.actor.role !== 'titulaire') { res.status(403).json({ error: 'Réservé au compte Pharmacien.' }); return null; }
  return r;
}

function requireAgent(req: express.Request, res: express.Response): Pharmacy | null {
  const key = req.headers['x-agent-key'];
  const ph = typeof key === 'string' ? store.getPharmacyByAgentKey(key) : undefined;
  if (!ph) { res.status(401).json({ error: 'Agent non appairé ou clé révoquée.', code: 'invalid_agent_key' }); return null; }
  return ph;
}

// ─── Utilitaires ─────────────────────────────────────────

function publicBaseUrl(req: express.Request): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  const safeHost = /^[A-Za-z0-9.:-]+$/.test(host) ? host : 'pharmagent.onrender.com';
  return `${proto === 'http' ? 'http' : 'https'}://${safeHost}`;
}

function resolveDocument(base64Input?: string, sampleAssetPath?: string): { base64: string; mimeType: string } {
  if (base64Input) {
    const m = base64Input.match(/^data:([^;]+);base64,(.+)$/);
    if (m) return { mimeType: m[1], base64: m[2] };
    return { mimeType: 'image/jpeg', base64: base64Input };
  }
  if (sampleAssetPath) {
    const rel = sampleAssetPath.replace(/^\/+/, '');
    const imagesDir = path.resolve(__dirname, 'src/assets/images');
    const abs = path.resolve(__dirname, rel);
    if (!abs.startsWith(imagesDir + path.sep)) throw new Error('Chemin image non autorisé.');
    if (!fs.existsSync(abs)) throw new Error(`Image introuvable : ${rel}`);
    return { mimeType: rel.endsWith('.png') ? 'image/png' : 'image/jpeg', base64: fs.readFileSync(abs).toString('base64') };
  }
  throw new Error('Aucun document fourni.');
}

// Dates du document → ISO (YYYY-MM-DD). « 12/2027 » = fin de mois (convention péremption).
function toIsoDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(fullYear(+m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(fullYear(+m[2]), +m[1], 0);
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], 0);
  return undefined;

  function fullYear(y: number) { return y < 100 ? 2000 + y : y; }
  function iso(y: number, mo: number, d: number) {
    if (mo < 1 || mo > 12) return undefined;
    const day = d || new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (day < 1 || day > 31) return undefined;
    return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}

// ─── Correspondance produits ──────────────────────────────

const isLocked = (l: ExtractedLineItem) => l.match?.status === 'confirmed' || l.match?.status === 'new_product';

async function matchDocumentLines(pharmacyId: string, data: ExtractedDocumentData): Promise<{ lines: ExtractedLineItem[]; tokensConsumed: number }> {
  const supplier = normalizeSupplier(data.supplierOrOrg);
  const { lines, pendingAI } = matchLines(data.lineItems, {
    catalog: store.getCatalog(pharmacyId),
    aliases: store.getAliasesForPharmacy(pharmacyId),
    supplier,
  });
  // Les choix déjà faits par le pharmacien ne sont jamais écrasés
  data.lineItems.forEach((orig, i) => { if (isLocked(orig)) lines[i] = orig; });

  const ambiguous = pendingAI.filter((p) => !isLocked(data.lineItems[p.index]));
  let tokensConsumed = 0;
  if (ambiguous.length) {
    try {
      const { decisions, tokensConsumed: t } = await resolveProductMatches({
        supplier: data.supplierOrOrg,
        items: ambiguous.map((p) => ({
          index: p.index,
          designation: lines[p.index].designation,
          unitPriceFCFA: lines[p.index].unitPriceFCFA,
          salePriceFCFA: lines[p.index].salePriceFCFA,
          candidates: p.candidates,
        })),
      });
      tokensConsumed = t;
      for (const d of decisions) {
        const m = lines[d.index].match!;
        const pick = m.candidates.find((c) => c.productId === d.productId)!;
        const conf = Math.max(0, Math.min(1, d.confidence));
        lines[d.index].match = {
          status: conf >= AUTO_THRESHOLD ? 'auto' : 'to_review',
          method: 'ai',
          score: conf,
          productId: pick.productId,
          erpLabel: pick.erpLabel,
          candidates: [pick, ...m.candidates.filter((c) => c.productId !== pick.productId)],
        };
      }
    } catch (err) {
      // Sans IA les lignes restent « à vérifier » : on ne devine jamais
      console.warn('[PharmAgent] Correspondance IA indisponible :', (err as Error).message);
    }
  }
  return { lines: attachReference(lines, store.getCatalog(pharmacyId)), tokensConsumed };
}

function buildDraftWorkbook(draft: DraftRecord): Buffer {
  const data = draft.extractedData;
  const statusLabel: Record<string, string> = { auto: 'Auto', confirmed: 'Confirmé', to_review: 'À VÉRIFIER', new_product: 'Nouveau produit' };
  const rows = data.lineItems.map((item) => ({
    'Date Réception': data.documentDate,
    'N° Document': data.documentNumber,
    'Fournisseur': data.supplierOrOrg,
    'Libellé Grossiste': item.designation,
    'Produit ERP': item.match?.erpLabel ?? '',
    'Correspondance': item.match ? `${statusLabel[item.match.status]} (${Math.round(item.match.score * 100)}%)` : '',
    'CIP': item.cip ?? '',
    'Quantité Reçue': item.quantity,
    'N° Lot': item.lotNumber ?? '',
    'Date Péremption': item.expiryDate ?? '',
    'Prix Achat Unitaire (FCFA)': item.unitPriceFCFA,
    'Prix Vente (FCFA)': item.salePriceFCFA ?? '',
    'Total Ligne (FCFA)': item.quantity * item.unitPriceFCFA,
    'Statut': draft.status === 'approved' ? 'APPROUVÉ PAR LE PHARMACIEN' : 'BROUILLON — EN ATTENTE VALIDATION PHARMACIEN',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({ wch: Math.max(12, Math.min(40, k.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Brouillon_Stock');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Repère les colonnes d'un export ERP quel que soit leur intitulé exact
const CATALOG_FIELDS: Partial<Record<ColumnField, keyof CatalogRowInput>> = {
  product: 'erpLabel', cip: 'cip', purchase: 'purchasePriceFCFA', sale: 'salePriceFCFA', stock: 'stockQty',
};

function parseCatalogFile(base64: string): { rows: CatalogRowInput[]; columns: Partial<Record<keyof CatalogRowInput, string>> } {
  const wb = readWorkbook(Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64'));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (!raw.length) return { rows: [], columns: {} };

  const columns: Partial<Record<keyof CatalogRowInput, string>> = {};
  for (const h of Object.keys(raw[0])) {
    const target = CATALOG_FIELDS[matchColumn(h) ?? 'discount'];
    if (target && !columns[target]) columns[target] = h;
  }
  const rows = raw.map((r) => ({
    erpLabel: columns.erpLabel ? String(r[columns.erpLabel]).trim() : '',
    cip: columns.cip ? String(r[columns.cip]).trim() || undefined : undefined,
    purchasePriceFCFA: columns.purchasePriceFCFA ? parseAmount(r[columns.purchasePriceFCFA]) : undefined,
    salePriceFCFA: columns.salePriceFCFA ? parseAmount(r[columns.salePriceFCFA]) : undefined,
    stockQty: columns.stockQty ? parseAmount(r[columns.stockQty]) : undefined,
  })).filter((r) => r.erpLabel);
  return { rows, columns };
}

// ─── Tâche transmise à l'agent local ─────────────────────

function buildTaskPayload(draft: DraftRecord) {
  const d = draft.extractedData;
  return {
    id: draft.id,
    attempt: draft.execution?.attempts ?? 1,
    header: {
      supplier: d.supplierOrOrg,
      documentNumber: d.documentNumber,
      documentDate: toIsoDate(d.documentDate) ?? d.documentDate,
      totalAmount: d.totalAmountFCFA,
    },
    lines: d.lineItems.map((l, index) => ({
      index,
      product: l.match?.erpLabel ?? l.designation,
      cip: l.cip ?? '',
      designation: l.designation,
      quantity: l.quantity,
      lotNumber: l.lotNumber ?? '',
      expiryDate: toIsoDate(l.expiryDate) ?? l.expiryDate ?? '',
      purchasePrice: l.unitPriceFCFA,
      salePrice: l.salePriceFCFA ?? '',
      freeUnits: l.freeUnits || '',
      lineTotal: l.lineTotal ?? l.quantity * l.unitPriceFCFA,
      skip: l.match?.status === 'new_product' ? "Nouveau produit : à créer d'abord dans l'ERP." : undefined,
    })),
  };
}

const STEP_KINDS = new Set<RecipeStep['kind']>(['fill', 'pick', 'click', 'press', 'select', 'type', 'key', 'wait']);

function sanitizeSteps(input: unknown): { steps: RecipeStep[]; error?: string } {
  if (!Array.isArray(input)) return { steps: [] };
  if (input.length > 200) return { steps: [], error: 'Recette trop longue (200 étapes max).' };
  const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const steps: RecipeStep[] = [];
  for (const raw of input as Array<Record<string, unknown>>) {
    if (!raw || !STEP_KINDS.has(raw.kind as RecipeStep['kind'])) return { steps: [], error: `Étape invalide : ${String(raw?.kind)}` };
    const step: RecipeStep = {
      kind: raw.kind as RecipeStep['kind'],
      field: str(raw.field, 40),
      value: str(raw.value, 500),
      selectors: Array.isArray(raw.selectors) ? raw.selectors.filter((s): s is string => typeof s === 'string').slice(0, 8).map((s) => s.slice(0, 500)) : undefined,
      text: str(raw.text, 200),
      key: str(raw.key, 40),
      format: str(raw.format, 40),
      label: str(raw.label, 200),
      ms: typeof raw.ms === 'number' ? Math.max(0, Math.min(10000, raw.ms)) : undefined,
      frame: str(raw.frame, 300),
      via: raw.via === 'key' || raw.via === 'mouse' ? raw.via : undefined,
    };
    // Garde-fou : jamais de clic sur un bouton de validation, même enregistré pendant la démo
    for (const t of [step.text, step.label]) {
      const check = t ? checkTextSafety(t) : { safe: true };
      if (!check.safe) return { steps: [], error: `Garde-fou : ${check.reason}` };
    }
    steps.push(step);
  }
  return { steps };
}

// ─── Appairage par code ──────────────────────────────────

interface Pairing { id: string; secret: string; code: string; createdAt: number; hostname?: string; os?: string; pharmacyId?: string }
const PAIRING_TTL_MS = 15 * 60 * 1000;
const pairings = new Map<string, Pairing>();

function purgePairings(): void {
  for (const [id, p] of pairings) if (Date.now() - p.createdAt > PAIRING_TTL_MS) pairings.delete(id);
}

// ─── Routes santé ─────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PharmAgent', version: '2.1.0', persistence: store.persistence });
});

// ─── Authentification propriétaire ───────────────────────

app.post('/api/owner/auth/login', (req, res) => {
  if (rateLimited(req, res, 'login')) return;
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId || !password) { res.status(400).json({ error: 'Identifiant et mot de passe requis.' }); return; }
  const token = store.loginOwner(loginId.trim(), password);
  if (!token) {
    recordFailure(req, 'login');
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  clearFailures(req, 'login');
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

// Sauvegarde complète (à garder en lieu sûr : contient les comptes et clés d'agents)
app.get('/api/owner/backup', (req, res) => {
  if (!requireOwner(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pharmagent-sauvegarde-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(store.exportState()));
});

app.post('/api/owner/restore', async (req, res) => {
  if (!requireOwner(req, res)) return;
  try {
    const result = await store.importState((req.body as { data?: unknown }).data);
    store.addAuditLog({ pharmacyId: 'OWNER', actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: `Restauration d'une sauvegarde : ${result.pharmacies} officine(s), ${result.drafts} brouillon(s)`, level: 'warning' });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/dashboard', (req, res) => {
  if (!requireOwner(req, res)) return;
  res.json(store.getDashboard());
});

// ─── Pharmacies ───────────────────────────────────────────

app.post('/api/pharmacies', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { name, city, region, pharmacist, targetSoftware } = req.body as {
    name: string; city: string; region?: string; pharmacist: string; targetSoftware: TargetSoftwareType;
  };
  if (!name?.trim() || !city?.trim() || !pharmacist?.trim()) {
    res.status(400).json({ error: 'Nom, ville et titulaire sont obligatoires.' });
    return;
  }
  const { pharmacy, password } = store.createPharmacy({ name: name.trim(), city: city.trim(), region, pharmacist: pharmacist.trim(), targetSoftware: targetSoftware ?? 'ERP Officine Intégré' });
  store.addAuditLog({ pharmacyId: pharmacy.id, actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: `Création de l'officine ${pharmacy.name}`, level: 'info' });
  res.status(201).json({ pharmacy, credentials: { code: pharmacy.code, password } });
});

app.post('/api/pharmacies/:id/reset-password', (req, res) => {
  if (!requireOwner(req, res)) return;
  const ph = store.getPharmacy(req.params.id);
  const password = ph ? store.resetPharmacistPassword(ph.id) : null;
  if (!ph || !password) { res.status(404).json({ error: 'Officine introuvable.' }); return; }
  store.addAuditLog({ pharmacyId: ph.id, actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: 'Mot de passe du compte Pharmacien réinitialisé', level: 'warning' });
  res.json({ code: ph.code, password });
});

// ─── Espace pharmacie (compte Pharmacien ou Équipe) ──────

const publicUser = (u: PharmacyUser) => ({ id: u.id, pharmacyId: u.pharmacyId, fullName: u.fullName, profile: u.role === 'titulaire' ? 'pharmacien' : 'equipe' });
const publicPharmacy = (p: Pharmacy) => ({ id: p.id, name: p.name, city: p.city, code: p.code });

app.post('/api/pharmacy/auth/login', (req, res) => {
  if (rateLimited(req, res, 'login')) return;
  const { code, profile, password } = req.body as { code?: string; profile?: string; password?: string };
  if (!code || !password || (profile !== 'pharmacien' && profile !== 'equipe')) {
    res.status(400).json({ error: 'Code pharmacie, profil et mot de passe requis.' });
    return;
  }
  const r = store.loginPharmacyProfile(code, profile, password);
  if (!r) {
    recordFailure(req, 'login');
    res.status(401).json({ error: 'Code pharmacie ou mot de passe incorrect.' });
    return;
  }
  clearFailures(req, 'login');
  res.json({ token: r.token, user: publicUser(r.user), pharmacy: publicPharmacy(r.pharmacy), teamAccount: store.hasTeamAccount(r.pharmacy.id) });
});

app.get('/api/pharmacy/auth/me', (req, res) => {
  const u = getPharmacySession(req);
  const ph = u ? store.getPharmacy(u.pharmacyId) : undefined;
  if (!u || !ph) { res.status(401).json({ error: 'Connexion requise.' }); return; }
  res.json({ user: publicUser(u), pharmacy: publicPharmacy(ph), teamAccount: store.hasTeamAccount(ph.id) });
});

app.get('/api/pharmacy/dashboard', (req, res) => {
  const u = getPharmacySession(req);
  if (!u) { res.status(401).json({ error: 'Connexion requise.' }); return; }
  const snap = store.getDashboard(u.pharmacyId);
  res.json({ ...snap, pharmacies: snap.pharmacies.map(({ agentKey: _key, ...p }) => p) });
});

app.post('/api/pharmacy/auth/change-password', (req, res) => {
  const u = getPharmacySession(req);
  if (!u) { res.status(401).json({ error: 'Connexion requise.' }); return; }
  const { current, next } = req.body as { current?: string; next?: string };
  if (!next || next.length < 6) { res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum.' }); return; }
  if (!current || !store.verifyUserPassword(u.id, current)) { res.status(401).json({ error: 'Mot de passe actuel incorrect.' }); return; }
  store.setUserPassword(u.id, next);
  res.json({ ok: true });
});

app.post('/api/pharmacy/team-account', (req, res) => {
  const u = getPharmacySession(req);
  if (!u) { res.status(401).json({ error: 'Connexion requise.' }); return; }
  if (u.role !== 'titulaire') { res.status(403).json({ error: 'Réservé au compte Pharmacien.' }); return; }
  const password = store.resetTeamAccount(u.pharmacyId);
  store.addAuditLog({ pharmacyId: u.pharmacyId, actorId: u.id, actorName: u.fullName, action: 'Compte Équipe créé ou réinitialisé', level: 'info' });
  res.json({ password });
});

app.patch('/api/pharmacies/:id/subscription', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { plan, quota } = req.body as { plan: string; quota?: number };
  if (!['trial', 'standard', 'premium', 'suspended'].includes(plan)) { res.status(400).json({ error: 'Formule inconnue.' }); return; }
  store.updatePharmacySubscription(req.params.id, plan as 'trial', quota);
  res.json({ ok: true });
});

app.post('/api/pharmacies/:id/auth/login', (req, res) => {
  if (rateLimited(req, res, 'login')) return;
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId || !password) { res.status(400).json({ error: 'Identifiant et mot de passe requis.' }); return; }
  const token = store.loginPharmacyUser(req.params.id, loginId, password);
  if (!token) {
    recordFailure(req, 'login');
    res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    return;
  }
  clearFailures(req, 'login');
  res.json({ token, user: store.verifyPharmacyUserToken(token) });
});

app.get('/api/pharmacies/:id/users', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ users: store.getPharmacyUsers(req.params.id).map(({ passwordHash: _h, ...u }) => u) });
});

// Le superviseur (ou le titulaire) saisit le code affiché par l'agent sur le PC de l'officine
app.post('/api/pharmacies/:id/pair', (req, res) => {
  if (rateLimited(req, res, 'pair')) return;
  const actor = requirePharmacist(req, res, req.params.id);
  if (!actor) return;
  const ph = store.getPharmacy(req.params.id);
  if (!ph) { res.status(404).json({ error: 'Officine introuvable.' }); return; }
  purgePairings();
  const code = String((req.body as { code?: string }).code ?? '').replace(/\D/g, '');
  const pairing = [...pairings.values()].find((p) => p.code === code && !p.pharmacyId);
  if (!pairing) {
    recordFailure(req, 'pair');
    res.status(404).json({ error: 'Code inconnu ou expiré. Vérifiez le code affiché sur l\'ordinateur.' });
    return;
  }
  clearFailures(req, 'pair');
  pairing.pharmacyId = ph.id;
  store.addAuditLog({ pharmacyId: ph.id, actorId: actor.actor.id, actorName: actor.displayName, action: `Ordinateur appairé : ${pairing.hostname ?? 'inconnu'} (${pairing.os ?? '?'})`, level: 'info' });
  res.json({ ok: true, hostname: pairing.hostname, os: pairing.os });
});

app.get('/api/pharmacies/:id/agent', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  const ph = store.getPharmacies().find((p) => p.id === req.params.id);
  if (!ph) { res.status(404).json({ error: 'Officine introuvable.' }); return; }
  const profile = store.getProfile(ph.id);
  res.json({
    presence: ph.agent ?? null,
    profile: profile ? {
      mode: profile.mode, erpUrl: profile.erpUrl, windowTitle: profile.windowTitle, recordedAt: profile.recordedAt,
      headerSteps: profile.headerSteps.length, lineSteps: profile.lineSteps.length,
      fields: [...new Set([...profile.headerSteps, ...profile.lineSteps].map((s) => s.field).filter(Boolean))],
    } : null,
    queue: store.getDrafts(ph.id).filter((d) => d.execution && d.status === 'approved').slice(0, 15).map((d) => ({
      id: d.id, documentNumber: d.extractedData.documentNumber, supplier: d.extractedData.supplierOrOrg,
      lines: d.extractedData.lineItems.length, execution: d.execution,
    })),
  });
});

// ─── Entraînement & Mémoire ───────────────────────────────

app.get('/api/training/download/:type', (req, res) => {
  if (req.params.type === 'memory' && !requireOwner(req, res)) return;
  const memory = store.getMemory();
  const wb = XLSX.utils.book_new();
  let fileName: string;

  if (req.params.type === 'memory') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      memory.productAliases.map((a) => ({ 'Grossiste': a.supplier ?? '', 'Libellé Grossiste': a.rawLabel, 'Produit ERP': a.canonicalName, 'Utilisations': a.hits ?? 0 }))
    ), 'Correspondances');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      memory.columnRules.map((r) => ({ 'Champ Source (Agent)': r.sourceField, 'Colonne Cible (Logiciel)': r.targetColumn }))
    ), 'Regles_Colonnes');
    fileName = 'PharmAgent_Memoire_Agent.xlsx';
  } else if (req.params.type === 'target') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'Date Réception': '', 'N° Bon Livraison': '', 'Fournisseur': '', 'Désignation Médicament': '', 'Quantité Reçue': '', 'N° Lot Fabricant': '', 'Date Péremption': '', 'Prix Achat Unitaire (FCFA)': '', 'Total Ligne (FCFA)': '', 'Statut Validation': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN' },
    ]), 'Modele_Reception_Stock');
    fileName = 'PharmAgent_Modele_Cible_Stock.xlsx';
  } else if (req.params.type === 'catalog_template') {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'Désignation': 'AMOXICILLINE 500 MG GELULE B/12', 'CIP': '', 'Prix achat': 980, 'Prix de vente': 1350, 'Stock': 10 },
    ]), 'Catalogue');
    fileName = 'PharmAgent_Modele_Catalogue.xlsx';
  } else {
    res.status(404).json({ error: 'Type de modèle inconnu.' });
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

app.post('/api/training/rules', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { type, rawLabel, canonicalName, sourceField, targetColumn } = req.body as Record<string, string>;
  if (type === 'alias') {
    if (!rawLabel || !canonicalName) { res.status(400).json({ error: 'rawLabel et canonicalName requis.' }); return; }
    res.json({ alias: store.addProductAlias(rawLabel, canonicalName) });
    return;
  }
  if (type === 'column') {
    if (!sourceField || !targetColumn) { res.status(400).json({ error: 'sourceField et targetColumn requis.' }); return; }
    res.json({ rule: store.addColumnRule(sourceField, targetColumn) });
    return;
  }
  res.status(400).json({ error: 'type doit être "alias" ou "column".' });
});

app.delete('/api/training/rules/:id', (req, res) => {
  if (!requireOwner(req, res)) return;
  if (req.query.type === 'alias') store.removeProductAlias(req.params.id);
  else store.removeColumnRule(req.params.id);
  res.json({ ok: true });
});

app.post('/api/training/import-memory', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { productAliases, columnRules } = req.body as { productAliases?: []; columnRules?: [] };
  store.importMemoryFromJson({ productAliases, columnRules });
  res.json({ ok: true, memory: store.getMemory() });
});

// ─── Catalogue produits de l'officine ─────────────────────

app.get('/api/pharmacies/:id/catalog', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  const products = store.getCatalog(req.params.id);
  res.json({ total: products.length, products: products.slice(0, 2000) });
});

app.post('/api/pharmacies/:id/catalog/import', (req, res) => {
  const actor = requirePharmacist(req, res, req.params.id);
  if (!actor) return;
  const { fileBase64 } = req.body as { fileBase64?: string };
  if (!fileBase64) { res.status(400).json({ error: 'Fichier requis (Excel ou CSV).' }); return; }
  try {
    const { rows, columns } = parseCatalogFile(fileBase64);
    if (!columns.erpLabel) {
      res.status(400).json({ error: 'Colonne « Désignation / Libellé / Produit » introuvable dans le fichier.' });
      return;
    }
    const result = store.upsertCatalog(req.params.id, rows, 'import');
    store.addAuditLog({ pharmacyId: req.params.id, actorId: actor.actor.id, actorName: actor.displayName, action: `Import catalogue : ${result.added} ajoutés, ${result.updated} mis à jour`, level: 'info' });
    res.json({ ...result, columns, total: store.getCatalog(req.params.id).length });
  } catch (err) {
    res.status(400).json({ error: `Fichier illisible : ${(err as Error).message}` });
  }
});

// ─── Commande : journal des ventes → proposition → panier ─

app.post('/api/pharmacies/:id/sales/import', (req, res) => {
  const actor = requirePharmacist(req, res, req.params.id);
  if (!actor) return;
  const { fileBase64, fileName, periodDays } = req.body as { fileBase64?: string; fileName?: string; periodDays?: number };
  if (!fileBase64) { res.status(400).json({ error: 'Fichier requis (export des ventes en Excel ou CSV).' }); return; }
  const catalog = store.getCatalog(req.params.id);
  if (!catalog.length) { res.status(400).json({ error: "Importez d'abord le catalogue avec le stock (Mon compte › Catalogue)." }); return; }
  try {
    const parsed = parseSalesJournal(Buffer.from(fileBase64.replace(/^data:[^,]+,/, ''), 'base64'), catalog, store.getAliasesForPharmacy(req.params.id));
    const typed = Number(periodDays);
    const fromDates = parsed.days && parsed.days > 0 ? parsed.days : undefined;
    const days = fromDates ?? (typed > 0 && typed <= 366 ? Math.round(typed) : undefined);
    if (!days) { res.status(400).json({ error: 'Pas de colonne Date dans le fichier : indiquez sur combien de jours portent ces ventes.' }); return; }
    const summary: SalesSummary = {
      pharmacyId: req.params.id, importedAt: new Date().toISOString(), fileName: String(fileName ?? '').slice(0, 120),
      periodDays: days, periodSource: fromDates ? 'dates' : 'saisie', items: parsed.items, unmatched: parsed.unmatched.slice(0, 200),
    };
    store.setSales(summary);
    store.addAuditLog({ pharmacyId: req.params.id, actorId: actor.actor.id, actorName: actor.displayName,
      action: `Journal des ventes importé : ${parsed.items.length} produits sur ${days} jours (${parsed.unmatched.length} non reconnus)`, level: 'info' });
    res.json({ periodDays: days, periodSource: summary.periodSource, products: parsed.items.length, unmatched: summary.unmatched });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/pharmacies/:id/order-proposal', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  const sales = store.getSales(req.params.id);
  if (!sales) { res.json({ sales: null, lines: [] }); return; }
  const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 120 ? n : d; };
  const params: OrderParams = {
    coverDays: num(req.query.cover, DEFAULT_ORDER_PARAMS.coverDays), leadDays: num(req.query.lead, DEFAULT_ORDER_PARAMS.leadDays),
    safetyDays: num(req.query.safety, DEFAULT_ORDER_PARAMS.safetyDays),
  };
  const { items: _items, ...info } = sales;
  res.json({ sales: info, params, lines: proposeOrder(store.getCatalog(req.params.id), sales, params) });
});

app.post('/api/pharmacies/:id/order-proposal/export', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  const { lines, format } = req.body as { lines?: Array<{ label?: unknown; cip?: unknown; quantity?: unknown }>; format?: string };
  const clean = (Array.isArray(lines) ? lines : []).slice(0, 2000).map((l) => ({
    label: String(l.label ?? '').slice(0, 200), cip: l.cip ? String(l.cip).slice(0, 20) : undefined, quantity: Math.max(0, Math.round(Number(l.quantity) || 0)),
  })).filter((l) => l.label && l.quantity > 0);
  if (!clean.length) { res.status(400).json({ error: 'Panier vide.' }); return; }
  const fmt = format === 'csv' ? 'csv' : 'xlsx';
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="commande-${day}.${fmt}"`);
  res.send(orderFile(clean, fmt));
});

app.delete('/api/pharmacies/:id/catalog', (req, res) => {
  if (!requireOwner(req, res)) return;
  store.clearCatalog(req.params.id);
  res.json({ ok: true });
});

// ─── Brouillons ───────────────────────────────────────────

app.get('/api/pharmacies/:id/drafts', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ drafts: store.getDrafts(req.params.id) });
});

app.get('/api/drafts/:draftId', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  res.json({ draft });
});

app.post('/api/drafts/:draftId/approve', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') { res.status(400).json({ error: "Analyse non terminée ou en échec : rien à approuver." }); return; }
  const actor = requireApprover(req, res, draft.pharmacyId);
  if (!actor) return;
  const blocked = blockingReason(draft);
  if (blocked) { res.status(400).json({ error: blocked }); return; }
  const toReview = draft.extractedData.lineItems.filter((l) => l.match?.status === 'to_review').length;
  if (toReview) {
    res.status(400).json({ error: `${toReview} ligne(s) à vérifier : choisissez le produit ERP avant d'approuver.` });
    return;
  }
  // Approuver = confirmer les correspondances → mémorisées pour la prochaine fois
  let learned = 0;
  for (const l of draft.extractedData.lineItems) {
    const m = l.match;
    const isNewAuto = m?.status === 'auto' && m.method !== 'memory' && m.method !== 'cip';
    if (!m?.erpLabel || !(isNewAuto || m.status === 'new_product')) continue;
    store.learnMatch({
      pharmacyId: draft.pharmacyId, supplier: draft.extractedData.supplierOrOrg, rawLabel: l.designation,
      productId: m.productId, erpLabel: m.erpLabel, purchasePriceFCFA: l.unitPriceFCFA, salePriceFCFA: l.salePriceFCFA, cip: l.cip,
    });
    learned++;
  }
  const updated = store.updateDraftStatus(req.params.draftId, 'approved', actor.displayName);
  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Brouillon ${draft.extractedData.documentNumber || draft.id} approuvé — envoyé à l'agent${learned ? ` — ${learned} correspondance(s) mémorisée(s)` : ''}`, level: 'approved' });
  res.json({ ok: true, draft: updated });
});

app.post('/api/drafts/:draftId/reject', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') { res.status(400).json({ error: "Analyse non terminée ou en échec : rien à approuver." }); return; }
  const actor = requireApprover(req, res, draft.pharmacyId);
  if (!actor) return;
  const { reason } = req.body as { reason?: string };
  const updated = store.updateDraftStatus(req.params.draftId, 'rejected', actor.displayName, reason);
  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Brouillon ${draft.extractedData.documentNumber || draft.id} rejeté`, level: 'rejected', details: reason });
  res.json({ ok: true, draft: updated });
});

app.post('/api/drafts/:draftId/requeue', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  const actor = requireApprover(req, res, draft.pharmacyId);
  if (!actor) return;
  if (draft.execution?.status === 'running') { res.status(400).json({ error: 'Saisie déjà en cours.' }); return; }
  const updated = store.requeueExecution(draft.id);
  if (!updated) { res.status(400).json({ error: 'Seul un brouillon approuvé peut être renvoyé à l\'agent.' }); return; }
  store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Saisie relancée : ${draft.extractedData.documentNumber || draft.id}`, level: 'info' });
  res.json({ ok: true, draft: updated });
});

// Le pharmacien tranche une ligne : choisit un produit, saisit le libellé ERP, ou marque « nouveau produit »
app.post('/api/drafts/:draftId/lines/:index/match', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  const index = parseInt(req.params.index, 10);
  const line = draft.extractedData.lineItems[index];
  if (!line) { res.status(404).json({ error: 'Ligne introuvable.' }); return; }

  const { productId, erpLabel, newProduct } = req.body as { productId?: string; erpLabel?: string; newProduct?: boolean };
  const prev = line.match ?? { candidates: [] };

  if (newProduct) {
    line.match = { status: 'new_product', method: 'manual', score: 1, erpLabel: erpLabel?.trim() || line.designation, candidates: prev.candidates };
  } else {
    const fromCatalog = productId ? store.getCatalog(draft.pharmacyId).find((p) => p.id === productId) : undefined;
    const label = fromCatalog?.erpLabel ?? erpLabel?.trim();
    if (!label) { res.status(400).json({ error: 'productId ou erpLabel requis.' }); return; }
    // Prix de la fiche AVANT mémorisation : l'écart éventuel reste visible jusqu'à l'approbation
    const reference = fromCatalog ? { purchase: fromCatalog.purchasePriceFCFA, sale: fromCatalog.salePriceFCFA, stock: fromCatalog.stockQty } : undefined;
    const product = store.learnMatch({
      pharmacyId: draft.pharmacyId, supplier: draft.extractedData.supplierOrOrg, rawLabel: line.designation,
      productId: fromCatalog?.id, erpLabel: label, purchasePriceFCFA: line.unitPriceFCFA, salePriceFCFA: line.salePriceFCFA, cip: line.cip,
    });
    line.match = { status: 'confirmed', method: 'manual', score: 1, productId: product.id, erpLabel: product.erpLabel, candidates: prev.candidates, reference };
  }
  store.updateDraftItems(draft.id, draft.extractedData.lineItems);
  res.json({ draft: store.getDraft(draft.id) });
});

// Le pharmacien corrige une valeur lue sur le document (quantité, lot, prix…)
app.patch('/api/drafts/:draftId/lines/:index', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  const line = draft.extractedData.lineItems[parseInt(req.params.index, 10)];
  if (!line) { res.status(404).json({ error: 'Ligne introuvable.' }); return; }
  const b = req.body as Partial<Record<'quantity' | 'unitPriceFCFA' | 'salePriceFCFA', number> & Record<'lotNumber' | 'expiryDate', string>>;
  if (typeof b.quantity === 'number' && b.quantity >= 0) line.quantity = Math.round(b.quantity);
  if (typeof b.unitPriceFCFA === 'number' && b.unitPriceFCFA >= 0) line.unitPriceFCFA = b.unitPriceFCFA;
  if (typeof b.salePriceFCFA === 'number' && b.salePriceFCFA >= 0) line.salePriceFCFA = b.salePriceFCFA;
  if (typeof b.lotNumber === 'string') line.lotNumber = b.lotNumber.trim().slice(0, 60);
  if (typeof b.expiryDate === 'string') line.expiryDate = b.expiryDate.trim().slice(0, 20);
  store.updateDraftItems(draft.id, draft.extractedData.lineItems);
  res.json({ draft: store.getDraft(draft.id) });
});

// Relance la correspondance (ex. après import du catalogue) sans toucher aux choix du pharmacien
app.post('/api/drafts/:draftId/rematch', async (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  if (draft.status !== 'pending') { res.status(400).json({ error: "Ce brouillon n'est plus en attente." }); return; }
  try {
    const { lines } = await matchDocumentLines(draft.pharmacyId, draft.extractedData);
    store.updateDraftItems(draft.id, lines);
    res.json({ draft: store.getDraft(draft.id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/drafts/:draftId/fill-excel', async (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  const actor = requirePharmacyOrOwner(req, res, draft.pharmacyId);
  if (!actor) return;
  if (draft.extractionStatus === 'processing' || draft.extractionStatus === 'error') { res.status(400).json({ error: 'Analyse non terminée : rien à écrire.' }); return; }
  const { fileBase64 } = req.body as { fileBase64?: string };
  if (!fileBase64) { res.status(400).json({ error: 'Fichier Excel requis (.xlsx).' }); return; }
  try {
    const t = buildTaskPayload(draft);
    const { buffer, report } = await fillWorkbook(
      Buffer.from(fileBase64.replace(/^data:[^,]+,/, ''), 'base64'),
      { supplier: t.header.supplier, documentNumber: t.header.documentNumber, documentDate: t.header.documentDate },
      t.lines.map((l, i) => ({ product: l.product, cip: l.cip, quantity: l.quantity, lotNumber: l.lotNumber, expiryDate: l.expiryDate, purchasePrice: l.purchasePrice, salePrice: l.salePrice,
        freeUnits: l.freeUnits, discountPercent: draft.extractedData.lineItems[i]?.discountPercent ?? '', vatRate: draft.extractedData.lineItems[i]?.vatRate ?? '', lineTotal: l.lineTotal })),
    );
    store.addAuditLog({ pharmacyId: draft.pharmacyId, actorId: actor.actor.id, actorName: actor.displayName, action: `Fichier Excel rempli : ${report.linesWritten} ligne(s) dans « ${report.sheet} »`, level: 'info' });
    res.json({ fileBase64: buffer.toString('base64'), report: { ...report, missingLabels: report.missing.map((f) => FIELD_LABELS[f]) } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg.startsWith('Aucune ligne') ? msg : `Fichier illisible : utilisez un fichier Excel (.xlsx), LibreOffice (.ods) ou CSV. Numbers : Fichier › Exporter vers › Excel. ${msg}` });
  }
});

app.get('/api/drafts/:draftId/download', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  if (!draft) { res.status(404).json({ error: 'Brouillon introuvable.' }); return; }
  if (!requirePharmacyOrOwner(req, res, draft.pharmacyId)) return;
  const safeNumber = (draft.extractedData.documentNumber || draft.id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="PharmAgent_${safeNumber}.xlsx"`);
  res.send(buildDraftWorkbook(draft));
});

// ─── Agent IA : extraction document (image ou PDF) ───────

app.post('/api/agent/extract', async (req, res) => {
  const { pharmacyId, imageBase64, sampleAssetPath, documentHint, taskPrompt, zoomBase64, fileName } = req.body as {
    pharmacyId?: string; imageBase64?: string; sampleAssetPath?: string; documentHint?: DocumentCategory; taskPrompt?: string; zoomBase64?: unknown; fileName?: string;
  };

  const owner = getOwnerSession(req);
  const pharmacyUser = getPharmacySession(req);
  if (!owner && !pharmacyUser) { res.status(401).json({ error: 'Connexion requise.' }); return; }

  const effPharmacyId = pharmacyId ?? pharmacyUser?.pharmacyId;
  if (!effPharmacyId || !store.getPharmacy(effPharmacyId)) { res.status(400).json({ error: 'Officine inconnue.' }); return; }
  if (pharmacyUser && pharmacyUser.pharmacyId !== effPharmacyId) { res.status(403).json({ error: 'Accès interdit à une autre officine.' }); return; }
  const quota = store.checkQuota(effPharmacyId);
  if (!quota.ok) { res.status(429).json({ error: quota.reason }); return; }

  let resolved: { base64: string; mimeType: string };
  try {
    resolved = resolveDocument(imageBase64, sampleAssetPath);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Document invalide.' }); return;
  }
  // Tableur reconnu par son type ou son extension (certains navigateurs envoient application/octet-stream)
  const isSheet = SHEET_MIME.test(resolved.mimeType) || /\.(csv|xlsx|xls|ods)$/i.test(fileName ?? '');
  if (!isSheet && !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(resolved.mimeType)) {
    res.status(400).json({ error: 'Format non pris en charge : PDF, Excel, CSV, ou photo (JPG, PNG).' }); return;
  }

  // Agrandissements facultatifs d'une photo (faits par le téléphone) : au plus 2, images uniquement
  const zooms = (Array.isArray(zoomBase64) && resolved.mimeType !== 'application/pdf' ? zoomBase64 : []).slice(0, 2).flatMap((z) => {
    const m = typeof z === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(z) : null;
    return m ? [{ mimeType: m[1], base64: m[2] }] : [];
  });

  const actorId = owner?.id ?? pharmacyUser!.id;
  const actorName = owner?.fullName ?? pharmacyUser!.fullName;
  const category = documentHint ?? 'bon_livraison';

  // Créer le brouillon immédiatement (état « en cours ») pour éviter le timeout HTTP
  const draft = store.createDraft({
    pharmacyId: effPharmacyId, status: 'pending', extractionStatus: 'processing',
    documentCategory: category,
    extractedData: { documentType: category, documentNumber: '', supplierOrOrg: '', recipientPharmacy: '', documentDate: '', currency: 'FCFA', totalAmountFCFA: 0, lineItems: [] },
    columnMapping: [], actorId, actorName, tokensConsumed: 0,
  });
  res.json({ draft });

  // Traitement IA en arrière-plan (ne bloque plus la réponse HTTP)
  (async () => {
    try {
      const params = { imageBase64: resolved.base64, mimeType: resolved.mimeType, documentHint: category, taskPrompt, zooms };
      let extraction: { data: ExtractedDocumentData; tokensConsumed: number } | undefined;
      if (isSheet) {
        // Fichier du grossiste : lu tel quel (exact). Colonnes non reconnues : l'IA lit le texte du tableau
        const buf = Buffer.from(resolved.base64, 'base64');
        const direct = sheetToDelivery(buf, fileName);
        if (direct?.lineItems.length) extraction = { data: direct, tokensConsumed: 0 };
        else {
          const wb = readWorkbook(buf);
          const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ';' })).join('\n').slice(0, 150_000);
          extraction = await extractDocument({ ...params, imageBase64: text, mimeType: 'text/plain', zooms: [] });
        }
      }
      extraction ??= await extractDocument(params);
      // Total absent ou qui ne recoupe pas les lignes : une seconde lecture plus attentive, gardée si elle est cohérente
      if (!isSheet && needsSecondLook(extraction.data)) {
        try {
          const second = await extractDocument({ ...params, effort: SECOND_LOOK_EFFORT });
          extraction.tokensConsumed += second.tokensConsumed;
          if (!needsSecondLook(second.data)) extraction.data = second.data;
        } catch { /* la première lecture reste valable */ }
      }
      const data = extraction.data;
      data.source = isSheet ? 'fichier' : resolved.mimeType === 'application/pdf' ? 'pdf' : 'photo';
      data.lineItems = (data.lineItems ?? []).filter((l) => l.designation?.trim());
      const matched = await matchDocumentLines(effPharmacyId, data);
      data.lineItems = matched.lines;
      const first: Record<string, unknown> = Object.fromEntries(Object.entries(data.lineItems[0] ?? {}).map(([k, v]) => [`item.${k}`, v]));
      const sample: Record<string, unknown> = { ...data, ...first };
      const columnMapping = store.getMemory().columnRules.map((r) => ({
        sourceField: r.sourceField, targetColumn: r.targetColumn, exampleValue: String(sample[r.sourceField] ?? ''),
      }));
      store.finalizeExtraction(draft.id, data, columnMapping, extraction.tokensConsumed + matched.tokensConsumed);
      const toReview = data.lineItems.filter((l) => l.match?.status === 'to_review').length;
      store.addAuditLog({ pharmacyId: effPharmacyId, actorId, actorName,
        action: `Extraction ${category} — ${data.lineItems.length} lignes (${data.lineItems.length - toReview} reconnues, ${toReview} à vérifier)`,
        level: 'info' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur extraction.';
      console.error('[PharmAgent] Extraction async :', msg);
      store.failExtraction(draft.id, msg);
    }
  })();
});

// ─── Agent IA : inspection d'interface ───────────────────

app.post('/api/agent/ground-interface', async (req, res) => {
  if (!requireOwner(req, res)) return;
  const { imageBase64, targetSoftware } = req.body as { imageBase64?: string; targetSoftware?: TargetSoftwareType };
  try {
    const { base64, mimeType } = resolveDocument(imageBase64);
    const result = await groundTargetInterface({ imageBase64: base64, mimeType, targetSoftware: targetSoftware ?? 'ERP Officine Intégré' });
    store.addAuditLog({ pharmacyId: 'OWNER', actorId: 'OWNER-01', actorName: store.getOwner().fullName, action: `Inspection d'interface — ${result.overallSafe ? 'SÉCURISÉ' : 'ALERTE'}`, level: result.overallSafe ? 'info' : 'warning', details: result.observations });
    res.json({ result });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur inspection.' });
  }
});

// ─── Agent local : appairage ─────────────────────────────

app.post('/api/agent-client/pair/start', (req, res) => {
  purgePairings();
  if (pairings.size > 500) { res.status(503).json({ error: 'Trop de demandes en cours, réessayez.' }); return; }
  const { hostname, os } = req.body as { hostname?: string; os?: string };
  const active = new Set([...pairings.values()].map((p) => p.code));
  let code: string;
  do { code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); } while (active.has(code));
  const pairing: Pairing = {
    id: crypto.randomUUID(), secret: crypto.randomBytes(24).toString('base64url'), code, createdAt: Date.now(),
    hostname: typeof hostname === 'string' ? hostname.slice(0, 80) : undefined,
    os: typeof os === 'string' ? os.slice(0, 80) : undefined,
  };
  pairings.set(pairing.id, pairing);
  res.json({ pairingId: pairing.id, secret: pairing.secret, code, expiresInSec: PAIRING_TTL_MS / 1000 });
});

app.get('/api/agent-client/pair/status', (req, res) => {
  purgePairings();
  const p = pairings.get(String(req.query.pairingId ?? ''));
  const secret = String(req.query.secret ?? '');
  if (!p || p.secret.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(p.secret), Buffer.from(secret))) {
    res.status(404).json({ status: 'expired' });
    return;
  }
  if (!p.pharmacyId) { res.json({ status: 'pending' }); return; }
  const ph = store.getPharmacy(p.pharmacyId);
  pairings.delete(p.id);
  if (!ph) { res.status(404).json({ status: 'expired' }); return; }
  res.json({ status: 'paired', agentKey: ph.agentKey, pharmacyId: ph.id, pharmacyName: ph.name });
});

// ─── Agent local : fonctionnement ────────────────────────

app.post('/api/agent-client/heartbeat', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  const { hostname, os, version, state } = req.body as Record<string, string | undefined>;
  store.touchAgent(ph.id, {
    hostname: hostname?.slice(0, 80), os: os?.slice(0, 80), version: version?.slice(0, 20), state: state?.slice(0, 120),
  });
  res.json({ pharmacy: { id: ph.id, name: ph.name }, profile: store.getProfile(ph.id) ?? null });
});

app.get('/api/agent-client/profile', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  res.json({ profile: store.getProfile(ph.id) ?? null });
});

app.put('/api/agent-client/profile', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  const b = req.body as Partial<AgentProfile>;
  if (b.mode !== 'web' && b.mode !== 'desktop') { res.status(400).json({ error: 'mode doit être "web" ou "desktop".' }); return; }
  const header = sanitizeSteps(b.headerSteps);
  const lines = sanitizeSteps(b.lineSteps);
  const error = header.error ?? lines.error;
  if (error) {
    store.addAuditLog({ pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent local', action: 'Démo refusée par le garde-fou', level: 'blocked', details: error });
    res.status(400).json({ error });
    return;
  }
  if (!lines.steps.length) { res.status(400).json({ error: 'La démo ne contient aucune saisie de ligne.' }); return; }
  const profile = store.saveProfile({
    pharmacyId: ph.id,
    mode: b.mode,
    erpUrl: typeof b.erpUrl === 'string' ? b.erpUrl.slice(0, 500) : undefined,
    formUrl: typeof b.formUrl === 'string' ? b.formUrl.slice(0, 1000) : undefined,
    windowTitle: typeof b.windowTitle === 'string' ? b.windowTitle.slice(0, 200) : undefined,
    headerSteps: header.steps,
    lineSteps: lines.steps,
    recordedAt: new Date().toISOString(),
  });
  store.addAuditLog({ pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent local', action: `Démo enregistrée (${b.mode === 'web' ? 'ERP web' : 'logiciel installé'}) — ${lines.steps.length} étapes par ligne`, level: 'info' });
  res.json({ profile });
});

// Exemple réel à saisir pendant la démo (dernier bon de l'officine), sinon exemple générique
app.get('/api/agent-client/sample', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  const draft = store.getDrafts(ph.id).find((d) => d.extractedData.lineItems.length > 0);
  if (draft) {
    const t = buildTaskPayload(draft);
    res.json({ header: t.header, line: t.lines[0] });
    return;
  }
  res.json({
    header: { supplier: 'UBIPHARM', documentNumber: 'BL-DEMO-001', documentDate: new Date().toISOString().slice(0, 10), totalAmount: 9800 },
    line: { index: 0, product: 'PARACETAMOL 500 MG CP B/20', cip: '', designation: 'PARACETAMOL 500MG CPR B20', quantity: 10, lotNumber: 'LOT2401', expiryDate: '2027-12-31', purchasePrice: 980, salePrice: 1350, lineTotal: 9800 },
  });
});

app.post('/api/agent-client/claim', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  store.touchAgent(ph.id, {});
  const draft = store.claimNextExecution(ph.id);
  if (!draft) { res.json({ task: null }); return; }
  store.addAuditLog({ pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent local', action: `Saisie démarrée : ${draft.extractedData.documentNumber || draft.id} (${draft.extractedData.lineItems.length} lignes)`, level: 'info' });
  res.json({ task: buildTaskPayload(draft) });
});

app.post('/api/agent-client/tasks/:draftId/result', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  const b = req.body as { status?: string; message?: string; durationMs?: number; lines?: Array<{ index: number; ok: boolean; message?: string }> };
  if (b.status !== 'done' && b.status !== 'failed') { res.status(400).json({ error: 'status doit être "done" ou "failed".' }); return; }
  const lines = Array.isArray(b.lines)
    ? b.lines.filter((l) => typeof l?.index === 'number').map((l) => ({ index: l.index, ok: !!l.ok, message: typeof l.message === 'string' ? l.message.slice(0, 300) : undefined }))
    : undefined;
  const draft = store.finishExecution(req.params.draftId, ph.id, {
    status: b.status, message: typeof b.message === 'string' ? b.message : undefined,
    durationMs: typeof b.durationMs === 'number' ? Math.round(b.durationMs) : undefined, lines,
  });
  if (!draft) { res.status(409).json({ error: 'Cette saisie n\'est pas en cours (déjà terminée ou relancée).' }); return; }
  const okCount = lines?.filter((l) => l.ok).length ?? 0;
  store.addAuditLog({
    pharmacyId: ph.id, actorId: 'AGENT', actorName: 'Agent local',
    action: b.status === 'done'
      ? `Saisie terminée : ${draft.extractedData.documentNumber || draft.id} — ${okCount} ligne(s) en ${Math.round((b.durationMs ?? 0) / 1000)} s`
      : `Saisie en échec : ${draft.extractedData.documentNumber || draft.id}`,
    level: b.status === 'done' ? 'info' : 'warning',
    details: b.message,
  });
  res.json({ ok: true });
});

// L'agent local envoie les produits lus dans l'ERP (réponses de la recherche produit)
app.post('/api/agent-client/catalog', (req, res) => {
  const ph = requireAgent(req, res);
  if (!ph) return;
  const { products } = req.body as { products?: CatalogRowInput[] };
  if (!Array.isArray(products)) { res.status(400).json({ error: 'products doit être un tableau.' }); return; }
  const result = store.upsertCatalog(ph.id, products.slice(0, 20000), 'erp_capture');
  res.json({ ...result, total: store.getCatalog(ph.id).length });
});

// ─── Installation de l'agent (public : aucun secret dedans) ─

// ZIP d'un seul fichier, avec le droit d'exécution : un .command téléchargé tel quel n'est pas exécutable sur Mac.
function zipSingleFile(name: string, content: Buffer, mode = 0o755): Buffer {
  const nameBuf = Buffer.from(name, 'utf-8');
  const crc = zlib.crc32(content);
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(10, 6); central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(local.length + nameBuf.length + content.length, 16);
  return Buffer.concat([local, nameBuf, content, central, nameBuf, end]);
}
function agentFile(name: string): string {
  return fs.readFileSync(path.join(AGENT_DIR, name), 'utf-8');
}

function sendScript(res: express.Response, body: string, fileName: string, type: string, crlf = false): void {
  res.setHeader('Content-Type', `${type}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(crlf ? body.replace(/\r?\n/g, '\r\n') : body);
}

app.get('/install/windows', (req, res) => {
  const base = publicBaseUrl(req);
  sendScript(res, agentFile('PharmAgent-Installer.bat').replaceAll('__SERVER_URL__', base), 'PharmAgent-Installer.bat', 'application/octet-stream', true);
});

app.get('/install/windows.ps1', (req, res) => {
  sendScript(res, agentFile('install.ps1').replaceAll('__SERVER_URL__', publicBaseUrl(req)), 'install.ps1', 'text/plain', true);
});

app.get('/install/mac.zip', (req, res) => {
  const script = `#!/bin/bash\n# PharmAgent — installation et lancement (macOS)\ncurl -fsSL "${publicBaseUrl(req)}/install/install.sh" | bash\n`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="PharmAgent-Mac.zip"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(zipSingleFile('PharmAgent-Mac.command', Buffer.from(script, 'utf-8')));
});

app.get('/install/mac', (req, res) => {
  const base = publicBaseUrl(req);
  sendScript(res, `#!/bin/bash\n# PharmAgent — installation macOS\ncurl -fsSL "${base}/install/install.sh" | bash\nread -n 1 -s -r -p "Appuyez sur une touche pour fermer cette fenêtre..."\n`, 'PharmAgent-Installer.command', 'application/octet-stream');
});

app.get('/install/install.sh', (req, res) => {
  sendScript(res, agentFile('install.sh').replaceAll('__SERVER_URL__', publicBaseUrl(req)), 'install.sh', 'text/x-shellscript');
});

app.get('/agent/pharmagent_agent.py', (_req, res) => {
  sendScript(res, agentFile('pharmagent_agent.py'), 'pharmagent_agent.py', 'text/x-python');
});

app.get('/agent/version', (_req, res) => {
  const src = agentFile('pharmagent_agent.py');
  const version = src.match(/^AGENT_VERSION\s*=\s*"([^"]+)"/m)?.[1] ?? '0';
  res.json({ version, sha256: crypto.createHash('sha256').update(src).digest('hex') });
});

// ─── Logs d'audit ─────────────────────────────────────────

app.get('/api/audit', (req, res) => {
  if (!requireOwner(req, res)) return;
  const { pharmacyId, limit } = req.query as { pharmacyId?: string; limit?: string };
  res.json({ logs: store.getAuditLogs(pharmacyId, limit ? Math.min(1000, parseInt(limit, 10) || 100) : 100) });
});

app.get('/api/pharmacies/:id/audit', (req, res) => {
  if (!requirePharmacyOrOwner(req, res, req.params.id)) return;
  res.json({ logs: store.getAuditLogs(req.params.id) });
});

// ─── Démarrage serveur ────────────────────────────────────

async function startServer(): Promise<void> {
  await store.init();
  const isProd = process.env.NODE_ENV === 'production';

  app.use(['/api', '/install', '/agent'], (_req, res) => {
    res.status(404).json({ error: 'Ressource introuvable.' });
  });

  if (!isProd) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(__dirname, 'dist');
    app.use(express.static(dist, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`PharmAgent v2 — http://0.0.0.0:${port} (stockage : ${store.persistence})`);
  });

  const stop = () => {
    server.close();
    store.shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

startServer().catch((err) => { console.error('Erreur démarrage serveur :', err); process.exit(1); });
