import fs from 'fs';
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
  ProductMemoryRule,
  QueuedDesktopTask,
  SoftwareGroundProfile,
  StockItemRecord,
  TargetSoftwareType,
} from '../types/pharmagent.ts';

interface PersistedDatabase {
  pharmacies: OfficineRecord[];
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  auditLogs: AuditLogEntry[];
  learnedMemory: AgentLearnedMemory;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
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
  pharmacies: [
    {
      id: 'dkr-centre',
      name: 'Pharmacie du Centre',
      city: 'Dakar (Plateau)',
      region: 'Dakar',
      pharmacist: 'Dr. Aminata Diop',
      targetSoftware: 'ERP Officine Intégré',
      agentKey: 'PA-DKR-4891',
      status: 'active',
      documentsProcessed: 418,
      bonsLivraisonCount: 245,
      facturesCount: 98,
      mutuellesCount: 75,
      draftsCreated: 418,
      guardrailBlocks: 24,
      tokensUsed: 512400,
      estimatedCostFCFA: 42800,
      lastActiveAt: '2026-11-18T07:42:00Z',
      dailyVolume: [48, 55, 62, 59, 64, 61, 69],
    },
    {
      id: 'tamba-teranga',
      name: 'Pharmacie Teranga',
      city: 'Tambacounda',
      region: 'Tambacounda',
      pharmacist: 'Dr. Moussa Ndiaye',
      targetSoftware: 'Tableur Excel Stock',
      agentKey: 'PA-TMB-7320',
      status: 'active',
      documentsProcessed: 264,
      bonsLivraisonCount: 132,
      facturesCount: 74,
      mutuellesCount: 58,
      draftsCreated: 264,
      guardrailBlocks: 15,
      tokensUsed: 318900,
      estimatedCostFCFA: 26650,
      lastActiveAt: '2026-11-18T07:31:00Z',
      dailyVolume: [31, 34, 39, 36, 42, 38, 44],
    },
    {
      id: 'dkr-almadies',
      name: 'Officine Horizon',
      city: 'Dakar (Almadies)',
      region: 'Dakar',
      pharmacist: 'Dr. Cheikh Fall',
      targetSoftware: 'Logiciel Comptoir Local',
      agentKey: 'PA-DKR-9012',
      status: 'active',
      documentsProcessed: 356,
      bonsLivraisonCount: 194,
      facturesCount: 92,
      mutuellesCount: 70,
      draftsCreated: 356,
      guardrailBlocks: 19,
      tokensUsed: 438200,
      estimatedCostFCFA: 36590,
      lastActiveAt: '2026-11-18T07:19:00Z',
      dailyVolume: [42, 47, 51, 53, 50, 56, 57],
    },
    {
      id: 'thies-cayor',
      name: 'Pharmacie Cayor',
      city: 'Thiès',
      region: 'Thiès',
      pharmacist: 'Dr. Fatou Sarr',
      targetSoftware: 'Progiciel Gestion Stock',
      agentKey: 'PA-THS-3104',
      status: 'active',
      documentsProcessed: 198,
      bonsLivraisonCount: 112,
      facturesCount: 51,
      mutuellesCount: 35,
      draftsCreated: 198,
      guardrailBlocks: 9,
      tokensUsed: 241600,
      estimatedCostFCFA: 20180,
      lastActiveAt: '2026-11-18T06:55:00Z',
      dailyVolume: [24, 27, 29, 26, 31, 29, 32],
    },
    {
      id: 'sl-ndar',
      name: 'Officine Ndar',
      city: 'Saint-Louis',
      region: 'Saint-Louis',
      pharmacist: 'Dr. Ibrahima Gueye',
      targetSoftware: 'Tableur Excel Stock',
      agentKey: 'PA-STL-6651',
      status: 'idle',
      documentsProcessed: 142,
      bonsLivraisonCount: 84,
      facturesCount: 36,
      mutuellesCount: 22,
      draftsCreated: 142,
      guardrailBlocks: 7,
      tokensUsed: 174300,
      estimatedCostFCFA: 14550,
      lastActiveAt: '2026-11-17T19:10:00Z',
      dailyVolume: [18, 21, 19, 22, 20, 21, 21],
    },
    {
      id: 'zig-casamance',
      name: 'Pharmacie Casamance',
      city: 'Ziguinchor',
      region: 'Ziguinchor',
      pharmacist: 'Dr. Mariama Bâ',
      targetSoftware: 'ERP Officine Intégré',
      agentKey: 'PA-ZIG-2089',
      status: 'guardrail_halted',
      documentsProcessed: 119,
      bonsLivraisonCount: 68,
      facturesCount: 31,
      mutuellesCount: 20,
      draftsCreated: 119,
      guardrailBlocks: 12,
      tokensUsed: 148500,
      estimatedCostFCFA: 12400,
      lastActiveAt: '2026-11-18T06:12:00Z',
      dailyVolume: [14, 16, 15, 19, 17, 18, 20],
    },
  ],
  stock: [
    {
      id: 'STK-101',
      pharmacyId: 'dkr-centre',
      designation: 'Amoxicilline 500mg Gélule B/24',
      quantity: 85,
      lotNumber: 'AMX2511',
      expiryDate: '04/2028',
      unitPriceFCFA: 1850,
      lastUpdatedAt: '2026-11-17T14:20:00Z',
      sourceDocument: 'BL-2026-4810',
    },
    {
      id: 'STK-102',
      pharmacyId: 'dkr-centre',
      designation: 'Paracétamol Doliprane 1000mg B/8',
      quantity: 210,
      lotNumber: 'DOL9801',
      expiryDate: '10/2027',
      unitPriceFCFA: 1200,
      lastUpdatedAt: '2026-11-17T14:20:00Z',
      sourceDocument: 'BL-2026-4810',
    },
    {
      id: 'STK-103',
      pharmacyId: 'tamba-teranga',
      designation: 'Augmentin 1g Sachet B/12',
      quantity: 42,
      lotNumber: 'AUG1120',
      expiryDate: '08/2027',
      unitPriceFCFA: 4500,
      lastUpdatedAt: '2026-11-16T10:15:00Z',
      sourceDocument: 'BL-2026-4690',
    },
  ],
  drafts: [
    {
      id: 'DRF-8821',
      pharmacyId: 'dkr-centre',
      pharmacyName: 'Pharmacie du Centre',
      createdAt: '2026-11-18T07:42:00Z',
      taskPrompt: 'Extraire les articles du bon Laborex et préparer le brouillon d’entrée en stock.',
      targetMode: 'erp_live',
      status: 'BROUILLON',
      guardrailNote: 'Brouillon créé par l’agent. En attente de validation du Dr. Aminata Diop.',
      extracted: {
        documentType: 'bon_livraison',
        documentNumber: 'BL-2026-4891',
        supplierOrOrg: 'LABOREX SENEGAL - DAKAR',
        recipientPharmacy: 'Pharmacie du Centre',
        documentDate: '18/10/2026',
        currency: 'FCFA',
        totalAmountFCFA: 381000,
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
      pharmacyId: 'dkr-centre',
      pharmacyName: 'Pharmacie du Centre',
      city: 'Dakar (Plateau)',
      documentNumber: 'BL-2026-4891',
      documentType: 'bon_livraison',
      targetSoftware: 'ERP Officine Intégré',
      tokensUsed: 2480,
      finalState: 'BROUILLON_CREE',
      guardrailMessage: 'Brouillon créé dans l’ERP Officine Intégré. Arrêt strict avant entrée en stock.',
    },
    {
      id: 'AUD-9480',
      timestamp: '2026-11-18T06:12:00Z',
      pharmacyId: 'zig-casamance',
      pharmacyName: 'Pharmacie Casamance',
      city: 'Ziguinchor',
      documentNumber: 'BL-2026-4703',
      documentType: 'bon_livraison',
      targetSoftware: 'ERP Officine Intégré',
      tokensUsed: 2610,
      finalState: 'VALIDATION_BLOQUEE',
      guardrailMessage: 'Garde-Fou déclenché : clic bloqué sur le bouton "Valider Définitivement".',
    },
  ],
  learnedMemory: initialMemory,
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
        };
      } catch {
        this.db = structuredClone(initialDatabase);
        this.persist();
      }
    } else {
      this.db = structuredClone(initialDatabase);
      this.persist();
    }
  }

  private persist(): void {
    fs.writeFileSync(DB_PATH, JSON.stringify(this.db, null, 2), 'utf-8');
  }

  getDashboard(): DashboardSnapshot {
    const summary = this.db.pharmacies.reduce(
      (acc, ph) => {
        acc.totalPharmacies += 1;
        if (ph.status === 'active') acc.activeAgents += 1;
        acc.totalDocuments += ph.documentsProcessed;
        acc.totalDraftsCreated += ph.draftsCreated;
        acc.totalGuardrailBlocks += ph.guardrailBlocks;
        acc.totalTokensUsed += ph.tokensUsed;
        acc.totalCostFCFA += ph.estimatedCostFCFA;
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
      summary,
      dailyTrend,
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
  }): OfficineRecord {
    const slug = input.city
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 8);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const id = `${slug || 'off'}-${suffix}`;
    const agentKey = `PA-${(slug || 'OFF').slice(0, 3).toUpperCase()}-${suffix}`;

    const record: OfficineRecord = {
      id,
      name: input.name.trim(),
      city: input.city.trim(),
      region: input.region.trim() || input.city.trim(),
      pharmacist: input.pharmacist.trim(),
      targetSoftware: input.targetSoftware,
      agentKey,
      status: 'active',
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
    };

    this.db.pharmacies.unshift(record);
    this.persist();
    return record;
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
      if (docType === 'facture') ph.facturesCount += 1;
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

  approveDraftByPharmacist(
    draftId: string,
    updatedItems?: ExtractedLineItem[],
    pharmacistName?: string
  ): DraftRecord {
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (!draft) {
      throw new Error('Brouillon introuvable.');
    }
    if (draft.status === 'VALIDE_PAR_PHARMACIEN') {
      throw new Error('Ce brouillon a déjà été validé en stock.');
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
      const existing = this.db.stock.find(
        (s) =>
          s.pharmacyId === draft.pharmacyId &&
          s.designation.toLowerCase() === item.designation.toLowerCase() &&
          s.lotNumber === item.lotNumber
      );
      if (existing) {
        existing.quantity += Number(item.quantity) || 0;
        existing.unitPriceFCFA = Number(item.unitPriceFCFA) || existing.unitPriceFCFA;
        existing.lastUpdatedAt = new Date().toISOString();
        existing.sourceDocument = draft.extracted.documentNumber;
      } else {
        this.db.stock.unshift({
          id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
          pharmacyId: draft.pharmacyId,
          designation: item.designation,
          quantity: Number(item.quantity) || 0,
          lotNumber: item.lotNumber || 'N/A',
          expiryDate: item.expiryDate || 'N/A',
          unitPriceFCFA: Number(item.unitPriceFCFA) || 0,
          lastUpdatedAt: new Date().toISOString(),
          sourceDocument: draft.extracted.documentNumber,
        });
      }
    }

    this.db.auditLogs.unshift({
      id: `AUD-${Math.floor(1000 + Math.random() * 9000)}`,
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
    });

    this.persist();
    return draft;
  }

  rejectDraft(draftId: string): DraftRecord {
    const draft = this.db.drafts.find((d) => d.id === draftId);
    if (!draft) {
      throw new Error('Brouillon introuvable.');
    }
    draft.status = 'REJETE';
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
  }): void {
    const ph = this.getPharmacy(params.pharmacyId);
    if (!ph) return;

    if (params.blocked) {
      ph.guardrailBlocks += 1;
      ph.status = 'guardrail_halted';
    } else {
      ph.status = 'active';
    }
    ph.lastActiveAt = new Date().toISOString();

    this.db.auditLogs.unshift({
      id: `AUD-${Math.floor(1000 + Math.random() * 9000)}`,
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
    });

    if (this.db.auditLogs.length > 60) {
      this.db.auditLogs.pop();
    }
    this.persist();
  }

  saveDraftArtifact(draftId: string, fileName: string, buffer: Buffer): void {
    const safeName = `${draftId}__${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    fs.writeFileSync(path.join(DRAFTS_DIR, safeName), buffer);
  }

  getDraftArtifact(draftId: string): { fileName: string; buffer: Buffer } | undefined {
    const files = fs.readdirSync(DRAFTS_DIR);
    const match = files.find((f) => f.startsWith(`${draftId}__`));
    if (!match) return undefined;
    const fileName = match.slice(`${draftId}__`.length);
    const buffer = fs.readFileSync(path.join(DRAFTS_DIR, match));
    return { fileName, buffer };
  }
}

export const store = new PharmAgentStore();
