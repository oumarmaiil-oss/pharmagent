// ============================================================
// PharmAgent — Types partagés frontend/backend
// ============================================================

export type TargetSoftwareType = 'ERP Officine Intégré' | 'Excel / Tableur' | 'Dossier Patient';
export type DocumentCategory = 'bon_livraison' | 'facture' | 'mutuelle';
export type SubscriptionPlan = 'trial' | 'standard' | 'premium' | 'suspended';
export type PharmacyUserRole = 'titulaire' | 'adjoint' | 'assistant';
export type DraftStatus = 'pending' | 'approved' | 'rejected';
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
  designation: string;
  quantity: number;
  lotNumber?: string;
  expiryDate?: string;
  unitPriceFCFA: number;
  confidence: number;
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
  hasExcelFile: boolean;
}

// ─── Mémoire apprise ──────────────────────────────────────

export interface ProductAlias {
  id: string;
  rawLabel: string;
  canonicalName: string;
  pharmacyId?: string;
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
  recentAudit: AuditLogEntry[];
  totalDraftsToday: number;
  totalApprovedMonth: number;
  learnedMemory: AgentLearnedMemory;
}

// ─── Exécution locale ─────────────────────────────────────

export interface ExecutionStepLog {
  stepIndex: number;
  action: string;
  status: 'pending' | 'done' | 'blocked' | 'error';
  message?: string;
  timestamp: string;
}

export interface ExecutionRunResult {
  draftId: string;
  success: boolean;
  steps: ExecutionStepLog[];
  blockedReason?: string;
  excelFileName?: string;
  tokensConsumed: number;
}
