<p align="center">
  <img src="public/og-image.png" alt="PharmAgent — l'IA lit le bon de livraison, vous validez, l'agent saisit." width="640">
</p>

<h1 align="center">PharmAgent</h1>

<p align="center">
  Saisie des bons de livraison en officine, pour l'Afrique de l'Ouest.<br>
  <a href="https://pharmagent.onrender.com">pharmagent.onrender.com</a>
</p>

---

## Le problème

Dans une officine, chaque livraison arrive avec un bon de livraison papier. Quelqu'un
le saisit à la main dans le logiciel de gestion : désignation, numéro de lot, quantité,
prix, date de péremption, ligne après ligne. Sur un bon de trente lignes, c'est une
demi-heure prise sur le comptoir — et une faute de frappe fausse le stock pour des mois.

## Ce que fait PharmAgent

1. **L'IA lit le bon de livraison** — photo ou fichier — et en tire les lignes.
2. **Le pharmacien relit et approuve** dans l'application. Rien ne part sans lui.
3. **Agent Floki, installé sur le poste de l'officine, saisit dans l'ERP** — le vrai,
   celui que la pharmacie utilise déjà, par son écran habituel.

## Le garde-fou

> **L'agent ne valide, ne confirme, ne clôture jamais.**

Il remplit l'écran de réception, puis s'arrête. Il ne clique jamais sur Valider,
Confirmer, Clôturer, Soumettre, Enregistrer définitivement, Commander ni Payer. Il
reconnaît ces boutons, les marque comme interdits, et le pharmacien peut le vérifier
lui-même à l'écran avant la première saisie.

Ce n'est pas une intention : c'est une règle vérifiée par les tests à chaque
modification, sur sept machines. **La décision reste au pharmacien, toujours.**

## Ce que l'agent refuse de faire

Un agent qui devine est plus dangereux qu'un agent qui s'arrête. Celui-ci refuse et le
dit, plutôt que d'écrire quelque chose de faux :

| Situation | Ce qu'il fait |
|---|---|
| Le produit n'est pas au catalogue de l'ERP | Il refuse la ligne et la nomme. Il ne choisit jamais un médicament voisin. |
| Le dosage ou la forme ne correspondent pas | Il refuse. *Amoxicilline 500 mg gélule* n'est pas *Doxycycline 100 mg gélule*. |
| Deux articles conviennent également | Il refuse. Il ne tire pas à pile ou face. |
| Le fournisseur n'est pas dans la liste de l'ERP | Il laisse vide plutôt que de rattacher la livraison au mauvais grossiste. |
| L'ERP demande une connexion | Il n'écrit rien et explique quoi faire. |
| Le bon est déjà saisi | Il refuse, pour ne pas compter les médicaments en double. |
| Une saisie a été interrompue | Il reprend où il s'était arrêté, sans resaisir ce qui est déjà là. |
| Un total ou une TVA | Il n'y touche pas : c'est l'ERP qui calcule, le pharmacien qui vérifie. |

## Ce qu'il sait faire seul

- **Reconnaître l'écran de réception** de n'importe quel ERP, en français comme en anglais.
- **Apprendre les colonnes muettes.** Une colonne sans intitulé ? Il devine d'après la
  forme du champ, écrit, relit, et ne retient que si l'ERP a bien repris la valeur.
- **Relire ce qu'il a écrit** et signaler tout champ que l'ERP affiche autrement.
- **Se dépanner.** Un bouton « Un problème ? » relit son journal, répare ce qui est sans
  risque et explique le reste en français. Rien ne sort de l'officine.
- **Se montrer.** Un bouton « Démonstration » remplit un ERP d'exemple sans toucher au
  vrai : de quoi convaincre en rendez-vous avant d'installer.

## Installation en officine

Un installateur par système, qui vérifie son propre travail : il refuse de se déclarer
terminé tant qu'il n'a pas vu un navigateur démarrer.

La marche à suivre complète tient sur une page :
**[fiche d'installation](https://pharmagent.onrender.com/install/fiche)**, à imprimer et
à laisser au titulaire.

## Comment c'est vérifié

À chaque modification, sur **sept machines** — Mac Intel ancien, Mac récent, PC Windows
ancien, PC Windows récent, Linux, plus une installation Windows complète de bout en bout :

- l'appariement des médicaments, dont sept cas qui **doivent** être refusés ;
- le remplissage de trois ERP volontairement très différents, croisés avec dix bons de
  livraison, confrontés case par case au bon d'origine ;
- la reprise d'une saisie interrompue, sans doublon ;
- l'apprentissage d'une colonne sans intitulé, et son oubli si le pharmacien le demande ;
- le garde-fou, à chaque test.

```bash
npm install && npm run dev       # application
python3 tests/matrice_erp.py     # trois ERP × dix bons
python3 tests/product_match.py   # appariement des médicaments
```

## Configuration du serveur

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Lecture des bons de livraison. Obligatoire. |
| `DATABASE_URL` | PostgreSQL. Sans elle, stockage dans un fichier local. |
| `PHARMAGENT_OWNER_PASSWORD` | Mot de passe du compte superviseur. Sinon tiré au hasard et affiché dans les journaux au premier démarrage. |
| `PHARMAGENT_PHARMACY_DEFAULT_PASSWORD` | Mot de passe initial des comptes d'officine. |
| `PHARMAGENT_AUTH_SECRET` | Signature des sessions. Généré automatiquement. |
| `PHARMAGENT_SUPPORT_NOM` | Qui appeler, affiché sur la fiche et dans l'agent. |
| `PHARMAGENT_SUPPORT_TEL` | Numéro d'assistance. **Tenu hors du dépôt, qui est public.** |
| `PHARMAGENT_SUPPORT_MAIL` | Adresse d'assistance, même raison. |

## Pile technique

Node et TypeScript côté serveur, React et Vite côté interface, PostgreSQL pour les
données. L'agent local est un fichier Python unique qui pilote un navigateur par
Playwright et se met à jour tout seul.

---

<br>

**Dr. O. Sow**

Pour toute demande, voir les coordonnées d'assistance dans l'application.

© 2026 — Tous droits réservés. Voir [LICENSE](LICENSE).
