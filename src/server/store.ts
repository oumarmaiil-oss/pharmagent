// ============================================================
// PharmAgent — Persistance des données (JSON file + mémoire)
// ============================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeLabel, normalizeSupplier } from './productMatcher.ts';
import type {
  AgentLearnedMemory,
  AuditLogEntry,
  AuditLevel,
  CatalogProduct,
  ColumnRule,
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
  return hashPassword(pw) === hash;
}

function generateSecret(len = 16): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.randomBytes(len)).map((b) => chars[b % chars.length]).join('');
}

function now(): string {
  return new Date().toISOString();
}

// ─── Dossier de données ───────────────────────────────────

function resolveDataDir(): string {
  const env = process.env.DATA_DIR;
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'pharmagent-db.json');
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');

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
  authSecret: string;
}

export interface CatalogRowInput {
  erpLabel: string;
  cip?: string;
  purchasePriceFCFA?: number;
  salePriceFCFA?: number;
  stockQty?: number;
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
        agentKey: `ak-${nanoid(20)}`,
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
      productAliases: [
        { id: nanoid(), rawLabel: 'AMOX 500', canonicalName: 'Amoxicilline 500mg', createdAt: now() },
        { id: nanoid(), rawLabel: 'PARACE 1G', canonicalName: 'Paracétamol 1000mg', createdAt: now() },
        { id: nanoid(), rawLabel: 'IBU 400', canonicalName: 'Ibuprofène 400mg', createdAt: now() },
      ],
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
    authSecret: process.env.PHARMAGENT_AUTH_SECRET ?? generateSecret(32),
  };
}

// ─── Token de session (simple, sans lib externe) ──────────

function makeToken(payload: object, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken<T>(token: string, secret: string): T | null {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
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

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Database;
        this.db = this.migrate(parsed);
      } catch {
        this.db = initialDatabase();
        this.persist();
      }
    } else {
      this.db = initialDatabase();
      this.persist();
    }
  }

  private migrate(parsed: Database): Database {
    const def = initialDatabase();
    return {
      ...def,
      ...parsed,
      learnedMemory: {
        productAliases: parsed.learnedMemory?.productAliases ?? def.learnedMemory.productAliases,
        columnRules: parsed.learnedMemory?.columnRules ?? def.learnedMemory.columnRules,
      },
      catalog: parsed.catalog ?? [],
      authSecret: parsed.authSecret ?? def.authSecret,
    };
  }

  private persist(): void {
    fs.writeFileSync(DB_PATH, JSON.stringify(this.db, null, 2), 'utf-8');
  }

  // ── Auth ──────────────────────────────────────────────

  loginOwner(loginId: string, password: string): string | null {
    const o = this.db.owner;
    if (o.loginId !== loginId && (o as any).legacyLoginId !== loginId) return null;
    if (!checkPassword(password, o.passwordHash)) return null;
    return makeToken({ kind: 'owner', sub: o.id, loginId: o.loginId, role: o.role }, this.db.authSecret);
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

  changePharmacyUserPassword(userId: string, newPassword: string): void {
    const user = this.db.users.find((u) => u.id === userId);
    if (user) { user.passwordHash = hashPassword(newPassword); this.persist(); }
  }

  // ── Pharmacies ────────────────────────────────────────

  getPharmacies(): Pharmacy[] { return this.db.pharmacies; }

  getPharmacy(id: string): Pharmacy | undefined {
    return this.db.pharmacies.find((p) => p.id === id);
  }

  createPharmacy(params: { name: string; city: string; region?: string; pharmacist: string; targetSoftware: TargetSoftwareType }): Pharmacy {
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
      agentKey: `ak-${nanoid(20)}`,
    };
    this.db.pharmacies.push(pharmacy);
    // Crée les 3 comptes par défaut
    for (const role of ['titulaire', 'adjoint', 'assistant'] as const) {
      this.db.users.push({
        id: `usr-${nanoid(8)}`,
        pharmacyId: pharmacy.id,
        loginId: role,
        fullName: role === 'titulaire' ? params.pharmacist : `${role.charAt(0).toUpperCase() + role.slice(1)} (${params.name})`,
        role,
        passwordHash: hashPassword(pharmacyPassword),
        createdAt: now(),
      });
    }
    this.persist();
    return pharmacy;
  }

  updatePharmacySubscription(id: string, plan: SubscriptionPlan, quota?: number): void {
    const ph = this.db.pharmacies.find((p) => p.id === id);
    if (!ph) return;
    ph.subscription = plan;
    if (quota !== undefined) ph.monthlyQuota = quota;
    this.persist();
  }

  resetMonthlyUsage(): void {
    this.db.pharmacies.forEach((p) => { p.usedThisMonth = 0; });
    this.persist();
  }

  // ── Utilisateurs officine ─────────────────────────────

  getPharmacyUsers(pharmacyId: string): PharmacyUser[] {
    return this.db.users.filter((u) => u.pharmacyId === pharmacyId);
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
    if (ph) ph.usedThisMonth += 1;
    if (this.db.drafts.length > 500) this.db.drafts = this.db.drafts.slice(0, 500);
    this.persist();
    return draft;
  }

  updateDraftStatus(id: string, status: DraftStatus, actorName: string, reason?: string): DraftRecord | undefined {
    const draft = this.db.drafts.find((d) => d.id === id);
    if (!draft) return undefined;
    draft.status = status;
    draft.updatedAt = now();
    if (status === 'approved') draft.approvedBy = actorName;
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

  // ── Artéfacts Excel brouillons ────────────────────────

  saveDraftFile(draftId: string, fileName: string, buffer: Buffer): void {
    const safe = `${draftId}__${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    fs.writeFileSync(path.join(DRAFTS_DIR, safe), buffer);
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (draft) { draft.hasExcelFile = true; this.persist(); }
  }

  getDraftFile(draftId: string): { fileName: string; buffer: Buffer } | undefined {
    try {
      const files = fs.readdirSync(DRAFTS_DIR);
      const match = files.find((f) => f.startsWith(`${draftId}__`));
      if (!match) return undefined;
      return { fileName: match.slice(`${draftId}__`.length), buffer: fs.readFileSync(path.join(DRAFTS_DIR, match)) };
    } catch { return undefined; }
  }

  // ── Audit ─────────────────────────────────────────────

  addAuditLog(params: { pharmacyId: string; actorId: string; actorName: string; action: string; level: AuditLevel; details?: string }): void {
    const ph = this.db.pharmacies.find((p) => p.id === params.pharmacyId);
    const entry: AuditLogEntry = {
      id: `al-${nanoid(10)}`,
      pharmacyId: params.pharmacyId,
      pharmacyName: ph?.name ?? 'Superviseur',
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.action,
      level: params.level,
      details: params.details,
      timestamp: now(),
    };
    this.db.auditLogs.unshift(entry);
    if (this.db.auditLogs.length > 500) this.db.auditLogs = this.db.auditLogs.slice(0, 500);
    this.persist();
  }

  getAuditLogs(pharmacyId?: string, limit = 100): AuditLogEntry[] {
    const logs = pharmacyId ? this.db.auditLogs.filter((l) => l.pharmacyId === pharmacyId) : this.db.auditLogs;
    return logs.slice(0, limit);
  }

  // ── Mémoire ───────────────────────────────────────────

  getMemory(): AgentLearnedMemory { return this.db.learnedMemory; }

  addProductAlias(rawLabel: string, canonicalName: string, pharmacyId?: string): ProductAlias {
    const existing = this.db.learnedMemory.productAliases.find(
      (a) => a.rawLabel.toLowerCase() === rawLabel.toLowerCase()
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

  getAliasesForPharmacy(pharmacyId: string): ProductAlias[] {
    return this.db.learnedMemory.productAliases.filter((a) => !a.pharmacyId || a.pharmacyId === pharmacyId);
  }

  // Mémorise « ce libellé de ce grossiste = ce produit ERP » et enrichit le catalogue
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
    if (params.cip && !product.cip) product.cip = params.cip;
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
    return product;   // l'appelant fait flush() une fois pour tout le lot
  }

  flush(): void { this.persist(); }

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
      const label = r.erpLabel?.trim();
      if (!label) continue;
      const cip = r.cip?.replace(/\D/g, '') || undefined;
      const existing = (cip && byCip.get(cip)) || byLabel.get(normalizeLabel(label));
      if (existing) {
        existing.erpLabel = label;
        if (cip) existing.cip = cip;
        if (r.purchasePriceFCFA) existing.purchasePriceFCFA = r.purchasePriceFCFA;
        if (r.salePriceFCFA) existing.salePriceFCFA = r.salePriceFCFA;
        if (r.stockQty !== undefined) existing.stockQty = r.stockQty;
        existing.updatedAt = now();
        updated++;
      } else {
        const p: CatalogProduct = {
          id: `pr-${nanoid(10)}`, pharmacyId, erpLabel: label, cip,
          purchasePriceFCFA: r.purchasePriceFCFA, salePriceFCFA: r.salePriceFCFA, stockQty: r.stockQty,
          suppliers: [], source, updatedAt: now(),
        };
        this.db.catalog.push(p);
        byLabel.set(normalizeLabel(label), p);
        if (cip) byCip.set(cip, p);
        added++;
      }
    }
    this.persist();
    return { added, updated };
  }

  clearCatalog(pharmacyId: string): void {
    this.db.catalog = this.db.catalog.filter((p) => p.pharmacyId !== pharmacyId);
    this.persist();
  }

  importMemoryFromJson(json: { productAliases?: ProductAlias[]; columnRules?: ColumnRule[] }): void {
    if (json.productAliases) {
      for (const a of json.productAliases) {
        if (a.rawLabel && a.canonicalName) this.addProductAlias(a.rawLabel, a.canonicalName, a.pharmacyId);
      }
    }
    if (json.columnRules) {
      for (const r of json.columnRules) {
        if (r.sourceField && r.targetColumn) this.addColumnRule(r.sourceField, r.targetColumn, r.pharmacyId);
      }
    }
  }

  // ── Dashboard ────────────────────────────────────────

  getDashboard() {
    const pharmacies = this.db.pharmacies;
    const thisMonth = new Date().toISOString().slice(0, 7);

    const stats = pharmacies.map((ph) => {
      const phDrafts = this.db.drafts.filter((d) => d.pharmacyId === ph.id);
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
      pendingDrafts: this.db.drafts.filter((d) => d.status === 'pending').slice(0, 20),
      recentAudit: this.db.auditLogs.slice(0, 20),
      totalDraftsToday: this.db.drafts.filter((d) => d.createdAt.startsWith(todayStr)).length,
      totalApprovedMonth: this.db.drafts.filter((d) => d.status === 'approved' && d.updatedAt.startsWith(thisMonth)).length,
      learnedMemory: this.db.learnedMemory,
    };
  }

  // ── Agent clé ────────────────────────────────────────

  getPharmacyByAgentKey(key: string): Pharmacy | undefined {
    return this.db.pharmacies.find((p) => p.agentKey === key);
  }

  getOwner(): OwnerAccount { return this.db.owner; }
}

export const store = new PharmAgentStore();
export { hashPassword, checkPassword, nanoid };
