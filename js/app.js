/**
 * Calibre-Web NextGen PWA - Main Application Controller
 * Handles NextGen Smart Shelves, Local Directory configuration in Settings,
 * Author & Series detail views, Custom Shelves, and Android PWA installation.
 */

const CalibreApp = (function () {
  'use strict';

  // Application State
  const state = {
    currentTab: 'home',
    books: [],
    totalBooks: 0,
    page: 0,
    pageSize: 24,
    isLoading: false,
    hasMore: true,
    searchQuery: '',
    selectedAuthor: null, // { id, name }
    selectedSeries: null, // { id, name }
    selectedTag: null,    // { id, name }
    selectedFormat: null, // string
    currentShelfId: null, // custom shelf ID
    sortBy: 'timestamp_desc',
    viewMode: 'grid',    // 'grid' or 'list'
    theme: 'dark',        // 'dark', 'light', 'sepia'
    selectedBookId: null
  };

  function debounce(fn, delay = 250) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderStars(rating) {
    if (!rating) return '';
    const stars = Math.round(rating / 2);
    let str = '';
    for (let i = 1; i <= 5; i++) {
      str += i <= stars ? '★' : '☆';
    }
    return `<span class="rating-stars" aria-label="${stars} étoiles sur 5">${str}</span>`;
  }

  /**
   * Initialize Application
   */
  async function init() {
    await setupTheme();
    setupPwaInstall();
    setupDialogDismissFallbacks();
    setupEventListeners();

    const savedMode = await CalibreStorage.getSetting('view_mode', 'grid');
    setViewMode(savedMode, false);

    updateDbStatusBadge('Initialisation...', 'badge-loading');

    try {
      const initResult = await CalibreDB.init();

      if (initResult.loaded) {
        updateDbStatusBadge(`${initResult.name} chargé`, 'badge-success');
        refreshStats();
        // Load default view
        switchTab('home');
      } else {
        updateDbStatusBadge('Aucune base chargée', 'badge-warning');
        switchTab('settings');
      }

      // Update Local Directory status display in Settings
      updateLocalDirectoryUI();

    } catch (err) {
      console.error('Erreur initialisation CalibreDB:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur initialisation : ' + err.message, 'error');
    }

    registerServiceWorker();
  }

  /**
   * Service Worker for offline PWA
   */
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('ServiceWorker enregistré avec succès, scope:', reg.scope);
            reg.onupdatefound = () => {
              const installing = reg.installing;
              installing.onstatechange = () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  showToast('Nouvelle version disponible ! Rafraîchissez pour mettre à jour.', 'info');
                }
              };
            };
          })
          .catch((err) => {
            console.warn('Enregistrement ServiceWorker échoué:', err);
          });
      });
    }
  }

  /**
   * Setup PWA Installation handling according to modern web guidance
   */
  function setupPwaInstall() {
    const installBtn = document.getElementById('btn-install-app');
    const supportsWebInstall = typeof Navigator.prototype.install === 'function';
    let deferredInstallPrompt = null;

    if (supportsWebInstall) {
      installBtn.hidden = false;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!supportsWebInstall) {
        installBtn.hidden = false;
      }
    });

    installBtn.addEventListener('click', async () => {
      if (installBtn.getAttribute('aria-disabled') === 'true') {
        return;
      }
      installBtn.setAttribute('aria-disabled', 'true');

      try {
        if (supportsWebInstall) {
          await navigator.install();
          showToast('Application installée avec succès !', 'success');
          installBtn.hidden = true;
        } else if (deferredInstallPrompt) {
          const promptEvent = deferredInstallPrompt;
          deferredInstallPrompt = null;
          await promptEvent.prompt();
          const { outcome } = await promptEvent.userChoice;

          if (outcome === 'accepted') {
            showToast('Application installée sur votre smartphone !', 'success');
          }
          if (!deferredInstallPrompt) {
            installBtn.hidden = true;
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // User canceled
        } else {
          console.error('Erreur installation PWA:', err);
          showToast("L'installation n'a pas pu démarrer.", 'error');
        }
      } finally {
        installBtn.removeAttribute('aria-disabled');
      }
    });

    window.addEventListener('appinstalled', () => {
      installBtn.hidden = true;
      showToast('Application installée sur votre appareil !', 'success');
    });
  }

  /**
   * Dialog light-dismiss fallback
   */
  function setupDialogDismissFallbacks() {
    const dialogs = document.querySelectorAll('dialog');
    dialogs.forEach((dialog) => {
      // Light-dismiss click on backdrop
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      });

      // Prevent clicks inside modal card from bubbling and triggering dismiss
      const innerCard = dialog.querySelector('.modal-content-card, .reader-container');
      if (innerCard) {
        innerCard.addEventListener('click', (event) => {
          event.stopPropagation();
        });
      }
    });
  }

  /**
   * Setup UI Event Listeners
   */
  function setupEventListeners() {
    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
      });
    });

    // Search bar
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('search-clear-btn');

    searchInput.addEventListener('input', debounce((e) => {
      state.searchQuery = e.target.value.trim();
      clearSearchBtn.hidden = !state.searchQuery;
      if (state.currentTab !== 'books') {
        switchTab('books');
      } else {
        loadBooks(true);
      }
    }, 250));

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.hidden = true;
      loadBooks(true);
    });

    // Sort selector
    document.getElementById('sort-select').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      loadBooks(true);
    });

    // View mode toggle
    document.getElementById('btn-view-grid').addEventListener('click', () => setViewMode('grid'));
    document.getElementById('btn-view-list').addEventListener('click', () => setViewMode('list'));

    // Theme toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', cycleTheme);

    // Infinite scroll
    window.addEventListener('scroll', () => {
      if (state.currentTab !== 'books' || state.isLoading || !state.hasMore) return;
      const scrollPosition = window.innerHeight + window.scrollY;
      const threshold = document.body.offsetHeight - 500;
      if (scrollPosition >= threshold) {
        loadMoreBooks();
      }
    });

    // Local Directory Settings Handlers
    document.getElementById('btn-define-local-dir').addEventListener('click', defineLocalDirectory);
    document.getElementById('btn-rescan-local-dir').addEventListener('click', rescanLocalDirectory);
    document.getElementById('btn-disconnect-local-dir').addEventListener('click', disconnectLocalDirectory);

    // Hidden folder input for fallback
    const inputFolderFallback = document.getElementById('input-folder-fallback');
    inputFolderFallback.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      const res = CalibreDB.registerFileList(files);
      showToast(`Dossier local associé ! ${res.epubsCount} EPUBs indexés.`, 'success');
      updateLocalDirectoryUI();
      inputFolderFallback.value = '';
    });

    // Database Actions
    const fileDbInput = document.getElementById('input-file-db');
    fileDbInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleDbFileImport(file);
      fileDbInput.value = '';
    });

    document.getElementById('btn-load-demo').addEventListener('click', loadDemoDatabase);
    document.getElementById('btn-export-db').addEventListener('click', exportDatabase);
    document.getElementById('btn-clear-db').addEventListener('click', clearLibrary);

    // Shelves Actions
    document.getElementById('btn-create-shelf').addEventListener('click', promptCreateShelf);

    // Book Detail Modal Buttons
    const modalCloseBtn = document.getElementById('modal-close-btn');
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('book-detail-dialog').close();
      });
    }

    document.getElementById('modal-read-epub-btn').addEventListener('click', readCurrentBook);
    document.getElementById('modal-share-btn').addEventListener('click', shareCurrentBook);
    document.getElementById('modal-add-shelf-btn').addEventListener('click', openAddToShelfDialog);

    // Reading Status Selector
    document.getElementById('modal-reading-status-select').addEventListener('change', async (e) => {
      if (!state.selectedBookId) return;
      const newStatus = e.target.value;
      await CalibreStorage.setReadingStatus(state.selectedBookId, newStatus);
      showToast(`Statut mis à jour : ${newStatus === 'read' ? 'Terminé' : newStatus === 'reading' ? 'En cours' : 'Non lu'}`, 'success');
      if (state.currentTab === 'home') loadMagicShelves();
    });

    // Book file manual association
    const inputBookFile = document.getElementById('input-associate-file');
    inputBookFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !state.selectedBookId) return;
      await associateBookFile(state.selectedBookId, file);
      inputBookFile.value = '';
    });
  }

  /**
   * Switch Active Tab
   */
  function switchTab(tabName) {
    state.currentTab = tabName;

    // Update bottom nav tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update sections
    document.querySelectorAll('.tab-section').forEach((section) => {
      section.classList.toggle('active', section.id === `section-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'instant' });

    if (tabName === 'home') {
      loadMagicShelves();
    } else if (tabName === 'books') {
      loadBooks(true);
    } else if (tabName === 'shelves') {
      loadShelvesView();
    } else if (tabName === 'authors') {
      loadAuthorsList();
    } else if (tabName === 'series') {
      loadSeriesList();
    } else if (tabName === 'settings') {
      refreshStorageInfo();
      updateLocalDirectoryUI();
    }
  }

  /**
   * Local Directory Settings Management
   */
  async function defineLocalDirectory() {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({
          mode: 'read',
          startIn: 'documents'
        });

        showToast('Indexation du dossier local...', 'info');
        const res = await CalibreDB.setLocalDirectoryHandle(dirHandle);

        showToast(`Dossier connecté ! ${res.epubsCount} EPUBs détectés.`, 'success');
        updateLocalDirectoryUI();

        if (res.hasMetadataDb) {
          updateDbStatusBadge('metadata.db connecté', 'badge-success');
          refreshStats();
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Erreur showDirectoryPicker:', err);
          document.getElementById('input-folder-fallback').click();
        }
      }
    } else {
      document.getElementById('input-folder-fallback').click();
    }
  }

  async function rescanLocalDirectory() {
    const dirInfo = CalibreDB.getLocalDirectoryInfo();
    if (!dirInfo.handle) {
      showToast('Aucun dossier local sélectionné.', 'warning');
      return;
    }

    // Re-verify permission if needed
    if (dirInfo.status === 'needs_permission') {
      const granted = await CalibreDB.requestDirectoryPermission();
      if (!granted) {
        showToast('Permission d\'accès refusée.', 'error');
        updateLocalDirectoryUI();
        return;
      }
    }

    showToast('Ré-indexation des fichiers locaux...', 'info');
    await CalibreDB.scanDirectoryHandle(dirInfo.handle);
    const updated = CalibreDB.getLocalDirectoryInfo();
    showToast(`Indexation terminée : ${updated.epubsCount} EPUBs locaux trouvés.`, 'success');
    updateLocalDirectoryUI();
  }

  async function disconnectLocalDirectory() {
    if (!confirm('Voulez-vous déconnecter le dossier local des livres ?')) return;
    await CalibreDB.removeLocalDirectory();
    updateLocalDirectoryUI();
    showToast('Dossier local déconnecté.', 'info');
  }

  function updateLocalDirectoryUI() {
    const info = CalibreDB.getLocalDirectoryInfo();
    const card = document.getElementById('local-dir-card');
    const statusBadge = document.getElementById('dir-status-badge');
    const pathDisplay = document.getElementById('dir-path-display');
    const countDisplay = document.getElementById('dir-epubs-count');
    const btnRescan = document.getElementById('btn-rescan-local-dir');
    const btnDisconnect = document.getElementById('btn-disconnect-local-dir');

    if (info.status === 'connected') {
      card.className = 'local-dir-card connected';
      statusBadge.textContent = 'Connecté';
      statusBadge.className = 'status-badge badge-success';
      pathDisplay.textContent = info.name || 'Dossier Calibre';
      countDisplay.textContent = `${info.epubsCount.toLocaleString('fr-FR')} EPUBs indexés`;
      btnRescan.hidden = false;
      btnDisconnect.hidden = false;
    } else if (info.status === 'needs_permission') {
      card.className = 'local-dir-card';
      statusBadge.textContent = 'Autorisation requise';
      statusBadge.className = 'status-badge badge-warning';
      pathDisplay.textContent = `${info.name} (Cliquez sur Ré-indexer pour autoriser)`;
      countDisplay.textContent = 'En attente d\'autorisation';
      btnRescan.hidden = false;
      btnDisconnect.hidden = false;
    } else {
      card.className = 'local-dir-card';
      statusBadge.textContent = 'Non configuré';
      statusBadge.className = 'status-badge badge-warning';
      pathDisplay.textContent = 'Aucun répertoire local défini pour les livres';
      countDisplay.textContent = '0 EPUBs';
      btnRescan.hidden = true;
      btnDisconnect.hidden = true;
    }
  }

  /**
   * Load NextGen Magic Shelves (Dashboard)
   */
  async function loadMagicShelves() {
    if (!CalibreDB.isLoaded()) {
      showEmptyLibraryBanner();
      return;
    }

    // 1. Continue Reading (Livres en cours)
    const continueBooks = await CalibreDB.getMagicShelfBooks('continue_reading', 12);
    renderShelfRow('shelf-continue-reading', continueBooks, '📖 En cours de lecture');

    // 2. Recently Added (Nouveautés)
    const recentBooks = await CalibreDB.getMagicShelfBooks('recently_added', 16);
    renderShelfRow('shelf-recently-added', recentBooks, '✨ Récemment ajoutés');

    // 3. Top Rated (Mieux notés)
    const topBooks = await CalibreDB.getMagicShelfBooks('top_rated', 16);
    renderShelfRow('shelf-top-rated', topBooks, '⭐ Les mieux notés');

    // 4. Random / Discover (Découverte)
    const randomBooks = await CalibreDB.getMagicShelfBooks('random', 16);
    renderShelfRow('shelf-random', randomBooks, '🎲 Découverte au hasard');
  }

  function renderShelfRow(containerId, booksList, title) {
    const section = document.getElementById(containerId);
    if (!section) return;

    if (!booksList.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const scrollContainer = section.querySelector('.magic-shelf-scroll');
    scrollContainer.innerHTML = '';

    for (const book of booksList) {
      const card = createBookCardElement(book);
      scrollContainer.appendChild(card);
    }
  }

  /**
   * Create standard NextGen Book Card Element
   */
  function createBookCardElement(book) {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.dataset.bookId = book.id;

    const coverWrapper = document.createElement('div');
    coverWrapper.className = 'book-cover-wrapper';

    const img = document.createElement('img');
    img.className = 'book-cover-img';
    img.alt = `Couverture de ${book.title}`;
    img.loading = 'lazy';

    CalibreDB.getCoverUrl(book).then((url) => {
      img.src = url;
    });

    coverWrapper.appendChild(img);

    if (book.series) {
      const seriesBadge = document.createElement('span');
      seriesBadge.className = 'book-badge-series';
      seriesBadge.textContent = `#${book.series_index}`;
      coverWrapper.appendChild(seriesBadge);
    }

    if (book.formats && book.formats.length > 0) {
      const fmtsBadge = document.createElement('span');
      fmtsBadge.className = 'book-badge-formats';
      fmtsBadge.textContent = book.formats[0];
      coverWrapper.appendChild(fmtsBadge);
    }

    // Check reading progress for overlay bar
    CalibreStorage.getProgress(book.id).then((prog) => {
      if (prog && prog.percentage > 0) {
        const bar = document.createElement('div');
        bar.className = 'book-progress-bar-cover';
        bar.innerHTML = `<div class="book-progress-fill" style="width: ${prog.percentage}%"></div>`;
        coverWrapper.appendChild(bar);
      }
    });

    const info = document.createElement('div');
    info.className = 'book-info';

    const title = document.createElement('h3');
    title.className = 'book-title';
    title.textContent = book.title;

    const author = document.createElement('p');
    author.className = 'book-author';
    author.textContent = book.authors;

    info.appendChild(title);
    info.appendChild(author);

    if (book.rating) {
      const ratingEl = document.createElement('div');
      ratingEl.className = 'book-rating';
      ratingEl.innerHTML = renderStars(book.rating);
      info.appendChild(ratingEl);
    }

    card.appendChild(coverWrapper);
    card.appendChild(info);

    card.addEventListener('click', () => {
      openBookDetail(book.id);
    });

    return card;
  }

  /**
   * Load books into the books view
   */
  async function loadBooks(reset = false) {
    if (!CalibreDB.isLoaded()) {
      showEmptyLibraryBanner();
      return;
    }

    if (reset) {
      state.page = 0;
      state.books = [];
      state.hasMore = true;
      document.getElementById('books-container').innerHTML = '';
    }

    state.isLoading = true;
    updateFilterChips();
    document.getElementById('loading-indicator').hidden = false;

    const offset = state.page * state.pageSize;
    const res = CalibreDB.getBooks({
      search: state.searchQuery,
      authorId: state.selectedAuthor ? state.selectedAuthor.id : null,
      seriesId: state.selectedSeries ? state.selectedSeries.id : null,
      tagId: state.selectedTag ? state.selectedTag.id : null,
      format: state.selectedFormat,
      sortBy: state.sortBy,
      offset: offset,
      limit: state.pageSize
    });

    state.totalBooks = res.total;
    state.books = state.books.concat(res.books);
    state.hasMore = state.books.length < state.totalBooks;

    const counterEl = document.getElementById('books-count-header');
    if (counterEl) {
      counterEl.textContent = `${state.totalBooks.toLocaleString('fr-FR')} livres`;
    }

    const container = document.getElementById('books-container');
    for (const book of res.books) {
      container.appendChild(createBookCardElement(book));
    }

    state.isLoading = false;
    document.getElementById('loading-indicator').hidden = true;

    const emptyEl = document.getElementById('no-books-found');
    if (emptyEl) {
      emptyEl.hidden = state.totalBooks > 0;
    }
  }

  function loadMoreBooks() {
    if (state.isLoading || !state.hasMore) return;
    state.page++;
    loadBooks(false);
  }

  /**
   * Open Book Details Modal
   */
  async function openBookDetail(bookId) {
    state.selectedBookId = Number(bookId);
    const dialog = document.getElementById('book-detail-dialog');
    if (!dialog) return;

    const details = CalibreDB.getBookDetails(bookId);
    if (!details) {
      console.warn('Livre introuvable dans la base Calibre:', bookId);
      showToast('Détails du livre indisponibles.', 'warning');
      return;
    }

    // 1. Populate basic metadata synchronously
    document.getElementById('modal-book-title').textContent = details.title || 'Sans titre';
    const authorsStr = (details.authors && details.authors.length > 0)
      ? details.authors.map(a => (a.name || a.sort || '').replace(/\|/g, ', ')).join(', ')
      : (details.author_sort || 'Auteur inconnu');
    document.getElementById('modal-book-author').textContent = authorsStr;

    // Series row & series navigation
    const seriesRow = document.getElementById('modal-series-row');
    const seriesNav = document.getElementById('modal-series-nav');
    if (details.series && details.series.length > 0) {
      seriesRow.hidden = false;
      document.getElementById('modal-book-series').textContent = `${details.series.map(s => s.name).join(', ')} (Tome ${details.series_index})`;

      if (details.seriesNavigation && (details.seriesNavigation.prev || details.seriesNavigation.next)) {
        seriesNav.hidden = false;
        seriesNav.innerHTML = '';

        if (details.seriesNavigation.prev) {
          const prevBtn = document.createElement('button');
          prevBtn.type = 'button';
          prevBtn.className = 'series-nav-btn';
          prevBtn.textContent = `‹ Tome ${details.seriesNavigation.prev.index}`;
          prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookDetail(details.seriesNavigation.prev.id);
          });
          seriesNav.appendChild(prevBtn);
        } else {
          seriesNav.appendChild(document.createElement('span'));
        }

        const seriesTitle = document.createElement('span');
        seriesTitle.textContent = details.seriesNavigation.seriesName;
        seriesNav.appendChild(seriesTitle);

        if (details.seriesNavigation.next) {
          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'series-nav-btn';
          nextBtn.textContent = `Tome ${details.seriesNavigation.next.index} ›`;
          nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookDetail(details.seriesNavigation.next.id);
          });
          seriesNav.appendChild(nextBtn);
        } else {
          seriesNav.appendChild(document.createElement('span'));
        }
      } else {
        seriesNav.hidden = true;
      }
    } else {
      seriesRow.hidden = true;
      seriesNav.hidden = true;
    }

    // Rating
    const ratingRow = document.getElementById('modal-rating-row');
    if (details.rating) {
      ratingRow.hidden = false;
      document.getElementById('modal-book-rating').innerHTML = renderStars(details.rating);
    } else {
      ratingRow.hidden = true;
    }

    // Publisher
    const pubRow = document.getElementById('modal-pub-row');
    if (details.publishers && details.publishers.length > 0) {
      pubRow.hidden = false;
      document.getElementById('modal-book-publisher').textContent = details.publishers.map(p => p.name).join(', ');
    } else {
      pubRow.hidden = true;
    }

    // Tags
    const tagsContainer = document.getElementById('modal-tags-container');
    tagsContainer.innerHTML = '';
    if (details.tags && details.tags.length > 0) {
      details.tags.forEach((tag) => {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'tag-badge';
        badge.textContent = tag.name;
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          dialog.close();
          filterByTag(tag.id, tag.name);
        });
        tagsContainer.appendChild(badge);
      });
      tagsContainer.parentElement.hidden = false;
    } else {
      tagsContainer.parentElement.hidden = true;
    }

    // Synopsis
    const commentEl = document.getElementById('modal-book-comment');
    if (details.comment) {
      commentEl.innerHTML = details.comment;
    } else {
      commentEl.innerHTML = '<em>Aucune description disponible pour ce livre.</em>';
    }

    // Immediate placeholder cover
    const coverImg = document.getElementById('modal-book-cover');
    coverImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="100%" height="100%" fill="%231a232e"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="14">Couverture...</text></svg>';

    // Immediate initial buttons state
    const btnReadEpub = document.getElementById('modal-read-epub-btn');
    const btnShare = document.getElementById('modal-share-btn');
    const fileStatusText = document.getElementById('modal-file-status');
    btnReadEpub.hidden = true;
    btnShare.hidden = true;
    fileStatusText.textContent = 'Vérification du fichier EPUB...';
    fileStatusText.className = 'status-checking';

    // 2. Open modal IMMEDIATELY: zero latency!
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }

    // 3. Asynchronously load Reading Status
    CalibreStorage.getReadingStatus(bookId).then((currentStatus) => {
      if (state.selectedBookId === Number(bookId)) {
        document.getElementById('modal-reading-status-select').value = currentStatus;
      }
    }).catch(console.warn);

    // 4. Asynchronously load Cover URL
    CalibreDB.getCoverUrl(details).then((url) => {
      if (state.selectedBookId === Number(bookId) && url) {
        coverImg.src = url;
      }
    }).catch(console.warn);

    // 5. Asynchronously check EPUB availability
    CalibreDB.getBookBlob(bookId, 'EPUB').then((epubBlobInfo) => {
      if (state.selectedBookId !== Number(bookId)) return;

      if (epubBlobInfo) {
        btnReadEpub.hidden = false;
        btnShare.hidden = false;
        const originText = epubBlobInfo.source === 'local_dir' ? 'dossier local' : epubBlobInfo.source === 'indexeddb' ? 'stockage PWA' : 'démo';
        fileStatusText.textContent = `✓ Fichier EPUB disponible (${formatBytes(epubBlobInfo.blob.size || 0)} - source : ${originText})`;
        fileStatusText.className = 'status-available';
      } else {
        const formatsInDb = (details.dataFiles || []).map(d => d.format).join(', ');
        fileStatusText.textContent = formatsInDb
          ? `Formats Calibre : ${formatsInDb}. Fichier non trouvé dans le dossier local défini.`
          : `Aucun fichier ebook associé.`;
        fileStatusText.className = 'status-missing';
      }
    }).catch((err) => {
      console.warn('Erreur vérification EPUB:', err);
      if (state.selectedBookId === Number(bookId)) {
        fileStatusText.textContent = 'Fichier non trouvé dans le dossier local.';
        fileStatusText.className = 'status-missing';
      }
    });
  }

  /**
   * Read current book in EPUB reader
   */
  async function readCurrentBook() {
    if (!state.selectedBookId) return;
    const fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'EPUB');
    if (!fileInfo) {
      showToast('Fichier EPUB non disponible. Vérifiez le dossier local dans les Paramètres.', 'warning');
      return;
    }

    const details = CalibreDB.getBookDetails(state.selectedBookId);
    document.getElementById('book-detail-dialog').close();
    CalibreReader.open(state.selectedBookId, fileInfo.blob, details.title);
  }

  /**
   * Share book file with external Android reading apps
   */
  async function shareCurrentBook() {
    if (!state.selectedBookId) return;
    const fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'EPUB');
    if (!fileInfo) return;

    const details = CalibreDB.getBookDetails(state.selectedBookId);
    const file = new File([fileInfo.blob], fileInfo.filename, { type: 'application/epub+zip' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: details.title,
          text: `Lire ${details.title}`
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Erreur partage:', err);
      }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(fileInfo.blob);
      a.download = fileInfo.filename;
      a.click();
      showToast('Téléchargement du livre lancé.', 'info');
    }
  }

  /**
   * Associate an uploaded ebook file to a book record
   */
  async function associateBookFile(bookId, file) {
    const ext = file.name.split('.').pop().toUpperCase();
    try {
      await CalibreStorage.saveBookFile(bookId, ext, file, file.name);
      showToast(`Fichier ${ext} associé avec succès !`, 'success');
      openBookDetail(bookId);
      loadBooks(true);
    } catch (err) {
      console.error('Erreur association fichier:', err);
      showToast('Erreur association : ' + err.message, 'error');
    }
  }

  /**
   * Shelves View & Management
   */
  async function loadShelvesView() {
    const container = document.getElementById('shelves-list-container');
    container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div></div>';

    const shelves = await CalibreStorage.getShelves();
    container.innerHTML = '';

    if (!shelves.length) {
      container.innerHTML = '<div class="empty-state-card"><p>Aucune étagère créée.</p></div>';
      return;
    }

    shelves.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'list-item-row';
      item.innerHTML = `
        <span class="item-name"><span aria-hidden="true">${s.icon || '📚'}</span> ${s.name}</span>
        <span class="item-count-badge">${s.bookIds.length} livre${s.bookIds.length > 1 ? 's' : ''}</span>
      `;
      item.addEventListener('click', () => openShelfDetail(s));
      container.appendChild(item);
    });
  }

  async function openShelfDetail(shelf) {
    state.currentShelfId = shelf.id;
    const books = CalibreDB.getBooksByIds(shelf.bookIds);

    document.getElementById('shelf-detail-title').textContent = `${shelf.icon || '📚'} ${shelf.name}`;
    document.getElementById('shelf-detail-desc').textContent = shelf.description || '';
    const booksContainer = document.getElementById('shelf-books-container');
    booksContainer.innerHTML = '';

    if (!books.length) {
      booksContainer.innerHTML = '<p style="color: var(--text-muted); padding: 16px;">Cette étagère est vide. Ajoutez-y des livres depuis leur fiche détaillée !</p>';
    } else {
      for (const book of books) {
        booksContainer.appendChild(createBookCardElement(book));
      }
    }

    document.getElementById('shelves-main-view').hidden = true;
    document.getElementById('shelf-detail-view').hidden = false;
  }

  function closeShelfDetail() {
    document.getElementById('shelf-detail-view').hidden = true;
    document.getElementById('shelves-main-view').hidden = false;
    loadShelvesView();
  }

  async function promptCreateShelf() {
    const name = prompt('Nom de la nouvelle étagère :');
    if (!name || !name.trim()) return;
    const desc = prompt('Description (optionnelle) :') || '';
    await CalibreStorage.createShelf(name.trim(), desc.trim());
    showToast(`Étagère « ${name.trim()} » créée !`, 'success');
    loadShelvesView();
  }

  async function openAddToShelfDialog() {
    if (!state.selectedBookId) return;
    const shelves = await CalibreStorage.getShelves();
    const shelfNames = shelves.map((s, idx) => `${idx + 1}. ${s.name}`).join('\n');
    const choice = prompt(`Ajouter à quelle étagère ?\n${shelfNames}\nEntrez le numéro :`);
    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= shelves.length) {
      const targetShelf = shelves[num - 1];
      await CalibreStorage.addBookToShelf(targetShelf.id, state.selectedBookId);
      showToast(`Livre ajouté à « ${targetShelf.name} » !`, 'success');
    }
  }

  /**
   * Authors & Series detail views
   */
  function loadAuthorsList() {
    const container = document.getElementById('authors-list-container');
    const authors = CalibreDB.getAuthors({ limit: 200 });

    container.innerHTML = '';
    if (!authors.length) {
      container.innerHTML = '<div class="empty-list">Aucun auteur trouvé.</div>';
      return;
    }

    authors.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'list-item-row';
      item.innerHTML = `
        <span class="item-name">${a.name}</span>
        <span class="item-count-badge">${a.book_count} livre${a.book_count > 1 ? 's' : ''}</span>
      `;
      item.addEventListener('click', () => openAuthorDetail(a.id));
      container.appendChild(item);
    });
  }

  function openAuthorDetail(authorId) {
    const details = CalibreDB.getAuthorDetails(authorId);
    if (!details) return;

    document.getElementById('author-detail-name').textContent = details.name;
    document.getElementById('author-detail-count').textContent = `${details.totalBooks} livre${details.totalBooks > 1 ? 's' : ''}`;
    const container = document.getElementById('author-books-container');
    container.innerHTML = '';

    for (const book of details.books) {
      container.appendChild(createBookCardElement(book));
    }

    document.getElementById('authors-main-view').hidden = true;
    document.getElementById('author-detail-view').hidden = false;
  }

  function closeAuthorDetail() {
    document.getElementById('author-detail-view').hidden = true;
    document.getElementById('authors-main-view').hidden = false;
  }

  function loadSeriesList() {
    const container = document.getElementById('series-list-container');
    const series = CalibreDB.getSeries({ limit: 200 });

    container.innerHTML = '';
    if (!series.length) {
      container.innerHTML = '<div class="empty-list">Aucune série trouvée.</div>';
      return;
    }

    series.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'list-item-row';
      item.innerHTML = `
        <span class="item-name">${s.name}</span>
        <span class="item-count-badge">${s.book_count} tome${s.book_count > 1 ? 's' : ''}</span>
      `;
      item.addEventListener('click', () => openSeriesDetail(s.id));
      container.appendChild(item);
    });
  }

  function openSeriesDetail(seriesId) {
    const details = CalibreDB.getSeriesDetails(seriesId);
    if (!details) return;

    document.getElementById('series-detail-name').textContent = details.name;
    document.getElementById('series-detail-count').textContent = `${details.totalBooks} tomes`;
    const container = document.getElementById('series-books-container');
    container.innerHTML = '';

    for (const book of details.books) {
      container.appendChild(createBookCardElement(book));
    }

    document.getElementById('series-main-view').hidden = true;
    document.getElementById('series-detail-view').hidden = false;
  }

  function closeSeriesDetail() {
    document.getElementById('series-detail-view').hidden = true;
    document.getElementById('series-main-view').hidden = false;
  }

  function filterByTag(id, name) {
    state.selectedTag = { id, name };
    switchTab('books');
    loadBooks(true);
  }

  /**
   * Filter Chips
   */
  function updateFilterChips() {
    const container = document.getElementById('active-filters');
    container.innerHTML = '';
    const chips = [];

    if (state.selectedAuthor) {
      chips.push({
        label: `Auteur: ${state.selectedAuthor.name}`,
        onRemove: () => { state.selectedAuthor = null; loadBooks(true); }
      });
    }

    if (state.selectedSeries) {
      chips.push({
        label: `Série: ${state.selectedSeries.name}`,
        onRemove: () => { state.selectedSeries = null; loadBooks(true); }
      });
    }

    if (state.selectedTag) {
      chips.push({
        label: `Tag: ${state.selectedTag.name}`,
        onRemove: () => { state.selectedTag = null; loadBooks(true); }
      });
    }

    if (state.selectedFormat) {
      chips.push({
        label: `Format: ${state.selectedFormat}`,
        onRemove: () => { state.selectedFormat = null; loadBooks(true); }
      });
    }

    chips.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = `${c.label} <button type="button" aria-label="Supprimer le filtre">×</button>`;
      chip.querySelector('button').addEventListener('click', c.onRemove);
      container.appendChild(chip);
    });

    container.hidden = chips.length === 0;
  }

  function setViewMode(mode, save = true) {
    state.viewMode = mode;
    const container = document.getElementById('books-container');
    container.classList.toggle('view-mode-grid', mode === 'grid');
    container.classList.toggle('view-mode-list', mode === 'list');

    document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
    document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');

    if (save) CalibreStorage.setSetting('view_mode', mode);
  }

  async function setupTheme() {
    const savedTheme = await CalibreStorage.getSetting('app_theme', 'dark');
    state.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function cycleTheme() {
    const themes = ['dark', 'light', 'sepia'];
    const curIdx = themes.indexOf(state.theme);
    const nextTheme = themes[(curIdx + 1) % themes.length];
    state.theme = nextTheme;
    document.documentElement.setAttribute('data-theme', nextTheme);
    CalibreStorage.setSetting('app_theme', nextTheme);
    showToast(`Thème : ${nextTheme === 'dark' ? 'NextGen CaliBlur' : nextTheme === 'light' ? 'Clair' : 'Sépia'}`, 'info');
  }

  async function handleDbFileImport(file) {
    if (!file.name.toLowerCase().endsWith('.db')) {
      showToast('Veuillez sélectionner un fichier .db (ex: metadata.db)', 'error');
      return;
    }

    updateDbStatusBadge('Chargement...', 'badge-loading');
    showToast('Lecture de la base de données...', 'info');

    try {
      const buffer = await file.arrayBuffer();
      CalibreDB.loadFromArrayBuffer(buffer, file.name);
      await CalibreStorage.saveMetadataDB(buffer, file.name);

      updateDbStatusBadge(`${file.name} chargé`, 'badge-success');
      showToast(`Base ${file.name} enregistrée sur votre smartphone !`, 'success');
      refreshStats();
      switchTab('home');
    } catch (err) {
      console.error('Erreur import base:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  async function loadDemoDatabase() {
    updateDbStatusBadge('Chargement...', 'badge-loading');
    showToast('Chargement de la bibliothèque d\'exemple...', 'info');

    try {
      const resp = await fetch('./sample-metadata.db');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      CalibreDB.loadFromArrayBuffer(buffer, 'sample-metadata.db');
      await CalibreStorage.saveMetadataDB(buffer, 'sample-metadata.db');

      updateDbStatusBadge('Démo chargée', 'badge-success');
      showToast('Bibliothèque d\'exemple prête !', 'success');
      refreshStats();
      switchTab('home');
    } catch (err) {
      showToast('Erreur démo : ' + err.message, 'error');
    }
  }

  function exportDatabase() {
    try {
      const data = CalibreDB.export();
      const blob = new Blob([data], { type: 'application/x-sqlite3' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = CalibreDB.getDbName() || 'metadata.db';
      a.click();
      showToast('Export téléchargé.', 'success');
    } catch (err) {
      showToast('Erreur export : ' + err.message, 'error');
    }
  }

  async function clearLibrary() {
    if (!confirm('Voulez-vous réinitialiser le stockage local ?')) return;
    await CalibreStorage.clearAll();
    CalibreDB.close();
    updateDbStatusBadge('Aucune base chargée', 'badge-warning');
    updateLocalDirectoryUI();
    showToast('Stockage local réinitialisé.', 'info');
    switchTab('settings');
  }

  function refreshStats() {
    const stats = CalibreDB.getStats();
    if (!stats) return;

    const statsEl = document.getElementById('stats-summary');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-number">${stats.books.toLocaleString('fr-FR')}</div><div class="stat-label">Livres</div></div>
        <div class="stat-card"><div class="stat-number">${stats.authors.toLocaleString('fr-FR')}</div><div class="stat-label">Auteurs</div></div>
        <div class="stat-card"><div class="stat-number">${stats.series.toLocaleString('fr-FR')}</div><div class="stat-label">Séries</div></div>
        <div class="stat-card"><div class="stat-number">${stats.tags.toLocaleString('fr-FR')}</div><div class="stat-label">Tags</div></div>
      `;
    }
  }

  async function refreshStorageInfo() {
    refreshStats();
    const infoEl = document.getElementById('storage-usage-info');
    if (!infoEl) return;

    try {
      const estimate = await CalibreStorage.getStorageEstimate();
      const dbSaved = await CalibreStorage.getMetadataDB();
      const usageMb = (estimate.usage / (1024 * 1024)).toFixed(1);
      const quotaMb = (estimate.quota / (1024 * 1024)).toFixed(0);

      infoEl.innerHTML = `
        <p><strong>Base active :</strong> ${CalibreDB.getDbName() || 'Aucune'}</p>
        <p><strong>Taille base :</strong> ${dbSaved ? formatBytes(dbSaved.size) : '0 B'}</p>
        <p><strong>Stockage navigateur utilisé :</strong> ${usageMb} Mo sur ${quotaMb} Mo</p>
      `;
    } catch (e) {}
  }

  function updateDbStatusBadge(text, className) {
    const badge = document.getElementById('db-status-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = `status-badge ${className}`;
  }

  function showEmptyLibraryBanner() {
    const container = document.getElementById('books-container');
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">📚</div>
        <h2>Calibre-Web NextGen PWA</h2>
        <p>Configurez votre bibliothèque pour commencer à lire vos livres hors-ligne :</p>
        <div class="empty-state-actions">
          <button class="btn btn-primary" onclick="CalibreApp.defineLocalDirectory()">
            📁 Définir le dossier local des livres
          </button>
          <button class="btn btn-secondary" onclick="document.getElementById('input-file-db').click()">
            🗄️ Charger metadata.db
          </button>
          <button class="btn btn-ghost" onclick="CalibreApp.loadDemoDatabase()">
            🚀 Essayer la bibliothèque exemple
          </button>
        </div>
      </div>
    `;
  }

  function showToast(message, type = 'info') {
    const toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast toast-${type} show`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toast.className = 'toast';
    }, 3200);
  }

  return {
    init,
    switchTab,
    defineLocalDirectory,
    rescanLocalDirectory,
    disconnectLocalDirectory,
    loadDemoDatabase,
    openBookDetail,
    closeShelfDetail,
    closeAuthorDetail,
    closeSeriesDetail,
    filterByTag
  };
})();

// Attach globally to window
window.CalibreApp = CalibreApp;

document.addEventListener('DOMContentLoaded', () => {
  CalibreApp.init();
});
