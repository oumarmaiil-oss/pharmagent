// ============================================================
// PharmAgent — Vocabulaire des bons de livraison, factures et relevés (Afrique, Europe, États-Unis)
// Une seule source pour : la lecture par l'IA, l'import du catalogue, le remplissage d'un fichier Excel.
// ============================================================

export type ColumnField =
  | 'product' | 'cip' | 'quantity' | 'freeUnits' | 'lot' | 'expiry'
  | 'purchase' | 'sale' | 'discount' | 'vat' | 'lineTotal' | 'stock';

export const FIELD_LABELS: Record<ColumnField, string> = {
  product: 'Désignation', cip: 'Code (CIP/EAN/NDC)', quantity: 'Quantité', freeUnits: 'UG (gratuits)',
  lot: 'N° de lot', expiry: 'Péremption', purchase: "Prix d'achat", sale: 'Prix de vente',
  discount: 'Remise %', vat: 'TVA %', lineTotal: 'Montant ligne', stock: 'Stock',
};

/** Intitulé ramené à une forme simple : minuscules, sans accents ni ponctuation (« P.U. HT » → « p u ht »). */
export const normLabel = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

// L'ordre compte : le premier motif reconnu l'emporte (« Qté UG » = gratuits, « Date Exp. » = péremption, « Qté stock » = stock).
export const COLUMN_PATTERNS: Array<[ColumnField, RegExp]> = [
  ['freeUnits', /^(ug|u g|uvg|gratuits?|free|free goods|bonus)( |$)|unites? gratuites?|qte (ug|gratuite)|quantite gratuite/],
  ['stock', /stock|on hand|en rayon/],
  ['cip', /^(cip|cip ?7|cip ?13|ean|ean ?13|ndc|gtin|upc)( \w+)?$|^code( (cip|ean|barre|barres|produit|article|ndc))?$/],
  ['expiry', /peremption|^exp( |$)|date exp|dlu|dluo|expir|use by|^per( |$)/],
  ['lot', /(^|\s)(lot|batch)(\s|$)|lot no|n lot/],
  ['quantity', /^(qte|qty|quantite|quantity|nb|nombre|colis|boites?)( |$)|quantite|qty shipped|^shipped$/],
  ['discount', /remise|rabais|discount|^rem( |$)/],
  ['vat', /^(tva|vat|tax)( |$)|taux (de )?tva|tva %/],
  ['lineTotal', /^(montant|total|mt|ext|extended|amount)( (ht|ttc|ligne|price|net|brut))?$|montant ligne|total ligne|extended price/],
  ['sale', /prix (de )?(vente|public)|^pv( |$)|^ppv|^ppa|^pp ?ttc|^ppttc|^vente$|tarif public|^tarif$|retail|^msrp|^awp/],
  ['purchase', /prix (d )?achat|prix (de )?cession|^pa( |$)|^achat|cout|^p ?u( |$)|^pu( |$)|prix unitaire|pu net|pght|ppht|pfht|^pph( |$)|unit (cost|price)|^cost$|^price$|^prix$|^prix (unitaire )?(ht|hors taxes?)( |$)|^p ?u ?ht$/],
  ['product', /designation|libelle|produit|denomination|article|^nom$|description|^item( |$)|product|medicament|specialite/],
];

export type HeaderField = 'supplier' | 'documentNumber' | 'documentDate';

/** Intitulé d'en-tête du bon : « Numéro de BL : », « N° Document / BL », « Fournisseur / Tiers », « Date du BL »…
 * Jamais : bon de commande, réception ERP, code tiers, date de péremption. */
export function matchHeaderLabel(label: unknown): HeaderField | undefined {
  const t = normLabel(label);
  if (!t || t.length > 40) return undefined;
  if (/^date\b/.test(t)) return /peremption|expir|naissance|commande|echeance/.test(t) ? undefined : 'documentDate';
  if (/^(invoice date|ship date|delivery date)$/.test(t)) return 'documentDate';
  if (/\b(fournisseur|grossiste|repartiteur|laboratoire|expediteur|vendor|supplier|sold by)\b/.test(t)) return 'supplier';
  if (/\b(commande|order|reception|code|client|tiers|ref|reference|pharmacie|pharmacien|operateur|emplacement|mutuelle|identifiant)\b/.test(t)) return undefined;
  const doc = '(bl|bon|bon de livraison|livraison|bordereau|bordereau de livraison|document|doc|facture|piece|invoice|packing slip)';
  if (new RegExp(`^(n|no|num|numero|number)( (de|du))? ${doc}( ${doc})*$`).test(t)) return 'documentNumber';
  if (new RegExp(`^${doc}( (n|no|number|numero))?$`).test(t)) return 'documentNumber';
  return undefined;
}

export function matchColumn(label: unknown): ColumnField | undefined {
  const t = normLabel(label);
  if (!t) return undefined;
  for (const [field, re] of COLUMN_PATTERNS) if (re.test(t)) return field;
  return undefined;
}

// Libellés de l'en-tête du document (fournisseur, numéro, date) dans un formulaire Excel
export const HEADER_PATTERNS: Array<['supplier' | 'documentNumber' | 'documentDate', RegExp]> = [
  ['supplier', /^(fournisseur|grossiste|repartiteur|laboratoire|expediteur|origine|vendor|supplier|sold by)$/],
  ['documentNumber', /^(n bl|n bon|bl|numero bl|num bl|n de bl|n livraison|numero|numero de livraison|bon de livraison|n piece|n facture|facture n|invoice|invoice no|invoice number|packing slip)$/],
  ['documentDate', /^(date|date de livraison|date bl|date de reception|date reception|date facture|invoice date|ship date)$/],
];

/** Glossaire donné à l'IA : mêmes notions, noms différents selon le pays et le grossiste. */
export const EXTRACTION_GLOSSARY = `
Glossaire (mêmes informations, noms différents selon les pays et les grossistes) :
- Désignation : Désignation, Libellé, Produit, Article, Spécialité, Description, Item, Product.
- Code produit (cip) : CIP, CIP7, CIP13, EAN13, Code article, Code barre, NDC (États-Unis), GTIN.
- Quantité livrée (quantity) : Qté, Qte livrée, Qté facturée, Qty shipped, Quantity. Si « commandée » et « livrée » figurent toutes deux, prends la livrée.
  Si la quantité est exprimée en colis (Nb colis × colisage), donne le nombre total de boîtes.
- Unités gratuites (freeUnits) : UG, U.G., Gratuits, Qté gratuite, Bonus, Free goods. Ne les ajoute JAMAIS à la quantité.
- Lot (lotNumber) : Lot, N° lot, Batch, Lot No. Péremption (expiryDate) : Péremption, Date Exp., Exp, DLU, DLUO, Expiry, Use by.
- Prix d'achat unitaire (unitPriceFCFA) : P.U., PU HT, PU net, Prix de cession, Prix achat, PGHT, PPHT, PPH (Maroc), Unit cost, Unit price.
  S'il existe un PU brut ET un PU net (après remise), prends le PU net et laisse discountPercent vide.
- Remise (discountPercent) : Remise %, Rem., Rabais, Discount. TVA de la ligne (vatRate, en %) : TVA, Taux TVA, VAT, Tax.
  Au Sénégal et dans l'UEMOA, les médicaments sont souvent exonérés (TVA 0) mais la parapharmacie est à 18 %.
- Prix public (salePriceFCFA) : PPV, PPA, PP TTC, Prix public, Prix de vente, Tarif public, Retail, AWP.
- Montant de la ligne (lineTotal) : Montant, Total, Montant HT, Ext., Extended price, Amount.
- Totaux : totalHT = total hors taxes ; totalTVA = montant total de TVA ; totalAmountFCFA = montant final à payer (Net à payer, Total TTC, Total général, Invoice total).
- Ignore les lignes qui ne sont pas des produits : « Report », « À reporter », sous-totaux de page, transport, frais, consigne.
- Les montants sont dans la devise du document (FCFA, EUR, USD, MAD…) : indique-la dans currency, ne convertis rien.
`.trim();

/** Pièges des vrais documents photographiés en officine (Laborex, UbiPharm, Copharmed…). */
export const DOCUMENT_READING_RULES = `
Règles de lecture des documents réels :
- FCFA n'a pas de centimes : « 638.200 » ou « 638 200 » = 638200. Le point y sépare les milliers.
- Annotations manuscrites du pharmacien : une date écrite à la main sur une ligne (ex. « 10/28 », même dans la colonne TVA ou Colisage) est la péremption de cette ligne s'il n'y en a pas d'imprimée.
  Un prix écrit à la main sur une ligne est le prix public (salePriceFCFA) seulement si aucun prix public n'est imprimé.
  Ignore les coches, « OK », signatures, tampons et références internes manuscrites (ex. « 2026/12345 ») : ce ne sont ni le numéro du document ni des produits.
- Des pastilles ou autocollants peuvent cacher une case : ne devine pas, baisse la confidence de la ligne.
- Impression matricielle pâle : O/D/0, I/1, S/5, B/8 se confondent. Choisis la lecture qui donne un nom de médicament qui existe (DOLIPRANE et non DDLIPRANE) et des chiffres cohérents (quantité × prix = montant).
  Les numéros de lot ne se recoupent avec rien : si un seul caractère du lot ou de la péremption n'est pas net, confidence de la ligne au plus 0,7.
- Lot et péremption peuvent être sur une seconde ligne sous le produit : rattache-les au produit au-dessus.
- Un produit qui vient d'être livré n'est presque jamais déjà périmé : si tu lis une date passée, relis-la ; si le doute reste, baisse la confidence.
- Un même document peut avoir deux volets (bon de prélèvement + facture, ou original + copie) avec les mêmes lignes : ne compte chaque ligne qu'une fois.
- Document de plusieurs pages (« page 1/2 ») : extrais les lignes de cette page. S'il n'y a pas de total final, totalAmountFCFA = le montant de bas de page (« Montant HT cumulé », « Cumul », « À reporter »).
- documentNumber = le numéro de la facture ou du bon (« Facture N° », « N° BL », « N° pièce »), recopié avec ses tirets : jamais le numéro de client, de commande, de tournée, de relevé ou de séquence.
- Un produit dont tu ne lis pas le nom : ne crée pas la ligne. Si la plupart des lignes ne se lisent pas, photoQuality = illisible.
- La photo peut être tournée ou de travers : lis-la dans le bon sens.
`.trim();
