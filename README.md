# 📚 Calibre-Web NextGen PWA - Version Mobile Android 100% Hors-ligne

Une Progressive Web App (PWA) moderne et réactive reprenant l'ensemble de l'architecture et du design **Calibre-Web NextGen ("caliBlur, elevated")**, conçue pour faire fonctionner votre bibliothèque Calibre directement sur votre smartphone **Android**, sans serveur et 100% hors-ligne.

Elle utilise directement le fichier **`metadata.db`** (format SQLite Calibre) et permet d'ouvrir et de lire vos **fichiers EPUB directement depuis un répertoire local** de votre smartphone ou PC, défini dans les **Paramètres**.

---

🔗 **Accès direct & Installation en ligne (GitHub Pages) :**  
👉 **[https://olepicard.github.io/calibre-pwa/](https://olepicard.github.io/calibre-pwa/)**

---

## 🌟 Nouvelles Fonctionnalités NextGen

- 📁 **Répertoire local des livres (EPUB) configurable dans les Paramètres** :
  - Définissez votre dossier Calibre ou dossier d'ebooks via le sélecteur de dossier natif (*File System Access API* / `showDirectoryPicker`).
  - La poignée du dossier (*DirectoryHandle*) est **conservée de manière persistante dans IndexedDB** : l'accès au dossier est mémorisé à chaque ouverture de l'application !
  - Lors de l'ouverture d'un livre, l'application résout automatiquement l'EPUB correspondant dans l'arborescence Calibre (`<Auteur>/<Titre (id)>/<fichier>.epub`) ou par indexation intelligente.
  - Compteur et statut en temps réel : nombre d'EPUBs détectés, bouton de ré-indexation en 1 clic.

- ✨ **Étagères Intelligentes (*Smart / Magic Shelves*) sur l'Accueil** :
  - **📖 Continuer la lecture** : reprend vos lectures en cours avec barre de progression de lecture sur la couverture.
  - **✨ Récemment ajoutés** : vos dernières acquisitions.
  - **⭐ Les mieux notés** : vos livres 4 et 5 étoiles.
  - **🎲 Découverte au hasard** : sélection aléatoire pour trouver de nouvelles inspirations.

- 📚 **Étagères Personnalisées (*Custom Shelves*)** :
  - Créez vos propres étagères (« Coups de cœur », « À lire cet été », « Science-fiction »).
  - Ajoutez ou retirez des livres depuis leur fiche détaillée.

- 🏷️ **Navigation par Série & Statuts de lecture** :
  - Sélecteur de statut sur chaque livre : **⚪ Non lu**, **📖 En cours**, **✓ Terminé**.
  - Navigation directe entre tomes au sein d'une série (*« ‹ Tome 1 »* / *« Tome 3 › »*).
  - Vues détaillées par Auteur et par Série classées par numéro de tome.

- 🎨 **Design Calibre-Web NextGen ("caliBlur, elevated")** :
  - Surfaces profondes ardoise-bleue (`#141c24`, `#1b2530`, `#222e3a`), séparateurs fins et texte chaud couleur papier (`#ece8e1`).
  - Touche signature ambre caliBlur (`#cc7b19`, `#e6a13f`).
  - Thèmes interchangeables : **NextGen CaliBlur (sombre)**, **Clair**, **Sépia**, **OLED Noir**.

- 📖 **Lecteur EPUB Tactile & Partage Android** :
  - Tournez les pages par balayage tactile (*swipe* gauche/droite).
  - Sommaire interactif, taille de police ajustable, mémorisation exacte de la position (CFI).
  - Bouton de partage Android (Web Share API) pour ouvrir le livre dans *ReadEra*, *Moon+ Reader*, *FBReader*, etc.

---

## 📂 Structure du Projet

```
calibre-web-master/pwa/
├── index.html              # Interface principale Calibre-Web NextGen
├── manifest.webmanifest    # Manifeste PWA Android
├── sw.js                   # Service Worker pour le cache hors-ligne
├── icon.png                # Icône haute résolution (800x800)
├── favicon.ico             # Favicon
├── sample-metadata.db      # Base Calibre SQLite d'exemple
├── sample.epub             # Ebook EPUB d'exemple pour tester immédiatement
├── serve.py                # Serveur de test local pour PC et smartphone (Wi-Fi)
├── css/
│   └── app.css             # Tokens NextGen ("caliBlur, elevated") et styles tactiles
├── js/
│   ├── app.js              # Contrôleur NextGen, Magic Shelves, gestion du dossier
│   ├── calibre-db.js       # Moteur SQLite WASM & résolution du répertoire local
│   ├── storage.js          # IndexedDB (metadata.db, DirectoryHandle, étagères, progression)
│   └── reader-epub.js      # Lecteur EPUB tactile intégré
└── lib/
    ├── sql-wasm.js         # SQLite WebAssembly
    ├── sql-wasm.wasm       # Binaire WASM SQLite
    ├── jszip.min.js        # Décompression ZIP/EPUB
    └── epub.min.js         # Moteur de rendu epub.js
```

---

## 📲 Installation sur Smartphone Android

1. Rendez-vous sur **[https://olepicard.github.io/calibre-pwa/](https://olepicard.github.io/calibre-pwa/)** depuis **Chrome** ou **Brave** sur votre smartphone.
2. Cliquez sur le bouton **« 📲 Installer »** dans l'en-tête, ou ouvrez le menu de Chrome (les **3 points verticaux**) et cliquez sur **« Installer l'application »** ou **« Ajouter à l'écran d'accueil »**.
3. L'application est installée sur votre smartphone et fonctionne **100% hors-ligne**.

---

## ⚙️ Configuration du Répertoire Local dans les Paramètres

1. Ouvrez l'application et allez dans l'onglet **⚙️ Stockage** en bas à droite.
2. Dans la section **📁 Répertoire local des livres (EPUB)** :
   - Cliquez sur **« 📁 Choisir le dossier local (EPUBs) »**.
   - Sélectionnez votre dossier de bibliothèque Calibre sur votre smartphone ou PC.
   - Le navigateur demande l'autorisation de lecture : acceptez.
   - L'application analyse l'arborescence et affiche le nombre d'EPUBs trouvés (ainsi que `metadata.db` s'il est présent à la racine).
3. Le dossier reste **connecté et mémorisé dans IndexedDB** pour les sessions futures !
4. Ouvrez n'importe quel livre : cliquez sur **« 📖 Lire maintenant (EPUB) »** pour lancer la lecture directe du fichier depuis votre dossier local.
