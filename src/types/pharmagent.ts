// ============================================================
// PharmAgent — Types partagés frontend/backend
// ============================================================

export type TargetSoftwareType = 'ERP Officine Intégré' | 'Excel / Tableur' | 'Dossier Patient';
export type DocumentCategory = 'bon_livraison' | 'facture' | 'mutuelle';
export type SubscriptionPlan = 'trial' | 'standard' | 'premium' | 'suspended';
export type PharmacyUserRole = 'titulaire' | 'adjoint' | 'assistant';
export type DraftStatus = 'pending' | 'approved' | 'rejected';
export type ExtractionStatus = 'processing' | 'ready' | 'error';
export type AuditLevel = 'info' | 'warning' | 'blocked' | 'approved' | 'rejected';

// ─── Entités principales ───────────────────────────────────

export interface Pharmacy {
  id: string;
  name: string;
  city: string;
  region: string;
  pharmacist: string;
  targetSoftware: TargetSoftwareType;
  createdAt: string;
  subscription: SubscriptionPlan;
  monthlyQuota: number;        // brouillons autorisés par mois
  usedThisMonth: number;
  agentKey: string;            // clé secrète pour l'agent Python local
  agent?: AgentPresence;
}

// ─── Agent local ──────────────────────────────────────────

export interface AgentPresence {
  lastSeen: string;
  hostname?: string;
  os?: string;
  version?: string;
  state?: string;              // ex. « En attente », « Saisie en cours »
}

export type ErpMode = 'web' | 'desktop';

// Étape d'une recette enregistrée pendant la démo (interprétée par l'agent)
export interface RecipeStep {
  kind: 'fill' | 'pick' | 'click' | 'press' | 'select' | 'type' | 'key' | 'wait';
  field?: string;
  value?: string;
  selectors?: string[];
  text?: string;
  key?: string;
  format?: string;
  label?: string;
  ms?: number;
  frame?: string;              // « name:xxx » ou « url:/chemin » si le champ est dans une iframe
  via?: 'key' | 'mouse';       // champ atteint au clavier (Tab) ou à la souris pendant la démo
}

export interface AgentProfile {
  pharmacyId: string;
  mode: ErpMode;
  erpUrl?: string;
  formUrl?: string;            // écran de saisie où la démo a été faite
  windowTitle?: string;
  headerSteps: RecipeStep[];
  lineSteps: RecipeStep[];
  recordedAt?: string;
  updatedAt: string;
}

export type ExecutionStatus = 'queued' | 'running' | 'done' | 'failed';

export interface DraftExecution {
  status: ExecutionStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  message?: string;
  durationMs?: number;
  lines?: Array<{ index: number; ok: boolean; message?: string }>;
}

export interface PharmacyUser {
  id: string;
  pharmacyId: string;
  loginId: string;
  fullName: string;
  role: PharmacyUserRole;
  passwordHash: string;
  createdAt: string;
}

export interface OwnerAccount {
  id: string;
  loginId: string;
  fullName: string;
  role: 'owner' | 'co_supervisor';
  passwordHash: string;
  createdAt: string;
}

// ─── Extraction IA ────────────────────────────────────────

export interface ExtractedLineItem {
  designation: string;          // libellé brut du grossiste, jamais normalisé
  cip?: string;
  quantity: number;
  lotNumber?: string;
  expiryDate?: string;
  unitPriceFCFA: number;        // prix d'achat
  salePriceFCFA?: number;
  confidence: number;           // confiance de lecture OCR
  match?: ProductMatch;
}

// ─── Catalogue produits & correspondance ──────────────────

export interface CatalogProduct {
  id: string;
  pharmacyId: string;
  erpLabel: string;             // libellé exact tel qu'affiché dans l'ERP
  cip?: string;
  purchasePriceFCFA?: number;
  salePriceFCFA?: number;
  stockQty?: number;
  suppliers: string[];          // grossistes déjà vus pour ce produit
  source: 'import' | 'erp_capture' | 'learned';
  updatedAt: string;
}

export type MatchMethod = 'cip' | 'memory' | 'score' | 'ai' | 'manual' | 'none';
export type MatchStatus = 'auto' | 'to_review' | 'confirmed' | 'new_product';

export interface MatchCandidate {
  productId: string;
  erpLabel: string;
  score: number;
}

export interface ProductMatch {
  status: MatchStatus;
  method: MatchMethod;
  score: number;                // 0..1
  productId?: string;
  erpLabel?: string;            // ce que l'agent tape/sélectionne dans l'ERP
  candidates: MatchCandidate[];
}

export interface ExtractedDocumentData {
  documentType: DocumentCategory;
  documentNumber: string;
  supplierOrOrg: string;
  recipientPharmacy: string;
  documentDate: string;
  currency: string;
  totalAmountFCFA: number;
  lineItems: ExtractedLineItem[];
  agentObservations?: string;
}

export interface ColumnMapping {
  sourceField: string;
  targetColumn: string;
  exampleValue: string;
}

// ─── Brouillons ───────────────────────────────────────────

export interface DraftRecord {
  id: string;
  pharmacyId: string;
  status: DraftStatus;
  extractionStatus?: ExtractionStatus;
  extractionError?: string;
  documentCategory: DocumentCategory;
  extractedData: ExtractedDocumentData;
  columnMapping: ColumnMapping[];
  createdAt: string;
  updatedAt: string;
  actorId: string;
  actorName: string;
  approvedBy?: string;
  rejectionReason?: string;
  tokensConsumed: number;
  execution?: DraftExecution;
}

// ─── Mémoire apprise ──────────────────────────────────────

export interface ProductAlias {
  id: string;
  rawLabel: string;
  canonicalName: string;
  pharmacyId?: string;
  supplier?: string;            // alias spécifique à un grossiste
  productId?: string;
  hits?: number;
  createdAt: string;
}

export interface ColumnRule {
  id: string;
  sourceField: string;
  targetColumn: string;
  pharmacyId?: string;
  createdAt: string;
}

export interface AgentLearnedMemory {
  productAliases: ProductAlias[];
  columnRules: ColumnRule[];
}

// ─── Audit ────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  actorId: string;
  actorName: string;
  action: string;
  level: AuditLevel;
  details?: string;
  timestamp: string;
}

// ─── UI Grounding ─────────────────────────────────────────

export type SafetyStatus = 'SAFE_DRAFT' | 'FORBIDDEN_BY_GUARDRAIL' | 'UNKNOWN';

export interface GroundedTargetElement {
  elementRole: string;
  detectedLabel: string;
  safetyStatus: SafetyStatus;
  confidence: number;
  boundingBox?: { x: number; y: number; w: number; h: number };
  suggestedAction: string;
}

export interface GroundingAnalysisResult {
  targetSoftware: TargetSoftwareType;
  elements: GroundedTargetElement[];
  overallSafe: boolean;
  observations: string;
  tokensConsumed: number;
}

// ─── Dashboard ────────────────────────────────────────────

export interface PharmacyStats {
  pharmacyId: string;
  pharmacyName: string;
  pendingDrafts: number;
  approvedThisMonth: number;
  rejectedThisMonth: number;
  usedThisMonth: number;
  monthlyQuota: number;
  subscription: SubscriptionPlan;
  lastActivity?: string;
}

export interface DashboardSnapshot {
  pharmacies: Pharmacy[];
  stats: PharmacyStats[];
  pendingDrafts: DraftRecord[];
  recentDrafts: DraftRecord[];
  persistence: 'postgres' | 'disk';
  recentAudit: AuditLogEntry[];
  totalDraftsToday: number;
  totalApprovedMonth: number;
  learnedMemory: AgentLearnedMemory;
}

