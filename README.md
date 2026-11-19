# PharmAgent

Plateforme de supervision multi-officines et assistant d'entrée en stock pharmaceutique
(vision IA Gemini + garde-fou « Brouillon » : l'agent ne valide jamais définitivement).

Stack : React 19 + Vite + Tailwind (PWA), serveur Express (`server.ts`), agent local Python (`backend-fastapi/`).

## Démarrage

Prérequis : Node.js ≥ 22.12.

```bash
npm install
cp .env.example .env.local   # puis renseigner GEMINI_API_KEY
npm run dev                  # http://localhost:3000
```

Au premier démarrage, les mots de passe provisoires (propriétaire et officines) sont **générés
aléatoirement et affichés dans la console**. Pour les fixer, définir `PHARMAGENT_OWNER_PASSWORD`
et `PHARMAGENT_PHARMACY_DEFAULT_PASSWORD`. Changez-les à la première connexion.

## Production

```bash
npm run build
npm start        # NODE_ENV=production, sert dist/ + API
```

Les données sont stockées dans `data/` (ignoré par git) : prévoir un volume persistant en hébergement.

## Scripts

| Script | Rôle |
|---|---|
| `npm run dev` | Serveur + Vite en développement |
| `npm run build` | Build de production |
| `npm start` | Serveur en mode production |
| `npm run lint` | Vérification TypeScript |

Voir aussi `GUIDE_MAC_ET_PC.md` pour l'installation de l'agent de bureau.
