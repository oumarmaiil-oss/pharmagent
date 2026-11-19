import { GoogleGenAI, Type } from '@google/genai';
import type {
  AgentLearnedMemory,
  DocumentCategory,
  ExtractedDocumentData,
  GroundedTargetElement,
  GroundingAnalysisResult,
} from '../types/pharmagent.ts';
import { guardrail } from './guardrail.ts';

// Modèle configurable via la variable d'environnement GEMINI_MODEL.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-argon';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY manquante côté serveur. Ajoutez-la dans les variables d’environnement du service (Render > Environment).'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function extractDocumentWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  documentHint: DocumentCategory;
  taskPrompt?: string;
  learnedMemory?: AgentLearnedMemory;
}): Promise<{ data: ExtractedDocumentData; tokensConsumed: number }> {
  const ai = getGeminiClient();

  const missionClause = params.taskPrompt?.trim()
    ? `\nInstruction spécifique du pharmacien : "${params.taskPrompt.trim()}". Réponds à cette instruction dans le champ agentObservations (ex: anomalies, dates d'expiration proches, écarts de prix).`
    : '';

  const memoryClause =
    params.learnedMemory && params.learnedMemory.productAliases.length > 0
      ? `\nMémoire apprise de l'officine (normalise les libellés reconnus vers leur nom canonique si cela correspond) :\n` +
        params.learnedMemory.productAliases
          .slice(0, 40)
          .map((p) => `- "${p.rawLabel}" => "${p.canonicalName}"`)
          .join('\n')
      : '';

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.imageBase64,
          },
        },
        {
          text:
            `Tu es l'agent d'exécution PharmAgent d'une officine pharmaceutique. ` +
            `Analyse ce document photographié (type probable : ${params.documentHint}). ` +
            `Extrais fidèlement l'en-tête (numéro de document, fournisseur ou organisme mutuelle, pharmacie destinataire, date, montant total en FCFA) ` +
            `et chaque ligne de produit avec désignation exacte, quantité entière, numéro de lot, date d'expiration et prix unitaire.` +
            memoryClause +
            missionClause,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: {
            type: Type.STRING,
            description: 'bon_livraison, facture ou mutuelle',
          },
          documentNumber: { type: Type.STRING },
          supplierOrOrg: { type: Type.STRING },
          recipientPharmacy: { type: Type.STRING },
          documentDate: { type: Type.STRING },
          currency: { type: Type.STRING },
          totalAmountFCFA: { type: Type.NUMBER },
          agentObservations: { type: Type.STRING },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                designation: { type: Type.STRING },
                quantity: { type: Type.INTEGER },
                lotNumber: { type: Type.STRING },
                expiryDate: { type: Type.STRING },
                unitPriceFCFA: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
              },
              required: ['designation', 'quantity', 'unitPriceFCFA', 'confidence'],
            },
          },
        },
        required: [
          'documentType',
          'documentNumber',
          'supplierOrOrg',
          'recipientPharmacy',
          'documentDate',
          'totalAmountFCFA',
          'lineItems',
        ],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Réponse vide renvoyée par Gemini Vision lors de l’extraction.');
  }

  const parsed = JSON.parse(text) as ExtractedDocumentData;
  const tokensConsumed = response.usageMetadata?.totalTokenCount ?? 1850;
  parsed.tokensConsumed = tokensConsumed;
  parsed.currency = parsed.currency || 'FCFA';

  return { data: parsed, tokensConsumed };
}

export async function mapToRealExcelColumnsWithGemini(params: {
  excelColumns: string[];
  extractedData: ExtractedDocumentData;
  learnedMemory?: AgentLearnedMemory;
}): Promise<{
  mappings: Array<{ excelColumn: string; sourceField: string }>;
  tokensConsumed: number;
}> {
  const ai = getGeminiClient();

  const memoryRulesText =
    params.learnedMemory && params.learnedMemory.columnRules.length > 0
      ? `\nRègles de mapping déjà mémorisées par l'agent (à respecter en priorité) :\n` +
        params.learnedMemory.columnRules
          .slice(0, 40)
          .map((c) => `- En-tête similaire à "${c.excelHeaderPattern}" => ${c.targetSourceField}`)
          .join('\n')
      : '';

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents:
      `Voici les en-têtes réels d'un fichier Excel créé par le pharmacien :\n` +
      `${JSON.stringify(params.excelColumns)}\n` +
      memoryRulesText +
      `\n\nAssocie chaque colonne Excel au champ source le plus pertinent parmi :\n` +
      `- documentNumber (N° document / facture / bon / référence)\n` +
      `- supplierOrOrg (Fournisseur / laboratoire / organisme / mutuelle)\n` +
      `- documentDate (Date du document ou de réception)\n` +
      `- item.designation (Nom du médicament / produit / DCI / article)\n` +
      `- item.quantity (Quantité / unités / qté livrée ou reçue)\n` +
      `- item.lotNumber (Numéro de lot / batch)\n` +
      `- item.expiryDate (Date d'expiration / péremption / DLC)\n` +
      `- item.unitPriceFCFA (Prix unitaire / tarif unitaire)\n` +
      `- item.lineTotalFCFA (Montant ligne / sous-total / total ligne)\n` +
      `- draftStatus (Statut Brouillon / contrôle / validation)\n` +
      `- none (Si aucune correspondance)`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            excelColumn: { type: Type.STRING },
            sourceField: { type: Type.STRING },
          },
          required: ['excelColumn', 'sourceField'],
        },
      },
    },
  });

  const text = (response.text ?? '[]').trim();
  const mappings = JSON.parse(text) as Array<{ excelColumn: string; sourceField: string }>;
  const tokensConsumed = response.usageMetadata?.totalTokenCount ?? 520;
  return { mappings, tokensConsumed };
}

export async function groundTargetInterfaceWithGemini(params: {
  screenshotBase64: string;
  mimeType: string;
  extractedData: ExtractedDocumentData;
}): Promise<{ result: GroundingAnalysisResult; tokensConsumed: number }> {
  const ai = getGeminiClient();

  const firstItem = params.extractedData.lineItems[0] ?? {
    designation: 'Amoxicilline 500mg',
    quantity: 10,
    lotNumber: 'LOT-001',
    unitPriceFCFA: 1500,
  };

  const compactContext = {
    documentNumber: params.extractedData.documentNumber,
    supplierOrOrg: params.extractedData.supplierOrOrg,
    documentDate: params.extractedData.documentDate,
    firstLineItem: firstItem,
    totalLineItems: params.extractedData.lineItems.length,
  };

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.screenshotBase64,
          },
        },
        {
          text:
            `Tu es le module de reconnaissance d'interface (UI Grounding) de PharmAgent. ` +
            `Analyse cette capture d'écran d'un logiciel cible (ERP de stock officine ou tableau Excel). ` +
            `Identifie visuellement :\n` +
            `1. Les zones de saisie (input_field) ou en-têtes/cellules de colonnes (table_column) correspondant aux étiquettes visibles.\n` +
            `2. Le bouton d'enregistrement temporaire / brouillon (elementRole='draft_button').\n` +
            `3. TOUT bouton de validation définitive (elementRole='forbidden_final_button', ex: 'Valider Définitivement', 'Confirmer', 'Valider').\n\n` +
            `Pour chaque élément, donne box_2d = [ymin, xmin, ymax, xmax] entre 0 et 1000. ` +
            `Associe chaque champ au chemin JSON pertinent parmi :\n` +
            `${JSON.stringify(compactContext, null, 2)}`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          targetInterfaceTitle: { type: Type.STRING },
          detectedSoftwareType: {
            type: Type.STRING,
            description: 'erp_form, excel_grid, ou desktop_app',
          },
          executionPlanSummary: { type: Type.STRING },
          elements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                detectedLabel: { type: Type.STRING },
                elementRole: {
                  type: Type.STRING,
                  description:
                    'input_field | table_column | draft_button | forbidden_final_button',
                },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                },
                semanticMapping: {
                  type: Type.OBJECT,
                  properties: {
                    sourceJsonPath: { type: Type.STRING },
                    targetFieldName: { type: Type.STRING },
                    sampleValueToInsert: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                  },
                  required: [
                    'sourceJsonPath',
                    'targetFieldName',
                    'sampleValueToInsert',
                    'confidence',
                  ],
                },
                safetyStatus: {
                  type: Type.STRING,
                  description:
                    'AUTHORIZED_INPUT | AUTHORIZED_DRAFT_SAVE | FORBIDDEN_BY_GUARDRAIL',
                },
                guardrailReason: { type: Type.STRING },
              },
              required: ['id', 'detectedLabel', 'elementRole', 'box_2d', 'safetyStatus'],
            },
          },
        },
        required: [
          'targetInterfaceTitle',
          'detectedSoftwareType',
          'executionPlanSummary',
          'elements',
        ],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Réponse vide renvoyée par Gemini Vision lors du UI Grounding.');
  }

  const rawResult = JSON.parse(text) as Omit<GroundingAnalysisResult, 'elements'> & {
    elements: Array<Omit<GroundedTargetElement, 'centerPoint'>>;
  };

  const normalizedElements: GroundedTargetElement[] = rawResult.elements.map((el, index) => {
    const [ymin, xmin, ymax, xmax] =
      Array.isArray(el.box_2d) && el.box_2d.length === 4 ? el.box_2d : [100, 100, 200, 300];
    const centerPoint = {
      x: Math.round((xmin + xmax) / 2),
      y: Math.round((ymin + ymax) / 2),
    };

    const hydrated: GroundedTargetElement = {
      id: el.id || `el-${index + 1}`,
      detectedLabel: el.detectedLabel,
      elementRole: el.elementRole,
      box_2d: [ymin, xmin, ymax, xmax],
      centerPoint,
      semanticMapping: el.semanticMapping ?? null,
      safetyStatus: el.safetyStatus,
      guardrailReason: el.guardrailReason,
    };

    return guardrail.enforceClassification(hydrated);
  });

  const tokensConsumed = response.usageMetadata?.totalTokenCount ?? 2140;

  return {
    result: {
      targetInterfaceTitle: rawResult.targetInterfaceTitle,
      detectedSoftwareType: rawResult.detectedSoftwareType,
      executionPlanSummary: rawResult.executionPlanSummary,
      elements: normalizedElements,
      tokensConsumed,
    },
    tokensConsumed,
  };
}
