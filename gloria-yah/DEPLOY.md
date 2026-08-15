# GLORIA-YAH — Déploiement (PowerShell)

Architecture retenue : **backend (API + PostgreSQL) sur Render**, **frontend (3 pages HTML) sur Firebase Hosting**. Firebase seul ne supporte pas PostgreSQL/PostGIS — voir explication dans le chat.

⚠️ **Avertissement honnête** : je n'ai pas pu tester ces étapes en conditions réelles (pas d'accès réseau dans mon environnement de travail). Les interfaces de Render/Firebase peuvent avoir légèrement changé depuis ma dernière connaissance. Si une étape ne correspond pas exactement à ce que tu vois à l'écran, dis-le-moi et on ajuste ensemble.

---

## Partie A — Backend sur Render

### A1. Mettre le code sur GitHub (si ce n'est pas déjà fait)

```powershell
cd gloria-yah
git init
git add .
git commit -m "Premier déploiement GLORIA-YAH"
```

Crée un dépôt vide sur github.com (sans README), puis :

```powershell
git remote add origin https://github.com/TON-COMPTE/gloria-yah.git
git branch -M main
git push -u origin main
```

⚠️ Vérifie que `.env` n'est PAS dans ce commit (il ne doit jamais aller sur GitHub — seul `.env.example` doit y être). Si besoin :

```powershell
git rm --cached .env
echo ".env" >> .gitignore
git add .gitignore
git commit -m "Ignorer .env"
git push
```

### A2. Créer la base PostgreSQL sur Render

1. Sur render.com → **New +** → **PostgreSQL**
2. Note bien l'**Internal Database URL** et l'**External Database URL** générés.
3. Vérifie que l'extension PostGIS est activable (Render la supporte sur ses instances PostgreSQL managées — à confirmer dans leur documentation actuelle).

### A3. Créer le service Web (le backend Node.js)

1. Sur render.com → **New +** → **Web Service** → connecte ton dépôt GitHub `gloria-yah`
2. Build Command : `npm install`
3. Start Command : `npm start`
4. Dans **Environment**, ajoute les variables (mêmes noms que `.env.example`) :
   - `DATABASE_URL` = l'Internal Database URL de l'étape A2
   - `JWT_SECRET` = une valeur longue et aléatoire (génère-la, ex. avec `openssl rand -hex 32` ou un générateur en ligne)
   - `KKIAPAY_PUBLIC_KEY`, `KKIAPAY_PRIVATE_KEY`, `KKIAPAY_SECRET_KEY`, `KKIAPAY_SANDBOX=true`
5. Déploie. Render te donne une URL du type `https://gloria-yah-api.onrender.com`.

### A4. Appliquer le schéma sur la base Render

Depuis ta machine, en te connectant à la base distante :

```powershell
$env:DATABASE_URL = "COLLE_ICI_L_EXTERNAL_DATABASE_URL_DE_RENDER"
npm run db:init
```

---

## Partie B — Frontend sur Firebase Hosting

### B1. Installer les outils Firebase (une seule fois)

```powershell
npm install -g firebase-tools
firebase login
```

### B2. Pointer le frontend vers le backend Render

Édite `public/assets/config.js` :

```javascript
window.GLORIA_YAH_API_BASE = "https://gloria-yah-api.onrender.com";
```

(remplace par l'URL réelle donnée par Render à l'étape A3)

### B3. Initialiser et déployer

```powershell
cd gloria-yah
firebase init hosting
```
Réponses aux questions de l'assistant Firebase :
- "What do you want to use as your public directory?" → `public`
- "Configure as a single-page app?" → **No**
- "Set up automatic builds with GitHub?" → **No** (pour l'instant, on garde simple)
- Ne pas écraser `public/index.html` si l'assistant le demande

```powershell
firebase deploy --only hosting
```

Firebase te donne une URL du type `https://gloria-yah.web.app`.

---

## Vérification finale

1. Ouvre `https://gloria-yah.web.app` (ou l'URL Firebase donnée)
2. Fais une estimation de prix sur la page passager → si un prix s'affiche, le frontend parle bien au backend Render.
3. Si erreur "Failed to fetch" : vérifie `config.js` (bonne URL Render ?) et que le backend Render est bien "Live" (pas en train de redémarrer — le palier gratuit de Render met le service en veille après inactivité, le premier appel peut prendre 30-60s).

## Limites du palier gratuit (à connaître avant de t'y fier pour de vrais utilisateurs)

- Render (palier gratuit) : le service backend se met en veille après une période d'inactivité — premier appel lent après veille. Pas adapté à un vrai lancement public, très bien pour tester.
- Vérifie les conditions actuelles de palier gratuit PostgreSQL sur Render (elles évoluent) avant de considérer ça comme une solution à long terme.
- Pour un vrai lancement avec des chauffeurs/passagers réels, prévoir un palier payant sur les deux (backend + base de données) pour éviter les temps de réveil et les limites de stockage.
