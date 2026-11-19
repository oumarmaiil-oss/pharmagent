import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  AgentLearnedMemory,
  AuditLogEntry,
  ColumnMemoryRule,
  DashboardSnapshot,
  DocumentCategory,
  DraftRecord,
  ExtractedLineItem,
  OfficineRecord,
  OwnerAccount,
  PharmacyUserAccount,
  PharmacyUserRole,
  ProductMemoryRule,
  QueuedDesktopTask,
  QuotaRequestKind,
  QuotaTopUpRequest,
  SoftwareGroundProfile,
  StockItemRecord,
  SubscriptionPlanId,
  SupervisorRole,
  TargetSoftwareType,
} from '../types/pharmagent.ts';
import { SUBSCRIPTION_PLANS, SUBSCRIPTION_PLAN_LIST } from './plans.ts';

export const MAX_SUPERVISOR_ACCOUNTS = 3;

export class QuotaError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 402) {
    super(message);
    this.statusCode = statusCode;
  }
}

interface StoredPharmacyUser extends PharmacyUserAccount {
  passwordHash: string;
  passwordSalt: string;
}

interface StoredOwnerAccount extends OwnerAccount {
  passwordHash: string;
  passwordSalt: string;
}

interface PersistedDatabase {
  pharmacies: OfficineRecord[];
  ownerAccount?: StoredOwnerAccount;
  supervisorAccounts?: StoredOwnerAccount[];
  pharmacyUsers: StoredPharmacyUser[];
  authSecret: string;
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  auditLogs: AuditLogEntry[];
  learnedMemory: AgentLearnedMemory;
  quotaRequests?: QuotaTopUpRequest[];
}

function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password: string, expectedHash: string, salt: string): boolean {
  const computed = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function toPublicUser(user: StoredPharmacyUser): PharmacyUserAccount {
  const { passwordHash: _h, passwordSalt: _s, ...publicUser } = user;
  return publicUser;
}

function toPublicOwner(owner: StoredOwnerAccount): OwnerAccount {
  const { passwordHash: _h, passwordSalt: _s, ...publicOwner } = owner;
  return {
    ...publicOwner,
    role: publicOwner.role || 'owner',
    active: publicOwner.active !== false,
  };
}

function generateProvisionalSecret(): string {
  // 16 caractères lisibles (sans 0/O/1/l/I), générés avec un CSPRNG.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '!';
}

// Mots de passe provisoires : définis par variable d'environnement, sinon générés
// aléatoirement à chaque démarrage et affichés UNE fois dans les logs serveur.
// Aucun mot de passe par défaut n'est codé en dur dans le dépôt.
const ownerProvisionalPassword =
  process.env.PHARMAGENT_OWNER_PASSWORD || generateProvisionalSecret();
const pharmacyProvisionalPassword =
  process.env.PHARMAGENT_PHARMACY_DEFAULT_PASSWORD || generateProvisionalSecret();

export const PROVISIONAL_OWNER_CREDENTIALS = {
  loginId: 'dr.oumar',
  legacyLoginId: 'dr.ousmane',
  password: ownerProvisionalPassword,
};

export const PROVISIONAL_PHARMACY_CREDENTIALS = {
  titulaire: { loginId: 'titulaire', password: pharmacyProvisionalPassword },
  adjoint: { loginId: 'adjoint', password: pharmacyProvisionalPassword },
  assistant: { loginId: 'assistant', password: pharmacyProvisionalPassword },
};

if (!process.env.PHARMAGENT_OWNER_PASSWORD || !process.env.PHARMAGENT_PHARMACY_DEFAULT_PASSWORD) {
  console.warn(
    '[PharmAgent] Mots de passe provisoires générés (utilisés seulement pour les NOUVEAUX comptes) :\n' +
      `  Propriétaire  ${PROVISIONAL_OWNER_CREDENTIALS.loginId} / ${ownerProvisionalPassword}\n` +
      `  Officines     titulaire|adjoint|assistant / ${pharmacyProvisionalPassword}\n` +
      '  Définissez PHARMAGENT_OWNER_PASSWORD et PHARMAGENT_PHARMACY_DEFAULT_PASSWORD pour les fixer.'
  );
}

function resolveWritableDataDir(): string {
  const preferred = path.resolve(process.cwd(), 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'pharmagent-data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const DATA_DIR = resolveWritableDataDir();
const DB_PATH = path.join(DATA_DIR, 'pharmagent-db.json');
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');

const initialMemory: AgentLearnedMemory = {
  productAliases: [
    {
      id: 'MEM-P-1',
      rawLabel: 'AMOX 500 / AMOXICILINE 500 GEL',
      canonicalName: 'Amoxicilline 500mg Gélule B/24',
      category: 'Antibiotique',
      learnedFrom: 'Référentiel Officine Initial',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-P-2',
      rawLabel: 'DOLIPRANE 1000 / PARACETAMOL 1G',
      canonicalName: 'Paracétamol Doliprane 1000mg B/8',
      category: 'Antalgique',
      learnedFrom: 'Référentiel Officine Initial',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-P-3',
      rawLabel: 'AUGMENTIN 1G SACH',
      canonicalName: 'Augmentin 1g Sachet B/12',
      category: 'Antibiotique',
      learnedFrom: 'Référentiel Officine Initial',
      createdAt: '2026-11-18T07:00:00Z',
    },
  ],
  columnRules: [
    {
      id: 'MEM-C-1',
      excelHeaderPattern: 'Désignation Médicament / Produit / Article / Médicament (DCI)',
      targetSourceField: 'item.designation',
      learnedFrom: 'Référentiel Excel Officine',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-C-2',
      excelHeaderPattern: 'Quantité Reçue / Qté Livrée / Unités / Qte',
      targetSourceField: 'item.quantity',
      learnedFrom: 'Référentiel Excel Officine',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-C-3',
      excelHeaderPattern: 'N° Lot Fabricant / Numéro de Lot / Batch',
      targetSourceField: 'item.lotNumber',
      learnedFrom: 'Référentiel Excel Officine',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-C-4',
      excelHeaderPattern: 'Date Péremption / DLC / Expiration',
      targetSourceField: 'item.expiryDate',
      learnedFrom: 'Référentiel Excel Officine',
      createdAt: '2026-11-18T07:00:00Z',
    },
    {
      id: 'MEM-C-5',
      excelHeaderPattern: 'Prix Achat Unitaire (FCFA) / P.U. / Tarif Unitaire FCFA',
      targetSourceField: 'item.unitPriceFCFA',
      learnedFrom: 'Référentiel Excel Officine',
      createdAt: '2026-11-18T07:00:00Z',
    },
  ],
  softwareProfiles: [],
};

const initialDatabase: PersistedDatabase = {
  authSecret: '',
  pharmacyUsers: [],
  pharmacies: [
    {
      id: 'officine-alpha',
      name: 'Pharmacie Alpha (Démo)',
      city: 'Secteur Nord (Démo)',
      region: 'Zone Pilote Nord',
      pharmacist: 'Dr. Titulaire Alpha',
      targetSoftware: 'ERP Officine Intégré',
      agentKey: 'PA-ALP-1001',
      status: 'active',
      subscriptionPlan: 'pro',
      monthlyQuotaLimit: 900000,
      monthlyQuotaUsed: 184200,
      subscriptionStatus: 'active',
      quotaCycleStart: '2026-11-01T00:00:00Z',
      documentsProcessed: 142,
      bonsLivraisonCount: 84,
      facturesCount: 36,
      mutuellesCount: 22,
      draftsCreated: 142,
      guardrailBlocks: 8,
      tokensUsed: 184200,
      estimatedCostFCFA: 15470,
      lastActiveAt: '2026-11-18T07:42:00Z',
      dailyVolume: [16, 19, 21, 18, 22, 20, 26],
      dailyInvoices: [4, 5, 6, 4, 6, 5, 6],
      dailyErrors: [1, 1, 2, 1, 1, 1, 1],
    },
    {
      id: 'officine-beta',
      name: 'Pharmacie Bêta (Démo)',
      city: 'Secteur Sud (Démo)',
      region: 'Zone Pilote Sud',
      pharmacist: 'Dr. Titulaire Bêta',
      targetSoftware: 'Tableur Excel Stock',
      agentKey: 'PA-BET-2002',
      status: 'active',
      subscriptionPlan: 'starter',
      monthlyQuotaLimit: 450000,
      monthlyQuotaUsed: 121500,
      subscriptionStatus: 'active',
      quotaCycleStart: '2026-11-01T00:00:00Z',
      documentsProcessed: 96,
      bonsLivraisonCount: 52,
      facturesCount: 26,
      mutuellesCount: 18,
      draftsCreated: 96,
      guardrailBlocks: 5,
      tokensUsed: 121500,
      estimatedCostFCFA: 10200,
      lastActiveAt: '2026-11-18T07:31:00Z',
      dailyVolume: [11, 13, 14, 12, 15, 14, 17],
      dailyInvoices: [3, 3, 4, 3, 4, 4, 5],
      dailyErrors: [1, 0, 1, 1, 1, 0, 1],
    },
  ],
  stock: [
    {
      id: 'STK-101',
      pharmacyId: 'officine-alpha',
      designation: 'Amoxicilline 500mg Gélule B/24',
      quantity: 85,
      lotNumber: 'AMX2511',
      expiryDate: '04/2028',
      unitPriceFCFA: 1850,
      lastUpdatedAt: '2026-11-17T14:20:00Z',
      sourceDocument: 'BL-DEMO-101',
    },
    {
      id: 'STK-102',
      pharmacyId: 'officine-alpha',
      designation: 'Paracétamol Doliprane 1000mg B/8',
      quantity: 210,
      lotNumber: 'DOL9801',
      expiryDate: '10/2027',
      unitPriceFCFA: 1200,
      lastUpdatedAt: '2026-11-17T14:20:00Z',
      sourceDocument: 'BL-DEMO-101',
    },
    {
      id: 'STK-103',
      pharmacyId: 'officine-beta',
      designation: 'Augmentin 1g Sachet B/12',
      quantity: 42,
      lotNumber: 'AUG1120',
      expiryDate: '08/2027',
      unitPriceFCFA: 4500,
      lastUpdatedAt: '2026-11-16T10:15:00Z',
      sourceDocument: 'BL-DEMO-201',
    },
  ],
  drafts: [
    {
      id: 'DRF-8821',
      pharmacyId: 'officine-alpha',
      pharmacyName: 'Pharmacie Alpha (Démo)',
      createdAt: '2026-11-18T07:42:00Z',
      taskPrompt: 'Extraire les articles du bon de livraison et préparer le brouillon d’entrée en stock.',
      targetMode: 'erp_live',
      status: 'BROUILLON',
      guardrailNote: 'Brouillon créé par l’agent. En attente de validation du Pharmacien titulaire.',
      extracted: {
        documentType: 'bon_livraison',
        documentNumber: 'BL-DEMO-102',
        supplierOrOrg: 'RÉPARTITEUR CENTRAL (DÉMO)',
        recipientPharmacy: 'Pharmacie Alpha (Démo)',
        documentDate: '18/11/2026',
        currency: 'FCFA',
        totalAmountFCFA: 218000,
        lineItems: [
          {
            designation: 'Amoxicilline 500mg Gélule B/24',
            quantity: 40,
            lotNumber: 'AMX2604',
            expiryDate: '06/2028',
            unitPriceFCFA: 1850,
            confidence: 0.98,
          },
          {
            designation: 'Paracétamol Doliprane 1000mg B/8',
            quantity: 120,
            lotNumber: 'DOL9912',
            expiryDate: '11/2027',
            unitPriceFCFA: 1200,
            confidence: 0.99,
          },
        ],
      },
    },
  ],
  taskQueue: [],
  auditLogs: [
    {
      id: 'AUD-9482',
      timestamp: '2026-11-18T07:42:00Z',
      pharmacyId: 'officine-alpha',
      pharmacyName: 'Pharmacie Alpha (Démo)',
      city: 'Secteur Nord (Démo)',
      documentNumber: 'BL-DEMO-102',
      documentType: 'bon_livraison',
      targetSoftware: 'ERP Officine Intégré',
      tokensUsed: 2480,
      finalState: 'BROUILLON_CREE',
      guardrailMessage: 'Brouillon créé dans l’ERP Officine Intégré. Arrêt strict avant entrée en stock.',
    },
    {
      id: 'AUD-9480',
      timestamp: '2026-11-18T06:12:00Z',
      pharmacyId: 'officine-beta',
      pharmacyName: 'Pharmacie Bêta (Démo)',
      city: 'Secteur Sud (Démo)',
      documentNumber: 'BL-DEMO-202',
      documentType: 'bon_livraison',
      targetSoftware: 'Tableur Excel Stock',
      tokensUsed: 2610,
      finalState: 'VALIDATION_BLOQUEE',
      guardrailMessage: 'Garde-Fou déclenché : clic bloqué sur le bouton "Valider Définitivement".',
    },
  ],
  learnedMemory: initialMemory,
  quotaRequests: [],
};

class PharmAgentStore {
  private db: PersistedDatabase;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedDatabase;
        this.db = {
          ...structuredClone(initialDatabase),
          ...parsed,
          learnedMemory: {
            ...structuredClone(initialMemory),
            ...(parsed.learnedMemory || {}),
            softwareProfiles: parsed.learnedMemory?.softwareProfiles || [],
          },
          pharmacyUsers: parsed.pharmacyUsers || [],
          quotaRequests: parsed.quotaRequests || [],
          authSecret: parsed.authSecret || '',
        };
      } catch {
        this.db = structuredClone(initialDatabase);
      }
    } else {
      this.db = structuredClone(initialDatabase);
    }

    let mutated = false;
    if (!this.db.authSecret) {
      this.db.authSecret = crypto.randomBytes(32).toString('hex');
      mutated = true;
    }
    if (!this.db.quotaRequests) {
      this.db.quotaRequests = [];
      mutated = true;
    }
    if (this.ensureOwnerAccount()) {
      mutated = true;
    }
    for (const pharmacy of this.db.pharmacies) {
      if (this.ensureDefaultUsersForPharmacy(pharmacy)) {
        mutated = true;
      }
      if (!pharmacy.dailyInvoices || pharmacy.dailyInvoices.length !== 7) {
        const seed = initialDatabase.pharmacies.find((s) => s.id === pharmacy.id);
        pharmacy.dailyInvoices = seed?.dailyInvoices
          ? [...seed.dailyInvoices]
          : pharmacy.dailyVolume.map((v) => Math.max(0, Math.round(v * 0.25)));
        mutated = true;
      }
      if (!pharmacy.dailyErrors || pharmacy.dailyErrors.length !== 7) {
        const seed = initialDatabase.pharmacies.find((s) => s.id === pharmacy.id);
        pharmacy.dailyErrors = seed?.dailyErrors
          ? [...seed.dailyErrors]
          : [0, 0, 0, 0, 0, 0, pharmacy.guardrailBlocks || 0];
        mutated = true;
      }
      if (!pharmacy.subscriptionPlan) {
        pharmacy.subscriptionPlan = pharmacy.id === 'officine-alpha' ? 'pro' : 'starter';
        mutated = true;
      }
      if (typeof pharmacy.monthlyQuotaLimit !== 'number' || pharmacy.monthlyQuotaLimit <= 10000) {
        pharmacy.monthlyQuotaLimit = SUBSCRIPTION_PLANS[pharmacy.subscriptionPlan].monthlyQuotaLimit;
        pharmacy.monthlyQuotaUsed = Math.min(
          pharmacy.monthlyQuotaLimit,
          pharmacy.tokensUsed || (pharmacy.documentsProcessed || 0) * 1260
        );
        mutated = true;
      }
      if (typeof pharmacy.monthlyQuotaUsed !== 'number') {
        pharmacy.monthlyQuotaUsed = pharmacy.tokensUsed || 0;
        mutated = true;
      }
      if (!pharmacy.subscriptionStatus) {
        pharmacy.subscriptionStatus = 'active';
        mutated = true;
      }
      if (!pharmacy.quotaCycleStart) {
        pharmacy.quotaCycleStart = new Date().toISOString();
        mutated = true;
      }
    }
    if (mutated || !fs.existsSync(DB_PATH)) {
      this.persist();
    }
  }

  private ensureOwnerAccount(): boolean {
    let updated = false;
    if (!this.db.supervisorAccounts) {
      this.db.supervisorAccounts = [];
      if (this.db.ownerAccount) {
        this.db.supervisorAccounts.push({
          ...this.db.ownerAccount,
          role: this.db.ownerAccount.role || 'owner',
          active: this.db.ownerAccount.active !== false,
          createdAt: this.db.ownerAccount.createdAt || new Date().toISOString(),
        });
      }
      updated = true;
    }

    for (const acc of this.db.supervisorAccounts) {
      if (!acc.role) {
        acc.role = acc.id === 'OWNER-01' ? 'owner' : 'co_supervisor';
        updated = true;
      }
      if (acc.active === undefined) {
        acc.active = true;
        updated = true;
      }
    }

    let primaryOwner = this.db.supervisorAccounts.find((s) => s.role === 'owner' || s.id === 'OWNER-01');
    if (!primaryOwner) {
      const cred = hashPassword(PROVISIONAL_OWNER_CREDENTIALS.password);
      primaryOwner = {
        id: 'OWNER-01',
        loginId: PROVISIONAL_OWNER_CREDENTIALS.loginId,
        fullName: 'Dr. Oumar',
        title: 'Pharmacien Propriétaire · DU Commercial (Sénégal)',
        role: 'owner',
        active: true,
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        passwordHash: cred.hash,
        passwordSalt: cred.salt,
      };
      this.db.supervisorAccounts.unshift(primaryOwner);
      updated = true;
    } else if (
      primaryOwner.mustChangePassword &&
      (primaryOwner.fullName === 'Dr. Ousmane' || primaryOwner.loginId === 'dr.ousmane')
    ) {
      primaryOwner.fullName = 'Dr. Oumar';
      primaryOwner.loginId = PROVISIONAL_OWNER_CREDENTIALS.loginId;
      primaryOwner.title = 'Pharmacien Propriétaire · DU Commercial (Sénégal)';
      updated = true;
    }

    this.db.ownerAccount = primaryOwner;
    return updated;
  }

  private ensureDefaultUsersForPharmacy(pharmacy: OfficineRecord): boolean {
    let changed = false;
    const now = new Date().toISOString();

    const defaults: Array<{
      id: string;
      loginId: string;
      fullName: string;
      role: PharmacyUserRole;
      password: string;
    }> = [
      {
        id: `USR-${pharmacy.id}-TIT`,
        loginId: PROVISIONAL_PHARMACY_CREDENTIALS.titulaire.loginId,
        fullName: pharmacy.pharmacist || 'Pharmacien Titulaire',
        role: 'titulaire',
        password: PROVISIONAL_PHARMACY_CREDENTIALS.titulaire.password,
      },
      {
        id: `USR-${pharmacy.id}-ADJ`,
        loginId: PROVISIONAL_PHARMACY_CREDENTIALS.adjoint.loginId,
        fullName: 'Pharmacien Adjoint / Gérant',
        role: 'adjoint',
        password: PROVISIONAL_PHARMACY_CREDENTIALS.adjoint.password,
      },
      {
        id: `USR-${pharmacy.id}-AST`,
        loginId: PROVISIONAL_PHARMACY_CREDENTIALS.assistant.loginId,
        fullName: 'Assistant / Préparateur Comptoir',
        role: 'assistant',
        password: PROVISIONAL_PHARMACY_CREDENTIALS.assistant.password,
      },
    ];

    for (const def of defaults) {
      const existing = this.db.pharmacyUsers.find(
        (u) => u.pharmacyId === pharmacy.id && u.loginId.toLowerCase() === def.loginId
      );
      if (!existing) {
        const cred = hashPassword(def.password);
        this.db.pharmacyUsers.push({
          id: def.id,
          pharmacyId: pharmacy.id,
          loginId: def.loginId,
          fullName: def.fullName,
          role: def.role,
          active: true,
          mustChangePassword: true,
          createdAt: now,
          passwordHash: cred.hash,
          passwordSalt: cred.salt,
        });
        changed = true;
      } else if (existing.mustChangePassword === undefined && !existing.passwordUpdatedAt) {
        // Migrate legacy untouched demo accounts to current provisional credentials
        const cred = hashPassword(def.password);
        existing.passwordHash = cred.hash;
        existing.passwordSalt = cred.salt;
        existing.mustChangePassword = true;
        changed = true;
      }
    }

    return changed;
  }

  private getSigningSecret(): string {
    return process.env.PHARMAGENT_AUTH_SECRET || this.db.authSecret;
  }

  createOwnerSessionToken(owner: OwnerAccount): string {
    const payload = {
      kind: 'owner',
      sub: owner.id,
      loginId: owner.loginId,
      role: owner.role || 'owner',
      exp: Date.now() + 1000 * 60 * 60 * 12,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  verifyOwnerSessionToken(token: string): OwnerAccount | null {
    try {
      this.ensureOwnerAccount();
      const [encoded, sig] = token.split('.');
      if (!encoded || !sig) return null;
      const expectedSig = crypto
        .createHmac('sha256', this.getSigningSecret())
        .update(encoded)
        .digest('base64url');
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
      }
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as {
        kind?: string;
        sub: string;
        exp: number;
      };
      if (parsed.kind !== 'owner' || !parsed.exp || Date.now() > parsed.exp) return null;
      const matched = (this.db.supervisorAccounts || []).find(
        (s) => s.id === parsed.sub && s.active !== false
      );
      return matched ? toPublicOwner(matched) : null;
    } catch {
      return null;
    }
  }

  authenticateOwner(loginId: string, password: string): OwnerAccount | null {
    this.ensureOwnerAccount();
    const cleanInput = loginId.trim().toLowerCase();
    const supervisor = (this.db.supervisorAccounts || []).find((acc) => {
      if (acc.active === false) return false;
      const matchesPrimary = acc.loginId.toLowerCase() === cleanInput;
      const matchesLegacy =
        acc.id === 'OWNER-01' &&
        acc.mustChangePassword &&
        cleanInput === PROVISIONAL_OWNER_CREDENTIALS.legacyLoginId;
      return matchesPrimary || matchesLegacy;
    });
    if (!supervisor) return null;
    if (!verifyPassword(password, supervisor.passwordHash, supervisor.passwordSalt)) return null;
    supervisor.lastLoginAt = new Date().toISOString();
    this.persist();
    return toPublicOwner(supervisor);
  }

  updateOwnerCredentials(input: {
    supervisorId?: string;
    currentPassword: string;
    newLoginId?: string;
    newFullName?: string;
    newPassword?: string;
  }): OwnerAccount {
    this.ensureOwnerAccount();
    const targetId = input.supervisorId || 'OWNER-01';
    const supervisor = (this.db.supervisorAccounts || []).find((s) => s.id === targetId);
    if (!supervisor || supervisor.active === false) {
      throw new Error('Compte superviseur introuvable ou désactivé.');
    }
    if (!verifyPassword(input.currentPassword, supervisor.passwordHash, supervisor.passwordSalt)) {
      throw new Error('Mot de passe actuel incorrect.');
    }

    if (input.newLoginId !== undefined && input.newLoginId.trim()) {
      const cleanLogin = input.newLoginId.trim().toLowerCase().replace(/\s+/g, '.');
      if (cleanLogin.length < 3) {
        throw new Error("L'identifiant doit contenir au moins 3 caractères.");
      }
      const duplicate = (this.db.supervisorAccounts || []).some(
        (s) => s.id !== supervisor.id && s.loginId.toLowerCase() === cleanLogin
      );
      if (duplicate) {
        throw new Error(`L'identifiant de supervision « ${cleanLogin} » est déjà utilisé.`);
      }
      supervisor.loginId = cleanLogin;
    }

    if (input.newFullName !== undefined && input.newFullName.trim()) {
      supervisor.fullName = input.newFullName.trim();
    }

    if (input.newPassword !== undefined && input.newPassword.trim()) {
      const trimmed = input.newPassword.trim();
      if (trimmed.length < 6) {
        throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      }
      const { hash, salt } = hashPassword(trimmed);
      supervisor.passwordHash = hash;
      supervisor.passwordSalt = salt;
      supervisor.mustChangePassword = false;
      supervisor.passwordUpdatedAt = new Date().toISOString();
    } else if (supervisor.mustChangePassword) {
      throw new Error('Veuillez saisir un nouveau mot de passe (min. 6 caractères).');
    }

    if (supervisor.id === 'OWNER-01') {
      this.db.ownerAccount = supervisor;
    }
    this.persist();
    return toPublicOwner(supervisor);
  }

  listSupervisorAccounts(): OwnerAccount[] {
    this.ensureOwnerAccount();
    return (this.db.supervisorAccounts || []).map(toPublicOwner);
  }

  createSupervisorAccount(input: {
    loginId: string;
    fullName: string;
    title?: string;
    password: string;
  }): OwnerAccount {
    this.ensureOwnerAccount();
    const accounts = this.db.supervisorAccounts || [];
    if (accounts.length >= MAX_SUPERVISOR_ACCOUNTS) {
      throw new Error(
        `Maximum atteint (${MAX_SUPERVISOR_ACCOUNTS} comptes Supervision autorisés : Propriétaire + 2 Co-Superviseurs).`
      );
    }

    const cleanLogin = input.loginId.trim().toLowerCase().replace(/\s+/g, '.');
    if (cleanLogin.length < 3) {
      throw new Error("L'identifiant doit contenir au moins 3 caractères.");
    }
    if (!input.fullName.trim()) {
      throw new Error('Le nom complet du co-superviseur est obligatoire.');
    }
    if (!input.password || input.password.trim().length < 6) {
      throw new Error('Le mot de passe provisoire doit contenir au moins 6 caractères.');
    }
    if (accounts.some((s) => s.loginId.toLowerCase() === cleanLogin)) {
      throw new Error(`L'identifiant « ${cleanLogin} » existe déjà dans l'équipe Supervision.`);
    }

    const { hash, salt } = hashPassword(input.password.trim());
    const created: StoredOwnerAccount = {
      id: `SUP-${Date.now().toString().slice(-5)}-${Math.floor(10 + Math.random() * 89)}`,
      loginId: cleanLogin,
      fullName: input.fullName.trim(),
      title: input.title?.trim() || 'Co-Superviseur Réseau · PharmAgent',
      role: 'co_supervisor',
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      passwordHash: hash,
      passwordSalt: salt,
    };
    accounts.push(created);
    this.db.supervisorAccounts = accounts;
    this.persist();
    return toPublicOwner(created);
  }

  updateSupervisorAccount(
    targetId: string,
    patch: {
      fullName?: string;
      title?: string;
      active?: boolean;
      password?: string;
    }
  ): OwnerAccount {
    this.ensureOwnerAccount();
    const accounts = this.db.supervisorAccounts || [];
    const target = accounts.find((s) => s.id === targetId);
    if (!target) throw new Error('Compte superviseur introuvable.');

    if (target.role === 'owner' && patch.active === false) {
      throw new Error('Impossible de suspendre le compte Propriétaire principal.');
    }

    if (patch.fullName !== undefined && patch.fullName.trim()) {
      target.fullName = patch.fullName.trim();
    }
    if (patch.title !== undefined && patch.title.trim()) {
      target.title = patch.title.trim();
    }
    if (typeof patch.active === 'boolean') {
      target.active = patch.active;
    }
    if (patch.password && patch.password.trim().length > 0) {
      if (patch.password.trim().length < 6) {
        throw new Error('Le mot de passe provisoire doit contenir au moins 6 caractères.');
      }
      const { hash, salt } = hashPassword(patch.password.trim());
      target.passwordHash = hash;
      target.passwordSalt = salt;
      target.mustChangePassword = true;
      target.passwordUpdatedAt = new Date().toISOString();
    }

    if (target.id === 'OWNER-01') {
      this.db.ownerAccount = target;
    }
    this.persist();
    return toPublicOwner(target);
  }

  deleteSupervisorAccount(targetId: string): void {
    this.ensureOwnerAccount();
    const accounts = this.db.supervisorAccounts || [];
    const target = accounts.find((s) => s.id === targetId);
    if (!target) throw new Error('Compte superviseur introuvable.');
    if (target.role === 'owner' || target.id === 'OWNER-01') {
      throw new Error('Impossible de supprimer le compte Propriétaire principal.');
    }
    this.db.supervisorAccounts = accounts.filter((s) => s.id !== targetId);
    this.persist();
  }

  createSessionToken(user: PharmacyUserAccount): string {
    const payload = {
      kind: 'pharmacy_user',
      sub: user.id,
      pharmacyId: user.pharmacyId,
      loginId: user.loginId,
      role: user.role,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  verifySessionToken(token: string): PharmacyUserAccount | null {
    try {
      const [encoded, sig] = token.split('.');
      if (!encoded || !sig) return null;
      const expectedSig = crypto
        .createHmac('sha256', this.getSigningSecret())
        .update(encoded)
        .digest('base64url');
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
      }
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as {
        kind?: string;
        sub: string;
        pharmacyId: string;
        exp: number;
      };
      if (parsed.kind === 'owner') return null;
      if (!parsed.exp || Date.now() > parsed.exp) return null;
      const user = this.db.pharmacyUsers.find(
        (u) => u.id === parsed.sub && u.pharmacyId === parsed.pharmacyId && u.active
      );
      return user ? toPublicUser(user) : null;
    } catch {
      return null;
    }
  }

  authenticatePharmacyUser(
    pharmacyId: string,
    loginId: string,
    password: string
  ): PharmacyUserAccount | null {
    const cleanLogin = loginId.trim().toLowerCase();
    const user = this.db.pharmacyUsers.find(
      (u) => u.pharmacyId === pharmacyId && u.loginId.toLowerCase() === cleanLogin
    );
    if (!user || !user.active) return null;
    if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) return null;
    user.lastLoginAt = new Date().toISOString();
    this.persist();
    return toPublicUser(user);
  }

  changeOwnPharmacyPassword(
    pharmacyId: string,
    userId: string,
    currentPassword: string,
    newPassword: string
  ): PharmacyUserAccount {
    const user = this.db.pharmacyUsers.find(
      (u) => u.pharmacyId === pharmacyId && u.id === userId
    );
    if (!user || !user.active) throw new Error('Compte utilisateur introuvable ou suspendu.');
    if (!verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
      throw new Error('Mot de passe actuel incorrect.');
    }
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.');
    }
    const { hash, salt } = hashPassword(trimmed);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.mustChangePassword = false;
    user.passwordUpdatedAt = new Date().toISOString();
    this.persist();
    return toPublicUser(user);
  }

  listPharmacyUsers(pharmacyId: string): PharmacyUserAccount[] {
    return this.db.pharmacyUsers
      .filter((u) => u.pharmacyId === pharmacyId)
      .map(toPublicUser);
  }

  createPharmacyUser(
    pharmacyId: string,
    input: {
      loginId: string;
      fullName: string;
      role: PharmacyUserRole;
      password: string;
    }
  ): PharmacyUserAccount {
    const pharmacy = this.getPharmacy(pharmacyId);
    if (!pharmacy) throw new Error('Officine introuvable.');

    const planSpec = SUBSCRIPTION_PLANS[pharmacy.subscriptionPlan || 'starter'];
    const currentUsers = this.db.pharmacyUsers.filter((u) => u.pharmacyId === pharmacyId);
    if (currentUsers.length >= planSpec.maxUsers) {
      throw new Error(
        `Limite du forfait ${planSpec.name} atteinte (${planSpec.maxUsers} compte(s) max). Passez au forfait supérieur depuis la Console Superviseur.`
      );
    }

    const cleanLogin = input.loginId.trim().toLowerCase().replace(/\s+/g, '.');
    if (cleanLogin.length < 3) {
      throw new Error("L'identifiant (ID) doit contenir au moins 3 caractères.");
    }
    if (!input.password || input.password.length < 4) {
      throw new Error('Le mot de passe doit contenir au moins 4 caractères.');
    }
    if (!input.fullName.trim()) {
      throw new Error('Le nom complet est requis.');
    }
    const exists = this.db.pharmacyUsers.some(
      (u) => u.pharmacyId === pharmacyId && u.loginId.toLowerCase() === cleanLogin
    );
    if (exists) {
      throw new Error(`L'identifiant « ${cleanLogin} » existe déjà dans cette officine.`);
    }

    const normalizedRole: PharmacyUserRole =
      input.role === 'titulaire' || input.role === 'adjoint' ? input.role : 'assistant';

    const { hash, salt } = hashPassword(input.password);
    const created: StoredPharmacyUser = {
      id: `USR-${Date.now().toString().slice(-6)}-${Math.floor(10 + Math.random() * 89)}`,
      pharmacyId,
      loginId: cleanLogin,
      fullName: input.fullName.trim(),
      role: normalizedRole,
      active: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      passwordHash: hash,
      passwordSalt: salt,
    };

    this.db.pharmacyUsers.unshift(created);
    this.persist();
    return toPublicUser(created);
  }

  updatePharmacyUser(
    pharmacyId: string,
    userId: string,
    patch: {
      fullName?: string;
      role?: PharmacyUserRole;
      active?: boolean;
      password?: string;
    }
  ): PharmacyUserAccount {
    const user = this.db.pharmacyUsers.find(
      (u) => u.pharmacyId === pharmacyId && u.id === userId
    );
    if (!user) throw new Error('Utilisateur introuvable.');

    const activeTitulaires = this.db.pharmacyUsers.filter(
      (u) => u.pharmacyId === pharmacyId && u.role === 'titulaire' && u.active
    );
    const isLastActiveTitulaire =
      user.role === 'titulaire' && user.active && activeTitulaires.length <= 1;

    if (
      isLastActiveTitulaire &&
      (patch.active === false || patch.role === 'assistant' || patch.role === 'adjoint')
    ) {
      throw new Error(
        'Impossible de désactiver ou rétrograder le dernier Pharmacien titulaire actif.'
      );
    }

    if (patch.fullName !== undefined && patch.fullName.trim()) {
      user.fullName = patch.fullName.trim();
    }
    if (patch.role === 'titulaire' || patch.role === 'adjoint' || patch.role === 'assistant') {
      user.role = patch.role;
    }
    if (typeof patch.active === 'boolean') {
      user.active = patch.active;
    }
    if (patch.password && patch.password.trim().length > 0) {
      if (patch.password.trim().length < 4) {
        throw new Error('Le nouveau mot de passe doit contenir au moins 4 caractères.');
      }
      const { hash, salt } = hashPassword(patch.password.trim());
      user.passwordHash = hash;
      user.passwordSalt = salt;
      user.mustChangePassword = true;
      user.passwordUpdatedAt = new Date().toISOString();
    }

    this.persist();
    return toPublicUser(user);
  }

  deletePharmacyUser(pharmacyId: string, userId: string): void {
    const user = this.db.pharmacyUsers.find(
      (u) => u.pharmacyId === pharmacyId && u.id === userId
    );
    if (!user) throw new Error('Utilisateur introuvable.');

    const activeTitulaires = this.db.pharmacyUsers.filter(
      (u) => u.pharmacyId === pharmacyId && u.role === 'titulaire' && u.active
    );
    if (user.role === 'titulaire' && user.active && activeTitulaires.length <= 1) {
      throw new Error('Impossible de supprimer le dernier Pharmacien titulaire actif.');
    }

    this.db.pharmacyUsers = this.db.pharmacyUsers.filter(
      (u) => !(u.pharmacyId === pharmacyId && u.id === userId)
    );
    this.persist();
  }

  private persistQueued = false;

  // Regroupe les écritures d'un même tour d'événement et écrit de façon atomique
  // (fichier temporaire + rename) pour éviter un JSON tronqué en cas de coupure.
  private persist(): void {
    if (this.persistQueued) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.db), 'utf-8');
      fs.renameSync(tmpPath, DB_PATH);
    });
  }

  getDashboard(): DashboardSnapshot {
    const quotaRequests = this.db.quotaRequests || [];
    const pendingQuotaRequestsCount = quotaRequests.filter((r) => r.status === 'EN_ATTENTE').length;
    const summary = this.db.pharmacies.reduce(
      (acc, ph) => {
        acc.totalPharmacies += 1;
        if (ph.status === 'active' && ph.subscriptionStatus !== 'suspended') acc.activeAgents += 1;
        acc.totalDocuments += ph.documentsProcessed;
        acc.totalDraftsCreated += ph.draftsCreated;
        acc.totalGuardrailBlocks += ph.guardrailBlocks;
        acc.totalTokensUsed += ph.tokensUsed;
        acc.totalCostFCFA += ph.estimatedCostFCFA;
        acc.totalQuotaAllocated = (acc.totalQuotaAllocated || 0) + (ph.monthlyQuotaLimit || 0);
        acc.totalQuotaUsed = (acc.totalQuotaUsed || 0) + (ph.monthlyQuotaUsed || 0);
        return acc;
      },
      {
        totalPharmacies: 0,
        activeAgents: 0,
        totalDocuments: 0,
        totalDraftsCreated: 0,
        pendingDraftsCount: this.db.drafts.filter((d) => d.status === 'BROUILLON').length,
        totalGuardrailBlocks: 0,
        totalTokensUsed: 0,
        totalCostFCFA: 0,
        totalQuotaAllocated: 0,
        totalQuotaUsed: 0,
        pendingQuotaRequestsCount,
      }
    );

    const dayLabels = ['J-6', 'J-5', 'J-4', 'J-3', 'J-2', 'Hier', "Aujourd'hui"];
    const dailyTrend = dayLabels.map((day, idx) => {
      const documents = this.db.pharmacies.reduce((sum, p) => sum + (p.dailyVolume[idx] || 0), 0);
      return {
        day,
        documents,
        tokensK: Math.round(documents * 1.24),
        drafts: documents,
      };
    });

    return {
      pharmacies: this.db.pharmacies,
      drafts: this.db.drafts,
      stock: this.db.stock,
      taskQueue: this.db.taskQueue,
      auditLogs: this.db.auditLogs,
      learnedMemory: this.db.learnedMemory,
      subscriptionPlans: SUBSCRIPTION_PLAN_LIST,
      quotaRequests,
      summary,
      dailyTrend,
    };
  }

  getPharmacyPortalSnapshot(pharmacyId: string) {
    const pharmacy = this.getPharmacy(pharmacyId);
    if (!pharmacy) return null;
    this.refreshCycleIfNeeded(pharmacy);
    return {
      pharmacy,
      drafts: this.db.drafts.filter((d) => d.pharmacyId === pharmacyId),
      stock: this.db.stock.filter((s) => s.pharmacyId === pharmacyId),
      taskQueue: this.db.taskQueue.filter((t) => t.pharmacyId === pharmacyId),
      auditLogs: this.db.auditLogs.filter((a) => a.pharmacyId === pharmacyId),
      quotaRequests: (this.db.quotaRequests || []).filter((r) => r.pharmacyId === pharmacyId),
    };
  }

  getMemory(): AgentLearnedMemory {
    return this.db.learnedMemory;
  }

  addProductAliasRule(rule: Omit<ProductMemoryRule, 'id' | 'createdAt'>): ProductMemoryRule {
    const existing = this.db.learnedMemory.productAliases.find(
      (r) => r.rawLabel.toLowerCase() === rule.rawLabel.toLowerCase()
    );
    if (existing) {
      existing.canonicalName = rule.canonicalName;
      existing.category = rule.category;
      existing.learnedFrom = rule.learnedFrom;
      this.persist();
      return existing;
    }
    const created: ProductMemoryRule = {
      ...rule,
      id: `MEM-P-${Date.now().toString().slice(-5)}`,
      createdAt: new Date().toISOString(),
    };
    this.db.learnedMemory.productAliases.unshift(created);
    this.persist();
    return created;
  }

  addColumnMappingRule(rule: Omit<ColumnMemoryRule, 'id' | 'createdAt'>): ColumnMemoryRule {
    const existing = this.db.learnedMemory.columnRules.find(
      (r) => r.excelHeaderPattern.toLowerCase() === rule.excelHeaderPattern.toLowerCase()
    );
    if (existing) {
      existing.targetSourceField = rule.targetSourceField;
      existing.learnedFrom = rule.learnedFrom;
      this.persist();
      return existing;
    }
    const created: ColumnMemoryRule = {
      ...rule,
      id: `MEM-C-${Date.now().toString().slice(-5)}`,
      createdAt: new Date().toISOString(),
    };
    this.db.learnedMemory.columnRules.unshift(created);
    this.persist();
    return created;
  }

  deleteMemoryRule(id: string): void {
    this.db.learnedMemory.productAliases = this.db.learnedMemory.productAliases.filter(
      (r) => r.id !== id
    );
    this.db.learnedMemory.columnRules = this.db.learnedMemory.columnRules.filter(
      (r) => r.id !== id
    );
    this.db.learnedMemory.softwareProfiles = (
      this.db.learnedMemory.softwareProfiles || []
    ).filter((r) => r.id !== id);
    this.persist();
  }

  saveSoftwareProfile(
    profile: Omit<SoftwareGroundProfile, 'id' | 'createdAt'>
  ): SoftwareGroundProfile {
    if (!this.db.learnedMemory.softwareProfiles) {
      this.db.learnedMemory.softwareProfiles = [];
    }
    const existing = this.db.learnedMemory.softwareProfiles.find(
      (p) =>
        p.pharmacyId === profile.pharmacyId &&
        p.softwareName.toLowerCase() === profile.softwareName.toLowerCase()
    );
    if (existing) {
      existing.elements = profile.elements;
      existing.injectionScript = profile.injectionScript;
      existing.detectedSoftwareType = profile.detectedSoftwareType;
      existing.createdAt = new Date().toISOString();
      this.persist();
      return existing;
    }
    const created: SoftwareGroundProfile = {
      ...profile,
      id: `PRF-${Date.now().toString().slice(-5)}`,
      createdAt: new Date().toISOString(),
    };
    this.db.learnedMemory.softwareProfiles.unshift(created);
    this.persist();
    return created;
  }

  learnFromExcelMappings(
    mappings: Array<{ excelColumn: string; sourceField: string }>,
    fileName: string
  ): number {
    let added = 0;
    for (const m of mappings) {
      if (!m.excelColumn || !m.sourceField || m.sourceField === 'none') continue;
      const alreadyKnown = this.db.learnedMemory.columnRules.some(
        (r) =>
          r.excelHeaderPattern
            .toLowerCase()
            .split('/')
            .map((s) => s.trim())
            .includes(m.excelColumn.toLowerCase())
      );
      if (!alreadyKnown) {
        this.addColumnMappingRule({
          excelHeaderPattern: m.excelColumn,
          targetSourceField: m.sourceField,
          learnedFrom: `Apprentissage auto (${fileName})`,
        });
        added += 1;
      }
    }
    return added;
  }

  getPharmacy(pharmacyId: string): OfficineRecord | undefined {
    return this.db.pharmacies.find((p) => p.id === pharmacyId);
  }

  getPharmacyByAgentKey(agentKey: string): OfficineRecord | undefined {
    return this.db.pharmacies.find((p) => p.agentKey === agentKey);
  }

  createPharmacy(input: {
    name: string;
    city: string;
    region: string;
    pharmacist: string;
    targetSoftware: TargetSoftwareType;
    subscriptionPlan?: SubscriptionPlanId;
  }): OfficineRecord {
    const slug = input.city
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 8);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const id = `${slug || 'off'}-${suffix}`;
    const agentKey = `PA-${(slug || 'OFF').slice(0, 3).toUpperCase()}-${suffix}`;
    const planId: SubscriptionPlanId =
      input.subscriptionPlan && SUBSCRIPTION_PLANS[input.subscriptionPlan]
        ? input.subscriptionPlan
        : 'pro';
    const planSpec = SUBSCRIPTION_PLANS[planId];

    const record: OfficineRecord = {
      id,
      name: input.name.trim(),
      city: input.city.trim(),
      region: input.region.trim() || input.city.trim(),
      pharmacist: input.pharmacist.trim(),
      targetSoftware: input.targetSoftware,
      agentKey,
      status: 'active',
      subscriptionPlan: planId,
      monthlyQuotaLimit: planSpec.monthlyQuotaLimit,
      monthlyQuotaUsed: 0,
      subscriptionStatus: 'active',
      quotaCycleStart: new Date().toISOString(),
      documentsProcessed: 0,
      bonsLivraisonCount: 0,
      facturesCount: 0,
      mutuellesCount: 0,
      draftsCreated: 0,
      guardrailBlocks: 0,
      tokensUsed: 0,
      estimatedCostFCFA: 0,
      lastActiveAt: new Date().toISOString(),
      dailyVolume: [0, 0, 0, 0, 0, 0, 0],
      dailyInvoices: [0, 0, 0, 0, 0, 0, 0],
      dailyErrors: [0, 0, 0, 0, 0, 0, 0],
    };

    this.db.pharmacies.unshift(record);
    this.ensureDefaultUsersForPharmacy(record);
    this.persist();
    return record;
  }

  private refreshCycleIfNeeded(ph: OfficineRecord): void {
    const now = new Date();
    const cycleDate = new Date(ph.quotaCycleStart || now.toISOString());
    if (
      !Number.isNaN(cycleDate.getTime()) &&
      (cycleDate.getUTCFullYear() !== now.getUTCFullYear() ||
        cycleDate.getUTCMonth() !== now.getUTCMonth())
    ) {
      ph.monthlyQuotaUsed = 0;
      ph.monthlyQuotaLimit = SUBSCRIPTION_PLANS[ph.subscriptionPlan || 'pro'].monthlyQuotaLimit;
      ph.quotaCycleStart = now.toISOString();
      this.persist();
    }
  }

  assertQuotaAvailable(pharmacyId: string): void {
    const ph = this.getPharmacy(pharmacyId);
    if (!ph) throw new QuotaError('Officine introuvable.', 404);
    this.refreshCycleIfNeeded(ph);

    if (ph.subscriptionStatus === 'suspended') {
      throw new QuotaError(
        `L'accès de ${ph.name} est actuellement suspendu par le superviseur. Contactez Dr. Oumar (+221 77 414 47 99).`,
        403
      );
    }
    if (ph.monthlyQuotaUsed >= ph.monthlyQuotaLimit) {
      throw new QuotaError(
        `Capacité mensuelle atteinte à 100 % pour ${ph.name}. Cliquez sur « Demander une recharge » dans votre portail ou contactez Dr. Oumar (+221 77 414 47 99).`,
        402
      );
    }
  }

  consumeQuota(pharmacyId: string, tokensConsumed: number): void {
    const ph = this.getPharmacy(pharmacyId);
    if (!ph) return;
    const safeUnits = Math.max(0, Math.round(tokensConsumed));
    ph.monthlyQuotaUsed = Math.min(ph.monthlyQuotaLimit, ph.monthlyQuotaUsed + safeUnits);
    this.persist();
  }

  updatePharmacySubscription(
    pharmacyId: string,
    input: {
      subscriptionPlan?: SubscriptionPlanId;
      monthlyQuotaLimit?: number;
      subscriptionStatus?: 'active' | 'suspended';
      resetUsage?: boolean;
      addBonusCredits?: number;
      addBonusPercent?: number;
      actorName?: string;
      actorRole?: SupervisorRole;
    }
  ): OfficineRecord {
    const ph = this.getPharmacy(pharmacyId);
    if (!ph) throw new Error('Officine introuvable.');

    if (input.subscriptionPlan && SUBSCRIPTION_PLANS[input.subscriptionPlan]) {
      ph.subscriptionPlan = input.subscriptionPlan;
      if (typeof input.monthlyQuotaLimit !== 'number') {
        ph.monthlyQuotaLimit = SUBSCRIPTION_PLANS[input.subscriptionPlan].monthlyQuotaLimit;
      }
    }
    if (typeof input.monthlyQuotaLimit === 'number' && input.monthlyQuotaLimit >= 0) {
      ph.monthlyQuotaLimit = Math.round(input.monthlyQuotaLimit);
    }
    if (typeof input.addBonusPercent === 'number' && input.addBonusPercent > 0) {
      const basePlanCap = SUBSCRIPTION_PLANS[ph.subscriptionPlan || 'pro'].monthlyQuotaLimit;
      const added = Math.round((basePlanCap * input.addBonusPercent) / 100);
      ph.monthlyQuotaLimit += added;
    }
    if (typeof input.addBonusCredits === 'number' && input.addBonusCredits > 0) {
      ph.monthlyQuotaLimit += Math.round(input.addBonusCredits);
    }
    if (input.resetUsage) {
      ph.monthlyQuotaUsed = 0;
      ph.quotaCycleStart = new Date().toISOString();
    }
    if (input.subscriptionStatus === 'active' || input.subscriptionStatus === 'suspended') {
      ph.subscriptionStatus = input.subscriptionStatus;
    }

    const pctUsed = Math.min(
      100,
      Math.round((ph.monthlyQuotaUsed / Math.max(ph.monthlyQuotaLimit, 1)) * 100)
    );

    this.db.auditLogs.unshift({
      id: `AUD-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 89)}`,
      timestamp: new Date().toISOString(),
      pharmacyId: ph.id,
      pharmacyName: ph.name,
      city: ph.city,
      documentNumber: `QUOTA-${ph.subscriptionPlan.toUpperCase()}`,
      documentType: 'facture',
      targetSoftware: ph.targetSoftware,
      tokensUsed: 0,
      finalState: 'BROUILLON_CREE',
      guardrailMessage: `Capacité IA mise à jour par la Supervision : forfait ${SUBSCRIPTION_PLANS[ph.subscriptionPlan].name}, utilisation ${pctUsed}%, statut ${ph.subscriptionStatus === 'active' ? 'Actif' : 'Suspendu'}.`,
      actorName: input.actorName || this.db.ownerAccount?.fullName || 'Dr. Oumar (Propriétaire)',
      actorRole: input.actorRole || 'owner',
    });

    this.persist();
    return ph;
  }

  createQuotaTopUpRequest(input: {
    pharmacyId: string;
    requestedKind: QuotaRequestKind;
    requestedBy: string;
    note?: string;
  }): QuotaTopUpRequest {
    const ph = this.getPharmacy(input.pharmacyId);
    if (!ph) throw new Error('Officine introuvable.');
    if (!this.db.quotaRequests) this.db.quotaRequests = [];

    const pctUsed = Math.min(
      100,
      Math.round((ph.monthlyQuotaUsed / Math.max(ph.monthlyQuotaLimit, 1)) * 100)
    );

    const reqItem: QuotaTopUpRequest = {
      id: `REQ-${Date.now().toString().slice(-5)}-${Math.floor(10 + Math.random() * 89)}`,
      pharmacyId: ph.id,
      pharmacyName: ph.name,
      agentKey: ph.agentKey,
      currentPlan: ph.subscriptionPlan || 'pro',
      currentPercentUsed: pctUsed,
      requestedKind: input.requestedKind,
      requestedBy: input.requestedBy,
      note: input.note?.trim() || undefined,
      status: 'EN_ATTENTE',
      createdAt: new Date().toISOString(),
    };

    this.db.quotaRequests.unshift(reqItem);
    this.persist();
    return reqItem;
  }

  resolveQuotaTopUpRequest(
    requestId: string,
    action: 'approve' | 'reject',
    resolutionNote?: string
  ): { request: QuotaTopUpRequest; pharmacy?: OfficineRecord } {
    if (!this.db.quotaRequests) this.db.quotaRequests = [];
    const reqItem = this.db.quotaRequests.find((r) => r.id === requestId);
    if (!reqItem) throw new Error('Demande de recharge introuvable.');
    if (reqItem.status !== 'EN_ATTENTE') {
      throw new Error('Cette demande a déjà été traitée.');
    }

    reqItem.resolvedAt = new Date().toISOString();
    reqItem.resolutionNote = resolutionNote?.trim() || undefined;

    let updatedPharmacy: OfficineRecord | undefined;
    if (action === 'approve') {
      reqItem.status = 'APPROUVEE';
      if (reqItem.requestedKind === 'topup_25') {
        updatedPharmacy = this.updatePharmacySubscription(reqItem.pharmacyId, {
          addBonusPercent: 25,
          subscriptionStatus: 'active',
        });
      } else if (reqItem.requestedKind === 'topup_50') {
        updatedPharmacy = this.updatePharmacySubscription(reqItem.pharmacyId, {
          addBonusPercent: 50,
          subscriptionStatus: 'active',
        });
      } else if (reqItem.requestedKind === 'upgrade_pro') {
        updatedPharmacy = this.updatePharmacySubscription(reqItem.pharmacyId, {
          subscriptionPlan: 'pro',
          monthlyQuotaLimit: SUBSCRIPTION_PLANS.pro.monthlyQuotaLimit,
          subscriptionStatus: 'active',
        });
      } else if (reqItem.requestedKind === 'upgrade_enterprise') {
        updatedPharmacy = this.updatePharmacySubscription(reqItem.pharmacyId, {
          subscriptionPlan: 'enterprise',
          monthlyQuotaLimit: SUBSCRIPTION_PLANS.enterprise.monthlyQuotaLimit,
          subscriptionStatus: 'active',
        });
      }
    } else {
      reqItem.status = 'REFUSEE';
    }

    this.persist();
    return { request: reqItem, pharmacy: updatedPharmacy };
  }

  recordVisionUsage(pharmacyId: string, tokensUsed: number, docType?: DocumentCategory): void {
    const ph = this.getPharmacy(pharmacyId);
    if (!ph) return;
    const safeTokens = Math.max(tokensUsed, 450);
    ph.tokensUsed += safeTokens;
    ph.estimatedCostFCFA += Math.round((safeTokens / 1000) * 84);
    ph.lastActiveAt = new Date().toISOString();
    ph.status = 'active';
    if (docType) {
      ph.documentsProcessed += 1;
      ph.dailyVolume[ph.dailyVolume.length - 1] += 1;
      if (docType === 'bon_livraison') ph.bonsLivraisonCount += 1;
      if (docType === 'facture') {
        ph.facturesCount += 1;
        if (!ph.dailyInvoices || ph.dailyInvoices.length !== 7) {
          ph.dailyInvoices = [0, 0, 0, 0, 0, 0, 0];
        }
        ph.dailyInvoices[ph.dailyInvoices.length - 1] += 1;
      }
      if (docType === 'mutuelle') ph.mutuellesCount += 1;
    }
    this.persist();
  }

  saveDraft(draft: DraftRecord): DraftRecord {
    this.db.drafts.unshift(draft);
    const ph = this.getPharmacy(draft.pharmacyId);
    if (ph) {
      ph.draftsCreated += 1;
      ph.lastActiveAt = new Date().toISOString();
    }
    this.persist();
    return draft;
  }

  getDraft(draftId: string): DraftRecord | undefined {
    return this.db.drafts.find((d) => d.id === draftId);
  }

  approveDraftByPharmacist(
    draftId: string,
    updatedItems?: ExtractedLineItem[],
    pharmacistName?: string,
    actorRole: PharmacyUserRole | SupervisorRole = 'titulaire'
  ): DraftRecord {
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (!draft) {
      throw new Error('Brouillon introuvable.');
    }
    if (draft.status === 'VALIDE_PAR_PHARMACIEN') {
      throw new Error('Ce brouillon a déjà été validé en stock.');
    }
    if (draft.status === 'REJETE') {
      throw new Error('Impossible de valider un brouillon déjà rejeté.');
    }

    const originalItems = draft.extracted.lineItems;
    const items = updatedItems ?? originalItems;

    // Apprend automatiquement les corrections de désignation faites par le pharmacien
    items.forEach((edited, idx) => {
      const orig = originalItems[idx];
      if (
        orig &&
        edited.designation.trim() &&
        orig.designation.trim() &&
        edited.designation.trim().toLowerCase() !== orig.designation.trim().toLowerCase()
      ) {
        this.addProductAliasRule({
          rawLabel: orig.designation.trim(),
          canonicalName: edited.designation.trim(),
          category: 'Correction Pharmacien',
          learnedFrom: `Validation ${draft.extracted.documentNumber}`,
        });
      }
    });

    draft.extracted.lineItems = items;
    draft.status = 'VALIDE_PAR_PHARMACIEN';
    draft.validatedAt = new Date().toISOString();
    const ph = this.getPharmacy(draft.pharmacyId);
    draft.validatedBy = pharmacistName || ph?.pharmacist || 'Pharmacien Titulaire';

    for (const item of items) {
      const normalizedLot = (item.lotNumber || 'N/A').trim() || 'N/A';
      const existing = this.db.stock.find(
        (s) =>
          s.pharmacyId === draft.pharmacyId &&
          s.designation.toLowerCase() === item.designation.trim().toLowerCase() &&
          (s.lotNumber || 'N/A').trim() === normalizedLot
      );
      if (existing) {
        existing.quantity += Number(item.quantity) || 0;
        existing.unitPriceFCFA = Number(item.unitPriceFCFA) || existing.unitPriceFCFA;
        existing.expiryDate = item.expiryDate || existing.expiryDate;
        existing.lastUpdatedAt = new Date().toISOString();
        existing.sourceDocument = draft.extracted.documentNumber;
      } else {
        this.db.stock.unshift({
          id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
          pharmacyId: draft.pharmacyId,
          designation: item.designation.trim(),
          quantity: Number(item.quantity) || 0,
          lotNumber: normalizedLot,
          expiryDate: item.expiryDate || 'N/A',
          unitPriceFCFA: Number(item.unitPriceFCFA) || 0,
          lastUpdatedAt: new Date().toISOString(),
          sourceDocument: draft.extracted.documentNumber,
        });
      }
    }

    this.db.auditLogs.unshift({
      id: `AUD-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 89)}`,
      timestamp: new Date().toISOString(),
      pharmacyId: draft.pharmacyId,
      pharmacyName: draft.pharmacyName,
      city: ph?.city || '',
      documentNumber: draft.extracted.documentNumber,
      documentType: draft.extracted.documentType,
      targetSoftware: ph?.targetSoftware || 'ERP Officine Intégré',
      tokensUsed: 0,
      finalState: 'VALIDE_HUMAIN',
      guardrailMessage: `Validation finale effectuée manuellement par ${draft.validatedBy}. Stock mis à jour.`,
      actorName: draft.validatedBy,
      actorRole,
    });

    if (this.db.auditLogs.length > 500) {
      this.db.auditLogs.length = 500;
    }

    this.persist();
    return draft;
  }

  updateDraftItemsBeforeApproval(
    draftId: string,
    updatedItems: ExtractedLineItem[],
    actorName: string
  ): DraftRecord {
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (!draft) {
      throw new Error('Brouillon introuvable.');
    }
    if (draft.status !== 'BROUILLON') {
      throw new Error('Seul un brouillon en attente peut être pré-corrigé.');
    }
    draft.extracted.lineItems = updatedItems;
    draft.lastEditedBy = actorName;
    draft.lastEditedAt = new Date().toISOString();
    this.persist();
    return draft;
  }

  rejectDraft(
    draftId: string,
    actorName?: string,
    actorRole: PharmacyUserRole | SupervisorRole = 'titulaire'
  ): DraftRecord {
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (!draft) {
      throw new Error('Brouillon introuvable.');
    }
    if (draft.status === 'VALIDE_PAR_PHARMACIEN') {
      throw new Error('Impossible de rejeter un brouillon déjà validé en stock.');
    }
    const ph = this.getPharmacy(draft.pharmacyId);
    const resolvedActor = actorName || ph?.pharmacist || 'Pharmacien Titulaire';
    draft.status = 'REJETE';
    draft.rejectedBy = resolvedActor;
    draft.rejectedAt = new Date().toISOString();

    this.db.auditLogs.unshift({
      id: `AUD-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 89)}`,
      timestamp: new Date().toISOString(),
      pharmacyId: draft.pharmacyId,
      pharmacyName: draft.pharmacyName,
      city: ph?.city || '',
      documentNumber: draft.extracted.documentNumber,
      documentType: draft.extracted.documentType,
      targetSoftware: ph?.targetSoftware || 'ERP Officine Intégré',
      tokensUsed: 0,
      finalState: 'BROUILLON_REJETE',
      guardrailMessage: `Brouillon rejeté et écarté manuellement par ${resolvedActor}. Aucune écriture en stock.`,
      actorName: resolvedActor,
      actorRole,
    });

    if (this.db.auditLogs.length > 500) {
      this.db.auditLogs.length = 500;
    }
    this.persist();
    return draft;
  }

  enqueueDesktopTask(task: QueuedDesktopTask): QueuedDesktopTask {
    this.db.taskQueue.unshift(task);
    this.persist();
    return task;
  }

  getNextDesktopTask(agentKey: string): QueuedDesktopTask | null {
    const ph = this.getPharmacyByAgentKey(agentKey);
    if (!ph) return null;
    return (
      this.db.taskQueue.find(
        (t) => t.pharmacyId === ph.id && t.status === 'EN_ATTENTE_AGENT_LOCAL'
      ) || null
    );
  }

  completeDesktopTask(
    taskId: string,
    status: 'BROUILLON_CREE_LOCALEMENT' | 'BLOQUE_GARDE_FOU',
    report: string
  ): QueuedDesktopTask | null {
    const task = this.db.taskQueue.find((t) => t.id === taskId);
    if (!task) return null;
    task.status = status;
    task.localAgentReport = report;
    this.recordExecutionOutcome({
      pharmacyId: task.pharmacyId,
      documentNumber: task.extracted.documentNumber,
      documentType: task.extracted.documentType,
      tokensUsed: task.extracted.tokensConsumed ?? 0,
      blocked: status === 'BLOQUE_GARDE_FOU',
      guardrailMessage: `[Agent Local Desktop] ${report}`,
    });
    this.persist();
    return task;
  }

  recordExecutionOutcome(params: {
    pharmacyId: string;
    documentNumber: string;
    documentType: DocumentCategory;
    tokensUsed: number;
    blocked: boolean;
    guardrailMessage: string;
    actorName?: string;
    actorRole?: PharmacyUserRole | SupervisorRole;
  }): void {
    const ph = this.getPharmacy(params.pharmacyId);
    if (!ph) return;

    if (params.blocked) {
      ph.guardrailBlocks += 1;
      ph.status = 'guardrail_halted';
      if (!ph.dailyErrors || ph.dailyErrors.length !== 7) {
        ph.dailyErrors = [0, 0, 0, 0, 0, 0, 0];
      }
      ph.dailyErrors[ph.dailyErrors.length - 1] += 1;
    } else {
      ph.status = 'active';
    }
    ph.lastActiveAt = new Date().toISOString();

    this.db.auditLogs.unshift({
      id: `AUD-${Date.now().toString().slice(-4)}-${Math.floor(10 + Math.random() * 89)}`,
      timestamp: new Date().toISOString(),
      pharmacyId: ph.id,
      pharmacyName: ph.name,
      city: ph.city,
      documentNumber: params.documentNumber,
      documentType: params.documentType,
      targetSoftware: ph.targetSoftware,
      tokensUsed: params.tokensUsed,
      finalState: params.blocked ? 'VALIDATION_BLOQUEE' : 'BROUILLON_CREE',
      guardrailMessage: params.guardrailMessage,
      actorName: params.actorName,
      actorRole: params.actorRole,
    });

    if (this.db.auditLogs.length > 500) {
      this.db.auditLogs.length = 500;
    }
    this.persist();
  }

  saveDraftArtifact(draftId: string, fileName: string, buffer: Buffer): void {
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });
    const safeName = `${draftId}__${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    fs.writeFileSync(path.join(DRAFTS_DIR, safeName), buffer);
  }

  getDraftArtifact(draftId: string): { fileName: string; buffer: Buffer } | undefined {
    if (!fs.existsSync(DRAFTS_DIR)) return undefined;
    const files = fs.readdirSync(DRAFTS_DIR);
    const match = files.find((f) => f.startsWith(`${draftId}__`));
    if (!match) return undefined;
    const fileName = match.slice(`${draftId}__`.length);
    const buffer = fs.readFileSync(path.join(DRAFTS_DIR, match));
    return { fileName, buffer };
  }
}

export const store = new PharmAgentStore();
