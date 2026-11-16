# 📚 Calibre-Web PWA - Version Mobile Android 100% Hors-ligne

Une Progressive Web App (PWA) moderne, réactive et autonome, conçue pour faire fonctionner votre bibliothèque **Calibre** directement sur votre smartphone **Android**, sans nécessiter de serveur en arrière-plan ni de connexion Internet.

Elle utilise directement le fichier **`metadata.db`** au format Calibre SQLite, stocké et exécuté en local sur votre appareil grâce à **WebAssembly (sql.js)** et **IndexedDB**.

🔗 **Accès direct & Installation en ligne (GitHub Pages) :**
👉 **[https://olepicard.github.io/calibre-pwa/](https://olepicard.github.io/calibre-pwa/)**

---

## 🌟 Points Forts

- 📱 **PWA Installable sur Android** : S'installe comme une application native depuis Google Chrome / Brave / Edge (icône sur l'écran d'accueil, affichage plein écran sans barre d'adresse).
- 📴 **100% Hors-ligne (Offline First)** : Le Service Worker met en cache tous les scripts, styles, polices et le moteur WebAssembly. Fonctionne même en mode avion.
- ⚡ **Moteur SQLite WebAssembly ultra-rapide** : Exécute des requêtes SQL natives directement dans le navigateur du smartphone. Testé avec succès sur des bibliothèques de plus de **35 000 livres**.
- 💾 **Persistance locale dans le smartphone** : Le fichier `metadata.db` et vos livres associés sont sauvegardés dans l'IndexedDB du téléphone. Vous ne le chargez qu'une seule fois !
- 📖 **Lecteur EPUB intégré (tactile)** :
  - Navigation par balayage tactile (*swipe* gauche/droite pour tourner les pages)
  - Thèmes de lecture : Sombre, Clair, Sépia, Noir OLED
  - Réglage de la taille de texte (A- / A+)
  - Table des matières dynamique (sommaire)
  - Sauvegarde automatique de la progression de lecture (reprise exacte là où vous vous êtes arrêté)
- 📲 **Intégration Android (Web Share API)** : Possibilité d'ouvrir et de partager vos ebooks directement dans vos liseuses Android préférées (*ReadEra*, *Moon+ Reader*, *FBReader*...).
- 🎨 **Interface Calibre-Web soignée** :
  - Barre de navigation mobile en bas de l'écran (Livres, Auteurs, Séries, Tags, Paramètres)
  - Mode Grille (avec couvertures) ou Liste compacte
  - Recherche instantanée avec filtre intelligent
  - Générateur automatique de couvertures élégantes si les fichiers d'image ne sont pas présents

---

## 📂 Structure des Fichiers

```
calibre-web-master/pwa/
├── index.html              # Interface principale PWA
├── manifest.webmanifest    # Configuration PWA Android (icônes, standalone, couleurs)
├── sw.js                   # Service Worker pour le cache hors-ligne
├── icon.png                # Icône HD 800x800
├── favicon.ico             # Favicon
├── sample-metadata.db      # Base d'exemple Calibre prête à l'emploi
├── serve.py                # Petit serveur Python pour tester sur PC & smartphone
├── css/
│   └── app.css             # Styles CSS modernes et responsive Android
├── js/
│   ├── app.js              # Contrôleur principal et logique UI
│   ├── calibre-db.js       # Moteur SQLite Calibre et gestionnaire de fichiers
│   ├── storage.js          # Couche IndexedDB pour la persistance locale
│   └── reader-epub.js      # Lecteur EPUB tactile autonome (epub.js)
└── lib/
    ├── sql-wasm.js         # Wrapper JS SQLite WebAssembly
    ├── sql-wasm.wasm       # Binaire WebAssembly SQLite
    ├── jszip.min.js        # Décompression ZIP/EPUB
    └── epub.min.js         # Moteur de rendu EPUB
```

---

## 🚀 Démarrage Rapide

### 1. Lancer le serveur local depuis votre PC

Dans le dossier `calibre-web-master/pwa`, exécutez simplement :

```powershell
python serve.py
```

Le script affichera deux adresses :
- Sur votre PC : `http://localhost:8080`
- Sur votre smartphone connecté au même Wi-Fi : `http://192.168.x.x:8080`

### 2. Ouvrir et installer sur Android

1. Sur votre smartphone Android, ouvrez **Google Chrome** et saisissez l'adresse Wi-Fi (ex: `http://192.168.1.50:8080`).
2. Cliquez sur le bouton **📲 Installer** dans l'en-tête, ou ouvrez le menu de Chrome (les 3 points verticaux en haut à droite) et sélectionnez **"Installer l'application"** ou **"Ajouter à l'écran d'accueil"**.
3. L'icône **Calibre-Web** apparaît sur l'écran d'accueil de votre smartphone.
4. Une fois installée, l'application fonctionne même sans le serveur PC et sans connexion Internet !

---

## 🗄️ Comment charger votre `metadata.db` sur le smartphone ?

Trois options sont à votre disposition dans l'onglet **Stockage / Paramètres** :

1. **Option A : Charger le fichier `metadata.db` seul**
   - Transférez votre fichier `metadata.db` de votre PC vers votre smartphone (via câble USB, Google Drive, Bluetooth ou téléchargement).
   - Dans la PWA, cliquez sur **"🗄️ Charger metadata.db"** et sélectionnez le fichier dans vos Téléchargements ou documents.
   - La base de données est instantanément importée dans l'espace sécurisé du navigateur (IndexedDB). Vous pouvez maintenant explorer l'ensemble de votre catalogue (auteurs, séries, résumés, dates, etc.).

2. **Option B : Sélectionner le dossier complet de votre bibliothèque Calibre**
   - Si vous avez copié votre dossier Calibre sur votre smartphone ou carte SD (ex: `/Stockage interne/Livres/Calibre/`), cliquez sur **"📁 Sélectionner le dossier Calibre"**.
   - La PWA détecte automatiquement `metadata.db` à la racine ET associe directement toutes les couvertures (`cover.jpg`) et tous les fichiers ebooks (`.epub`, `.pdf`) pour une lecture directe !

3. **Option C : Essayer la base exemple intégrée**
   - Cliquez sur **"🚀 Charger la base exemple"** pour tester instantanément l'application avec plusieurs classiques littéraires (Jules Verne, Victor Hugo, Alexandre Dumas, George Orwell...).

---

## 📖 Lecture et Gestion des Ebooks

- **Lecteur intégré** : Cliquez sur n'importe quel livre puis sur **"Lire maintenant (EPUB)"** pour ouvrir le lecteur plein écran.
- **Associer un livre spécifique** : Si vous n'avez importé que `metadata.db`, vous pouvez à tout moment cliquer sur **"📎 Associer un fichier ebook"** dans la fiche d'un livre pour y rattacher son fichier `.epub` ou `.pdf` depuis la mémoire de votre téléphone.
- **Partage vers d'autres liseuses** : Le bouton **"📲 Ouvrir dans Moon+ / ReadEra"** envoie directement le fichier du livre à l'application de votre choix installée sur votre smartphone Android.
