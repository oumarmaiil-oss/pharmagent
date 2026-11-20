// ============================================================
// PharmAgent — Persistance (mémoire + fichier JSON + Postgres optionnel)
// ============================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { normalizeLabel, normalizeSupplier } from './productMatcher.ts';
import type {
  AgentLearnedMemory,
  AgentPresence,
  AgentProfile,
  AuditLogEntry,
  AuditLevel,
  CatalogProduct,
  ColumnRule,
  DraftExecution,
  DraftRecord,
  DraftStatus,
  OwnerAccount,
  Pharmacy,
  PharmacyUser,
  ProductAlias,
  SubscriptionPlan,
  TargetSoftwareType,
} from '../types/pharmagent.ts';

// ─── Utilitaires ──────────────────────────────────────────

function nanoid(len = 12): string {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw + 'pharmagent-salt').digest('hex');
}

function checkPassword(pw: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(pw));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const READABLE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function readable(len: number): string {
  return Array.from(crypto.randomBytes(len)).map((b) => READABLE[b % READABLE.length]).join('');
}

function generateSecret(len = 16): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.randomBytes(len)).map((b) => chars[b % chars.length]).join('');
}

function now(): string {
  return new Date().toISOString();
}

// ─── Emplacements ─────────────────────────────────────────

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
const DB_PATH = path.join(DATA_DIR, 'pharmagent-db.json');
const DATABASE_URL = process.env.DATABASE_URL;

// Une tâche « en saisie » depuis plus longtemps est considérée comme abandonnée
const RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Mots de passe provisoires ────────────────────────────

const ownerPassword = process.env.PHARMAGENT_OWNER_PASSWORD ?? generateSecret();
const pharmacyPassword = process.env.PHARMAGENT_PHARMACY_DEFAULT_PASSWORD ?? generateSecret();

if (!process.env.PHARMAGENT_OWNER_PASSWORD || !process.env.PHARMAGENT_PHARMACY_DEFAULT_PASSWORD) {
  console.warn(
    '[PharmAgent] Mots de passe provisoires (définis pour les NOUVEAUX comptes uniquement) :\n' +
    `  Propriétaire : dr.oumar / ${ownerPassword}\n` +
    `  Officines    : titulaire|adjoint|assistant / ${pharmacyPassword}\n` +
    '  → Définissez PHARMAGENT_OWNER_PASSWORD et PHARMAGENT_PHARMACY_DEFAULT_PASSWORD pour les fixer.'
  );
}

// ─── Structure de la base ─────────────────────────────────

interface Database {
  owner: OwnerAccount;
  pharmacies: Pharmacy[];
  users: PharmacyUser[];
  drafts: DraftRecord[];
  auditLogs: AuditLogEntry[];
  learnedMemory: AgentLearnedMemory;
  catalog: CatalogProduct[];
  agentProfiles: AgentProfile[];
  authSecret: string;
}

export interface CatalogRowInput {
  erpLabel: string;
  cip?: string;
  purchasePriceFCFA?: number;
  salePriceFCFA?: number;
  stockQty?: number;
}

export interface ExecutionResultInput {
  status: 'done' | 'failed';
  message?: string;
  durationMs?: number;
  lines?: DraftExecution['lines'];
}

function initialDatabase(): Database {
  const demoPharmacyId = `ph-${nanoid(8)}`;
  return {
    owner: {
      id: 'OWNER-01',
      loginId: 'dr.oumar',
      fullName: 'Dr. Oumar',
      role: 'owner',
      passwordHash: hashPassword(ownerPassword),
      createdAt: now(),
    },
    pharmacies: [
      {
        id: demoPharmacyId,
        name: 'Pharmacie Alpha (Démo)',
        city: 'Dakar',
        region: 'Dakar',
        pharmacist: 'Dr. Aminata Diallo',
        targetSoftware: 'ERP Officine Intégré',
        createdAt: now(),
        subscription: 'trial',
        monthlyQuota: 50,
        usedThisMonth: 0,
        agentKey: `ak-${nanoid(24)}`,
      },
    ],
    users: [
      {
        id: `usr-${nanoid(8)}`,
        pharmacyId: demoPharmacyId,
        loginId: 'titulaire',
        fullName: 'Dr. Aminata Diallo',
        role: 'titulaire',
        passwordHash: hashPassword(pharmacyPassword),
        createdAt: now(),
      },
    ],
    drafts: [],
    auditLogs: [],
    learnedMemory: {
      productAliases: [],
      columnRules: [
        { id: nanoid(), sourceField: 'item.designation', targetColumn: 'Désignation Médicament', createdAt: now() },
        { id: nanoid(), sourceField: 'item.quantity', targetColumn: 'Quantité Reçue', createdAt: now() },
        { id: nanoid(), sourceField: 'item.expiryDate', targetColumn: 'Date Péremption', createdAt: now() },
        { id: nanoid(), sourceField: 'item.lotNumber', targetColumn: 'N° Lot Fabricant', createdAt: now() },
        { id: nanoid(), sourceField: 'item.unitPriceFCFA', targetColumn: 'Prix Achat Unitaire (FCFA)', createdAt: now() },
        { id: nanoid(), sourceField: 'documentDate', targetColumn: 'Date Réception', createdAt: now() },
        { id: nanoid(), sourceField: 'supplierOrOrg', targetColumn: 'Fournisseur', createdAt: now() },
        { id: nanoid(), sourceField: 'documentNumber', targetColumn: 'N° Bon Livraison', createdAt: now() },
      ],
    },
    catalog: [],
    agentProfiles: [],
    authSecret: process.env.PHARMAGENT_AUTH_SECRET ?? generateSecret(32),
  };
}

// ─── Token de session (HMAC, sans dépendance) ─────────────

function makeToken(payload: object, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken<T>(token: string, secret: string): T | null {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Store principal ──────────────────────────────────────

class PharmAgentStore {
  private db: Database;
  private pool?: pg.Pool;
  private pgTimer?: NodeJS.Timeout;
  private presence = new Map<string, AgentPresence>();

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let loaded: Database | undefined;
    if (fs.existsSync(DB_PATH)) {
      try { loaded = this.migrate(JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as Database); } catch { /* fichier corrompu */ }
    }
    this.db = loaded ?? initialDatabase();
    this.ensureCodes();
    if (!loaded) this.writeFile();
  }

  // Chaque pharmacie a un code court pour se connecter (attribué aussi aux pharmacies existantes)
  private ensureCodes(): void {
    const used = new Set(this.db.pharmacies.map((p) => p.code).filter(Boolean));
    for (const ph of this.db.pharmacies) {
      if (ph.code) continue;
      let code = readable(6);
      while (used.has(code)) code = readable(6);
      ph.code = code;
      used.add(code);
    }
  }

  // Charge l'état depuis Postgres si DATABASE_URL est défini (survit aux redémarrages Render)
  async init(): Promise<void> {
    if (!DATABASE_URL) {
      console.warn('[PharmAgent] DATABASE_URL absent : données sur disque local uniquement (perdues au redéploiement sur Render gratuit).');
      return;
    }
    const needsSsl = /\.render\.com|sslmode=require/.test(DATABASE_URL);
    this.pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
    await this.pool.query(
      'CREATE TABLE IF NOT EXISTS pharmagent_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    const r = await this.pool.query<{ data: Database }>('SELECT data FROM pharmagent_state WHERE id = 1');
    if (r.rows[0]) {
      this.db = this.migrate(r.rows[0].data);
      this.ensureCodes();
      this.writeFile();
      console.log('[PharmAgent] État chargé depuis Postgres.');
    } else {
      await this.flushPg();
      console.log('[PharmAgent] Postgres initialisé.');
    }
  }

  async shutdown(): Promise<void> {
    if (this.pgTimer) { clearTimeout(this.pgTimer); this.pgTimer = undefined; }
    await this.flushPg();
    await this.pool?.end();
  }

  get persistence(): 'postgres' | 'disk' {
    return this.pool ? 'postgres' : 'disk';
  }

  private migrate(parsed: Database): Database {
    const def = initialDatabase();
    for (const d of parsed.drafts ?? []) {
      if (d.extractionStatus === 'processing') {
        d.extractionStatus = 'error';
        d.extractionError = "Analyse interrompue par un redémarrage du serveur. Relancez l'analyse.";
        d.status = 'rejected';
        d.rejectionReason = d.extractionError;
      }
    }
    return {
      ...def,
      ...parsed,
      learnedMemory: {
        productAliases: parsed.learnedMemory?.productAliases ?? [],
        columnRules: parsed.learnedMemory?.columnRules ?? def.learnedMemory.columnRules,
      },
      catalog: parsed.catalog ?? [],
      agentProfiles: parsed.agentProfiles ?? [],
      authSecret: parsed.authSecret ?? def.authSecret,
    };
  }

  private writeFile(): void {
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  }

  private persist(): void {
    this.writeFile();
    if (this.pool && !this.pgTimer) {
      this.pgTimer = setTimeout(() => { this.pgTimer = undefined; void this.flushPg(); }, 400);
    }
  }

  private async flushPg(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        'INSERT INTO pharmagent_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
        [JSON.stringify(this.db)]
      );
    } catch (err) {
      console.error('[PharmAgent] Écriture Postgres échouée, nouvel essai dans 5 s :', (err as Error).message);
      if (!this.pgTimer) this.pgTimer = setTimeout(() => { this.pgTimer = undefined; void this.flushPg(); }, 5000);
    }
  }

  // ── Auth ──────────────────────────────────────────────

  loginOwner(loginId: string, password: string): string | null {
    const o = this.db.owner;
    if (o.loginId !== loginId) return null;
    if (!checkPassword(password, o.passwordHash)) return null;
    return makeToken({ kind: 'owner', sub: o.id }, this.db.authSecret);
  }

  verifyOwnerToken(token: string): OwnerAccount | null {
    const payload = verifyToken<{ kind: string; sub: string }>(token, this.db.authSecret);
    if (!payload || payload.kind !== 'owner') return null;
    return this.db.owner.id === payload.sub ? this.db.owner : null;
  }

  loginPharmacyUser(pharmacyId: string, loginId: string, password: string): string | null {
    const user = this.db.users.find((u) => u.pharmacyId === pharmacyId && u.loginId === loginId);
    if (!user) return null;
    if (!checkPassword(password, user.passwordHash)) return null;
    return makeToken({ kind: 'pharmacy_user', sub: user.id, pharmacyId }, this.db.authSecret);
  }

  verifyPharmacyUserToken(token: string): PharmacyUser | null {
    const payload = verifyToken<{ kind: string; sub: string; pharmacyId: string }>(token, this.db.authSecret);
    if (!payload || payload.kind !== 'pharmacy_user') return null;
    return this.db.users.find((u) => u.id === payload.sub) ?? null;
  }

  changeOwnerCredentials(newLoginId: string, newFullName: string, currentPassword: string, newPassword?: string): boolean {
    const o = this.db.owner;
    if (!checkPassword(currentPassword, o.passwordHash)) return false;
    o.loginId = newLoginId || o.loginId;
    o.fullName = newFullName || o.fullName;
    if (newPassword) o.passwordHash = hashPassword(newPassword);
    this.persist();
    return true;
  }

  // ── Pharmacies ────────────────────────────────────────

  getPharmacies(): Pharmacy[] {
    return this.db.pharmacies.map((p) => ({ ...p, agent: this.presence.get(p.id) }));
  }

  getPharmacy(id: string): Pharmacy | undefined {
    return this.db.pharmacies.find((p) => p.id === id);
  }

  createPharmacy(params: { name: string; city: string; region?: string; pharmacist: string; targetSoftware: TargetSoftwareType }): { pharmacy: Pharmacy; password: string } {
    const pharmacy: Pharmacy = {
      id: `ph-${nanoid(8)}`,
      name: params.name,
      city: params.city,
      region: params.region ?? params.city,
      pharmacist: params.pharmacist,
      targetSoftware: params.targetSoftware,
      createdAt: now(),
      subscription: 'trial',
      monthlyQuota: 50,
      usedThisMonth: 0,
      agentKey: `ak-${nanoid(24)}`,
    };
    this.db.pharmacies.push(pharmacy);
    const password = readable(8);
    this.db.users.push({
      id: `usr-${nanoid(8)}`,
      pharmacyId: pharmacy.id,
      loginId: 'titulaire',
      fullName: params.pharmacist,
      role: 'titulaire',
      passwordHash: hashPassword(password),
      createdAt: now(),
    });
    this.ensureCodes();
    this.persist();
    return { pharmacy, password };
  }

  updatePharmacySubscription(id: string, plan: SubscriptionPlan, quota?: number): void {
    const ph = this.db.pharmacies.find((p) => p.id === id);
    if (!ph) return;
    ph.subscription = plan;
    if (quota !== undefined) ph.monthlyQuota = quota;
    this.persist();
  }

  getPharmacyByCode(code: string): Pharmacy | undefined {
    const c = code.trim().toUpperCase();
    return c ? this.db.pharmacies.find((p) => p.code === c) : undefined;
  }

  loginPharmacyProfile(code: string, profile: 'pharmacien' | 'equipe', password: string): { token: string; user: PharmacyUser; pharmacy: Pharmacy } | null {
    const pharmacy = this.getPharmacyByCode(code);
    if (!pharmacy) return null;
    const user = this.db.users.find((u) => u.pharmacyId === pharmacy.id
      && (profile === 'pharmacien' ? u.role === 'titulaire' : u.role !== 'titulaire')
      && checkPassword(password, u.passwordHash));
    if (!user) return null;
    return { token: makeToken({ kind: 'pharmacy_user', sub: user.id, pharmacyId: pharmacy.id }, this.db.authSecret), user, pharmacy };
  }

  verifyUserPassword(userId: string, password: string): boolean {
    const u = this.db.users.find((x) => x.id === userId);
    return !!u && checkPassword(password, u.passwordHash);
  }

  setUserPassword(userId: string, password: string): void {
    const u = this.db.users.find((x) => x.id === userId);
    if (!u) return;
    u.passwordHash = hashPassword(password);
    this.persist();
  }

  resetPharmacistPassword(pharmacyId: string): string | null {
    const u = this.db.users.find((x) => x.pharmacyId === pharmacyId && x.role === 'titulaire');
    if (!u) return null;
    const password = readable(8);
    u.passwordHash = hashPassword(password);
    this.persist();
    return password;
  }

  hasTeamAccount(pharmacyId: string): boolean {
    return this.db.users.some((u) => u.pharmacyId === pharmacyId && u.role !== 'titulaire');
  }

  // Compte « Équipe » facultatif : créé ou réinitialisé par le pharmacien
  resetTeamAccount(pharmacyId: string): string {
    const ph = this.db.pharmacies.find((p) => p.id === pharmacyId);
    let user = this.db.users.find((u) => u.pharmacyId === pharmacyId && u.loginId === 'equipe');
    if (!user) {
      user = { id: `usr-${nanoid(8)}`, pharmacyId, loginId: 'equipe', fullName: `Équipe (${ph?.name ?? ''})`, role: 'assistant', passwordHash: '', createdAt: now() };
      this.db.users.push(user);
    }
    const password = readable(8);
    user.passwordHash = hashPassword(password);
    this.persist();
    return password;
  }

  getPharmacyUsers(pharmacyId: string): PharmacyUser[] {
    return this.db.users.filter((u) => u.pharmacyId === pharmacyId);
  }

  // ── Agent local ───────────────────────────────────────

  getPharmacyByAgentKey(key: string): Pharmacy | undefined {
    if (!key) return undefined;
    return this.db.pharmacies.find((p) => p.agentKey === key);
  }

  touchAgent(pharmacyId: string, info: Partial<AgentPresence>): void {
    const prev = this.presence.get(pharmacyId);
    this.presence.set(pharmacyId, { ...prev, ...info, lastSeen: now() });
  }

  getProfile(pharmacyId: string): AgentProfile | undefined {
    return this.db.agentProfiles.find((p) => p.pharmacyId === pharmacyId);
  }

  saveProfile(profile: Omit<AgentProfile, 'updatedAt'>): AgentProfile {
    const full: AgentProfile = { ...profile, updatedAt: now() };
    this.db.agentProfiles = this.db.agentProfiles.filter((p) => p.pharmacyId !== profile.pharmacyId);
    this.db.agentProfiles.push(full);
    this.persist();
    return full;
  }

  // ── Brouillons ────────────────────────────────────────

  getDrafts(pharmacyId?: string): DraftRecord[] {
    return pharmacyId ? this.db.drafts.filter((d) => d.pharmacyId === pharmacyId) : this.db.drafts;
  }

  getDraft(id: string): DraftRecord | undefined {
    return this.db.drafts.find((d) => d.id === id);
  }

  createDraft(params: Omit<DraftRecord, 'id' | 'createdAt' | 'updatedAt'>): DraftRecord {
    const draft: DraftRecord = { ...params, id: `dr-${nanoid(10)}`, createdAt: now(), updatedAt: now() };
    this.db.drafts.unshift(draft);
    const ph = this.db.pharmacies.find((p) => p.id === params.pharmacyId);
    if (ph) { this.rollMonth(ph); ph.usedThisMonth += 1; }
    if (this.db.drafts.length > 500) this.db.drafts = this.db.drafts.slice(0, 500);
    this.persist();
    return draft;
  }

  private rollMonth(ph: Pharmacy): void {
    const month = new Date().toISOString().slice(0, 7);
    if (ph.quotaMonth !== month) { ph.quotaMonth = month; ph.usedThisMonth = 0; }
  }

  checkQuota(pharmacyId: string): { ok: true } | { ok: false; reason: string } {
    const ph = this.db.pharmacies.find((p) => p.id === pharmacyId);
    if (!ph) return { ok: false, reason: 'Officine inconnue.' };
    this.rollMonth(ph);
    if (ph.subscription === 'suspended') return { ok: false, reason: 'Abonnement suspendu : contactez le responsable PharmAgent.' };
    if (ph.usedThisMonth >= ph.monthlyQuota) {
      return { ok: false, reason: `Quota mensuel atteint (${ph.usedThisMonth}/${ph.monthlyQuota} bons). Le propriétaire peut l'augmenter dans Mes Officines.` };
    }
    return { ok: true };
  }

  exportState(): Database {
    return JSON.parse(JSON.stringify(this.db)) as Database;
  }

  async importState(data: unknown): Promise<{ pharmacies: number; drafts: number }> {
    const d = data as Partial<Database> | null;
    if (!d || typeof d !== 'object' || !d.owner || !Array.isArray(d.pharmacies) || !Array.isArray(d.drafts)) {
      throw new Error('Fichier de sauvegarde invalide.');
    }
    this.db = this.migrate(d as Database);
    this.ensureCodes();
    this.writeFile();
    await this.flushPg();
    return { pharmacies: this.db.pharmacies.length, drafts: this.db.drafts.length };
  }

  finalizeExtraction(id: string, data: DraftRecord['extractedData'], mapping: DraftRecord['columnMapping'], tokens: number): void {
    const draft = this.db.drafts.find((d) => d.id === id);
    if (!draft) return;
    draft.extractedData = data;
    draft.columnMapping = mapping;
    draft.tokensConsumed = tokens;
    draft.extractionStatus = 'ready';
    const key = (s?: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Même fournisseur = même premier mot (« Laborex (eurapharma), Dakar » = « LABOREX EURAPHARMA ») ; inconnu d'un côté = on se fie au numéro
    const brand = (s?: string) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/)?.[0] ?? '';
    const sameSupplier = (a?: string, b?: string) => !brand(a) || !brand(b) || brand(a) === brand(b);
    const number = key(data.documentNumber);
    const dup = number ? this.db.drafts.find((d) => d.id !== id && d.pharmacyId === draft.pharmacyId && d.status !== 'rejected'
      && d.extractionStatus !== 'error' && key(d.extractedData.documentNumber) === number
      && sameSupplier(d.extractedData.supplierOrOrg, data.supplierOrOrg)) : undefined;
    draft.duplicateOf = dup ? { id: dup.id, createdAt: dup.createdAt, status: dup.status } : undefined;
    draft.updatedAt = now();
    this.persist();
  }

  failExtraction(id: string, error: string): void {
    const draft = this.db.drafts.find((d) => d.id === id);
    if (!draft) return;
    draft.extractionStatus = 'error';
    draft.extractionError = error;
    draft.status = 'rejected';
    draft.rejectionReason = error;
    const ph = this.db.pharmacies.find((p) => p.id === draft.pharmacyId);
    if (ph && ph.usedThisMonth > 0) ph.usedThisMonth -= 1;
    draft.updatedAt = now();
    this.persist();
  }

  updateDraftStatus(id: string, status: DraftStatus, actorName: string, reason?: string): DraftRecord | undefined {
    const draft = this.db.drafts.find((d) => d.id === id);
    if (!draft) return undefined;
    draft.status = status;
    draft.updatedAt = now();
    if (status === 'approved') {
      draft.approvedBy = actorName;
      draft.execution = { status: 'queued', queuedAt: now(), attempts: 0 };
    }
    if (status === 'rejected') draft.rejectionReason = reason ?? '';
    this.persist();
    return draft;
  }

  updateDraftItems(id: string, items: DraftRecord['extractedData']['lineItems']): void {
    const draft = this.db.drafts.find((d) => d.id === id);
    if (!draft) return;
    draft.extractedData.lineItems = items;
    draft.updatedAt = now();
    this.persist();
  }

  // Attribue atomiquement la plus ancienne saisie en attente : un bon n'est jamais saisi deux fois
  claimNextExecution(pharmacyId: string): DraftRecord | undefined {
    const mine = this.db.drafts.filter((d) => d.pharmacyId === pharmacyId && d.status === 'approved' && d.execution);
    let changed = false;
    for (const d of mine) {
      const ex = d.execution!;
      if (ex.status === 'running' && ex.startedAt && Date.now() - Date.parse(ex.startedAt) > RUNNING_TIMEOUT_MS) {
        ex.status = 'failed';
        ex.finishedAt = now();
        ex.message = "Délai dépassé : l'agent ne s'est pas manifesté. Vérifiez l'ERP puis relancez.";
        changed = true;
      }
    }
    // Une seule saisie à la fois par officine
    if (mine.some((d) => d.execution!.status === 'running')) {
      if (changed) this.persist();
      return undefined;
    }
    const next = mine
      .filter((d) => d.execution!.status === 'queued')
      .sort((a, b) => a.execution!.queuedAt.localeCompare(b.execution!.queuedAt))[0];
    if (!next) {
      if (changed) this.persist();
      return undefined;
    }
    const ex = next.execution!;
    ex.status = 'running';
    ex.startedAt = now();
    ex.finishedAt = undefined;
    ex.message = undefined;
    ex.lines = undefined;
    ex.attempts += 1;
    next.updatedAt = now();
    this.persist();
    return next;
  }

  finishExecution(draftId: string, pharmacyId: string, result: ExecutionResultInput): DraftRecord | undefined {
    const d = this.db.drafts.find((x) => x.id === draftId && x.pharmacyId === pharmacyId);
    if (!d?.execution || d.execution.status !== 'running') return undefined;
    d.execution.status = result.status;
    d.execution.finishedAt = now();
    d.execution.message = result.message?.slice(0, 500);
    d.execution.durationMs = result.durationMs;
    d.execution.lines = result.lines?.slice(0, 500);
    d.updatedAt = now();
    this.persist();
    return d;
  }

  requeueExecution(draftId: string): DraftRecord | undefined {
    const d = this.db.drafts.find((x) => x.id === draftId);
    if (!d || d.status !== 'approved') return undefined;
    d.execution = { status: 'queued', queuedAt: now(), attempts: d.execution?.attempts ?? 0 };
    d.updatedAt = now();
    this.persist();
    return d;
  }

  // ── Audit ─────────────────────────────────────────────

  addAuditLog(params: { pharmacyId: string; actorId: string; actorName: string; action: string; level: AuditLevel; details?: string }): void {
    const ph = this.db.pharmacies.find((p) => p.id === params.pharmacyId);
    this.db.auditLogs.unshift({
      id: `al-${nanoid(10)}`,
      pharmacyId: params.pharmacyId,
      pharmacyName: ph?.name ?? 'Superviseur',
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.action,
      level: params.level,
      details: params.details,
      timestamp: now(),
    });
    if (this.db.auditLogs.length > 1000) this.db.auditLogs = this.db.auditLogs.slice(0, 1000);
    this.persist();
  }

  getAuditLogs(pharmacyId?: string, limit = 100): AuditLogEntry[] {
    const logs = pharmacyId ? this.db.auditLogs.filter((l) => l.pharmacyId === pharmacyId) : this.db.auditLogs;
    return logs.slice(0, limit);
  }

  // ── Mémoire ───────────────────────────────────────────

  getMemory(): AgentLearnedMemory { return this.db.learnedMemory; }

  getAliasesForPharmacy(pharmacyId: string): ProductAlias[] {
    return this.db.learnedMemory.productAliases.filter((a) => !a.pharmacyId || a.pharmacyId === pharmacyId);
  }

  addProductAlias(rawLabel: string, canonicalName: string, pharmacyId?: string): ProductAlias {
    const existing = this.db.learnedMemory.productAliases.find(
      (a) => a.rawLabel.toLowerCase() === rawLabel.toLowerCase() && a.pharmacyId === pharmacyId && !a.supplier
    );
    if (existing) { existing.canonicalName = canonicalName; this.persist(); return existing; }
    const alias: ProductAlias = { id: nanoid(), rawLabel, canonicalName, pharmacyId, createdAt: now() };
    this.db.learnedMemory.productAliases.unshift(alias);
    this.persist();
    return alias;
  }

  removeProductAlias(id: string): void {
    this.db.learnedMemory.productAliases = this.db.learnedMemory.productAliases.filter((a) => a.id !== id);
    this.persist();
  }

  addColumnRule(sourceField: string, targetColumn: string, pharmacyId?: string): ColumnRule {
    const existing = this.db.learnedMemory.columnRules.find((r) => r.sourceField === sourceField);
    if (existing) { existing.targetColumn = targetColumn; this.persist(); return existing; }
    const rule: ColumnRule = { id: nanoid(), sourceField, targetColumn, pharmacyId, createdAt: now() };
    this.db.learnedMemory.columnRules.unshift(rule);
    this.persist();
    return rule;
  }

  removeColumnRule(id: string): void {
    this.db.learnedMemory.columnRules = this.db.learnedMemory.columnRules.filter((r) => r.id !== id);
    this.persist();
  }

  // Mémorise « ce libellé de ce grossiste = ce produit ERP » et enrichit le catalogue.
  // Ne persiste pas : l'appelant enchaîne avec une écriture (lot de lignes).
  learnMatch(params: { pharmacyId: string; supplier: string; rawLabel: string; productId?: string; erpLabel: string; purchasePriceFCFA?: number; salePriceFCFA?: number; cip?: string }): CatalogProduct {
    const supplier = normalizeSupplier(params.supplier);
    let product = params.productId
      ? this.db.catalog.find((p) => p.id === params.productId && p.pharmacyId === params.pharmacyId)
      : undefined;
    if (!product) {
      const key = normalizeLabel(params.erpLabel);
      product = this.db.catalog.find((p) => p.pharmacyId === params.pharmacyId && normalizeLabel(p.erpLabel) === key);
    }
    if (!product) {
      product = {
        id: `pr-${nanoid(10)}`, pharmacyId: params.pharmacyId, erpLabel: params.erpLabel.trim(),
        suppliers: [], source: 'learned', updatedAt: now(),
      };
      this.db.catalog.push(product);
    }
    if (supplier && !product.suppliers.includes(supplier)) product.suppliers.push(supplier);
    if (params.purchasePriceFCFA) product.purchasePriceFCFA = params.purchasePriceFCFA;
    if (params.salePriceFCFA) product.salePriceFCFA = params.salePriceFCFA;
    if (params.cip && !product.cip) product.cip = params.cip.replace(/\D/g, '') || undefined;
    product.updatedAt = now();

    const rawKey = normalizeLabel(params.rawLabel);
    const aliases = this.db.learnedMemory.productAliases;
    const existing = aliases.find((a) => a.pharmacyId === params.pharmacyId && a.supplier === supplier && normalizeLabel(a.rawLabel) === rawKey);
    if (existing) {
      existing.productId = product.id;
      existing.canonicalName = product.erpLabel;
      existing.hits = (existing.hits ?? 0) + 1;
    } else {
      aliases.unshift({
        id: nanoid(), rawLabel: params.rawLabel, canonicalName: product.erpLabel,
        pharmacyId: params.pharmacyId, supplier, productId: product.id, hits: 1, createdAt: now(),
      });
    }
    return product;
  }

  flush(): void { this.persist(); }

  importMemoryFromJson(json: { productAliases?: ProductAlias[]; columnRules?: ColumnRule[] }): void {
    for (const a of json.productAliases ?? []) {
      if (a.rawLabel && a.canonicalName) this.addProductAlias(a.rawLabel, a.canonicalName, a.pharmacyId);
    }
    for (const r of json.columnRules ?? []) {
      if (r.sourceField && r.targetColumn) this.addColumnRule(r.sourceField, r.targetColumn, r.pharmacyId);
    }
  }

  // ── Catalogue produits ───────────────────────────────

  getCatalog(pharmacyId: string): CatalogProduct[] {
    return this.db.catalog.filter((p) => p.pharmacyId === pharmacyId);
  }

  upsertCatalog(pharmacyId: string, rows: CatalogRowInput[], source: CatalogProduct['source']): { added: number; updated: number } {
    const mine = this.getCatalog(pharmacyId);
    const byCip = new Map(mine.filter((p) => p.cip).map((p) => [p.cip!, p]));
    const byLabel = new Map(mine.map((p) => [normalizeLabel(p.erpLabel), p]));
    let added = 0, updated = 0;
    for (const r of rows) {
      const label = typeof r.erpLabel === 'string' ? r.erpLabel.trim().slice(0, 200) : '';
      if (!label) continue;
      const cip = (typeof r.cip === 'string' || typeof r.cip === 'number') ? String(r.cip).replace(/\D/g, '') || undefined : undefined;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      const existing = (cip && byCip.get(cip)) || byLabel.get(normalizeLabel(label));
      if (existing) {
        existing.erpLabel = label;
        if (cip) existing.cip = cip;
        if (num(r.purchasePriceFCFA)) existing.purchasePriceFCFA = num(r.purchasePriceFCFA);
        if (num(r.salePriceFCFA)) existing.salePriceFCFA = num(r.salePriceFCFA);
        if (num(r.stockQty) !== undefined) existing.stockQty = num(r.stockQty);
        existing.updatedAt = now();
        updated++;
      } else {
        const p: CatalogProduct = {
          id: `pr-${nanoid(10)}`, pharmacyId, erpLabel: label, cip,
          purchasePriceFCFA: num(r.purchasePriceFCFA), salePriceFCFA: num(r.salePriceFCFA), stockQty: num(r.stockQty),
          suppliers: [], source, updatedAt: now(),
        };
        this.db.catalog.push(p);
        byLabel.set(normalizeLabel(label), p);
        if (cip) byCip.set(cip, p);
        added++;
      }
    }
    if (added || updated) this.persist();
    return { added, updated };
  }

  clearCatalog(pharmacyId: string): void {
    this.db.catalog = this.db.catalog.filter((p) => p.pharmacyId !== pharmacyId);
    this.persist();
  }

  // ── Dashboard ────────────────────────────────────────

  getDashboard(pharmacyId?: string) {
    const pharmacies = this.getPharmacies().filter((p) => !pharmacyId || p.id === pharmacyId);
    const drafts = pharmacyId ? this.db.drafts.filter((d) => d.pharmacyId === pharmacyId) : this.db.drafts;
    const thisMonth = new Date().toISOString().slice(0, 7);

    const stats = pharmacies.map((ph) => {
      const phDrafts = drafts.filter((d) => d.pharmacyId === ph.id);
      const monthDrafts = phDrafts.filter((d) => d.createdAt.startsWith(thisMonth));
      return {
        pharmacyId: ph.id,
        pharmacyName: ph.name,
        pendingDrafts: phDrafts.filter((d) => d.status === 'pending').length,
        approvedThisMonth: monthDrafts.filter((d) => d.status === 'approved').length,
        rejectedThisMonth: monthDrafts.filter((d) => d.status === 'rejected').length,
        usedThisMonth: ph.usedThisMonth,
        monthlyQuota: ph.monthlyQuota,
        subscription: ph.subscription,
        lastActivity: phDrafts[0]?.updatedAt,
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      pharmacies,
      stats,
      pendingDrafts: drafts.filter((d) => d.status === 'pending').slice(0, 30),
      recentDrafts: drafts.filter((d) => d.status === 'approved').slice(0, 30),
      recentAudit: this.db.auditLogs.filter((l) => !pharmacyId || l.pharmacyId === pharmacyId).slice(0, 20),
      totalDraftsToday: drafts.filter((d) => d.createdAt.startsWith(todayStr)).length,
      totalApprovedMonth: drafts.filter((d) => d.status === 'approved' && d.updatedAt.startsWith(thisMonth)).length,
      learnedMemory: pharmacyId
        ? { ...this.db.learnedMemory, productAliases: this.db.learnedMemory.productAliases.filter((a) => !a.pharmacyId || a.pharmacyId === pharmacyId) }
        : this.db.learnedMemory,
      persistence: this.persistence,
    };
  }

  getOwner(): OwnerAccount { return this.db.owner; }
}

export const store = new PharmAgentStore();
export { hashPassword, checkPassword, nanoid };
