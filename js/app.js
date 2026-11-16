/**
 * Calibre-Web PWA - Main Application Controller
 * Handles routing, view switching, book card rendering, search debounce, modals, and PWA installation.
 */

const CalibreApp = (function () {
  'use strict';

  // Application state
  const state = {
    currentTab: 'books',
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
    selectedFormat: null, // string (e.g. 'EPUB', 'PDF')
    sortBy: 'timestamp_desc',
    viewMode: 'grid',    // 'grid' or 'list'
    theme: 'theme-dark',  // 'theme-dark', 'theme-light', 'theme-sepia'
    selectedBookId: null
  };

  // Debounce helper
  function debounce(fn, delay = 250) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Format file sizes
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Render rating stars
  function renderStars(rating) {
    if (!rating) return '';
    // Calibre ratings are usually 0, 2, 4, 6, 8, 10 (corresponding to 0 to 5 stars)
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
    setupTheme();
    setupPwaInstall();
    setupDialogDismissFallbacks();
    setupEventListeners();

    // Check saved view mode
    const savedMode = await CalibreStorage.getSetting('view_mode', 'grid');
    setViewMode(savedMode, false);

    // Try initializing DB from IndexedDB
    updateDbStatusBadge('Initialisation...', 'badge-loading');

    try {
      const dbStatus = await CalibreDB.init();

      if (dbStatus.loaded) {
        updateDbStatusBadge(`${dbStatus.name} chargé`, 'badge-success');
        refreshStats();
        loadBooks(true);
      } else {
        updateDbStatusBadge('Aucune base chargée', 'badge-warning');
        showEmptyLibraryBanner();
      }
    } catch (err) {
      console.error('Erreur initialisation CalibreDB:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur initialisation : ' + err.message, 'error');
    }

    // Register Service Worker for offline PWA
    registerServiceWorker();
  }

  /**
   * Service Worker Registration
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
   * Setup PWA Installation handling according to modern web guidance:
   * Uses navigator.install() if supported, falls back to beforeinstallprompt event.
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
   * Setup Dialog light-dismiss fallback for browsers not supporting closedby
   */
  function setupDialogDismissFallbacks() {
    const dialogs = document.querySelectorAll('dialog');
    dialogs.forEach((dialog) => {
      if (!('closedBy' in HTMLDialogElement.prototype)) {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isContent = (
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width
          );
          if (isContent) return;
          dialog.close();
        });
      }
    });
  }

  /**
   * Setup UI Event Listeners
   */
  function setupEventListeners() {
    // Bottom Navigation tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const targetTab = tab.dataset.tab;
        switchTab(targetTab);
      });
    });

    // Search bar
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('search-clear-btn');

    searchInput.addEventListener('input', debounce((e) => {
      state.searchQuery = e.target.value.trim();
      clearSearchBtn.hidden = !state.searchQuery;
      loadBooks(true);
    }, 250));

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.hidden = true;
      loadBooks(true);
    });

    // Sort selector
    const sortSelect = document.getElementById('sort-select');
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      loadBooks(true);
    });

    // View mode toggle (grid / list)
    document.getElementById('btn-view-grid').addEventListener('click', () => setViewMode('grid'));
    document.getElementById('btn-view-list').addEventListener('click', () => setViewMode('list'));

    // Theme toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', cycleTheme);

    // Infinite scroll on window
    window.addEventListener('scroll', () => {
      if (state.currentTab !== 'books' || state.isLoading || !state.hasMore) return;
      const scrollPosition = window.innerHeight + window.scrollY;
      const threshold = document.body.offsetHeight - 500;
      if (scrollPosition >= threshold) {
        loadMoreBooks();
      }
    });

    // Database Actions:
    // 1. Single file input (metadata.db)
    const fileDbInput = document.getElementById('input-file-db');
    fileDbInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleDbFileImport(file);
      fileDbInput.value = '';
    });

    // 2. Folder picker (showDirectoryPicker or webkitdirectory)
    const btnPickFolder = document.getElementById('btn-pick-folder');
    btnPickFolder.addEventListener('click', handleFolderPick);

    const inputFolder = document.getElementById('input-folder');
    inputFolder.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      await handleFolderFiles(files);
      inputFolder.value = '';
    });

    // 3. Demo database loader
    document.getElementById('btn-load-demo').addEventListener('click', loadDemoDatabase);

    // 4. Export database
    document.getElementById('btn-export-db').addEventListener('click', exportDatabase);

    // 5. Clear storage
    document.getElementById('btn-clear-db').addEventListener('click', clearLibrary);

    // Book Detail Modal Buttons
    document.getElementById('modal-close-btn').addEventListener('click', () => {
      document.getElementById('book-detail-dialog').close();
    });

    document.getElementById('modal-read-epub-btn').addEventListener('click', readCurrentBook);
    document.getElementById('modal-read-pdf-btn').addEventListener('click', readCurrentBookPdf);
    document.getElementById('modal-share-btn').addEventListener('click', shareCurrentBook);

    // Book file association
    const inputBookFile = document.getElementById('input-associate-file');
    inputBookFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !state.selectedBookId) return;
      await associateBookFile(state.selectedBookId, file);
      inputBookFile.value = '';
    });
  }

  /**
   * Switch active tab
   */
  function switchTab(tabName) {
    state.currentTab = tabName;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab sections
    document.querySelectorAll('.tab-section').forEach((section) => {
      section.classList.toggle('active', section.id === `section-${tabName}`);
    });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Load data for the active tab
    if (tabName === 'books') {
      if (state.books.length === 0 && CalibreDB.isLoaded()) {
        loadBooks(true);
      }
    } else if (tabName === 'authors') {
      loadAuthorsList();
    } else if (tabName === 'series') {
      loadSeriesList();
    } else if (tabName === 'tags') {
      loadTagsList();
    } else if (tabName === 'settings') {
      refreshStorageInfo();
    }
  }

  /**
   * Set View Mode (grid vs list)
   */
  function setViewMode(mode, save = true) {
    state.viewMode = mode;
    const container = document.getElementById('books-container');
    container.classList.toggle('view-mode-grid', mode === 'grid');
    container.classList.toggle('view-mode-list', mode === 'list');

    document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
    document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');

    if (save) {
      CalibreStorage.setSetting('view_mode', mode);
    }
  }

  /**
   * Theme Setup & Switcher
   */
  async function setupTheme() {
    const savedTheme = await CalibreStorage.getSetting('app_theme', 'theme-dark');
    state.theme = savedTheme;
    document.documentElement.className = savedTheme;
  }

  function cycleTheme() {
    const themes = ['theme-dark', 'theme-light', 'theme-sepia'];
    const curIdx = themes.indexOf(state.theme);
    const nextTheme = themes[(curIdx + 1) % themes.length];
    state.theme = nextTheme;
    document.documentElement.className = nextTheme;
    CalibreStorage.setSetting('app_theme', nextTheme);
    showToast(`Thème changé : ${nextTheme.replace('theme-', '')}`, 'info');
  }

  /**
   * Update active filter chips
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

    // Update book counter header
    const counterEl = document.getElementById('books-count-header');
    if (counterEl) {
      counterEl.textContent = `${state.totalBooks.toLocaleString('fr-FR')} livres`;
    }

    // Render new book items
    renderBookCards(res.books);

    state.isLoading = false;
    document.getElementById('loading-indicator').hidden = true;

    // Show empty state if total === 0
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
   * Render book cards into DOM
   */
  async function renderBookCards(booksList) {
    const container = document.getElementById('books-container');

    for (const book of booksList) {
      const card = document.createElement('article');
      card.className = 'book-card';
      card.dataset.bookId = book.id;

      // Cover container
      const coverWrapper = document.createElement('div');
      coverWrapper.className = 'book-cover-wrapper';

      const img = document.createElement('img');
      img.className = 'book-cover-img';
      img.alt = `Couverture de ${book.title}`;
      img.loading = 'lazy';

      // Load cover URL asynchronously
      CalibreDB.getCoverUrl(book).then((url) => {
        img.src = url;
      });

      coverWrapper.appendChild(img);

      // Series badge overlay if part of series
      if (book.series) {
        const seriesBadge = document.createElement('span');
        seriesBadge.className = 'book-badge-series';
        seriesBadge.textContent = `#${book.series_index}`;
        coverWrapper.appendChild(seriesBadge);
      }

      // Format badges overlay (EPUB, PDF...)
      if (book.formats && book.formats.length > 0) {
        const fmtsBadge = document.createElement('span');
        fmtsBadge.className = 'book-badge-formats';
        fmtsBadge.textContent = book.formats[0];
        coverWrapper.appendChild(fmtsBadge);
      }

      // Metadata info
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

      // Open detail on click
      card.addEventListener('click', () => {
        openBookDetail(book.id);
      });

      container.appendChild(card);
    }
  }

  /**
   * Open Book Details Sheet / Modal
   */
  async function openBookDetail(bookId) {
    state.selectedBookId = Number(bookId);
    const dialog = document.getElementById('book-detail-dialog');
    const details = CalibreDB.getBookDetails(bookId);
    if (!details) return;

    // Fill modal fields
    document.getElementById('modal-book-title').textContent = details.title;
    document.getElementById('modal-book-author').textContent = details.authors.map(a => a.name).join(', ') || details.author_sort || 'Auteur inconnu';

    const seriesRow = document.getElementById('modal-series-row');
    if (details.series && details.series.length > 0) {
      seriesRow.hidden = false;
      document.getElementById('modal-book-series').textContent = `${details.series.map(s => s.name).join(', ')} (Livre ${details.series_index})`;
    } else {
      seriesRow.hidden = true;
    }

    const ratingRow = document.getElementById('modal-rating-row');
    if (details.rating) {
      ratingRow.hidden = false;
      document.getElementById('modal-book-rating').innerHTML = renderStars(details.rating);
    } else {
      ratingRow.hidden = true;
    }

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
        badge.addEventListener('click', () => {
          dialog.close();
          filterByTag(tag.id, tag.name);
        });
        tagsContainer.appendChild(badge);
      });
      tagsContainer.parentElement.hidden = false;
    } else {
      tagsContainer.parentElement.hidden = true;
    }

    // Synopsis / Comment
    const commentEl = document.getElementById('modal-book-comment');
    if (details.comment) {
      commentEl.innerHTML = details.comment;
      commentEl.hidden = false;
    } else {
      commentEl.innerHTML = '<em>Aucune description disponible pour ce livre.</em>';
      commentEl.hidden = false;
    }

    // Cover image
    const coverImg = document.getElementById('modal-book-cover');
    coverImg.src = await CalibreDB.getCoverUrl(details);

    // Check available files (EPUB, PDF...)
    const btnReadEpub = document.getElementById('modal-read-epub-btn');
    const btnReadPdf = document.getElementById('modal-read-pdf-btn');
    const btnShare = document.getElementById('modal-share-btn');
    const fileStatusText = document.getElementById('modal-file-status');

    btnReadEpub.hidden = true;
    btnReadPdf.hidden = true;
    btnShare.hidden = true;

    // Check if book has EPUB or PDF blob available
    const epubBlobInfo = await CalibreDB.getBookBlob(bookId, 'EPUB');
    const pdfBlobInfo = await CalibreDB.getBookBlob(bookId, 'PDF');

    if (epubBlobInfo) {
      btnReadEpub.hidden = false;
      btnShare.hidden = false;
      fileStatusText.textContent = `Fichier EPUB disponible (${formatBytes(epubBlobInfo.blob.size)})`;
      fileStatusText.className = 'status-available';
    } else if (pdfBlobInfo) {
      btnReadPdf.hidden = false;
      btnShare.hidden = false;
      fileStatusText.textContent = `Fichier PDF disponible (${formatBytes(pdfBlobInfo.blob.size)})`;
      fileStatusText.className = 'status-available';
    } else {
      const formatsInDb = details.dataFiles.map(d => d.format).join(', ');
      if (formatsInDb) {
        fileStatusText.textContent = `Formats enregistrés : ${formatsInDb}. Fichier non encore chargé sur l'appareil.`;
      } else {
        fileStatusText.textContent = `Aucun fichier ebook associé.`;
      }
      fileStatusText.className = 'status-missing';
    }

    dialog.showModal();
  }

  /**
   * Read current book in EPUB reader
   */
  async function readCurrentBook() {
    if (!state.selectedBookId) return;
    const fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'EPUB');
    if (!fileInfo) {
      showToast('Fichier EPUB non disponible. Veuillez associer le fichier.', 'warning');
      return;
    }

    const details = CalibreDB.getBookDetails(state.selectedBookId);
    document.getElementById('book-detail-dialog').close();
    CalibreReader.open(state.selectedBookId, fileInfo.blob, details.title);
  }

  /**
   * Read current book PDF
   */
  async function readCurrentBookPdf() {
    if (!state.selectedBookId) return;
    const fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'PDF');
    if (!fileInfo) {
      showToast('Fichier PDF non disponible.', 'warning');
      return;
    }

    // Open PDF via object URL
    const url = URL.createObjectURL(fileInfo.blob);
    window.open(url, '_blank');
  }

  /**
   * Share book file with external Android reading apps (Moon+, ReadEra, etc.)
   */
  async function shareCurrentBook() {
    if (!state.selectedBookId) return;
    let fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'EPUB');
    if (!fileInfo) fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'PDF');
    if (!fileInfo) return;

    const details = CalibreDB.getBookDetails(state.selectedBookId);
    const file = new File([fileInfo.blob], fileInfo.filename, { type: fileInfo.blob.type || 'application/epub+zip' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: details.title,
          text: `Lire ${details.title} par ${details.authors.map(a => a.name).join(', ')}`
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Erreur partage:', err);
      }
    } else {
      // Fallback: trigger download
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
      // Refresh details modal
      openBookDetail(bookId);
      // Refresh card formats
      loadBooks(true);
    } catch (err) {
      console.error('Erreur association fichier:', err);
      showToast('Erreur association : ' + err.message, 'error');
    }
  }

  /**
   * Filter helpers
   */
  function filterByAuthor(id, name) {
    state.selectedAuthor = { id, name };
    switchTab('books');
    loadBooks(true);
  }

  function filterBySeries(id, name) {
    state.selectedSeries = { id, name };
    switchTab('books');
    loadBooks(true);
  }

  function filterByTag(id, name) {
    state.selectedTag = { id, name };
    switchTab('books');
    loadBooks(true);
  }

  function filterByFormat(format) {
    state.selectedFormat = format;
    switchTab('books');
    loadBooks(true);
  }

  /**
   * Load Authors tab
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
      item.addEventListener('click', () => filterByAuthor(a.id, a.name));
      container.appendChild(item);
    });
  }

  /**
   * Load Series tab
   */
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
        <span class="item-count-badge">${s.book_count} livre${s.book_count > 1 ? 's' : ''}</span>
      `;
      item.addEventListener('click', () => filterBySeries(s.id, s.name));
      container.appendChild(item);
    });
  }

  /**
   * Load Tags tab
   */
  function loadTagsList() {
    const container = document.getElementById('tags-list-container');
    const tags = CalibreDB.getTags({ limit: 200 });

    container.innerHTML = '';
    if (!tags.length) {
      container.innerHTML = '<div class="empty-list">Aucun tag trouvé.</div>';
      return;
    }

    tags.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'list-item-row';
      item.innerHTML = `
        <span class="item-name">${t.name}</span>
        <span class="item-count-badge">${t.book_count} livre${t.book_count > 1 ? 's' : ''}</span>
      `;
      item.addEventListener('click', () => filterByTag(t.id, t.name));
      container.appendChild(item);
    });
  }

  /**
   * Handle single metadata.db file upload
   */
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

      // Persist in IndexedDB
      await CalibreStorage.saveMetadataDB(buffer, file.name);

      updateDbStatusBadge(`${file.name} chargé`, 'badge-success');
      showToast(`Base ${file.name} chargée et enregistrée sur votre smartphone !`, 'success');
      refreshStats();
      switchTab('books');
      loadBooks(true);
    } catch (err) {
      console.error('Erreur import base:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur lors du chargement : ' + err.message, 'error');
    }
  }

  /**
   * Handle Calibre directory pick (showDirectoryPicker or fallback)
   */
  async function handleFolderPick() {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({
          mode: 'read',
          startIn: 'documents'
        });

        updateDbStatusBadge('Analyse du dossier...', 'badge-loading');
        showToast('Lecture du dossier Calibre...', 'info');

        const filesCount = await CalibreDB.registerDirectoryHandle(dirHandle);

        // Check if metadata.db is in the folder
        const dbResult = await CalibreDB.findMetadataDbInMap();
        if (dbResult) {
          CalibreDB.loadFromArrayBuffer(dbResult.buffer, 'metadata.db');
          await CalibreStorage.saveMetadataDB(dbResult.buffer, 'metadata.db');
          updateDbStatusBadge('Dossier Calibre connecté', 'badge-success');
          showToast(`Bibliothèque connectée ! ${filesCount} fichiers indexés.`, 'success');
          refreshStats();
          switchTab('books');
          loadBooks(true);
        } else {
          showToast('metadata.db non trouvé à la racine du dossier.', 'warning');
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Erreur showDirectoryPicker:', err);
          // Fallback to webkitdirectory file input
          document.getElementById('input-folder').click();
        }
      }
    } else {
      // Trigger fallback input
      document.getElementById('input-folder').click();
    }
  }

  async function handleFolderFiles(files) {
    updateDbStatusBadge('Analyse des fichiers...', 'badge-loading');
    showToast('Indexation des fichiers du dossier...', 'info');

    try {
      const count = CalibreDB.registerFileList(files);
      const dbResult = await CalibreDB.findMetadataDbInMap();

      if (dbResult) {
        CalibreDB.loadFromArrayBuffer(dbResult.buffer, 'metadata.db');
        await CalibreStorage.saveMetadataDB(dbResult.buffer, 'metadata.db');
        updateDbStatusBadge('Dossier Calibre connecté', 'badge-success');
        showToast(`Dossier connecté ! ${count} fichiers détectés.`, 'success');
        refreshStats();
        switchTab('books');
        loadBooks(true);
      } else {
        showToast('metadata.db introuvable dans les fichiers sélectionnés.', 'warning');
      }
    } catch (err) {
      console.error('Erreur lecture fichiers dossier:', err);
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  /**
   * Load bundled demo database
   */
  async function loadDemoDatabase() {
    updateDbStatusBadge('Chargement démo...', 'badge-loading');
    showToast('Chargement de la bibliothèque de démonstration...', 'info');

    try {
      const resp = await fetch('./sample-metadata.db');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      CalibreDB.loadFromArrayBuffer(buffer, 'sample-metadata.db');
      await CalibreStorage.saveMetadataDB(buffer, 'sample-metadata.db');

      updateDbStatusBadge('Démo chargée', 'badge-success');
      showToast('Bibliothèque d\'exemple chargée avec succès !', 'success');
      refreshStats();
      switchTab('books');
      loadBooks(true);
    } catch (err) {
      console.error('Erreur démo:', err);
      showToast('Impossible de charger la démo : ' + err.message, 'error');
    }
  }

  /**
   * Export current metadata.db file
   */
  function exportDatabase() {
    try {
      const data = CalibreDB.export();
      const blob = new Blob([data], { type: 'application/x-sqlite3' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = CalibreDB.getDbName() || 'metadata.db';
      a.click();
      showToast('Export de la base téléchargé.', 'success');
    } catch (err) {
      showToast('Erreur export : ' + err.message, 'error');
    }
  }

  /**
   * Reset / Clear local library
   */
  async function clearLibrary() {
    if (!confirm('Voulez-vous vraiment effacer la base de données et les fichiers locaux du smartphone ?')) {
      return;
    }

    try {
      await CalibreStorage.clearAll();
      CalibreDB.close();
      updateDbStatusBadge('Aucune base chargée', 'badge-warning');
      state.books = [];
      state.totalBooks = 0;
      document.getElementById('books-container').innerHTML = '';
      showEmptyLibraryBanner();
      refreshStats();
      showToast('Stockage local réinitialisé.', 'info');
    } catch (err) {
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  /**
   * Refresh Stats Display
   */
  function refreshStats() {
    const stats = CalibreDB.getStats();
    if (!stats) return;

    const statsEl = document.getElementById('stats-summary');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card">
          <div class="stat-number">${stats.books.toLocaleString('fr-FR')}</div>
          <div class="stat-label">Livres</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.authors.toLocaleString('fr-FR')}</div>
          <div class="stat-label">Auteurs</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.series.toLocaleString('fr-FR')}</div>
          <div class="stat-label">Séries</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.tags.toLocaleString('fr-FR')}</div>
          <div class="stat-label">Tags</div>
        </div>
      `;
    }
  }

  /**
   * Refresh Storage Usage info in settings
   */
  async function refreshStorageInfo() {
    refreshStats();
    const infoEl = document.getElementById('storage-usage-info');
    if (!infoEl) return;

    try {
      const estimate = await CalibreStorage.getStorageEstimate();
      const dbSaved = await CalibreStorage.getMetadataDB();
      const files = await CalibreStorage.getAllBookFiles();

      const usageMb = (estimate.usage / (1024 * 1024)).toFixed(1);
      const quotaMb = (estimate.quota / (1024 * 1024)).toFixed(0);

      infoEl.innerHTML = `
        <p><strong>Fichier DB actif :</strong> ${CalibreDB.getDbName() || 'Aucun'}</p>
        <p><strong>Taille de la base :</strong> ${dbSaved ? formatBytes(dbSaved.size) : '0 B'}</p>
        <p><strong>Livres stockés hors-ligne :</strong> ${files.length} fichiers</p>
        <p><strong>Espace navigateur utilisé :</strong> ${usageMb} Mo sur ${quotaMb} Mo alloués</p>
      `;
    } catch (e) {
      infoEl.textContent = 'Impossible de calculer l\'espace de stockage.';
    }
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
        <h2>Bienvenue sur Calibre-Web PWA</h2>
        <p>Pour commencer à parcourir vos livres sur votre smartphone :</p>
        <div class="empty-state-actions">
          <button class="btn btn-primary" onclick="document.getElementById('input-file-db').click()">
            🗄️ Charger un fichier metadata.db
          </button>
          <button class="btn btn-secondary" onclick="CalibreApp.handleFolderPick()">
            📁 Sélectionner le dossier Calibre
          </button>
          <button class="btn btn-ghost" onclick="CalibreApp.loadDemoDatabase()">
            🚀 Essayer avec la bibliothèque exemple
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

  // Public API
  return {
    init,
    switchTab,
    handleFolderPick,
    loadDemoDatabase,
    filterByAuthor,
    filterBySeries,
    filterByTag,
    filterByFormat
  };
})();

// Bootstrap app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  CalibreApp.init();
});
