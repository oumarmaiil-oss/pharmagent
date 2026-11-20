# Journal d'audit de sécurité — PharmAgent

Date : 20/11/2026 · Version : serveur `rebuild/v2`, agent 2.2.6
Méthode : lecture du code en attaquant (routes, authentification, fichiers, agent local, données), puis second passage automatique (`tests/attack.py`, exécuté à chaque mise à jour par la CI).

## Passage 1 — constats et corrections

| # | Gravité | Constat | Scénario d'attaque | Correction | Test |
|---|---|---|---|---|---|
| S1 | **Critique** | L'agent tapait les textes du bon tels quels, sauts de ligne compris | Un bon piégé (ou une lecture IA sur deux lignes) contient un retour à la ligne : l'agent tape **Entrée** dans l'ERP, qui peut déclencher le bouton par défaut (Valider). La règle absolue est contournée | Caractères de contrôle remplacés par des espaces, côté serveur **et** côté agent (double protection) | `agent_unit.py` |
| S2 | Élevée | Mots de passe en SHA-256 avec sel fixe | Une sauvegarde volée permet de retrouver les mots de passe en quelques minutes | scrypt avec sel aléatoire ; anciens mots de passe convertis automatiquement à la connexion | `security.test.ts` |
| S3 | Élevée | Changer ou réinitialiser un mot de passe ne coupait pas les sessions ouvertes | Un téléphone perdu ou un ancien employé reste connecté 7 jours malgré le changement | Le jeton porte une empreinte du mot de passe : tout changement déconnecte les anciennes sessions | `api_smoke.py` |
| S4 | Moyenne | Jeton de session dans l'adresse des téléchargements (`?token=`) | Le jeton se retrouve dans l'historique du navigateur et les journaux | Téléchargements par en-tête ; jeton dans l'adresse refusé | `api_smoke.py`, `attack.py` |
| S5 | Moyenne | Ancienne route de connexion par identifiant interne, inutilisée | Surface d'attaque supplémentaire | Supprimée | `api_smoke.py` |
| S6 | Moyenne | Panier CSV : un libellé commençant par `=` devient une formule Excel | Libellé piégé → formule exécutée à l'ouverture | Valeurs neutralisées (`'=`) | `orders.test.ts` |
| S7 | Moyenne | Mise à jour automatique de l'agent possible en HTTP | Interception réseau → code malveillant exécuté sur le poste | Mise à jour refusée hors HTTPS | `agent_unit.py` |
| S8 | Moyenne | Pas de politique de sécurité du contenu (CSP) ni HSTS | Une injection de script éventuelle pourrait voler la session | CSP stricte (`script-src 'self'`), HSTS, Permissions-Policy | `api_smoke.py` |
| S9 | Moyenne | Le superviseur pouvait agir sur une pharmacie supprimée | Données orphelines | Pharmacie inconnue → 404 | `api_smoke.py` |
| S10 | Faible | Le superviseur était bloqué sur les réglages Pharmacien (contraire à la règle) | — | Corrigé | `api_smoke.py` |

Vérifié sans défaut : cloisonnement entre pharmacies, signature des jetons (HMAC, comparaison en temps constant), limitation des essais de connexion et d'appairage, appairage de l'agent (code + secret), panneau local de l'agent (local uniquement, en-tête obligatoire, protection DNS rebinding, affichage échappé), chemins d'exemples (pas de sortie du dossier), taille des envois (30 Mo), adresse du serveur dans les installeurs (filtrée).

## Passage 2 — attaque automatique (`tests/attack.py`)

Résultat : **0 brèche**.
- 19 routes d'une pharmacie essayées 4 fois : par une autre pharmacie (Pharmacien et Équipe), sans compte, avec un jeton falsifié. Toutes refusées, et le brouillon visé est resté intact.
- 12 routes du superviseur essayées avec un compte Pharmacien : toutes refusées.
- Les actions réservées au Pharmacien sont refusées au compte Équipe.
- 7 routes de l'agent essayées sans clé et avec une fausse clé : toutes refusées.
- Fichiers piégés, chemin hors dossier, envoi géant, jeton dans l'adresse : tous refusés.
- Force brute : bloquée après 5 essais.

## Risques restants (à traiter avant un client payant)

1. **Signature du code de l'agent.** La mise à jour vérifie l'empreinte fournie par le serveur. Si le serveur est compromis, l'agent l'est aussi. La solution est une signature hors ligne (clé privée hors du serveur) : à faire avant le déploiement réel.
2. **Installeurs non signés** (Windows SmartScreen, macOS Gatekeeper). Il faudra un certificat Microsoft et un compte Apple Developer (99 $/an).
3. **Limitation des essais en mémoire** : elle est remise à zéro à chaque redémarrage. Suffisant pour la démo ; à mettre en base pour la production.
4. **Lecture des documents par l'IA** : un document piégé peut fausser des valeurs (« injection de consigne »). La parade est en place : validation humaine obligatoire, contrôles des totaux et des prix, agent qui ne valide jamais.
5. **Données de santé** : la démo ne doit pas recevoir de vraies ordonnances. Les ordonnances sont détectées et bloquées.
