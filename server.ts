import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import {
  extractDocumentWithGemini,
  groundTargetInterfaceWithGemini,
  mapToRealExcelColumnsWithGemini,
} from './src/server/geminiAgent.ts';
import { guardrail, SafetyViolationError } from './src/server/guardrail.ts';
import { QuotaError, store, PROVISIONAL_PHARMACY_CREDENTIALS } from './src/server/store.ts';
import type {
  DocumentCategory,
  DraftRecord,
  ExecutionRunResult,
  ExecutionStepLog,
  ExtractedDocumentData,
  ExtractedLineItem,
  GroundedTargetElement,
  OwnerAccount,
  PharmacyUserAccount,
  PharmacyUserRole,
  QuotaRequestKind,
  SubscriptionPlanId,
  TargetExecutionMode,
  TargetSoftwareType,
} from './src/types/pharmagent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '30mb' }));

// Limiteur de tentatives de connexion (en mémoire) : 10 échecs / 15 min par IP + route.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function loginKey(req: express.Request): string {
  return `${req.ip}:${req.path}`;
}

function loginRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const now = Date.now();
  const entry = loginFailures.get(loginKey(req));
  if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({ error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' });
    return;
  }
  res.on('finish', () => {
    const key = loginKey(req);
    if (res.statusCode === 401) {
      const cur = loginFailures.get(key);
      if (cur && cur.resetAt > Date.now()) cur.count += 1;
      else loginFailures.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    } else if (res.statusCode < 400) {
      loginFailures.delete(key);
    }
  });
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailures) if (v.resetAt <= now) loginFailures.delete(k);
}, LOGIN_WINDOW_MS).unref();

function resolveImagePayload(
  base64Input?: string,
  sampleAssetPath?: string,
  fallbackMime = 'image/jpeg'
): { base64: string; mimeType: string } {
  if (base64Input) {
    const match = base64Input.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], base64: match[2] };
    }
    return { mimeType: fallbackMime, base64: base64Input };
  }

  if (sampleAssetPath) {
    const safeRelative = sampleAssetPath.replace(/^\/+/, '');
    const allowedRoots = [
      path.resolve(__dirname, 'src/assets/images'),
      path.resolve(__dirname, 'dist/src/assets/images'),
    ];
    const candidates = [
      path.resolve(__dirname, safeRelative),
      path.resolve(__dirname, 'dist', safeRelative),
    ];
    const absolutePath = candidates.find(
      (c) =>
        allowedRoots.some((root) => c.startsWith(root + path.sep)) &&
        fs.existsSync(c)
    );
    if (!absolutePath) {
      throw new Error('Chemin d’image exemple non autorisé ou introuvable.');
    }
    const buffer = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { base64: buffer.toString('base64'), mimeType };
  }

  throw new Error('Aucune image fournie (ni photo prise/importée, ni exemple sélectionné).');
}

function resolveSourceFieldValue(
  extracted: ExtractedDocumentData,
  item: ExtractedLineItem,
  sourceField: string
): string | number {
  if (sourceField.startsWith('extra:')) {
    const key = sourceField.slice('extra:'.length).trim().toLowerCase();
    const found = (extracted.extraFields || []).find((f) => f.key.trim().toLowerCase() === key);
    return found ? found.value : '';
  }

  switch (sourceField) {
    case 'documentNumber':
      return extracted.documentNumber;
    case 'supplierOrOrg':
      return extracted.supplierOrOrg;
    case 'recipientPharmacy':
      return extracted.recipientPharmacy || '';
    case 'documentDate':
      return extracted.documentDate;
    case 'billingPeriod':
      return extracted.billingPeriod || extracted.documentDate || '';
    case 'meterNumber':
      return extracted.meterNumber || '';
    case 'consumption':
      return extracted.consumption || '';
    case 'totalAmountFCFA':
      return extracted.totalAmountFCFA ?? item.unitPriceFCFA ?? 0;
    case 'customerAddress':
      return extracted.customerAddress || '';
    case 'customerCity':
      return extracted.customerCity || '';
    case 'item.designation':
      return item.designation;
    case 'item.quantity':
      return item.quantity;
    case 'item.lotNumber':
      return item.lotNumber || 'N/A';
    case 'item.expiryDate':
      return item.expiryDate || 'N/A';
    case 'item.unitPriceFCFA':
      return item.unitPriceFCFA;
    case 'item.lineTotalFCFA':
      return item.quantity * item.unitPriceFCFA;
    case 'draftStatus':
      return 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN';
    default:
      return '';
  }
}

function resolveJsonPathValue(extracted: ExtractedDocumentData, sourceJsonPath?: string): string {
  if (!sourceJsonPath) return '';
  const clean = sourceJsonPath.replace(/^extracted\./, '').trim();
  const firstItem = extracted.lineItems?.[0];

  if (clean.startsWith('extra:')) {
    return String(resolveSourceFieldValue(extracted, firstItem || ({} as ExtractedLineItem), clean));
  }

  const normalized = clean
    .replace(/^firstLineItem\./, 'item.')
    .replace(/^lineItems\[0\]\./, 'item.');

  if (firstItem) {
    const direct = resolveSourceFieldValue(extracted, firstItem, normalized);
    if (direct !== '') return String(direct);
  }

  const record = extracted as unknown as Record<string, unknown>;
  if (record[clean] !== undefined && record[clean] !== null) {
    return String(record[clean]);
  }
  return '';
}

function hydrateElementsWithExtractedData(
  elements: GroundedTargetElement[],
  extracted: ExtractedDocumentData
): GroundedTargetElement[] {
  return elements.map((el) => {
    if (!el.semanticMapping) return el;
    const dynamicVal = resolveJsonPathValue(extracted, el.semanticMapping.sourceJsonPath);
    if (!dynamicVal) return el;
    return {
      ...el,
      semanticMapping: {
        ...el.semanticMapping,
        sampleValueToInsert: dynamicVal,
      },
    };
  });
}

function extractToken(req: express.Request): string | null {
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return queryToken || null;
}

function getOwnerSession(req: express.Request): OwnerAccount | null {
  const token = extractToken(req);
  if (!token) return null;
  return store.verifyOwnerSessionToken(token);
}

function getPharmacySession(req: express.Request): PharmacyUserAccount | null {
  const token = extractToken(req);
  if (!token) return null;
  return store.verifySessionToken(token);
}

function requireOwnerSession(req: express.Request, res: express.Response): OwnerAccount | null {
  const owner = getOwnerSession(req);
  if (!owner) {
    res.status(401).json({ error: 'Authentification du Pharmacien propriétaire requise.' });
    return null;
  }
  return owner;
}

type AuthenticatedActor =
  | { kind: 'owner'; owner: OwnerAccount; displayName: string; role: 'owner' | 'co_supervisor' }
  | { kind: 'pharmacy_user'; user: PharmacyUserAccount; displayName: string; role: PharmacyUserRole };

function formatSupervisorDisplay(owner: OwnerAccount): string {
  const roleLabel = owner.role === 'co_supervisor' ? 'Co-Superviseur' : 'Propriétaire';
  return `${owner.fullName} (${roleLabel})`;
}

function getActorForPharmacy(req: express.Request, pharmacyId: string): AuthenticatedActor | null {
  const owner = getOwnerSession(req);
  if (owner) {
    return {
      kind: 'owner',
      owner,
      displayName: formatSupervisorDisplay(owner),
      role: owner.role || 'owner',
    };
  }
  const user = getPharmacySession(req);
  if (user && user.pharmacyId === pharmacyId) {
    return {
      kind: 'pharmacy_user',
      user,
      displayName: `${user.fullName} (@${user.loginId})`,
      role: user.role,
    };
  }
  return null;
}

function requirePharmacyOrOwner(
  req: express.Request,
  res: express.Response,
  pharmacyId: string
): AuthenticatedActor | null {
  const owner = getOwnerSession(req);
  if (owner) {
    return {
      kind: 'owner',
      owner,
      displayName: formatSupervisorDisplay(owner),
      role: owner.role || 'owner',
    };
  }
  const user = getPharmacySession(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise avec votre identifiant et mot de passe.' });
    return null;
  }
  if (user.pharmacyId !== pharmacyId) {
    res.status(403).json({ error: 'Accès interdit à une autre officine.' });
    return null;
  }
  return {
    kind: 'pharmacy_user',
    user,
    displayName: `${user.fullName} (@${user.loginId})`,
    role: user.role,
  };
}

function requireApproverSession(
  req: express.Request,
  res: express.Response,
  pharmacyId: string
): AuthenticatedActor | null {
  const actor = requirePharmacyOrOwner(req, res, pharmacyId);
  if (!actor) return null;
  if (actor.kind === 'pharmacy_user' && actor.user.role === 'assistant') {
    res.status(403).json({
      error:
        'Action réservée au Pharmacien titulaire ou Pharmacien adjoint. Un Assistant/Préparateur ne peut pas valider en stock.',
    });
    return null;
  }
  return actor;
}

function requireTitulaireOrOwner(
  req: express.Request,
  res: express.Response,
  pharmacyId: string
): AuthenticatedActor | null {
  const actor = requirePharmacyOrOwner(req, res, pharmacyId);
  if (!actor) return null;
  if (actor.kind === 'pharmacy_user' && actor.user.role !== 'titulaire') {
    res.status(403).json({
      error:
        'Action réservée au Pharmacien titulaire ou au Propriétaire. Seule la validation en stock est déléguée au Pharmacien adjoint.',
    });
    return null;
  }
  return actor;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PharmAgent' });
});

app.post('/api/owner/auth/login', loginRateLimit, (req, res) => {
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId?.trim() || !password) {
    res.status(400).json({ error: 'Identifiant et mot de passe obligatoires.' });
    return;
  }
  const owner = store.authenticateOwner(loginId, password);
  if (!owner) {
    res.status(401).json({ error: 'Identifiant ou mot de passe propriétaire invalide.' });
    return;
  }
  const token = store.createOwnerSessionToken(owner);
  res.json({ token, owner });
});

app.get('/api/owner/auth/me', (req, res) => {
  const owner = getOwnerSession(req);
  if (!owner) {
    res.status(401).json({ error: 'Session propriétaire expirée ou invalide.' });
    return;
  }
  res.json({ owner });
});

app.post('/api/owner/auth/change-credentials', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const { currentPassword, newLoginId, newFullName, newPassword } = req.body as {
      currentPassword?: string;
      newLoginId?: string;
      newFullName?: string;
      newPassword?: string;
    };
    if (!currentPassword) {
      res.status(400).json({ error: 'Le mot de passe actuel est requis.' });
      return;
    }
    const updated = store.updateOwnerCredentials({
      supervisorId: owner.id,
      currentPassword,
      newLoginId,
      newFullName,
      newPassword,
    });
    const token = store.createOwnerSessionToken(updated);
    res.json({ owner: updated, token });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour des identifiants.';
    res.status(400).json({ error: message });
  }
});

// Équipe Supervision (Propriétaire + 2 Co-Superviseurs max, strictement séparée des officines)
app.get('/api/supervisors', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  res.json({
    supervisors: store.listSupervisorAccounts(),
    canManageTeam: owner.role === 'owner',
    maxAccounts: 3,
  });
});

app.post('/api/supervisors', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  if (owner.role !== 'owner') {
    res.status(403).json({ error: 'Seul le Propriétaire principal peut ajouter un Co-Superviseur.' });
    return;
  }
  try {
    const { loginId, fullName, title, password } = req.body as {
      loginId?: string;
      fullName?: string;
      title?: string;
      password?: string;
    };
    const created = store.createSupervisorAccount({
      loginId: loginId || '',
      fullName: fullName || '',
      title,
      password: password || '',
    });
    res.status(201).json({
      supervisor: created,
      supervisors: store.listSupervisorAccounts(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur création co-superviseur.';
    res.status(400).json({ error: message });
  }
});

app.patch('/api/supervisors/:id', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  if (owner.role !== 'owner') {
    res.status(403).json({ error: 'Seul le Propriétaire principal peut modifier l’équipe Supervision.' });
    return;
  }
  try {
    const { fullName, title, active, password } = req.body as {
      fullName?: string;
      title?: string;
      active?: boolean;
      password?: string;
    };
    const updated = store.updateSupervisorAccount(req.params.id, {
      fullName,
      title,
      active,
      password,
    });
    res.json({
      supervisor: updated,
      supervisors: store.listSupervisorAccounts(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur modification superviseur.';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/supervisors/:id', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  if (owner.role !== 'owner') {
    res.status(403).json({ error: 'Seul le Propriétaire principal peut retirer un Co-Superviseur.' });
    return;
  }
  try {
    store.deleteSupervisorAccount(req.params.id);
    res.json({ supervisors: store.listSupervisorAccounts() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur suppression superviseur.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/portal/resolve', (req, res) => {
  const key = String(req.query.key || '').trim();
  if (!key) {
    res.status(400).json({ error: 'Clé officine manquante.' });
    return;
  }
  const all = store.getDashboard().pharmacies;
  const pharmacy = all.find(
    (p) => p.agentKey.toLowerCase() === key.toLowerCase() || p.id.toLowerCase() === key.toLowerCase()
  );
  if (!pharmacy) {
    res.status(404).json({ error: `Clé d’officine « ${key} » introuvable.` });
    return;
  }
  res.json({
    pharmacy: {
      id: pharmacy.id,
      name: pharmacy.name,
      city: pharmacy.city,
      region: pharmacy.region,
      pharmacist: pharmacy.pharmacist,
      targetSoftware: pharmacy.targetSoftware,
      agentKey: pharmacy.agentKey,
      status: pharmacy.status,
      subscriptionPlan: pharmacy.subscriptionPlan,
      monthlyQuotaLimit: pharmacy.monthlyQuotaLimit,
      monthlyQuotaUsed: pharmacy.monthlyQuotaUsed,
      subscriptionStatus: pharmacy.subscriptionStatus,
    },
  });
});

app.get('/api/pharmacies/:id/portal-data', (req, res) => {
  const actor = requirePharmacyOrOwner(req, res, req.params.id);
  if (!actor) return;
  const portalData = store.getPharmacyPortalSnapshot(req.params.id);
  if (!portalData) {
    res.status(404).json({ error: 'Officine introuvable.' });
    return;
  }
  res.json(portalData);
});

app.get('/api/dashboard', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  res.json(store.getDashboard());
});

app.post('/api/pharmacies', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const { name, city, region, pharmacist, targetSoftware, subscriptionPlan } = req.body as {
      name: string;
      city: string;
      region?: string;
      pharmacist: string;
      targetSoftware: TargetSoftwareType;
      subscriptionPlan?: SubscriptionPlanId;
    };

    if (!name?.trim() || !city?.trim() || !pharmacist?.trim()) {
      res.status(400).json({ error: 'Nom de l’officine, ville et titulaire sont obligatoires.' });
      return;
    }

    const created = store.createPharmacy({
      name,
      city,
      region: region || city,
      pharmacist,
      targetSoftware: targetSoftware || 'ERP Officine Intégré',
      subscriptionPlan,
    });

    res.status(201).json({
      pharmacy: created,
      provisionalCredentials: PROVISIONAL_PHARMACY_CREDENTIALS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur création officine.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/pharmacies/:id/subscription', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const {
      subscriptionPlan,
      monthlyQuotaLimit,
      subscriptionStatus,
      resetUsage,
      addBonusCredits,
      addBonusPercent,
    } = req.body as {
      subscriptionPlan?: SubscriptionPlanId;
      monthlyQuotaLimit?: number;
      subscriptionStatus?: 'active' | 'suspended';
      resetUsage?: boolean;
      addBonusCredits?: number;
      addBonusPercent?: number;
    };

    const updated = store.updatePharmacySubscription(req.params.id, {
      subscriptionPlan,
      monthlyQuotaLimit,
      subscriptionStatus,
      resetUsage,
      addBonusCredits,
      addBonusPercent,
      actorName: formatSupervisorDisplay(owner),
      actorRole: owner.role || 'owner',
    });
    res.json({ pharmacy: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour quota/abonnement.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/pharmacies/:id/quota-requests', (req, res) => {
  const actor = requirePharmacyOrOwner(req, res, req.params.id);
  if (!actor) return;
  try {
    const { requestedKind, note } = req.body as {
      requestedKind?: QuotaRequestKind;
      note?: string;
    };
    const allowedKinds: QuotaRequestKind[] = [
      'topup_25',
      'topup_50',
      'upgrade_pro',
      'upgrade_enterprise',
    ];
    if (!requestedKind || !allowedKinds.includes(requestedKind)) {
      res.status(400).json({ error: 'Type de recharge ou changement de forfait invalide.' });
      return;
    }
    const created = store.createQuotaTopUpRequest({
      pharmacyId: req.params.id,
      requestedKind,
      requestedBy: actor.displayName,
      note,
    });
    res.status(201).json({ request: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur création demande de recharge.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/quota-requests/:requestId/resolve', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const { action, resolutionNote } = req.body as {
      action?: 'approve' | 'reject';
      resolutionNote?: string;
    };
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Action invalide (approve ou reject requis).' });
      return;
    }
    const resolved = store.resolveQuotaTopUpRequest(req.params.requestId, action, resolutionNote);
    res.json(resolved);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur traitement de la demande.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/pharmacies/:id/auth/login', loginRateLimit, (req, res) => {
  const pharmacy = store.getPharmacy(req.params.id);
  if (!pharmacy) {
    res.status(404).json({ error: 'Officine introuvable.' });
    return;
  }
  const { loginId, password } = req.body as { loginId?: string; password?: string };
  if (!loginId?.trim() || !password) {
    res.status(400).json({ error: 'Identifiant (ID) et mot de passe obligatoires.' });
    return;
  }
  const user = store.authenticatePharmacyUser(pharmacy.id, loginId, password);
  if (!user) {
    res.status(401).json({ error: 'Identifiant ou mot de passe invalide (ou compte désactivé).' });
    return;
  }
  const token = store.createSessionToken(user);
  res.json({ token, user });
});

app.get('/api/pharmacies/:id/auth/me', (req, res) => {
  const session = getPharmacySession(req);
  if (!session || session.pharmacyId !== req.params.id) {
    res.status(401).json({ error: 'Session expirée ou invalide.' });
    return;
  }
  res.json({ user: session });
});

app.post('/api/pharmacies/:id/auth/change-password', (req, res) => {
  const session = getPharmacySession(req);
  if (!session || session.pharmacyId !== req.params.id) {
    res.status(401).json({ error: 'Connexion officine requise pour modifier votre mot de passe.' });
    return;
  }
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis.' });
      return;
    }
    const updated = store.changeOwnPharmacyPassword(
      req.params.id,
      session.id,
      currentPassword,
      newPassword
    );
    res.json({ user: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur modification mot de passe.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/pharmacies/:id/users', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  res.json({ users: store.listPharmacyUsers(req.params.id) });
});

app.post('/api/pharmacies/:id/users', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  try {
    const { loginId, fullName, role, password } = req.body as {
      loginId: string;
      fullName: string;
      role: PharmacyUserRole;
      password: string;
    };
    const created = store.createPharmacyUser(req.params.id, {
      loginId,
      fullName,
      role,
      password,
    });
    res.status(201).json({ user: created, users: store.listPharmacyUsers(req.params.id) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur création utilisateur.';
    res.status(400).json({ error: message });
  }
});

app.patch('/api/pharmacies/:id/users/:userId', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  try {
    const { fullName, role, active, password } = req.body as {
      fullName?: string;
      role?: PharmacyUserRole;
      active?: boolean;
      password?: string;
    };
    const updated = store.updatePharmacyUser(req.params.id, req.params.userId, {
      fullName,
      role,
      active,
      password,
    });
    res.json({ user: updated, users: store.listPharmacyUsers(req.params.id) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour utilisateur.';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/pharmacies/:id/users/:userId', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  if (actor.kind === 'pharmacy_user' && actor.user.id === req.params.userId) {
    res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte connecté.' });
    return;
  }
  try {
    store.deletePharmacyUser(req.params.id, req.params.userId);
    res.json({ users: store.listPharmacyUsers(req.params.id) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur suppression utilisateur.';
    res.status(400).json({ error: message });
  }
});

/**
 * Génération des 3 fichiers Excel d'entraînement et de test réel :
 * 1. memory     -> PharmAgent_Memoire_Mapping.xlsx (Ce que l'agent mémorise)
 * 2. target     -> PharmAgent_Modele_Cible_Stock.xlsx (Là où il doit le remplir)
 * 3. custom_kit -> PharmAgent_Proposition_Test_Officine.xlsx (Fichier spécial proposé pour tester)
 */
app.get('/api/training/download/:templateType', (req, res) => {
  const { templateType } = req.params;
  // La mémoire apprise (alias produits, règles de colonnes) est une donnée privée
  // des officines : son export est réservé aux superviseurs connectés.
  if (templateType === 'memory' && !requireOwnerSession(req, res)) return;
  const memory = store.getMemory();
  const wb = XLSX.utils.book_new();
  let fileName = 'PharmAgent.xlsx';

  if (templateType === 'memory') {
    const productRows = memory.productAliases.map((p) => ({
      'Libellé Brut Document (Alias)': p.rawLabel,
      'Désignation Officiale Officine': p.canonicalName,
      Catégorie: p.category,
      Origine: p.learnedFrom,
    }));
    const columnRows = memory.columnRules.map((c) => ({
      'En-tête Colonne Excel': c.excelHeaderPattern,
      'Champ JSON Source': c.targetSourceField,
      Origine: c.learnedFrom,
    }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), 'Dictionnaire_Produits');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(columnRows), 'Regles_Colonnes_Excel');
    fileName = 'PharmAgent_1_Memoire_Agent.xlsx';
  } else if (templateType === 'target') {
    const targetRows = [
      {
        'Date de réception': '17/11/2026',
        'N° de document': 'BL-DEMO-001',
        'Fournisseur / Organisme': 'RÉPARTITEUR CENTRAL (DÉMO)',
        'Désignation (DCI)': 'Amoxicilline 500mg Gélule B/24',
        'Quantité reçue': 30,
        'N° de lot': 'AMX2601',
        'Date de péremption': '05/2028',
        'Prix unitaire (FCFA)': 1850,
        'Total ligne (FCFA)': 55500,
        'Statut Brouillon': 'EXEMPLE INITIAL',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetRows), 'Reception_Stock');
    fileName = 'PharmAgent_2_Modele_Cible_Stock.xlsx';
  } else if (templateType === 'custom_kit') {
    const customRows = [
      {
        'N° de document': 'BL-DEMO-002',
        'Fournisseur / Organisme': 'GROSSISTE PHARMA (DÉMO)',
        'Date du document': '15/11/2026',
        'Désignation (DCI)': 'Paracétamol Doliprane 1000mg B/8',
        'Quantité livrée': 50,
        'N° de lot': 'DOL9001',
        'Date de péremption': '12/2027',
        'Prix unitaire (FCFA)': 1200,
        'Montant ligne (FCFA)': 60000,
        'Contrôle Garde-Fou': 'EXEMPLE INITIAL',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customRows), 'Suivi_Entrees_Test');
    fileName = 'PharmAgent_3_Fichier_Test_Propose.xlsx';
  } else if (templateType === 'facture_sdr') {
    const sdrRows = [
      {
        'N° de facture': 'FAC-SDR-DEMO-01',
        'Organisme / Fournisseur': 'SDR / SERVICE PUBLIC',
        'Abonné / Client': 'Client Exemple (Démo)',
        'N° de compteur': 'CPT-00482910',
        Consommation: '38 m3',
        'Coût total (FCFA)': 24500,
        Adresse: '10 Avenue Exemple, Secteur Nord',
        Localité: 'Secteur Nord (Démo)',
        'Date / Période': '11/2026',
        'Statut Brouillon (Garde-Fou)': 'EXEMPLE INITIAL',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sdrRows), 'Factures_SDR');
    fileName = 'PharmAgent_4_Modele_Facture_SDR.xlsx';
  } else {
    res.status(404).json({ error: 'Type de fichier Excel inconnu.' });
    return;
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
});

app.get('/api/guide/mac-pc', (_req, res) => {
  const guidePath = path.resolve(__dirname, 'GUIDE_MAC_ET_PC.md');
  if (!fs.existsSync(guidePath)) {
    res.status(404).json({ error: 'Guide Mac & PC introuvable.' });
    return;
  }
  const content = fs.readFileSync(guidePath, 'utf-8');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="GUIDE_MAC_ET_PC.md"');
  res.send(content);
});

app.post('/api/training/upload-memory', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const { excelBase64, fileName = 'Memoire_Importee.xlsx' } = req.body as {
      excelBase64: string;
      fileName?: string;
    };
    if (!excelBase64) {
      res.status(400).json({ error: 'Fichier Excel manquant.' });
      return;
    }

    const cleanB64 = excelBase64.replace(/^data:[^;]+;base64,/, '');
    const wb = XLSX.read(Buffer.from(cleanB64, 'base64'), { type: 'buffer' });
    let importedProducts = 0;
    let importedColumns = 0;

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
        defval: '',
      });
      for (const row of rows) {
        const rawLabel = String(
          row['Libellé Brut Document (Alias)'] || row['Alias'] || row['rawLabel'] || ''
        ).trim();
        const canonicalName = String(
          row['Désignation Officiale Officine'] || row['Nom Officiel'] || row['canonicalName'] || ''
        ).trim();
        const category = String(row['Catégorie'] || row['category'] || 'Médicament').trim();

        if (rawLabel && canonicalName) {
          store.addProductAliasRule({
            rawLabel,
            canonicalName,
            category,
            learnedFrom: `Import Excel (${fileName})`,
          });
          importedProducts += 1;
        }

        const headerPat = String(
          row['En-tête Colonne Excel'] || row['Colonne'] || row['excelHeaderPattern'] || ''
        ).trim();
        const sourceField = String(
          row['Champ JSON Source'] || row['Champ'] || row['targetSourceField'] || ''
        ).trim();
        if (headerPat && sourceField) {
          store.addColumnMappingRule({
            excelHeaderPattern: headerPat,
            targetSourceField: sourceField,
            learnedFrom: `Import Excel (${fileName})`,
          });
          importedColumns += 1;
        }
      }
    }

    res.json({
      importedProducts,
      importedColumns,
      learnedMemory: store.getMemory(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lecture fichier mémoire Excel.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/training/rules', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  const { kind, key, value, category } = req.body as {
    kind: 'product' | 'column';
    key: string;
    value: string;
    category?: string;
  };
  if (!key?.trim() || !value?.trim()) {
    res.status(400).json({ error: 'Les deux champs sont requis.' });
    return;
  }
  if (kind === 'product') {
    store.addProductAliasRule({
      rawLabel: key.trim(),
      canonicalName: value.trim(),
      category: category?.trim() || 'Officine',
      learnedFrom: 'Ajout manuel Propriétaire',
    });
  } else {
    store.addColumnMappingRule({
      excelHeaderPattern: key.trim(),
      targetSourceField: value.trim(),
      learnedFrom: 'Ajout manuel Propriétaire',
    });
  }
  res.json({ learnedMemory: store.getMemory() });
});

app.delete('/api/training/rules/:id', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  store.deleteMemoryRule(req.params.id);
  res.json({ learnedMemory: store.getMemory() });
});

app.post('/api/training/software-profiles', (req, res) => {
  const {
    softwareName,
    pharmacyId,
    detectedSoftwareType,
    elements,
    injectionScript,
  } = req.body as {
    softwareName: string;
    pharmacyId: string;
    detectedSoftwareType: 'erp_form' | 'excel_grid' | 'desktop_app';
    elements: GroundedTargetElement[];
    injectionScript: string;
  };

  const actor = requireTitulaireOrOwner(req, res, pharmacyId);
  if (!actor) return;

  if (!softwareName?.trim() || !Array.isArray(elements)) {
    res.status(400).json({ error: 'Nom du logiciel et éléments détectés requis.' });
    return;
  }

  const profile = store.saveSoftwareProfile({
    softwareName: softwareName.trim(),
    pharmacyId,
    detectedSoftwareType: detectedSoftwareType || 'erp_form',
    elements,
    injectionScript: injectionScript || '',
  });

  res.status(201).json({ profile, learnedMemory: store.getMemory() });
});

app.get('/api/pharmacies/:id/installer', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  const pharmacy = store.getPharmacy(req.params.id);
  if (!pharmacy) {
    res.status(404).json({ error: 'Officine introuvable.' });
    return;
  }
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const serverOrigin = host ? `${proto}://${host}` : process.env.APP_URL || 'http://localhost:3000';
  const localAgentPath = path.resolve(__dirname, 'backend-fastapi/pharmagent_local_agent.py');
  const guardrailPath = path.resolve(__dirname, 'backend-fastapi/app/safety_guardrail.py');
  const localCode = fs.existsSync(localAgentPath)
    ? fs.readFileSync(localAgentPath, 'utf-8')
    : '';
  const guardrailCode = fs.existsSync(guardrailPath)
    ? fs.readFileSync(guardrailPath, 'utf-8')
    : '';

  const bundledScript = `"""
====================================================================
PHARMAGENT — AGENT POSTE LOCAL PRÉ-CONFIGURÉ (WINDOWS / MAC)
Officine : ${pharmacy.name} (${pharmacy.city})
Titulaire : ${pharmacy.pharmacist}
Logiciel cible : ${pharmacy.targetSoftware}
Clé d'appairage : ${pharmacy.agentKey}
Serveur Central : ${serverOrigin}

Démarrage manuel dans un terminal :
  Windows : C:\\PharmAgent\\.venv\\Scripts\\python.exe C:\\PharmAgent\\pharmagent_${pharmacy.id}.py
  macOS   : ~/PharmAgent/.venv/bin/python3 ~/PharmAgent/pharmagent_${pharmacy.id}.py
Les logs d'exécution sont enregistrés dans pharmagent.log (même dossier).
====================================================================
"""

import re
import os
import sys
import time
import io
import base64
import logging
from dataclasses import dataclass
from typing import List, Optional
import requests
import pyautogui
from PIL import ImageGrab

if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pharmagent.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("PharmAgent")

SERVER_URL = ${JSON.stringify(serverOrigin)}
AGENT_KEY = ${JSON.stringify(pharmacy.agentKey)}

# --- GARDE-FOU DE SÉCURITÉ ABSOLU (BROUILLON UNIQUEMENT) ---
${guardrailCode.replace(/^import .*\n/gm, '').replace(/^from .*\n/gm, '')}

def capture_screen_base64() -> str:
    screenshot = ImageGrab.grab()
    buf = io.BytesIO()
    screenshot.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

def type_text_utf8(text: str) -> None:
    """Saisit fidèlement les accents français (é, è, à, ç) via presse-papier + collage."""
    if not text:
        return
    try:
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
        hotkey_mod = "command" if sys.platform == "darwin" else "ctrl"
        pyautogui.hotkey(hotkey_mod, "v")
        time.sleep(0.05)
        root.destroy()
        return
    except Exception:
        pyautogui.write(text, interval=0.02)

def resolve_value_from_task(elem: dict, extracted: dict) -> str:
    mapping = elem.get("semanticMapping") or {}
    path_str = (mapping.get("sourceJsonPath") or "").strip()
    items = extracted.get("lineItems") or []
    first_item = items[0] if items else {}
    clean = path_str.replace("extracted.", "").replace("firstLineItem.", "item.").replace("lineItems[0].", "item.")
    if clean.startswith("extra:"):
        target_key = clean[6:].strip().lower()
        for ef in extracted.get("extraFields") or []:
            if str(ef.get("key", "")).strip().lower() == target_key:
                return str(ef.get("value", ""))
    if clean.startswith("item."):
        field = clean[5:]
        if field in first_item and first_item[field] is not None:
            return str(first_item[field])
    if clean and clean in extracted and extracted[clean] is not None:
        return str(extracted[clean])
    return str(mapping.get("sampleValueToInsert") or "")

def run():
    guardrail = DraftOnlyGuardrail()
    screen_w, screen_h = pyautogui.size()
    logger.info("Poste %s connecté à %s (%sx%s)", ${JSON.stringify(pharmacy.name)}, SERVER_URL, screen_w, screen_h)
    while True:
        try:
            resp = requests.get(f"{SERVER_URL.rstrip('/')}/api/agent-client/next-task", params={"agentKey": AGENT_KEY}, timeout=15)
            payload = resp.json()
            task = payload.get("task")
            if not task:
                time.sleep(4)
                continue

            logger.info("[Tâche reçue] %s — Document %s", task["id"], task["extracted"].get("documentNumber"))
            profile = payload.get("softwareProfile")
            if profile and profile.get("elements"):
                logger.info("[Profil mémorisé] Application directe de '%s'", profile["softwareName"])
                elements = profile["elements"]
            else:
                logger.info("[UI Grounding] Analyse de l'écran en direct via Gemini Vision...")
                shot = capture_screen_base64()
                gr = requests.post(
                    f"{SERVER_URL.rstrip('/')}/api/agent/ground",
                    json={"pharmacyId": task["pharmacyId"], "agentKey": AGENT_KEY, "extractedData": task["extracted"], "screenshotBase64": shot, "mimeType": "image/png"},
                    timeout=60,
                )
                gr.raise_for_status()
                elements = gr.json()["grounding"]["elements"]

            filled_count = 0
            blocked_labels = []
            for elem in elements:
                if elem.get("safetyStatus") == "FORBIDDEN_BY_GUARDRAIL" or elem.get("elementRole") == "forbidden_final_button":
                    logger.warning("[GARDE-FOU] Bouton final ignoré et verrouillé : %s", elem.get("detectedLabel"))
                    blocked_labels.append(elem.get("detectedLabel", "Validation"))
                    continue
                try:
                    guardrail.assert_element_safe(elem["elementRole"], elem["detectedLabel"], elem.get("safetyStatus"))
                except SafetyViolationError as exc:
                    logger.warning("[GARDE-FOU] %s", exc)
                    requests.post(
                        f"{SERVER_URL.rstrip('/')}/api/agent-client/report",
                        json={"taskId": task["id"], "status": "BLOQUE_GARDE_FOU", "report": str(exc)},
                        timeout=15,
                    )
                    break

                cx = int((elem["centerPoint"]["x"] / 1000.0) * screen_w)
                cy = int((elem["centerPoint"]["y"] / 1000.0) * screen_h)
                if elem["elementRole"] in ("input_field", "table_column") and elem.get("semanticMapping"):
                    val = resolve_value_from_task(elem, task["extracted"])
                    pyautogui.click(cx, cy)
                    time.sleep(0.08)
                    type_text_utf8(val)
                    filled_count += 1
                    logger.info("  -> Saisi '%s' dans [%s] (%s, %s)", val, elem.get("detectedLabel"), cx, cy)
                elif elem["elementRole"] == "draft_button":
                    pyautogui.click(cx, cy)
                    logger.info("  -> Clic Brouillon [%s]. Arrêt obligatoire.", elem.get("detectedLabel"))
                    break

            requests.post(
                f"{SERVER_URL.rstrip('/')}/api/agent-client/report",
                json={
                    "taskId": task["id"],
                    "status": "BROUILLON_CREE_LOCALEMENT",
                    "report": f"{filled_count} champ(s) saisi(s). Bouton(s) final(aux) verrouillé(s) : {', '.join(blocked_labels) or 'aucun'}. Arrêt strict au Brouillon.",
                },
                timeout=15,
            )
        except KeyboardInterrupt:
            break
        except Exception as exc:
            logger.error("[Info/Erreur] %s", exc)
            time.sleep(5)

if __name__ == "__main__":
    run()
`;

  const fileName = `pharmagent_${pharmacy.id}.py`;
  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(bundledScript || localCode);
});

app.get('/api/pharmacies/:id/launcher/:os', (req, res) => {
  const actor = requireTitulaireOrOwner(req, res, req.params.id);
  if (!actor) return;
  const pharmacy = store.getPharmacy(req.params.id);
  if (!pharmacy) {
    res.status(404).json({ error: 'Officine introuvable.' });
    return;
  }
  const osTarget = req.params.os === 'mac' ? 'mac' : 'windows';
  const mode = req.query.mode === 'manual' ? 'manual' : 'autostart';
  const scriptFile = `pharmagent_${pharmacy.id}.py`;

  if (osTarget === 'windows') {
    if (mode === 'manual') {
      const manualBat = `@echo off\r\ntitle PharmAgent Officine - ${pharmacy.name}\r\ncd /d "%~dp0"\r\nif not exist "${scriptFile}" if exist "C:\\PharmAgent\\${scriptFile}" cd /d "C:\\PharmAgent"\r\nif not exist "${scriptFile}" (\r\n  echo [ERREUR] Telechargez ${scriptFile} dans le meme dossier.\r\n  pause\r\n  exit /b 1\r\n)\r\nif exist "C:\\PharmAgent\\.venv\\Scripts\\python.exe" (\r\n  "C:\\PharmAgent\\.venv\\Scripts\\python.exe" "${scriptFile}"\r\n) else (\r\n  py -m pip install --quiet requests pyautogui pillow\r\n  py "${scriptFile}"\r\n)\r\npause\r\n`;
      res.setHeader('Content-Type', 'application/x-bat; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Tester_PharmAgent_${pharmacy.id}.bat"`
      );
      res.send(manualBat);
      return;
    }

    const autoBat = [
      '@echo off',
      `title Installation & Auto-Demarrage PharmAgent - ${pharmacy.name}`,
      'echo ============================================================',
      `echo   PHARMAGENT — INSTALLATION COMPLETE + DEMARRAGE AUTOMATIQUE`,
      `echo   Officine : ${pharmacy.name}`,
      'echo ============================================================',
      'set "APPDIR=C:\\PharmAgent"',
      'if not exist "%APPDIR%" mkdir "%APPDIR%"',
      `if exist "%~dp0${scriptFile}" copy /Y "%~dp0${scriptFile}" "%APPDIR%\\${scriptFile}" >nul`,
      `if not exist "%APPDIR%\\${scriptFile}" if exist "%USERPROFILE%\\Downloads\\${scriptFile}" copy /Y "%USERPROFILE%\\Downloads\\${scriptFile}" "%APPDIR%\\${scriptFile}" >nul`,
      `if not exist "%APPDIR%\\${scriptFile}" (`,
      `  echo [ERREUR] Fichier ${scriptFile} introuvable dans Telechargements ou ce dossier.`,
      `  echo Telechargez d'abord ${scriptFile} depuis votre Portail Officine puis relancez ce script.`,
      '  pause',
      '  exit /b 1',
      ')',
      'where py >nul 2>nul || where python >nul 2>nul',
      'if errorlevel 1 (',
      '  echo [1/4] Python absent sur ce PC neuf. Installation automatique via winget...',
      '  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements',
      ')',
      'set "PYCMD=py"',
      'where py >nul 2>nul || set "PYCMD=python"',
      'echo [2/4] Creation de l environnement Python isole (%APPDIR%\\.venv)...',
      'if not exist "%APPDIR%\\.venv\\Scripts\\python.exe" %PYCMD% -m venv "%APPDIR%\\.venv"',
      'if not exist "%APPDIR%\\.venv\\Scripts\\python.exe" (',
      '  echo [ERREUR] Python vient peut-etre d etre installe. Fermez cette fenetre et double-cliquez a nouveau.',
      '  pause',
      '  exit /b 1',
      ')',
      'echo [3/4] Installation des dependances (requests, pyautogui, pillow)...',
      '"%APPDIR%\\.venv\\Scripts\\python.exe" -m pip install --upgrade --quiet pip',
      '"%APPDIR%\\.venv\\Scripts\\python.exe" -m pip install --quiet requests pyautogui pillow',
      'echo [4/4] Activation du demarrage automatique Windows (sans terminal)...',
      `set "VBS=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\PharmAgent_${pharmacy.id}.vbs"`,
      `echo CreateObject("WScript.Shell").Run """%APPDIR%\\.venv\\Scripts\\pythonw.exe"" ""%APPDIR%\\${scriptFile}""", 0, False > "%VBS%"`,
      'wscript.exe "%VBS%"',
      'echo.',
      'echo [OK] PharmAgent est demarre en arriere-plan et se lancera automatiquement a chaque allumage du PC.',
      'echo Journal d activite : %APPDIR%\\pharmagent.log',
      'pause',
      '',
    ].join('\r\n');
    res.setHeader('Content-Type', 'application/x-bat; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Installer_AutoStart_${pharmacy.id}.bat"`
    );
    res.send(autoBat);
    return;
  }

  if (mode === 'manual') {
    const manualMac = `#!/bin/bash\ncd "$(dirname "$0")"\n[ ! -f "${scriptFile}" ] && [ -f "$HOME/PharmAgent/${scriptFile}" ] && cd "$HOME/PharmAgent"\nif [ ! -f "${scriptFile}" ]; then\n  echo "[ERREUR] Placez ce fichier dans le meme dossier que ${scriptFile}"\n  read -p "Appuyez sur Entree pour fermer..."\n  exit 1\nfi\nif [ -x "$HOME/PharmAgent/.venv/bin/python3" ]; then\n  "$HOME/PharmAgent/.venv/bin/python3" "${scriptFile}"\nelse\n  python3 "${scriptFile}"\nfi\n`;
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Tester_PharmAgent_${pharmacy.id}.command"`
    );
    res.send(manualMac);
    return;
  }

  const autoMac = `#!/bin/bash
set -e
APPDIR="$HOME/PharmAgent"
SCRIPT_FILE="${scriptFile}"
PLIST="$HOME/Library/LaunchAgents/com.pharmagent.${pharmacy.id}.plist"
mkdir -p "$APPDIR" "$HOME/Library/LaunchAgents"

if [ -f "$(dirname "$0")/$SCRIPT_FILE" ]; then
  cp "$(dirname "$0")/$SCRIPT_FILE" "$APPDIR/$SCRIPT_FILE"
elif [ -f "$HOME/Downloads/$SCRIPT_FILE" ]; then
  cp "$HOME/Downloads/$SCRIPT_FILE" "$APPDIR/$SCRIPT_FILE"
fi

if [ ! -f "$APPDIR/$SCRIPT_FILE" ]; then
  echo "[ERREUR] Telechargez d'abord $SCRIPT_FILE puis relancez ce script."
  read -p "Appuyez sur Entree pour fermer..."
  exit 1
fi

PYBIN="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
if [ ! -x "$PYBIN" ]; then
  PYBIN="$(command -v python3 || true)"
fi

if [ -z "$PYBIN" ]; then
  echo "[1/4] Python 3 absent sur ce Mac. Telechargement de Python 3.12 officiel..."
  curl -L "https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg" -o /tmp/python3_pharmagent.pkg
  sudo installer -pkg /tmp/python3_pharmagent.pkg -target /
  rm -f /tmp/python3_pharmagent.pkg
  PYBIN="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
fi

echo "[2/4] Creation de l'environnement virtuel $APPDIR/.venv..."
"$PYBIN" -m venv "$APPDIR/.venv"

echo "[3/4] Installation des dependances (requests, pyautogui, pillow)..."
"$APPDIR/.venv/bin/pip" install --upgrade --quiet pip
"$APPDIR/.venv/bin/pip" install --quiet requests pyautogui pillow

echo "[4/4] Configuration du demarrage automatique macOS (LaunchAgent)..."
cat << EOF > "$PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pharmagent.${pharmacy.id}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APPDIR/.venv/bin/python3</string>
    <string>$APPDIR/$SCRIPT_FILE</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$APPDIR/pharmagent.log</string>
  <key>StandardErrorPath</key>
  <string>$APPDIR/pharmagent.log</string>
</dict>
</plist>
EOF

launchctl bootout gui/$(id -u) "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

echo ""
echo "[OK] PharmAgent est actif en arriere-plan et demarrera automatiquement a chaque session."
echo "RAPPEL macOS : Activez Terminal et Python dans Reglages Systeme -> Confidentialite et securite -> Accessibilite + Enregistrement de l'ecran."
echo "Journal d'activite : $APPDIR/pharmagent.log"
read -p "Appuyez sur Entree pour fermer..."
`;
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Installer_AutoStart_${pharmacy.id}.command"`
  );
  res.send(autoMac);
});

app.post('/api/agent/run-task', async (req, res) => {
  try {
    const {
      pharmacyId,
      taskPrompt,
      documentHint = 'bon_livraison',
      imageBase64,
      sampleAssetPath,
      mimeType,
      targetMode = 'erp_live',
      uploadedExcelBase64,
      uploadedExcelName,
    } = req.body as {
      pharmacyId: string;
      taskPrompt: string;
      documentHint?: DocumentCategory;
      imageBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
      targetMode?: TargetExecutionMode;
      uploadedExcelBase64?: string;
      uploadedExcelName?: string;
    };

    const pharmacy = store.getPharmacy(pharmacyId);
    if (!pharmacy) {
      res.status(404).json({ error: 'Officine introuvable.' });
      return;
    }

    const actor = requirePharmacyOrOwner(req, res, pharmacy.id);
    if (!actor) return;

    store.assertQuotaAvailable(pharmacy.id);

    const learnedMemory = store.getMemory();
    const image = resolveImagePayload(imageBase64, sampleAssetPath, mimeType || 'image/jpeg');
    const { data: extracted, tokensConsumed: extractTokens } = await extractDocumentWithGemini({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      documentHint,
      taskPrompt,
      learnedMemory,
    });

    let totalTokens = extractTokens;
    store.recordVisionUsage(pharmacy.id, extractTokens, extracted.documentType || documentHint);

    const draftId = `DRF-${Date.now().toString().slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
    let draftFileName: string | undefined;
    let draftArtifactUrl: string | undefined;
    let excelColumnsMapped: Array<{ excelColumn: string; sourceField: string }> | undefined;
    let excelPreviewHeaders: string[] | undefined;
    let excelPreviewRows: Array<Record<string, unknown>> | undefined;
    let learnedColumnsCount = 0;

    const effectiveItems: ExtractedLineItem[] =
      extracted.lineItems && extracted.lineItems.length > 0
        ? extracted.lineItems
        : [
            {
              designation: extracted.supplierOrOrg || 'Facture Service',
              quantity: 1,
              lotNumber: extracted.meterNumber || '',
              expiryDate: extracted.billingPeriod || '',
              unitPriceFCFA: extracted.totalAmountFCFA || 0,
              confidence: 0.95,
            },
          ];
    extracted.lineItems = effectiveItems;

    if (targetMode === 'excel_upload' && uploadedExcelBase64) {
      const cleanB64 = uploadedExcelBase64.replace(/^data:[^;]+;base64,/, '');
      const wb = XLSX.read(Buffer.from(cleanB64, 'base64'), { type: 'buffer' });
      const firstSheetName = wb.SheetNames[0];
      const ws = wb.Sheets[firstSheetName];
      const existingRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const headerMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      const excelHeaders = (headerMatrix[0] || []).map((h) => String(h).trim()).filter(Boolean);

      if (excelHeaders.length > 0) {
        const mapped = await mapToRealExcelColumnsWithGemini({
          excelColumns: excelHeaders,
          extractedData: extracted,
          learnedMemory,
        });
        totalTokens += mapped.tokensConsumed;
        store.recordVisionUsage(pharmacy.id, mapped.tokensConsumed);
        excelColumnsMapped = mapped.mappings;
        learnedColumnsCount = store.learnFromExcelMappings(
          mapped.mappings,
          uploadedExcelName || 'Excel_Officine.xlsx'
        );

        const hasStatusColumn = mapped.mappings.some((m) => m.sourceField === 'draftStatus');
        const newRows = effectiveItems.map((item) => {
          const rowObj: Record<string, unknown> = {};
          for (const col of excelHeaders) {
            const match = mapped.mappings.find((m) => m.excelColumn === col);
            rowObj[col] = match
              ? resolveSourceFieldValue(extracted, item, match.sourceField)
              : '';
          }
          if (!hasStatusColumn) {
            rowObj['Statut PharmAgent'] = 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN';
          }
          return rowObj;
        });

        const finalHeaders = hasStatusColumn
          ? excelHeaders
          : [...excelHeaders, 'Statut PharmAgent'];
        excelPreviewHeaders = finalHeaders;
        excelPreviewRows = newRows;

        const updatedWs = XLSX.utils.json_to_sheet([...existingRows, ...newRows], {
          header: finalHeaders,
        });
        wb.Sheets[firstSheetName] = updatedWs;
      } else {
        const fallbackRows = extracted.lineItems.map((item) => ({
          'N° de document': extracted.documentNumber,
          'Fournisseur / Organisme': extracted.supplierOrOrg,
          Date: extracted.documentDate,
          'Désignation (DCI)': item.designation,
          Quantité: item.quantity,
          'N° de lot': item.lotNumber || 'N/A',
          'Date de péremption': item.expiryDate || 'N/A',
          'Prix unitaire (FCFA)': item.unitPriceFCFA,
          Statut: 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
        }));
        excelPreviewHeaders = Object.keys(fallbackRows[0] || {});
        excelPreviewRows = fallbackRows;
        wb.Sheets[firstSheetName] = XLSX.utils.json_to_sheet(fallbackRows);
      }

      const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      const baseName = (uploadedExcelName || 'Stock_Officine.xlsx').replace(/\.xlsx$/i, '');
      draftFileName = `${baseName}_BROUILLON_${extracted.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
      store.saveDraftArtifact(draftId, draftFileName, outBuffer);
      draftArtifactUrl = `/api/drafts/${draftId}/download`;
    } else {
      const wb = XLSX.utils.book_new();
      const rows = extracted.lineItems.map((item) => ({
        'N° de document': extracted.documentNumber,
        'Fournisseur / Organisme': extracted.supplierOrOrg,
        Date: extracted.documentDate,
        'Désignation (DCI)': item.designation,
        Quantité: item.quantity,
        'N° de lot': item.lotNumber || 'N/A',
        'Date de péremption': item.expiryDate || 'N/A',
        'Prix unitaire (FCFA)': item.unitPriceFCFA,
        'Statut Saisie PharmAgent': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'BROUILLON_STOCK');
      const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      draftFileName = `BROUILLON_${pharmacy.id}_${extracted.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
      store.saveDraftArtifact(draftId, draftFileName, outBuffer);
      draftArtifactUrl = `/api/drafts/${draftId}/download`;
    }

    if (targetMode === 'local_desktop') {
      store.enqueueDesktopTask({
        id: `TSK-${Date.now().toString().slice(-5)}-${Math.floor(10 + Math.random() * 89)}`,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        createdAt: new Date().toISOString(),
        taskPrompt,
        extracted,
        status: 'EN_ATTENTE_AGENT_LOCAL',
      });
    }

    const guardrailNote =
      targetMode === 'local_desktop'
        ? `Tâche transmise à l'agent desktop (${pharmacy.targetSoftware}) et brouillon sauvegardé. Validation finale bloquée.`
        : targetMode === 'excel_upload'
        ? `Lignes injectées dans votre classeur Excel avec statut BROUILLON${
            learnedColumnsCount > 0 ? ` (+${learnedColumnsCount} nouvelle(s) colonne(s) mémorisée(s))` : ''
          }. Validation finale bloquée.`
        : `Brouillon enregistré dans ERP Officine Intégré pour ${pharmacy.name}. Validation finale réservée au pharmacien.`;

    const actorDisplay = actor.displayName;

    const draft: DraftRecord = {
      id: draftId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      createdAt: new Date().toISOString(),
      taskPrompt: taskPrompt || 'Extraction et mise en brouillon de réception.',
      targetMode,
      status: 'BROUILLON',
      extracted: { ...extracted, tokensConsumed: totalTokens },
      draftArtifactUrl,
      draftFileName,
      excelColumnsMapped,
      excelPreviewHeaders,
      excelPreviewRows,
      createdBy: actorDisplay,
      createdByRole: actor.role,
      guardrailNote,
    };

    store.consumeQuota(pharmacy.id, totalTokens);
    store.saveDraft(draft);
    store.recordExecutionOutcome({
      pharmacyId: pharmacy.id,
      documentNumber: extracted.documentNumber,
      documentType: extracted.documentType || documentHint,
      tokensUsed: totalTokens,
      blocked: false,
      guardrailMessage: guardrailNote,
      actorName: actorDisplay,
      actorRole: actor.role,
    });

    res.json({ draft, tokensConsumed: totalTokens, learnedColumnsCount });
  } catch (err: unknown) {
    if (err instanceof QuotaError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur lors du traitement de la mission.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/drafts/:draftId/items', (req, res) => {
  try {
    const existing = store.getDraft(req.params.draftId);
    if (!existing) {
      res.status(404).json({ error: 'Brouillon introuvable.' });
      return;
    }
    const actor = requirePharmacyOrOwner(req, res, existing.pharmacyId);
    if (!actor) return;

    const { lineItems } = req.body as { lineItems?: ExtractedLineItem[] };
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      res.status(400).json({ error: 'Lignes du brouillon manquantes.' });
      return;
    }
    const updated = store.updateDraftItemsBeforeApproval(
      req.params.draftId,
      lineItems,
      actor.displayName
    );
    res.json({ draft: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur mise à jour des lignes.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/drafts/:draftId/approve', (req, res) => {
  try {
    const existing = store.getDraft(req.params.draftId);
    if (!existing) {
      res.status(404).json({ error: 'Brouillon introuvable.' });
      return;
    }
    const actor = requireApproverSession(req, res, existing.pharmacyId);
    if (!actor) return;

    const { lineItems, pharmacistName } = req.body as {
      lineItems?: ExtractedLineItem[];
      pharmacistName?: string;
    };
    const updated = store.approveDraftByPharmacist(
      req.params.draftId,
      lineItems,
      pharmacistName || actor.displayName,
      actor.role
    );
    res.json({ draft: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la validation humaine.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/drafts/:draftId/reject', (req, res) => {
  try {
    const existing = store.getDraft(req.params.draftId);
    if (!existing) {
      res.status(404).json({ error: 'Brouillon introuvable.' });
      return;
    }
    const actor = requireTitulaireOrOwner(req, res, existing.pharmacyId);
    if (!actor) return;

    const updated = store.rejectDraft(req.params.draftId, actor.displayName, actor.role);
    res.json({ draft: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors du rejet.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/agent-client/next-task', (req, res) => {
  const agentKey = String(req.query.agentKey || '');
  if (!agentKey) {
    res.status(400).json({ error: 'agentKey manquant.' });
    return;
  }
  const pharmacy = store.getPharmacyByAgentKey(agentKey);
  const task = store.getNextDesktopTask(agentKey);
  const rawProfile = pharmacy
    ? (store.getMemory().softwareProfiles || []).find((p) => p.pharmacyId === pharmacy.id) || null
    : null;
  const softwareProfile =
    rawProfile && task
      ? {
          ...rawProfile,
          elements: hydrateElementsWithExtractedData(rawProfile.elements, task.extracted),
        }
      : rawProfile;
  res.json({ task, softwareProfile });
});

app.post('/api/agent-client/report', (req, res) => {
  const { taskId, status, report } = req.body as {
    taskId: string;
    status: 'BROUILLON_CREE_LOCALEMENT' | 'BLOQUE_GARDE_FOU';
    report: string;
  };
  const updated = store.completeDesktopTask(taskId, status, report);
  if (!updated) {
    res.status(404).json({ error: 'Tâche introuvable.' });
    return;
  }
  res.json({ task: updated });
});

app.post('/api/agent/extract', async (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const {
      pharmacyId,
      documentHint = 'bon_livraison',
      imageBase64,
      sampleAssetPath,
      mimeType,
      taskPrompt,
    } = req.body as {
      pharmacyId: string;
      documentHint?: DocumentCategory;
      imageBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
      taskPrompt?: string;
    };

    store.assertQuotaAvailable(pharmacyId);

    const image = resolveImagePayload(imageBase64, sampleAssetPath, mimeType || 'image/jpeg');
    const { data, tokensConsumed } = await extractDocumentWithGemini({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      documentHint,
      taskPrompt,
      learnedMemory: store.getMemory(),
    });

    store.consumeQuota(pharmacyId, tokensConsumed);
    store.recordVisionUsage(pharmacyId, tokensConsumed, data.documentType || documentHint);

    res.json({
      extracted: data,
      tokensConsumed,
    });
  } catch (err: unknown) {
    if (err instanceof QuotaError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de l’extraction Gemini Vision.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/agent/ground', async (req, res) => {
  try {
    const {
      pharmacyId,
      agentKey,
      extractedData,
      screenshotBase64,
      sampleAssetPath,
      mimeType,
    } = req.body as {
      pharmacyId: string;
      agentKey?: string;
      extractedData: ExtractedDocumentData;
      screenshotBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
    };

    const keyMatch =
      typeof agentKey === 'string' && agentKey.trim()
        ? store.getPharmacyByAgentKey(agentKey.trim())
        : undefined;
    const isAuthorizedByAgentKey = Boolean(keyMatch && keyMatch.id === pharmacyId);

    if (!isAuthorizedByAgentKey) {
      const actor = requireTitulaireOrOwner(req, res, pharmacyId);
      if (!actor) return;
    }

    if (!extractedData) {
      res.status(400).json({ error: 'Données extraites manquantes pour le UI Grounding.' });
      return;
    }

    store.assertQuotaAvailable(pharmacyId);

    const screenshot = resolveImagePayload(
      screenshotBase64,
      sampleAssetPath,
      mimeType || 'image/jpeg'
    );

    const { result, tokensConsumed } = await groundTargetInterfaceWithGemini({
      screenshotBase64: screenshot.base64,
      mimeType: screenshot.mimeType,
      extractedData,
    });

    store.consumeQuota(pharmacyId, tokensConsumed);
    store.recordVisionUsage(pharmacyId, tokensConsumed);

    res.json({
      grounding: result,
      tokensConsumed,
    });
  } catch (err: unknown) {
    if (err instanceof QuotaError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur lors du UI Grounding.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/agent/execute-draft', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  try {
    const {
      pharmacyId,
      extractedData,
      elements,
      attemptFinalValidation = false,
      targetSoftwareType = 'erp_form',
    } = req.body as {
      pharmacyId: string;
      extractedData: ExtractedDocumentData;
      elements: GroundedTargetElement[];
      attemptFinalValidation?: boolean;
      targetSoftwareType?: 'erp_form' | 'excel_grid' | 'desktop_app';
    };

    const pharmacy = store.getPharmacy(pharmacyId);
    if (!pharmacy) {
      res.status(404).json({ error: 'Officine introuvable.' });
      return;
    }

    const runId = `RUN-${Date.now().toString().slice(-6)}`;
    const steps: ExecutionStepLog[] = [];
    let stepCounter = 1;
    let guardrailTriggered = false;
    let guardrailReport =
      'Politique BROUILLON UNIQUEMENT respectée : arrêt strict avant toute validation finale.';

    steps.push({
      stepIndex: stepCounter++,
      action: 'FOCUS_WINDOW',
      targetLabel: pharmacy.targetSoftware,
      status: 'EXECUTED',
      message: `Fenêtre cible activée pour ${pharmacy.name} (${pharmacy.city}).`,
      timestamp: new Date().toISOString(),
    });

    const inputElements = elements.filter(
      (e) => e.elementRole === 'input_field' || e.elementRole === 'table_column'
    );
    const draftButtons = elements.filter((e) => e.elementRole === 'draft_button');
    const forbiddenButtons = elements.filter(
      (e) => e.elementRole === 'forbidden_final_button' || e.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL'
    );

    const pythonLines: string[] = [
      '# Script généré dynamiquement par PharmAgent UI Grounding',
      'import pyautogui, time',
      'from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError',
      '',
      'guardrail = DraftOnlyGuardrail()',
      `# Officine : ${pharmacy.name} (${pharmacy.city}) — Logiciel : ${pharmacy.targetSoftware}`,
    ];

    for (const el of inputElements) {
      guardrail.assertElementSafe(el);
      const value = el.semanticMapping?.sampleValueToInsert ?? '';
      const px = Math.round((el.centerPoint.x / 1000) * 1920);
      const py = Math.round((el.centerPoint.y / 1000) * 1080);

      steps.push({
        stepIndex: stepCounter++,
        action: targetSoftwareType === 'excel_grid' ? 'WRITE_EXCEL_CELL' : 'CLICK_AND_TYPE',
        targetLabel: el.detectedLabel,
        coordinates: el.centerPoint,
        valueInserted: value,
        status: 'EXECUTED',
        message: `Insertion de "${value}" dans [${el.detectedLabel}] aux coordonnées normalisées (${el.centerPoint.x}, ${el.centerPoint.y}).`,
        timestamp: new Date().toISOString(),
      });

      pythonLines.push(
        `pyautogui.click(${px}, ${py})  # ${el.detectedLabel}`,
        `pyautogui.write(${JSON.stringify(value)}, interval=0.02)`
      );
    }

    if (attemptFinalValidation) {
      const targetForbidden = forbiddenButtons[0] ?? {
        elementRole: 'forbidden_final_button' as const,
        detectedLabel: 'Valider Définitivement',
        safetyStatus: 'FORBIDDEN_BY_GUARDRAIL' as const,
        centerPoint: { x: 900, y: 940 },
      };

      try {
        guardrail.assertElementSafe(targetForbidden);
      } catch (err) {
        if (err instanceof SafetyViolationError) {
          guardrailTriggered = true;
          guardrailReport = err.message;
          steps.push({
            stepIndex: stepCounter++,
            action: 'BLOCK_FINAL_VALIDATION',
            targetLabel: targetForbidden.detectedLabel,
            coordinates: targetForbidden.centerPoint,
            status: 'BLOCKED_BY_GUARDRAIL',
            message: err.message,
            timestamp: new Date().toISOString(),
          });
          pythonLines.push(
            '',
            `# TENTATIVE DE VALIDATION FINALE INTERCEPTÉE :`,
            `guardrail.assert_element_safe("forbidden_final_button", ${JSON.stringify(targetForbidden.detectedLabel)})  # -> Lève SafetyViolationError !`
          );
        }
      }
    } else {
      const draftBtn = draftButtons[0];
      const draftLabel = draftBtn?.detectedLabel ?? 'Enregistrer Brouillon';
      if (draftBtn) {
        guardrail.assertElementSafe(draftBtn);
      }
      steps.push({
        stepIndex: stepCounter++,
        action: 'CLICK_SAVE_DRAFT',
        targetLabel: draftLabel,
        coordinates: draftBtn?.centerPoint ?? { x: 730, y: 940 },
        status: 'STOPPED_AT_DRAFT',
        message: `Action "${draftLabel}" exécutée. Cycle agent terminé — validation définitive bloquée par défaut.`,
        timestamp: new Date().toISOString(),
      });

      if (forbiddenButtons.length > 0) {
        for (const fb of forbiddenButtons) {
          steps.push({
            stepIndex: stepCounter++,
            action: 'BLOCK_FINAL_VALIDATION',
            targetLabel: fb.detectedLabel,
            coordinates: fb.centerPoint,
            status: 'BLOCKED_BY_GUARDRAIL',
            message: `Bouton "${fb.detectedLabel}" verrouillé par le Garde-Fou Absolu (validation pharmacien obligatoire).`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      pythonLines.push(
        '',
        `# ARRÊT STRICT AU STADE BROUILLON`,
        `guardrail.assert_element_safe("draft_button", ${JSON.stringify(draftLabel)})`,
        `# Clic sur "${draftLabel}" uniquement. Validation finale interdite.`
      );
    }

    const wb = XLSX.utils.book_new();
    const rows = (extractedData.lineItems || []).map((item) => ({
      'N° de document': extractedData.documentNumber,
      'Fournisseur / Organisme': extractedData.supplierOrOrg,
      Date: extractedData.documentDate,
      'Désignation (DCI)': item.designation,
      Quantité: item.quantity,
      'N° de lot': item.lotNumber || 'N/A',
      'Date de péremption': item.expiryDate || 'N/A',
      'Prix unitaire (FCFA)': item.unitPriceFCFA,
      'Sous-total (FCFA)': item.quantity * item.unitPriceFCFA,
      'Statut Saisie PharmAgent': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'BROUILLON_STOCK');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const draftFileName = `BROUILLON_${pharmacy.id}_${extractedData.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
    store.saveDraftArtifact(runId, draftFileName, xlsxBuffer);

    const ownerActor = getActorForPharmacy(req, pharmacy.id);
    if (!guardrailTriggered) {
      store.saveDraft({
        id: runId,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        createdAt: new Date().toISOString(),
        taskPrompt: 'Saisie par UI Grounding sur capture écran cible.',
        targetMode: 'erp_live',
        status: 'BROUILLON',
        extracted: extractedData,
        draftArtifactUrl: `/api/drafts/${runId}/download`,
        draftFileName,
        createdBy: ownerActor?.displayName,
        createdByRole: ownerActor?.role,
        guardrailNote: guardrailReport,
      });
    }

    store.recordExecutionOutcome({
      pharmacyId: pharmacy.id,
      documentNumber: extractedData.documentNumber,
      documentType: extractedData.documentType || 'bon_livraison',
      tokensUsed: extractedData.tokensConsumed ?? 2100,
      blocked: guardrailTriggered,
      guardrailMessage: guardrailReport,
      actorName: ownerActor?.displayName,
      actorRole: ownerActor?.role,
    });

    const result: ExecutionRunResult = {
      runId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      documentNumber: extractedData.documentNumber,
      finalState: guardrailTriggered ? 'SECURITY_VIOLATION_BLOCKED' : 'DRAFT_SAVED_ONLY',
      draftArtifactUrl: `/api/drafts/${runId}/download`,
      draftFileName,
      steps,
      guardrailTriggered,
      guardrailReport,
      pythonScriptPreview: pythonLines.join('\n'),
    };

    res.json(result);
  } catch (err: unknown) {
    if (err instanceof SafetyViolationError) {
      res.status(403).json({ error: err.message, guardrailTriggered: true });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur d’exécution Brouillon.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/drafts/:draftId/download', (req, res) => {
  const draft = store.getDraft(req.params.draftId);
  const owner = getOwnerSession(req);
  if (!owner) {
    const user = getPharmacySession(req);
    if (!user) {
      res.status(401).json({ error: 'Authentification requise pour télécharger ce brouillon.' });
      return;
    }
    if (draft && draft.pharmacyId !== user.pharmacyId) {
      res.status(403).json({ error: 'Accès interdit au brouillon d’une autre officine.' });
      return;
    }
  }
  const artifact = store.getDraftArtifact(req.params.draftId);
  if (!artifact) {
    res.status(404).json({ error: 'Fichier Brouillon introuvable ou expiré.' });
    return;
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
  res.send(artifact.buffer);
});

app.get('/api/fastapi-sources', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  const fastapiDir = path.resolve(__dirname, 'backend-fastapi');
  const relativeFiles = [
    'requirements.txt',
    'pharmagent_local_agent.py',
    'app/main.py',
    'app/vision_extractor.py',
    'app/ui_grounding.py',
    'app/safety_guardrail.py',
    'app/executor.py',
  ];

  const files = relativeFiles
    .map((rel) => {
      const fullPath = path.join(fastapiDir, rel);
      if (!fs.existsSync(fullPath)) return null;
      return {
        path: `backend-fastapi/${rel}`,
        language: rel.endsWith('.py') ? 'python' : 'text',
        content: fs.readFileSync(fullPath, 'utf-8'),
      };
    })
    .filter(Boolean);

  res.json({ files });
});

app.get('/api/export/saas-backup', (req, res) => {
  const owner = requireOwnerSession(req, res);
  if (!owner) return;
  const dashboard = store.getDashboard();
  const backupPayload = {
    exportedAt: new Date().toISOString(),
    license: 'PA-COM-SN-2026 — Dr. Oumar (DU Commercial, Sénégal)',
    owner: {
      loginId: owner.loginId,
      fullName: owner.fullName,
      title: owner.title,
    },
    snapshot: dashboard,
  };
  const dateSlug = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="PharmAgent_Sauvegarde_${dateSlug}.json"`
  );
  res.send(JSON.stringify(backupPayload, null, 2));
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API introuvable.' });
  });

  app.use(
    '/src/assets/images',
    express.static(path.resolve(__dirname, 'src/assets/images'))
  );

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PharmAgent server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
