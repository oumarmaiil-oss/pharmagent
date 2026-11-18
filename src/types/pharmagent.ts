export type DocumentCategory = 'bon_livraison' | 'facture' | 'mutuelle';

export type TargetSoftwareType =
  | 'ERP Officine Intégré'
  | 'Logiciel Comptoir Local'
  | 'Tableur Excel Stock'
  | 'Progiciel Gestion Stock';

export type TargetExecutionMode = 'erp_live' | 'excel_upload' | 'local_desktop';

export interface OfficineRecord {
  id: string;
  name: string;
  city: string;
  region: string;
  pharmacist: string;
  targetSoftware: TargetSoftwareType;
  agentKey: string;
  status: 'active' | 'idle' | 'guardrail_halted';
  documentsProcessed: number;
  bonsLivraisonCount: number;
  facturesCount: number;
  mutuellesCount: number;
  draftsCreated: number;
  guardrailBlocks: number;
  tokensUsed: number;
  estimatedCostFCFA: number;
  lastActiveAt: string;
  dailyVolume: number[];
}

export interface ExtractedLineItem {
  designation: string;
  quantity: number;
  lotNumber: string;
  expiryDate: string;
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
  rawNotes?: string;
  tokensConsumed?: number;
}

export interface StockItemRecord {
  id: string;
  pharmacyId: string;
  designation: string;
  quantity: number;
  lotNumber: string;
  expiryDate: string;
  unitPriceFCFA: number;
  lastUpdatedAt: string;
  sourceDocument: string;
}

export interface ProductMemoryRule {
  id: string;
  rawLabel: string;
  canonicalName: string;
  category: string;
  learnedFrom: string;
  createdAt: string;
}

export interface ColumnMemoryRule {
  id: string;
  excelHeaderPattern: string;
  targetSourceField: string;
  learnedFrom: string;
  createdAt: string;
}

export interface SoftwareGroundProfile {
  id: string;
  softwareName: string;
  pharmacyId: string;
  detectedSoftwareType: 'erp_form' | 'excel_grid' | 'desktop_app';
  elements: GroundedTargetElement[];
  injectionScript: string;
  createdAt: string;
}

export interface AgentLearnedMemory {
  productAliases: ProductMemoryRule[];
  columnRules: ColumnMemoryRule[];
  softwareProfiles: SoftwareGroundProfile[];
}

export interface DraftRecord {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  createdAt: string;
  taskPrompt: string;
  targetMode: TargetExecutionMode;
  status: 'BROUILLON' | 'VALIDE_PAR_PHARMACIEN' | 'REJETE';
  extracted: ExtractedDocumentData;
  draftArtifactUrl?: string;
  draftFileName?: string;
  excelColumnsMapped?: Array<{ excelColumn: string; sourceField: string }>;
  excelPreviewHeaders?: string[];
  excelPreviewRows?: Array<Record<string, unknown>>;
  validatedBy?: string;
  validatedAt?: string;
  guardrailNote: string;
}

export interface QueuedDesktopTask {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  createdAt: string;
  taskPrompt: string;
  extracted: ExtractedDocumentData;
  status: 'EN_ATTENTE_AGENT_LOCAL' | 'BROUILLON_CREE_LOCALEMENT' | 'BLOQUE_GARDE_FOU';
  localAgentReport?: string;
}

export interface GroundedTargetElement {
  id: string;
  detectedLabel: string;
  elementRole: 'input_field' | 'table_column' | 'draft_button' | 'forbidden_final_button';
  box_2d: [number, number, number, number];
  centerPoint: { x: number; y: number };
  semanticMapping: {
    sourceJsonPath: string;
    targetFieldName: string;
    sampleValueToInsert: string;
    confidence: number;
  } | null;
  safetyStatus: 'AUTHORIZED_INPUT' | 'AUTHORIZED_DRAFT_SAVE' | 'FORBIDDEN_BY_GUARDRAIL';
  guardrailReason?: string;
}

export interface GroundingAnalysisResult {
  targetInterfaceTitle: string;
  detectedSoftwareType: 'erp_form' | 'excel_grid' | 'desktop_app';
  elements: GroundedTargetElement[];
  executionPlanSummary: string;
  tokensConsumed?: number;
}

export interface ExecutionStepLog {
  stepIndex: number;
  action:
    | 'FOCUS_WINDOW'
    | 'CLICK_AND_TYPE'
    | 'WRITE_EXCEL_CELL'
    | 'CLICK_SAVE_DRAFT'
    | 'BLOCK_FINAL_VALIDATION';
  targetLabel: string;
  coordinates?: { x: number; y: number };
  valueInserted?: string;
  status: 'EXECUTED' | 'STOPPED_AT_DRAFT' | 'BLOCKED_BY_GUARDRAIL';
  message: string;
  timestamp: string;
}

export interface ExecutionRunResult {
  runId: string;
  pharmacyId: string;
  pharmacyName: string;
  documentNumber: string;
  finalState: 'DRAFT_SAVED_ONLY' | 'SECURITY_VIOLATION_BLOCKED';
  draftArtifactUrl?: string;
  draftFileName?: string;
  steps: ExecutionStepLog[];
  guardrailTriggered: boolean;
  guardrailReport: string;
  pythonScriptPreview: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  pharmacyId: string;
  pharmacyName: string;
  city: string;
  documentNumber: string;
  documentType: DocumentCategory;
  targetSoftware: string;
  tokensUsed: number;
  finalState: 'BROUILLON_CREE' | 'VALIDATION_BLOQUEE' | 'VALIDE_HUMAIN';
  guardrailMessage: string;
}

export interface DashboardSnapshot {
  pharmacies: OfficineRecord[];
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  auditLogs: AuditLogEntry[];
  learnedMemory: AgentLearnedMemory;
  summary: {
    totalPharmacies: number;
    activeAgents: number;
    totalDocuments: number;
    totalDraftsCreated: number;
    pendingDraftsCount: number;
    totalGuardrailBlocks: number;
    totalTokensUsed: number;
    totalCostFCFA: number;
  };
  dailyTrend: Array<{
    day: string;
    documents: number;
    tokensK: number;
    drafts: number;
  }>;
}
