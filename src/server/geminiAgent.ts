import { GoogleGenAI, Type } from '@google/genai';
import type {
  AgentLearnedMemory,
  DocumentCategory,
  ExtractedDocumentData,
  GroundedTargetElement,
  GroundingAnalysisResult,
} from '../types/pharmagent.ts';
import { guardrail } from './guardrail.ts';

// Modèle Gemini configurable sans redéploiement de code (variable GEMINI_MODEL).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY manquante côté serveur. Configurez la variable dans Settings > Secrets.'
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

function parseGeminiJson<T>(rawText: string, contextLabel: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Réponse JSON invalide reçue de Gemini (${contextLabel}).`);
  }
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
            `Tu es l'agent d'exécution universel PharmAgent. ` +
            `Analyse ce document photographié ou scanné (type probable : ${params.documentHint}). ` +
            `Il peut s'agir d'un bon de livraison / facture officine OU d'une facture de service (eau SDR / service public, électricité, télécom, etc.). ` +
            `Extrais fidèlement :\n` +
            `- L'en-tête : numéro de document/facture (documentNumber), fournisseur ou organisme émetteur (supplierOrOrg), client/abonné/pharmacie destinataire (recipientPharmacy), date du document (documentDate), coût total / montant à payer en FCFA (totalAmountFCFA).\n` +
            `- Si présents sur la facture : numéro de compteur / police (meterNumber), consommation relevée avec unité ex: "42 m3" ou "310 kWh" (consumption), adresse complète du client/compteur (customerAddress), ville / commune (customerCity), période facturée ou échéance (billingPeriod), et toute autre information utile dans extraFields (clé/valeur).\n` +
            `- Les lignes détaillées (lineItems). Si la facture ne comporte pas de tableau multi-lignes (ex: facture d'eau ou de service globale), crée au moins 1 ligne récapitulative avec designation = libellé du service, quantity = 1, unitPriceFCFA = totalAmountFCFA.` +
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
          meterNumber: { type: Type.STRING },
          consumption: { type: Type.STRING },
          customerAddress: { type: Type.STRING },
          customerCity: { type: Type.STRING },
          billingPeriod: { type: Type.STRING },
          extraFields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['key', 'value'],
            },
          },
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

  const parsed = parseGeminiJson<ExtractedDocumentData>(text, 'extraction');
  const tokensConsumed = response.usageMetadata?.totalTokenCount ?? 1850;
  parsed.tokensConsumed = tokensConsumed;
  parsed.currency = parsed.currency || 'FCFA';
  parsed.lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];

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

  const extraKeys = (params.extractedData.extraFields || [])
    .map((f) => `- extra:${f.key} (Valeur extraite: ${f.value})`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents:
      `Voici les en-têtes réels d'un fichier Excel créé par l'utilisateur :\n` +
      `${JSON.stringify(params.excelColumns)}\n` +
      memoryRulesText +
      `\n\nAssocie chaque colonne Excel au champ source le plus pertinent parmi :\n` +
      `- documentNumber (N° document / facture / bon / référence)\n` +
      `- supplierOrOrg (Fournisseur / laboratoire / organisme / SDR / mutuelle)\n` +
      `- recipientPharmacy (Client / abonné / destinataire / pharmacie)\n` +
      `- documentDate (Date du document / facture / période)\n` +
      `- billingPeriod (Période facturée / mois / échéance)\n` +
      `- meterNumber (N° compteur / numéro compteur / police / référence compteur)\n` +
      `- consumption (Consommation / index / m3 / kWh / volume consommé)\n` +
      `- totalAmountFCFA (Coût total / montant TTC / coût / total facture)\n` +
      `- customerAddress (Adresse / rue / quartier)\n` +
      `- customerCity (Ville / localité / commune)\n` +
      `- item.designation (Désignation / produit / libellé service / article)\n` +
      `- item.quantity (Quantité / unités / qté)\n` +
      `- item.lotNumber (Numéro de lot / batch)\n` +
      `- item.expiryDate (Date d'expiration / péremption / DLC)\n` +
      `- item.unitPriceFCFA (Prix unitaire / tarif unitaire)\n` +
      `- item.lineTotalFCFA (Montant ligne / sous-total)\n` +
      `- draftStatus (Statut Brouillon / contrôle / validation)\n` +
      (extraKeys ? `${extraKeys}\n` : '') +
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
  const parsedMappings = parseGeminiJson<Array<{ excelColumn: string; sourceField: string }>>(
    text,
    'mapping Excel'
  );
  const mappings = Array.isArray(parsedMappings) ? parsedMappings : [];
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

  const rawResult = parseGeminiJson<
    Omit<GroundingAnalysisResult, 'elements'> & {
      elements: Array<Omit<GroundedTargetElement, 'centerPoint'>>;
    }
  >(text, 'UI Grounding');

  const elementsList = Array.isArray(rawResult.elements) ? rawResult.elements : [];
  const normalizedElements: GroundedTargetElement[] = elementsList.map((el, index) => {
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
