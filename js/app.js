/**
 * calibre PWA (Android & Desktop) - Main Application Controller
 * Faithfully implements the features and visual design of Calibre & Calibre Content Server
 * (https://calibre-ebook.com/fr/demo#screenshots) for Android smartphones:
 * - Calibre Content Server Top Bar (#34302d) & 3-Column Cover Grid
 * - Calibre Classic Iconic Action Toolbar
 * - Calibre 3D Cover Browser ("Cover Flow" with reflections)
 * - Calibre Multi-Column Sortable Table (following sortable-table guidance)
 * - Calibre Tag Browser Drawer (following navigation-drawer guidance)
 * - Virtual Library Tabs & Advanced Search Syntax (author:, tag:, format:, rating:, series:)
 * - Content Server Book Details Sheet with < / > cover navigation & clickable metadata links
 * - Exact Missing File Name & Relative Path display with 1-click Copy
 * - Live SQLite Metadata Editor & Built-in EPUB Viewer
 */

const CalibreApp = (function () {
  'use strict';

  const state = {
    currentTab: 'books',
    books: [],
    totalBooks: 0,
    page: 0,
    pageSize: 36,
    isLoading: false,
    hasMore: true,
    searchQuery: '',
    selectedAuthor: null,     // { id, name }
    selectedSeries: null,     // { id, name }
    selectedTag: null,        // { id, name }
    selectedPublisher: null,  // { id, name }
    selectedLanguage: null,   // { id, name }
    selectedRating: null,     // number (1..5)
    selectedIdentifier: null, // string
    selectedFormat: null,     // string
    currentShelfId: null,
    sortBy: 'timestamp_desc',
    viewMode: 'grid',         // 'grid' | 'table' | 'list'
    theme: 'dark',            // 'dark' | 'light' | 'sepia'
    selectedBookId: null,
    coverFlowIndex: 0,
    showCoverFlow: true,
    showActionToolbar: true,
    activeVirtualTab: 'all',
    customVirtualTabs: []     // [{ id, label, query, filters }]
  };

  let closeDrawerFn = null;
  let openDrawerFn = null;
  const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

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

  function formatDateCalibre(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return String(isoStr).slice(0, 10);
    }
  }

  function toRoman(num) {
    const n = Math.floor(Number(num) || 1);
    if (n <= 0 || n > 50) return String(num);
    const map = [
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'],
      [5, 'V'], [4, 'IV'], [1, 'I']
    ];
    let res = '';
    let rem = n;
    for (const [val, sym] of map) {
      while (rem >= val) {
        res += sym;
        rem -= val;
      }
    }
    return res;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('✓ Copié dans le presse-papier !', 'info');
      }).catch(() => {
        window.prompt('Copier le texte ci-dessous :', text);
      });
    } else {
      window.prompt('Copier le texte ci-dessous :', text);
    }
  }

  function renderMissingFileCard(details) {
    const dataFiles = (details && details.dataFiles) || [];
    const basePath = (details && details.path) || '';

    if (dataFiles.length > 0) {
      const filesHtml = dataFiles.map((d) => {
        const ext = (d.format || 'epub').toLowerCase();
        const baseName = d.name || details.title || 'livre';
        const fileName = `${baseName}.${ext}`;
        const relPath = basePath ? `${basePath}/${fileName}` : fileName;
        const sizeStr = d.size ? formatBytes(d.size) : 'Inconnue';
        const safeFileName = escapeHtml(fileName);
        const safeRelPath = escapeHtml(relPath);
        const jsFileName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const jsRelPath = relPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        return `
          <div class="status-missing-file-box">
            <div class="status-missing-row">
              <span class="status-missing-badge">${escapeHtml(d.format || ext.toUpperCase())}</span>
              <span class="status-missing-meta">Taille Calibre : <strong>${sizeStr}</strong></span>
            </div>
            <div class="status-missing-field">
              <span class="status-missing-label">Nom exact du fichier recherché :</span>
              <div class="status-code-container">
                <code class="status-code-text" title="Cliquer pour copier" onclick="CalibreApp.copyToClipboard('${jsFileName}')">${safeFileName}</code>
                <button type="button" class="btn-copy-code" title="Copier le nom du fichier" onclick="CalibreApp.copyToClipboard('${jsFileName}')">📋 Copier</button>
              </div>
            </div>
            <div class="status-missing-field">
              <span class="status-missing-label">Chemin relatif attendu :</span>
              <div class="status-code-container">
                <code class="status-code-text status-code-path" title="Cliquer pour copier" onclick="CalibreApp.copyToClipboard('${jsRelPath}')">${safeRelPath}</code>
                <button type="button" class="btn-copy-code" title="Copier le chemin relatif" onclick="CalibreApp.copyToClipboard('${jsRelPath}')">📋 Copier</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="file-status-missing-card">
          <div class="status-missing-header">
            <span class="status-missing-icon">⚠️</span>
            <div>
              <div class="status-missing-title">Fichier non trouvé dans le dossier / ZIP local</div>
              <div class="status-missing-subtitle">Sur Android, si la page a été rechargée, re-sélectionnez votre fichier .ZIP ou dossier local ci-dessous :</div>
            </div>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin: 4px 0;">
            <button type="button" class="btn btn-primary btn-sm" onclick="CalibreApp.defineLocalZipArchive()">
              📦 Connecter / Reconnecter l'archive .ZIP
            </button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="CalibreApp.defineLocalDirectory()">
              📁 Connecter le dossier local
            </button>
          </div>
          <div class="status-missing-list">
            ${filesHtml}
          </div>
          <div class="status-missing-help">
            💡 <em>Sur smartphone Android, l'accès direct à un fichier <strong>.ZIP</strong> de plusieurs Go est valable durant la session active : cliquez sur <strong>« 📦 Connecter / Reconnecter l'archive .ZIP »</strong> pour activer les jaquettes et la lecture EPUB.</em>
          </div>
        </div>
      `;
    }

    return `
      <div class="file-status-missing-card">
        <div class="status-missing-header">
          <span class="status-missing-icon">ℹ️</span>
          <div>
            <div class="status-missing-title">Aucun fichier ebook associé dans Calibre</div>
            <div class="status-missing-subtitle">Cette notice est présente dans metadata.db mais aucun fichier (EPUB, PDF...) n'y est associé.</div>
          </div>
        </div>
        <div class="status-missing-help" style="margin-top: 8px;">
          💡 <em>Vous pouvez lui associer un fichier (.epub) manuellement à l'aide du bouton ci-dessus.</em>
        </div>
      </div>
    `;
  }

  function renderAvailableFileCard(epubBlobInfo) {
    const originText = epubBlobInfo.source === 'archive_zip'
      ? 'archive ZIP locale'
      : epubBlobInfo.source === 'local_dir'
        ? 'dossier local'
        : epubBlobInfo.source === 'indexeddb'
          ? 'stockage PWA'
          : 'bibliothèque démo';
    const filename = epubBlobInfo.filename || 'ebook.epub';
    const sizeStr = formatBytes(epubBlobInfo.blob.size || 0);

    return `
      <div class="file-status-available-card">
        <div class="status-available-header">
          <span class="status-available-icon">✓</span>
          <div>
            <div class="status-available-title">Fichier EPUB disponible (${sizeStr})</div>
            <div class="status-available-meta">Source : <strong>${originText}</strong> • <code class="status-code-avail">${escapeHtml(filename)}</code></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderStars(rating) {
    if (!rating) return '';
    const stars = Math.max(0, Math.min(5, Math.round(rating / 2)));
    if (stars === 0) return '';
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
    setupTagBrowserDrawer();
    setupCoverFlowGestures();
    setupEventListeners();

    const savedMode = await CalibreStorage.getSetting('view_mode', 'grid');
    setViewMode(savedMode, false);

    const savedCoverFlow = await CalibreStorage.getSetting('show_coverflow', true);
    state.showCoverFlow = savedCoverFlow !== false;
    updateCoverFlowVisibility();

    updateDbStatusBadge('Initialisation...', 'badge-loading');

    try {
      const initResult = await CalibreDB.init();

      if (initResult.loaded) {
        const libName = (initResult.name || 'calibre library').replace(/\.db$/i, '');
        updateHeaderLibraryTitle(libName);
        if (initResult.directoryStatus === 'connected') {
          const icon = initResult.sourceType === 'zip' ? '📦' : '📁';
          updateDbStatusBadge(`${icon} ${initResult.directoryName || initResult.name}`, 'badge-success');
        } else if (String(initResult.name || '').toLowerCase().includes('.zip')) {
          updateDbStatusBadge('⚠️ Reconnecter .ZIP', 'badge-warning');
        } else {
          updateDbStatusBadge(`${initResult.name}`, 'badge-success');
        }
        refreshStats();
        renderTagBrowserTree();
        switchTab('books');
      } else {
        // Automatically load Demo Library on first launch so user sees the full Calibre UI immediately
        await loadDemoDatabase(true);
      }

      updateLocalDirectoryUI();
    } catch (err) {
      console.error('Erreur initialisation CalibreDB:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur initialisation : ' + err.message, 'error');
    }

    registerServiceWorker();
  }

  function updateHeaderLibraryTitle(name) {
    const el = document.getElementById('header-library-title');
    if (el && name) {
      el.textContent = name;
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            reg.update().catch(() => {});
            reg.onupdatefound = () => {
              const installing = reg.installing;
              installing.onstatechange = () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                  showToast('Mise à jour Calibre PWA appliquée !', 'info');
                }
              };
            };
          })
          .catch((err) => {
            console.warn('ServiceWorker non enregistré:', err);
          });
      });
    }
  }

  /**
   * Setup Tag Browser Drawer (<dialog class="Drawer">) following navigation-drawer guidance
   */
  function setupTagBrowserDrawer() {
    const drawer = document.getElementById('tag-browser-drawer');
    const openBtn = document.getElementById('btn-open-tag-drawer');
    if (!drawer || !openBtn) return;

    const scroller = drawer.querySelector('.Drawer-scroller');
    const sheet = drawer.querySelector('.Drawer-sheet');
    const closeBtn = document.getElementById('tag-drawer-close');

    // Scroll-driven backdrop fade fallback for browsers without animation-timeline: scroll()
    if (!CSS.supports('animation-timeline: scroll()')) {
      scroller.addEventListener('scroll', () => {
        const ratio = Math.max(0, Math.min(1, 1 - scroller.scrollLeft / (sheet.offsetWidth || 280)));
        drawer.style.setProperty('--drawer-backdrop', String(ratio));
      });
    }

    openDrawerFn = async function openDrawer() {
      renderTagBrowserTree(document.getElementById('tag-browser-search')?.value || '');
      drawer.showModal();

      if (!CSS.supports('scroll-initial-target', 'nearest')) {
        scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      scroller.scrollTo({ left: 0, behavior: 'auto' });
    };

    closeDrawerFn = function closeDrawer() {
      if (!drawer.open) return;
      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });
      // Fallback timeout if smooth scroll is disabled or instant
      setTimeout(() => {
        if (drawer.open && scroller.scrollLeft >= sheet.offsetWidth * 0.8) {
          drawer.close();
          openBtn.setAttribute('aria-expanded', 'false');
        }
      }, 320);
    };

    function onDrawerOpened() {
      openBtn.setAttribute('aria-expanded', 'true');
    }

    function onDrawerClosed() {
      if (drawer.open) {
        drawer.close();
      }
      openBtn.setAttribute('aria-expanded', 'false');
    }

    const visibleThreshold = 1 / Math.max(320, window.innerWidth);
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        if (entry.intersectionRatio < visibleThreshold) onDrawerClosed();
        if (entry.intersectionRatio >= 0.98) onDrawerOpened();
      },
      { root: drawer, threshold: [visibleThreshold, 1] }
    );
    observer.observe(sheet);

    openBtn.addEventListener('click', () => openDrawerFn());
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawerFn());

    drawer.addEventListener('click', (event) => {
      if (!sheet.contains(event.target)) closeDrawerFn();
    });

    drawer.addEventListener('cancel', (event) => {
      if (event.cancelable) {
        event.preventDefault();
        closeDrawerFn();
      }
    });

    const tagSearchInput = document.getElementById('tag-browser-search');
    if (tagSearchInput) {
      tagSearchInput.addEventListener('input', debounce((e) => {
        renderTagBrowserTree(e.target.value);
      }, 180));
    }

    const resetBtn = document.getElementById('btn-reset-all-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetAllFilters();
        closeDrawerFn();
      });
    }
  }

  function openTagDrawer() {
    if (openDrawerFn) openDrawerFn();
  }

  /**
   * Populate the Calibre Tag Browser Hierarchical Tree (shot1_main.png left panel)
   */
  function renderTagBrowserTree(filterText = '') {
    const container = document.getElementById('tag-browser-tree');
    if (!container || !CalibreDB.isLoaded()) return;

    const q = (filterText || '').trim().toLowerCase();
    const filterItems = (arr) => {
      if (!q) return arr;
      return arr.filter((item) => String(item.name || '').toLowerCase().includes(q));
    };

    const categories = [
      {
        key: 'authors',
        icon: '👤',
        label: 'Auteurs',
        items: filterItems(CalibreDB.getAuthors({ search: q, limit: 150 })),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedAuthor = { id: item.id, name: item.name };
        }
      },
      {
        key: 'languages',
        icon: '🌐',
        label: 'Langues',
        items: filterItems(CalibreDB.getLanguages()),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedLanguage = { id: item.id, name: item.name };
        }
      },
      {
        key: 'series',
        icon: '📚',
        label: 'Séries',
        items: filterItems(CalibreDB.getSeries({ search: q, limit: 150 })),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedSeries = { id: item.id, name: item.name };
        }
      },
      {
        key: 'formats',
        icon: '📖',
        label: 'Formats',
        items: filterItems(CalibreDB.getFormatsDistribution()),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedFormat = item.name;
        }
      },
      {
        key: 'publishers',
        icon: '🏢',
        label: 'Éditeurs',
        items: filterItems(CalibreDB.getPublishers({ search: q, limit: 150 })),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedPublisher = { id: item.id, name: item.name };
        }
      },
      {
        key: 'ratings',
        icon: '⭐',
        label: 'Notes',
        items: filterItems(CalibreDB.getRatingsDistribution()),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedRating = item.stars;
        }
      },
      {
        key: 'tags',
        icon: '🏷️',
        label: 'Étiquettes',
        items: filterItems(CalibreDB.getTags({ search: q, limit: 200 })),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedTag = { id: item.id, name: item.name };
        }
      },
      {
        key: 'identifiers',
        icon: '🆔',
        label: 'Identifiants',
        items: filterItems(CalibreDB.getIdentifierTypes()),
        onSelect: (item) => {
          resetCategoryFilters();
          state.selectedIdentifier = item.id;
        }
      }
    ];

    container.innerHTML = '';

    categories.forEach((cat, idx) => {
      const details = document.createElement('details');
      details.className = 'tag-category-details';
      if (q && cat.items.length > 0) {
        details.open = true;
      } else if (!q && (idx === 0 || idx === 3 || idx === 6)) {
        details.open = true;
      }

      const summary = document.createElement('summary');
      summary.className = 'tag-category-summary';
      summary.innerHTML = `
        <span class="tag-cat-left">
          <span class="tag-cat-arrow" aria-hidden="true">▶</span>
          <span aria-hidden="true">${cat.icon}</span>
          <span>${escapeHtml(cat.label)}</span>
        </span>
        <span class="tag-cat-count">${cat.items.length}</span>
      `;
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'tag-category-items';

      if (cat.items.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.style.cssText = 'padding: 6px 10px; font-size: 0.76rem; color: var(--text-muted);';
        emptyLi.textContent = 'Aucun élément';
        ul.appendChild(emptyLi);
      } else {
        cat.items.forEach((item) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-tree-item';
          btn.innerHTML = `
            <span class="tag-tree-item-name">${escapeHtml(item.name)}</span>
            <span class="tag-tree-item-count">${item.book_count || 0}</span>
          `;
          btn.addEventListener('click', () => {
            cat.onSelect(item);
            if (closeDrawerFn) closeDrawerFn();
            if (state.currentTab !== 'books') {
              switchTab('books');
            } else {
              loadBooks(true);
            }
          });
          li.appendChild(btn);
          ul.appendChild(li);
        });
      }

      details.appendChild(ul);
      container.appendChild(details);
    });
  }

  function resetCategoryFilters() {
    state.selectedAuthor = null;
    state.selectedSeries = null;
    state.selectedTag = null;
    state.selectedPublisher = null;
    state.selectedLanguage = null;
    state.selectedRating = null;
    state.selectedIdentifier = null;
    state.selectedFormat = null;
  }

  function resetAllFilters() {
    resetCategoryFilters();
    state.searchQuery = '';
    state.activeVirtualTab = 'all';
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.hidden = true;
    renderVirtualTabs();
    if (state.currentTab !== 'books') {
      switchTab('books');
    } else {
      loadBooks(true);
    }
  }

  function resetAndGoBooks() {
    resetAllFilters();
  }

  /**
   * Setup PWA Installation handling
   */
  function setupPwaInstall() {
    const installBtn = document.getElementById('btn-install-app');
    if (!installBtn) return;
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
      if (installBtn.getAttribute('aria-disabled') === 'true') return;
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
        if (err.name !== 'AbortError') {
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
   * Dialog light-dismiss fallback (excluding tag-browser-drawer which handles its own scroll-snap dismiss)
   */
  function setupDialogDismissFallbacks() {
    const dialogs = document.querySelectorAll('dialog:not(#tag-browser-drawer)');
    dialogs.forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      });

      const innerCard = dialog.querySelector('.modal-content-card, .reader-container');
      if (innerCard) {
        innerCard.addEventListener('click', (event) => {
          event.stopPropagation();
        });
      }
    });
  }

  /**
   * Setup 3D Cover Browser ("Cover Flow") Touch Swipe Gestures
   */
  function setupCoverFlowGestures() {
    const stage = document.getElementById('coverflow-stage');
    if (!stage) return;

    let startX = 0;
    let startY = 0;

    stage.addEventListener('touchstart', (e) => {
      startX = e.changedTouches[0].screenX;
      startY = e.changedTouches[0].screenY;
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].screenX - startX;
      const dy = e.changedTouches[0].screenY - startY;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          stepCoverFlow(1);
        } else {
          stepCoverFlow(-1);
        }
      }
    }, { passive: true });
  }

  /**
   * Render Calibre 3D Cover Browser ("Cover Flow" - shot1_main.png & shot6_night_mode.png)
   */
  function renderCoverFlow() {
    const section = document.getElementById('coverflow-section');
    const track = document.getElementById('coverflow-track');
    const titleEl = document.getElementById('coverflow-title');
    const ratingEl = document.getElementById('coverflow-rating');
    if (!section || !track) return;

    if (!state.showCoverFlow || state.currentTab !== 'books' || state.books.length === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    if (state.coverFlowIndex >= state.books.length) {
      state.coverFlowIndex = 0;
    }

    const centerIdx = state.coverFlowIndex;
    const centerBook = state.books[centerIdx];
    if (centerBook) {
      state.selectedBookId = centerBook.id;
      titleEl.textContent = centerBook.title;
      ratingEl.innerHTML = centerBook.rating ? renderStars(centerBook.rating) : '';
      updateStatusFooter();
    }

    track.innerHTML = '';
    const range = 4;
    const start = Math.max(0, centerIdx - range);
    const end = Math.min(state.books.length - 1, centerIdx + range);

    for (let i = start; i <= end; i++) {
      const book = state.books[i];
      const offset = i - centerIdx;
      const absOff = Math.abs(offset);

      const item = document.createElement('div');
      item.className = 'coverflow-item' + (offset === 0 ? ' is-center' : '');
      item.dataset.bookId = book.id;

      let tx = 0;
      let tz = 0;
      let ry = 0;
      let scale = 1;

      if (offset === 0) {
        tx = 0;
        tz = 45;
        ry = 0;
        scale = 1.06;
      } else if (offset < 0) {
        tx = -52 + offset * 38;
        tz = -absOff * 28;
        ry = 46;
        scale = Math.max(0.75, 0.94 - absOff * 0.05);
      } else {
        tx = 52 + offset * 38;
        tz = -absOff * 28;
        ry = -46;
        scale = Math.max(0.75, 0.94 - absOff * 0.05);
      }

      item.style.transform = `translate3d(${tx}px, 0, ${tz}px) rotateY(${ry}deg) scale(${scale})`;
      item.style.zIndex = String(20 - absOff);
      item.style.opacity = absOff > 3 ? '0.35' : '1';

      const img = document.createElement('img');
      img.alt = book.title;
      CalibreDB.getCoverUrl(book).then((url) => {
        img.src = url;
      });
      item.appendChild(img);

      item.addEventListener('click', () => {
        if (offset === 0) {
          openBookDetail(book.id);
        } else {
          state.coverFlowIndex = i;
          selectBookInCatalog(book.id, false);
          renderCoverFlow();
        }
      });

      track.appendChild(item);
    }
  }

  function stepCoverFlow(delta) {
    if (!state.books.length) return;
    const nextIdx = Math.max(0, Math.min(state.books.length - 1, state.coverFlowIndex + delta));
    if (nextIdx !== state.coverFlowIndex) {
      state.coverFlowIndex = nextIdx;
      const book = state.books[nextIdx];
      if (book) {
        selectBookInCatalog(book.id, false);
      }
      renderCoverFlow();
    }
  }

  function toggleCoverFlow() {
    state.showCoverFlow = !state.showCoverFlow;
    CalibreStorage.setSetting('show_coverflow', state.showCoverFlow);
    updateCoverFlowVisibility();
    renderCoverFlow();
  }

  function updateCoverFlowVisibility() {
    const btn = document.getElementById('toolbar-btn-coverflow');
    if (btn) btn.classList.toggle('active', state.showCoverFlow);
  }

  function toggleCalibreToolbar() {
    state.showActionToolbar = !state.showActionToolbar;
    const bar = document.getElementById('calibre-action-toolbar');
    const btn = document.getElementById('btn-toggle-toolbar');
    if (bar) bar.hidden = !state.showActionToolbar;
    if (btn) btn.classList.toggle('active', state.showActionToolbar);
  }

  function selectBookInCatalog(bookId, syncCoverFlow = true) {
    state.selectedBookId = Number(bookId);

    document.querySelectorAll('.book-card').forEach((card) => {
      card.classList.toggle('is-selected', Number(card.dataset.bookId) === state.selectedBookId);
    });

    document.querySelectorAll('#calibre-table-tbody tr').forEach((tr) => {
      tr.classList.toggle('is-selected', Number(tr.dataset.bookId) === state.selectedBookId);
    });

    if (syncCoverFlow) {
      const idx = state.books.findIndex((b) => Number(b.id) === state.selectedBookId);
      if (idx !== -1 && idx !== state.coverFlowIndex) {
        state.coverFlowIndex = idx;
        renderCoverFlow();
      }
    }

    updateStatusFooter();
  }

  function updateStatusFooter() {
    const statusText = document.getElementById('status-selection-text');
    if (!statusText) return;
    const selectedCount = state.selectedBookId ? 1 : 0;
    statusText.textContent = `[${state.totalBooks.toLocaleString('fr-FR')} livres, ${selectedCount} sélectionné]`;
  }

  /**
   * Setup UI Event Listeners
   */
  function setupEventListeners() {
    // Bottom Nav tabs
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

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
      }
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.hidden = true;
      loadBooks(true);
    });

    // Sort selector
    document.getElementById('sort-select').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      if (state.currentTab !== 'books') {
        switchTab('books');
      } else {
        loadBooks(true);
      }
    });

    // View mode toggle (Grid / Table / List)
    document.getElementById('btn-view-grid').addEventListener('click', () => {
      setViewMode('grid');
      if (state.currentTab !== 'books') switchTab('books');
    });

    const btnTable = document.getElementById('btn-view-table');
    if (btnTable) {
      btnTable.addEventListener('click', () => {
        setViewMode('table');
        if (state.currentTab !== 'books') switchTab('books');
      });
    }

    document.getElementById('btn-view-list').addEventListener('click', () => {
      setViewMode('list');
      if (state.currentTab !== 'books') switchTab('books');
    });

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

    // Local Directory & ZIP Archive Settings Handlers
    document.getElementById('btn-define-local-dir').addEventListener('click', defineLocalDirectory);
    const btnDefineZip = document.getElementById('btn-define-local-zip');
    if (btnDefineZip) {
      btnDefineZip.addEventListener('click', defineLocalZipArchive);
    }
    document.getElementById('btn-rescan-local-dir').addEventListener('click', rescanLocalDirectory);
    document.getElementById('btn-disconnect-local-dir').addEventListener('click', disconnectLocalDirectory);

    // Hidden folder input for fallback (DO NOT reset .value = '' after selection on Android, as it revokes content:// URIs)
    const inputFolderFallback = document.getElementById('input-folder-fallback');
    inputFolderFallback.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      const res = CalibreDB.registerFileList(files);
      showToast(`Dossier local associé ! ${res.epubsCount} EPUBs indexés.`, 'success');
      updateLocalDirectoryUI();
      if (state.currentTab === 'books') loadBooks(true);
    });

    // Hidden ZIP archive input for fallback / mobile file selection
    // IMPORTANT: Never clear inputZipLibrary.value = '' after change on Android Chrome,
    // because clearing the input invalidates the underlying Android content:// File reference!
    const inputZipLibrary = document.getElementById('input-zip-library');
    if (inputZipLibrary) {
      inputZipLibrary.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await handleZipArchiveImport(file);
      });
    }

    const dbBadge = document.getElementById('db-status-badge');
    if (dbBadge) {
      dbBadge.style.cursor = 'pointer';
      dbBadge.title = 'Cliquer pour connecter une archive .ZIP ou gérer la bibliothèque';
      dbBadge.addEventListener('click', () => {
        const info = CalibreDB.getLocalDirectoryInfo();
        if (info.status !== 'connected') {
          defineLocalZipArchive();
        } else {
          switchTab('settings');
        }
      });
    }

    // Database Actions
    const fileDbInput = document.getElementById('input-file-db');
    fileDbInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleDbFileImport(file);
      fileDbInput.value = '';
    });

    document.getElementById('btn-load-demo').addEventListener('click', () => loadDemoDatabase(false));
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

    // Metadata Editor Form submission
    const editMetaForm = document.getElementById('edit-metadata-form');
    if (editMetaForm) {
      editMetaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveEditedMetadata();
      });
    }
  }

  function triggerSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      state.searchQuery = searchInput.value.trim();
      document.getElementById('search-clear-btn').hidden = !state.searchQuery;
    }
    if (state.currentTab !== 'books') {
      switchTab('books');
    } else {
      loadBooks(true);
    }
  }

  function focusSearchBar() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function cycleQuickSort() {
    const sorts = [
      { key: 'timestamp_desc', label: 'Récents' },
      { key: 'title_asc', label: 'Titre (A → Z)' },
      { key: 'author_asc', label: 'Auteur (A → Z)' },
      { key: 'rating_desc', label: 'Note (★)' },
      { key: 'pubdate_desc', label: 'Date de publication' }
    ];
    const idx = sorts.findIndex((s) => s.key === state.sortBy);
    const next = sorts[(idx + 1) % sorts.length];
    state.sortBy = next.key;
    const sel = document.getElementById('sort-select');
    if (sel) sel.value = next.key;
    showToast(`Tri : ${next.label}`, 'info');
    if (state.currentTab !== 'books') {
      switchTab('books');
    } else {
      loadBooks(true);
    }
  }

  /**
   * Virtual Library Tabs (All books | Recent | Top Rated | Custom saved tabs)
   */
  function selectVirtualTab(tabId) {
    state.activeVirtualTab = tabId;
    resetCategoryFilters();

    if (tabId === 'all') {
      state.searchQuery = '';
      state.sortBy = 'timestamp_desc';
    } else if (tabId === 'recent') {
      state.searchQuery = '';
      state.sortBy = 'timestamp_desc';
    } else if (tabId === 'top_rated') {
      state.searchQuery = 'rating:>=4';
      state.sortBy = 'rating_desc';
    } else if (tabId === 'epub_only') {
      state.selectedFormat = 'EPUB';
    } else {
      const custom = state.customVirtualTabs.find((t) => t.id === tabId);
      if (custom) {
        state.searchQuery = custom.query || '';
        if (custom.filters) {
          Object.assign(state, custom.filters);
        }
      }
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = state.searchQuery;
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.hidden = !state.searchQuery;
    const sortSel = document.getElementById('sort-select');
    if (sortSel) sortSel.value = state.sortBy;

    renderVirtualTabs();
    if (state.currentTab !== 'books') {
      switchTab('books');
    } else {
      loadBooks(true);
    }
  }

  function saveCurrentSearchAsTab() {
    const defaultLabel = state.searchQuery
      || (state.selectedTag && state.selectedTag.name)
      || (state.selectedAuthor && state.selectedAuthor.name)
      || (state.selectedSeries && state.selectedSeries.name)
      || '';
    const name = window.prompt('Nom du nouvel onglet de bibliothèque virtuelle :', defaultLabel || 'Ma sélection');
    if (!name || !name.trim()) return;

    const id = 'vl_' + Date.now();
    state.customVirtualTabs.push({
      id,
      label: name.trim(),
      query: state.searchQuery,
      filters: {
        selectedAuthor: state.selectedAuthor,
        selectedSeries: state.selectedSeries,
        selectedTag: state.selectedTag,
        selectedPublisher: state.selectedPublisher,
        selectedFormat: state.selectedFormat
      }
    });
    state.activeVirtualTab = id;
    renderVirtualTabs();
    showToast(`Onglet « ${name.trim()} » ajouté !`, 'success');
  }

  function closeVirtualTab(tabId, event) {
    if (event) event.stopPropagation();
    state.customVirtualTabs = state.customVirtualTabs.filter((t) => t.id !== tabId);
    if (state.activeVirtualTab === tabId) {
      selectVirtualTab('all');
    } else {
      renderVirtualTabs();
    }
  }

  function renderVirtualTabs() {
    const bar = document.getElementById('virtual-library-tabs');
    if (!bar) return;

    const baseTabs = [
      { id: 'all', label: 'Tous les livres' },
      { id: 'recent', label: 'Récents' },
      { id: 'top_rated', label: '★ Favoris' },
      { id: 'epub_only', label: 'Format EPUB' }
    ];

    let html = baseTabs.map((t) => {
      const active = state.activeVirtualTab === t.id;
      return `
        <button type="button" class="vl-tab ${active ? 'active' : ''}" data-vl="${t.id}" role="tab" aria-selected="${active}" onclick="CalibreApp.selectVirtualTab('${t.id}')">
          ${escapeHtml(t.label)}
        </button>
      `;
    }).join('');

    html += state.customVirtualTabs.map((t) => {
      const active = state.activeVirtualTab === t.id;
      return `
        <button type="button" class="vl-tab ${active ? 'active' : ''}" data-vl="${t.id}" role="tab" aria-selected="${active}" onclick="CalibreApp.selectVirtualTab('${t.id}')">
          <span>${escapeHtml(t.label)}</span>
          <span class="vl-tab-close" title="Fermer l'onglet" onclick="CalibreApp.closeVirtualTab('${t.id}', event)">✕</span>
        </button>
      `;
    }).join('');

    bar.innerHTML = html;
  }

  /**
   * Switch Active Tab
   */
  function switchTab(tabName) {
    state.currentTab = tabName;

    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-section').forEach((section) => {
      section.classList.toggle('active', section.id === `section-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'instant' });

    const controlsBar = document.querySelector('.controls-bar');
    if (controlsBar) {
      controlsBar.hidden = (tabName === 'settings' || tabName === 'authors' || tabName === 'series' || tabName === 'shelves');
    }

    const coverflowSection = document.getElementById('coverflow-section');
    if (coverflowSection && tabName !== 'books') {
      coverflowSection.hidden = true;
    }

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
   * Local Directory & ZIP Archive Settings Management
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
          updateHeaderLibraryTitle(dirHandle.name || 'calibre library');
          updateDbStatusBadge('metadata.db connecté', 'badge-success');
          refreshStats();
          renderTagBrowserTree();
          if (state.currentTab === 'books') loadBooks(true);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          document.getElementById('input-folder-fallback').click();
        }
      }
    } else {
      document.getElementById('input-folder-fallback').click();
    }
  }

  /**
   * Open a Calibre Library .ZIP Archive (containing metadata.db at root + EPUB subfolders)
   * Uses Zero-Copy Central Directory Indexing (File.slice) without loading the entire ZIP in RAM!
   */
  async function defineLocalZipArchive() {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Archive Bibliothèque Calibre (.zip)',
              accept: { 'application/zip': ['.zip'] }
            }
          ]
        });
        if (!fileHandle) return;

        showToast('Indexation rapide du répertoire central ZIP...', 'info');
        const res = await CalibreDB.setLocalZipHandle(fileHandle);
        onZipArchiveConnected(res);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const inputZip = document.getElementById('input-zip-library');
    if (inputZip) {
      inputZip.value = '';
      inputZip.click();
    }
  }

  async function handleZipArchiveImport(file) {
    if (!file) return;
    try {
      showToast('Indexation rapide du répertoire central ZIP...', 'info');
      const res = await CalibreDB.registerZipFile(file, false);
      onZipArchiveConnected(res);
    } catch (err) {
      console.error('Erreur lecture archive ZIP:', err);
      showToast('Erreur archive ZIP : ' + err.message, 'error');
    }
  }

  function onZipArchiveConnected(res) {
    updateLocalDirectoryUI();
    const cleanTitle = (res.name || 'calibre.zip').replace(/\.zip$/i, '');
    updateHeaderLibraryTitle(cleanTitle);
    updateDbStatusBadge(`📦 ${res.epubsCount} EPUBs`, 'badge-success');

    if (res.hasMetadataDb) {
      showToast(`✓ Archive ZIP active (${res.epubsCount.toLocaleString('fr-FR')} EPUBs + jaquettes) !`, 'success');
      refreshStats();
      renderTagBrowserTree();
    } else {
      showToast(`✓ Archive ZIP connectée (${res.epubsCount.toLocaleString('fr-FR')} EPUBs indexés).`, 'success');
    }

    const detailDialog = document.getElementById('book-detail-dialog');
    const wasDetailOpen = detailDialog && detailDialog.open && state.selectedBookId;

    if (state.currentTab !== 'books') {
      switchTab('books');
    } else {
      loadBooks(true);
    }

    if (wasDetailOpen) {
      openBookDetail(state.selectedBookId);
    }
  }

  async function rescanLocalDirectory() {
    const dirInfo = CalibreDB.getLocalDirectoryInfo();
    if (!dirInfo.handle && !dirInfo.zipFile) {
      showToast('Aucun dossier ou fichier ZIP sélectionné.', 'warning');
      return;
    }

    if (dirInfo.status === 'needs_permission') {
      const granted = await CalibreDB.requestDirectoryPermission();
      if (!granted) {
        showToast("Permission d'accès refusée.", 'error');
        updateLocalDirectoryUI();
        return;
      }
      const updated = CalibreDB.getLocalDirectoryInfo();
      showToast(`Accès rétabli : ${updated.epubsCount} EPUBs disponibles.`, 'success');
      updateLocalDirectoryUI();
      return;
    }

    if (dirInfo.sourceType === 'zip' && dirInfo.zipFile) {
      showToast('Ré-indexation de l\'archive ZIP...', 'info');
      const res = await CalibreDB.registerZipFile(dirInfo.zipFile, Boolean(dirInfo.handle));
      onZipArchiveConnected(res);
      return;
    }

    showToast('Ré-indexation des fichiers locaux...', 'info');
    await CalibreDB.scanDirectoryHandle(dirInfo.handle);
    const updated = CalibreDB.getLocalDirectoryInfo();
    showToast(`Indexation terminée : ${updated.epubsCount} EPUBs locaux trouvés.`, 'success');
    updateLocalDirectoryUI();
  }

  async function disconnectLocalDirectory() {
    if (!confirm('Voulez-vous déconnecter le répertoire / fichier ZIP local des livres ?')) return;
    await CalibreDB.removeLocalDirectory();
    updateLocalDirectoryUI();
    showToast('Source locale déconnectée.', 'info');
  }

  function updateLocalDirectoryUI() {
    const info = CalibreDB.getLocalDirectoryInfo();
    const card = document.getElementById('local-dir-card');
    const statusBadge = document.getElementById('dir-status-badge');
    const pathDisplay = document.getElementById('dir-path-display');
    const countDisplay = document.getElementById('dir-epubs-count');
    const btnRescan = document.getElementById('btn-rescan-local-dir');
    const btnDisconnect = document.getElementById('btn-disconnect-local-dir');
    if (!card) return;

    const isZip = info.sourceType === 'zip';
    const prefixIcon = isZip ? '📦 Archive ZIP : ' : '📁 Dossier : ';

    if (info.status === 'connected') {
      card.className = 'local-dir-card connected';
      statusBadge.textContent = isZip ? 'Archive ZIP connectée' : 'Dossier connecté';
      statusBadge.className = 'status-badge badge-success';
      pathDisplay.textContent = prefixIcon + (info.name || 'Bibliothèque Calibre');
      countDisplay.textContent = `${info.epubsCount.toLocaleString('fr-FR')} EPUBs indexés (accès direct sans surcharge RAM)`;
      btnRescan.hidden = false;
      btnDisconnect.hidden = false;
    } else if (info.status === 'needs_permission') {
      card.className = 'local-dir-card';
      statusBadge.textContent = 'Autorisation requise';
      statusBadge.className = 'status-badge badge-warning';
      pathDisplay.textContent = `${prefixIcon}${info.name} (Cliquez sur Ré-indexer pour autoriser l'accès)`;
      countDisplay.textContent = "En attente d'autorisation";
      btnRescan.hidden = false;
      btnDisconnect.hidden = false;
    } else {
      card.className = 'local-dir-card';
      statusBadge.textContent = 'Non configuré';
      statusBadge.className = 'status-badge badge-warning';
      pathDisplay.textContent = 'Aucun répertoire local ou fichier .ZIP défini';
      countDisplay.textContent = '0 EPUBs';
      btnRescan.hidden = true;
      btnDisconnect.hidden = true;
    }
  }

  /**
   * Load Smart Shelves (Découverte)
   */
  async function loadMagicShelves() {
    if (!CalibreDB.isLoaded()) {
      showEmptyLibraryBanner();
      return;
    }

    const continueBooks = await CalibreDB.getMagicShelfBooks('continue_reading', 12);
    renderShelfRow('shelf-continue-reading', continueBooks);

    const recentBooks = await CalibreDB.getMagicShelfBooks('recently_added', 16);
    renderShelfRow('shelf-recently-added', recentBooks);

    const topBooks = await CalibreDB.getMagicShelfBooks('top_rated', 16);
    renderShelfRow('shelf-top-rated', topBooks);

    const randomBooks = await CalibreDB.getMagicShelfBooks('random', 16);
    renderShelfRow('shelf-random', randomBooks);
  }

  function renderShelfRow(containerId, booksList) {
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
      scrollContainer.appendChild(createBookCardElement(book));
    }
  }

  /**
   * Create Calibre Book Card Element (Grid & List views)
   */
  function createBookCardElement(book) {
    const card = document.createElement('article');
    card.className = 'book-card' + (Number(book.id) === state.selectedBookId ? ' is-selected' : '');
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
      selectBookInCatalog(book.id, true);
      openBookDetail(book.id);
    });

    return card;
  }

  /**
   * Create Calibre Table Row (shot1_main.png & shot6_night_mode.png)
   */
  function createCalibreTableRow(book, rowNumber) {
    const tr = document.createElement('tr');
    tr.dataset.bookId = book.id;
    if (Number(book.id) === state.selectedBookId) {
      tr.classList.add('is-selected');
    }

    const starsCount = book.rating ? Math.round(book.rating / 2) : 0;
    const starsStr = starsCount > 0 ? '★'.repeat(starsCount) : '';
    const tagsStr = Array.isArray(book.tags) ? book.tags.join(', ') : '';
    const seriesStr = book.series ? `${book.series} [${book.series_index}]` : '';
    const dateRaw = book.timestamp || book.pubdate || '';
    const dateFormatted = formatDateCalibre(dateRaw);
    const formatsStr = Array.isArray(book.formats) ? book.formats.join(', ') : '';

    tr.innerHTML = `
      <td class="col-num" data-value="${rowNumber}">${rowNumber}</td>
      <td class="col-title" data-value="${escapeHtml(book.title)}">${escapeHtml(book.title)}</td>
      <td class="col-author" data-value="${escapeHtml(book.authors)}">${escapeHtml(book.authors)}</td>
      <td class="col-rating" data-value="${starsCount}">${starsStr}</td>
      <td class="col-tags">${escapeHtml(tagsStr)}</td>
      <td class="col-series" data-value="${escapeHtml(seriesStr)}">${escapeHtml(seriesStr)}</td>
      <td class="col-publisher">${escapeHtml(book.publisher || '')}</td>
      <td class="col-date" data-value="${escapeHtml(dateRaw)}">${escapeHtml(dateFormatted)}</td>
      <td class="col-formats">${escapeHtml(formatsStr)}</td>
    `;

    tr.addEventListener('click', () => {
      if (state.selectedBookId === Number(book.id)) {
        openBookDetail(book.id);
      } else {
        selectBookInCatalog(book.id, true);
      }
    });

    tr.addEventListener('dblclick', () => {
      openBookDetail(book.id);
    });

    return tr;
  }

  /**
   * Sortable Table Header Click Handler (following sortable-table guidance)
   * Moves existing <tr> DOM nodes without rebuilding tbody via innerHTML.
   */
  function sortTableByColumn(colKey, btnEl) {
    const table = document.getElementById('calibre-books-table');
    const tbody = document.getElementById('calibre-table-tbody');
    const status = document.getElementById('table-sort-status');
    if (!table || !tbody || !btnEl) return;

    const th = btnEl.closest('th');
    if (!th) return;

    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';

    for (const header of table.tHead.rows[0].cells) {
      header.removeAttribute('aria-sort');
    }
    th.setAttribute('aria-sort', direction);

    const colIndex = th.cellIndex;
    const type = th.dataset.type || 'text';
    const factor = direction === 'ascending' ? 1 : -1;

    const rows = [...tbody.rows];
    const rowValues = new Map();
    for (const row of rows) {
      const cell = row.cells[colIndex];
      const raw = cell ? (cell.dataset.value ?? cell.textContent.trim()) : '';
      rowValues.set(row, type === 'number' ? (parseFloat(raw) || 0) : raw);
    }

    rows.sort((a, b) => {
      const va = rowValues.get(a);
      const vb = rowValues.get(b);
      if (type === 'number') {
        return factor * (va - vb);
      }
      return factor * textCollator.compare(String(va), String(vb));
    });

    // Move existing <tr> nodes without innerHTML rebuild
    const supportsMoveBefore = typeof tbody.moveBefore === 'function';
    for (const row of rows) {
      if (supportsMoveBefore) {
        tbody.moveBefore(row, null);
      } else {
        tbody.appendChild(row);
      }
    }

    if (status) {
      status.textContent = `Trié par ${btnEl.textContent.trim()}, ${direction === 'ascending' ? 'croissant' : 'décroissant'}, ${rows.length} lignes`;
    }
  }

  /**
   * Load books into the catalog views (Grid, Table, List, and 3D Cover Flow)
   */
  async function loadBooks(reset = false) {
    if (!CalibreDB.isLoaded()) {
      showEmptyLibraryBanner();
      return;
    }

    const container = document.getElementById('books-container');
    const tbody = document.getElementById('calibre-table-tbody');

    if (reset) {
      state.page = 0;
      state.books = [];
      state.coverFlowIndex = 0;
      state.hasMore = true;
      if (container) container.innerHTML = '';
      if (tbody) tbody.innerHTML = '';
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
      publisherId: state.selectedPublisher ? state.selectedPublisher.id : null,
      languageId: state.selectedLanguage ? state.selectedLanguage.id : null,
      ratingStars: state.selectedRating,
      identifierType: state.selectedIdentifier,
      format: state.selectedFormat,
      sortBy: state.sortBy,
      offset: offset,
      limit: state.pageSize
    });

    const prevCount = state.books.length;
    state.totalBooks = res.total;
    state.books = state.books.concat(res.books);
    state.hasMore = state.books.length < state.totalBooks;

    if (reset && state.books.length > 0) {
      state.selectedBookId = state.books[0].id;
    }

    const counterEl = document.getElementById('books-count-header');
    if (counterEl) {
      counterEl.textContent = `${state.totalBooks.toLocaleString('fr-FR')} livre${state.totalBooks > 1 ? 's' : ''}`;
    }

    res.books.forEach((book, i) => {
      if (container) container.appendChild(createBookCardElement(book));
      if (tbody) tbody.appendChild(createCalibreTableRow(book, prevCount + i + 1));
    });

    if (reset) {
      renderCoverFlow();
    }
    updateStatusFooter();

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
   * Open Calibre Content Server Book Details Sheet (shot5_web_content_server.png)
   */
  async function openBookDetail(bookId) {
    state.selectedBookId = Number(bookId);
    selectBookInCatalog(bookId, true);

    const dialog = document.getElementById('book-detail-dialog');
    if (!dialog) return;

    const details = CalibreDB.getBookDetails(bookId);
    if (!details) {
      showToast('Détails du livre indisponibles.', 'warning');
      return;
    }

    // Header title & SR title
    const titleStr = details.title || 'Sans titre';
    document.getElementById('modal-book-title').textContent = titleStr;
    const headerTitleEl = document.getElementById('modal-header-title');
    if (headerTitleEl) headerTitleEl.textContent = titleStr;

    // 1. Authors (clickable blue links like shot5_web_content_server.png)
    const authorEl = document.getElementById('modal-book-author');
    authorEl.innerHTML = '';
    if (details.authors && details.authors.length > 0) {
      details.authors.forEach((a, idx) => {
        if (idx > 0) authorEl.appendChild(document.createTextNode(', '));
        const link = document.createElement('a');
        link.className = 'calibre-meta-link';
        link.textContent = (a.name || a.sort || '').replace(/\|/g, ', ');
        link.addEventListener('click', () => {
          dialog.close();
          resetCategoryFilters();
          state.selectedAuthor = { id: a.id, name: a.name };
          switchTab('books');
        });
        authorEl.appendChild(link);
      });
    } else {
      authorEl.textContent = details.author_sort || 'Auteur inconnu';
    }

    // 2. Formats (clickable blue links: EPUB, MOBI...)
    const formatsRow = document.getElementById('modal-formats-row');
    const formatsEl = document.getElementById('modal-book-formats');
    if (formatsEl) {
      formatsEl.innerHTML = '';
      if (details.dataFiles && details.dataFiles.length > 0) {
        if (formatsRow) formatsRow.hidden = false;
        details.dataFiles.forEach((d, idx) => {
          if (idx > 0) formatsEl.appendChild(document.createTextNode(', '));
          const link = document.createElement('a');
          link.className = 'calibre-meta-link';
          link.textContent = d.format;
          link.title = `${d.name}.${d.format.toLowerCase()} (${formatBytes(d.size)})`;
          link.addEventListener('click', () => {
            if (d.format === 'EPUB') {
              readCurrentBook();
            } else {
              dialog.close();
              resetCategoryFilters();
              state.selectedFormat = d.format;
              switchTab('books');
            }
          });
          formatsEl.appendChild(link);
        });
      } else {
        if (formatsRow) formatsRow.hidden = false;
        formatsEl.textContent = 'Aucun';
      }
    }

    // 3. Series ("II de Alice's Adventures" clickable blue link like shot5_web_content_server.png)
    const seriesRow = document.getElementById('modal-series-row');
    const seriesEl = document.getElementById('modal-book-series');
    const seriesNav = document.getElementById('modal-series-nav');
    if (details.series && details.series.length > 0) {
      seriesRow.hidden = false;
      seriesEl.innerHTML = '';
      const s = details.series[0];
      const romanIdx = toRoman(details.series_index);
      seriesEl.appendChild(document.createTextNode(`${romanIdx} de `));
      const sLink = document.createElement('a');
      sLink.className = 'calibre-meta-link';
      sLink.textContent = s.name;
      sLink.addEventListener('click', () => {
        dialog.close();
        resetCategoryFilters();
        state.selectedSeries = { id: s.id, name: s.name };
        switchTab('books');
      });
      seriesEl.appendChild(sLink);

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

    // 4. Rating
    const ratingRow = document.getElementById('modal-rating-row');
    if (details.rating) {
      ratingRow.hidden = false;
      document.getElementById('modal-book-rating').innerHTML = renderStars(details.rating);
    } else {
      ratingRow.hidden = true;
    }

    // 5. Publisher (clickable blue link)
    const pubRow = document.getElementById('modal-pub-row');
    const pubEl = document.getElementById('modal-book-publisher');
    if (details.publishers && details.publishers.length > 0) {
      pubRow.hidden = false;
      pubEl.innerHTML = '';
      details.publishers.forEach((p, idx) => {
        if (idx > 0) pubEl.appendChild(document.createTextNode(', '));
        const link = document.createElement('a');
        link.className = 'calibre-meta-link';
        link.textContent = p.name;
        link.addEventListener('click', () => {
          dialog.close();
          resetCategoryFilters();
          state.selectedPublisher = { id: p.id, name: p.name };
          switchTab('books');
        });
        pubEl.appendChild(link);
      });
    } else {
      pubRow.hidden = true;
    }

    // 6. Identifiers (ISBN, Google, Amazon...)
    const idsRow = document.getElementById('modal-ids-row');
    const idsEl = document.getElementById('modal-book-identifiers');
    if (idsRow && idsEl) {
      if (details.identifiers && details.identifiers.length > 0) {
        idsRow.hidden = false;
        idsEl.innerHTML = details.identifiers.map((idObj) =>
          `<span class="calibre-meta-link" onclick="CalibreApp.copyToClipboard('${escapeHtml(idObj.val)}')" title="Cliquer pour copier (${escapeHtml(idObj.type)})">${escapeHtml(idObj.val)}</span>`
        ).join(', ');
      } else {
        idsRow.hidden = true;
      }
    }

    // 7. Tags (clickable blue links like shot5_web_content_server.png)
    const tagsContainer = document.getElementById('modal-tags-container');
    const tagsRow = document.getElementById('modal-tags-row');
    tagsContainer.innerHTML = '';
    if (details.tags && details.tags.length > 0) {
      if (tagsRow) tagsRow.hidden = false;
      details.tags.forEach((tag, idx) => {
        if (idx > 0) tagsContainer.appendChild(document.createTextNode(', '));
        const link = document.createElement('a');
        link.className = 'calibre-meta-link tag-badge';
        link.textContent = tag.name;
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          dialog.close();
          filterByTag(tag.id, tag.name);
        });
        tagsContainer.appendChild(link);
      });
    } else {
      if (tagsRow) tagsRow.hidden = true;
    }

    // 8. Path ("Cliquer pour ouvrir" link like shot1_main.png)
    const pathEl = document.getElementById('modal-book-path-link');
    if (pathEl) {
      const pathStr = details.path || `Livre #${details.id}`;
      pathEl.innerHTML = `<a class="calibre-meta-link" title="${escapeHtml(pathStr)}" onclick="CalibreApp.copyToClipboard('${escapeHtml(pathStr).replace(/'/g, "\\'")}')">Cliquer pour copier (${escapeHtml(pathStr)})</a>`;
    }

    // 9. Synopsis / Summary
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
    fileStatusText.innerHTML = `
      <div class="file-status-checking-card">
        <div class="spinner-sm"></div>
        <span>Vérification du fichier EPUB dans la bibliothèque locale...</span>
      </div>
    `;
    fileStatusText.className = 'status-checking';

    // Open modal IMMEDIATELY
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }

    // Load Reading Status
    CalibreStorage.getReadingStatus(bookId).then((currentStatus) => {
      if (state.selectedBookId === Number(bookId)) {
        document.getElementById('modal-reading-status-select').value = currentStatus;
      }
    }).catch(console.warn);

    // Load Cover URL
    CalibreDB.getCoverUrl(details).then((url) => {
      if (state.selectedBookId === Number(bookId) && url) {
        coverImg.src = url;
      }
    }).catch(console.warn);

    // Check EPUB availability
    checkAndRenderBookFileStatus(bookId, details);
  }

  function checkAndRenderBookFileStatus(bookId, details) {
    const btnReadEpub = document.getElementById('modal-read-epub-btn');
    const btnShare = document.getElementById('modal-share-btn');
    const fileStatusText = document.getElementById('modal-file-status');

    CalibreDB.getBookBlob(bookId, 'EPUB').then((epubBlobInfo) => {
      if (state.selectedBookId !== Number(bookId)) return;

      if (epubBlobInfo) {
        btnReadEpub.hidden = false;
        btnShare.hidden = false;
        fileStatusText.innerHTML = renderAvailableFileCard(epubBlobInfo);
        fileStatusText.className = 'status-available';
      } else {
        btnReadEpub.hidden = true;
        btnShare.hidden = true;
        fileStatusText.innerHTML = renderMissingFileCard(details);
        fileStatusText.className = 'status-missing';
      }
    }).catch((err) => {
      console.warn('Erreur vérification EPUB:', err);
      if (state.selectedBookId === Number(bookId)) {
        btnReadEpub.hidden = true;
        btnShare.hidden = true;
        fileStatusText.innerHTML = renderMissingFileCard(details);
        fileStatusText.className = 'status-missing';
      }
    });
  }

  function recheckCurrentBookFile() {
    if (!state.selectedBookId) return;
    const details = CalibreDB.getBookDetails(state.selectedBookId);
    if (details) {
      checkAndRenderBookFileStatus(state.selectedBookId, details);
      showToast('Vérification du fichier local effectuée.', 'info');
    }
  }

  /**
   * Navigate to Previous (<) or Next (>) Book directly from the Book Details Cover Overlay
   * (Matches shot5_web_content_server.png cover arrows)
   */
  function navigateDetailBook(delta) {
    if (!state.books.length || !state.selectedBookId) return;
    const curIdx = state.books.findIndex((b) => Number(b.id) === state.selectedBookId);
    if (curIdx === -1) return;
    const nextIdx = (curIdx + delta + state.books.length) % state.books.length;
    const targetBook = state.books[nextIdx];
    if (targetBook) {
      openBookDetail(targetBook.id);
    }
  }

  /**
   * Calibre Toolbar Actions on Selected Book
   */
  function getActiveOrFirstBookId() {
    if (state.selectedBookId) return state.selectedBookId;
    if (state.books.length > 0) {
      state.selectedBookId = state.books[0].id;
      return state.selectedBookId;
    }
    showToast('Aucun livre sélectionné.', 'warning');
    return null;
  }

  function openSelectedBookDetail() {
    const id = getActiveOrFirstBookId();
    if (id) openBookDetail(id);
  }

  async function readSelectedBook() {
    const id = getActiveOrFirstBookId();
    if (!id) return;
    state.selectedBookId = id;
    const fileInfo = await CalibreDB.getBookBlob(id, 'EPUB');
    if (!fileInfo) {
      openBookDetail(id);
      return;
    }
    const details = CalibreDB.getBookDetails(id);
    CalibreReader.open(id, fileInfo.blob, details ? details.title : 'Livre');
  }

  async function shareSelectedBook() {
    const id = getActiveOrFirstBookId();
    if (!id) return;
    state.selectedBookId = id;
    const fileInfo = await CalibreDB.getBookBlob(id, 'EPUB');
    if (!fileInfo) {
      openBookDetail(id);
      return;
    }
    await shareCurrentBook();
  }

  async function saveSelectedToDisk() {
    const id = getActiveOrFirstBookId();
    if (id) {
      const fileInfo = await CalibreDB.getBookBlob(id, 'EPUB');
      if (fileInfo && fileInfo.blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(fileInfo.blob);
        a.download = fileInfo.filename || 'livre.epub';
        a.click();
        showToast(`Téléchargement de ${fileInfo.filename} lancé.`, 'success');
        return;
      }
    }
    exportDatabase();
  }

  /**
   * Calibre Metadata Editor Modal (Éditer les métadonnées)
   */
  function openEditMetadataForSelected() {
    const id = getActiveOrFirstBookId();
    if (!id) return;
    state.selectedBookId = id;
    openEditMetadataModal();
  }

  function openEditMetadataModal() {
    if (!state.selectedBookId) return;
    const details = CalibreDB.getBookDetails(state.selectedBookId);
    if (!details) return;

    document.getElementById('edit-meta-title').value = details.title || '';
    const authorsStr = (details.authors && details.authors.length > 0)
      ? details.authors.map((a) => (a.name || a.sort || '')).join(', ')
      : (details.author_sort || '');
    document.getElementById('edit-meta-authors').value = authorsStr;
    document.getElementById('edit-meta-series').value = (details.series && details.series[0]) ? details.series[0].name : '';
    document.getElementById('edit-meta-series-index').value = details.series_index || 1;
    document.getElementById('edit-meta-rating').value = details.rating ? String(Math.round(details.rating / 2)) : '0';
    document.getElementById('edit-meta-publisher').value = (details.publishers && details.publishers[0]) ? details.publishers[0].name : '';
    document.getElementById('edit-meta-tags').value = (details.tags || []).map((t) => t.name).join(', ');
    document.getElementById('edit-meta-comment').value = details.comment || '';

    const editDialog = document.getElementById('edit-metadata-dialog');
    if (editDialog) editDialog.showModal();
  }

  async function saveEditedMetadata() {
    if (!state.selectedBookId) return;
    try {
      const meta = {
        title: document.getElementById('edit-meta-title').value,
        authors: document.getElementById('edit-meta-authors').value,
        series: document.getElementById('edit-meta-series').value,
        series_index: document.getElementById('edit-meta-series-index').value,
        ratingStars: document.getElementById('edit-meta-rating').value,
        publisher: document.getElementById('edit-meta-publisher').value,
        tags: document.getElementById('edit-meta-tags').value,
        comment: document.getElementById('edit-meta-comment').value
      };

      await CalibreDB.updateBookMetadata(state.selectedBookId, meta);
      document.getElementById('edit-metadata-dialog').close();
      showToast('✓ Métadonnées enregistrées dans metadata.db !', 'success');

      renderTagBrowserTree();
      loadBooks(true);
      const detailDialog = document.getElementById('book-detail-dialog');
      if (detailDialog && detailDialog.open) {
        openBookDetail(state.selectedBookId);
      }
    } catch (err) {
      console.error('Erreur mise à jour métadonnées:', err);
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  /**
   * Delete Book from SQLite Database
   */
  function deleteSelectedBookPrompt() {
    const id = getActiveOrFirstBookId();
    if (!id) return;
    state.selectedBookId = id;
    deleteCurrentBook();
  }

  async function deleteCurrentBook() {
    if (!state.selectedBookId) return;
    const details = CalibreDB.getBookDetails(state.selectedBookId);
    const title = details ? details.title : `#${state.selectedBookId}`;
    if (!confirm(`Supprimer « ${title} » de la base de données Calibre locale ?`)) return;

    try {
      await CalibreDB.deleteBook(state.selectedBookId);
      const detailDialog = document.getElementById('book-detail-dialog');
      if (detailDialog && detailDialog.open) detailDialog.close();

      showToast(`Livre « ${title} » supprimé.`, 'info');
      state.selectedBookId = null;
      refreshStats();
      renderTagBrowserTree();
      loadBooks(true);
    } catch (err) {
      showToast('Erreur suppression : ' + err.message, 'error');
    }
  }

  /**
   * Read current book in EPUB reader
   */
  async function readCurrentBook() {
    if (!state.selectedBookId) return;
    const fileInfo = await CalibreDB.getBookBlob(state.selectedBookId, 'EPUB');
    if (!fileInfo) {
      const details = CalibreDB.getBookDetails(state.selectedBookId);
      const expectedFile = (details && details.dataFiles && details.dataFiles[0])
        ? `${details.dataFiles[0].name}.${details.dataFiles[0].format.toLowerCase()}`
        : 'fichier ebook';
      showToast(`Fichier "${expectedFile}" non trouvé dans le dossier local.`, 'warning');
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
        <span class="item-name"><span aria-hidden="true">${s.icon || '📚'}</span> ${escapeHtml(s.name)}</span>
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
    booksContainer.className = state.viewMode === 'list' ? 'view-mode-list' : 'view-mode-grid';
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
        <span class="item-name">${escapeHtml(a.name)}</span>
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
    container.className = state.viewMode === 'list' ? 'view-mode-list' : 'view-mode-grid';
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
        <span class="item-name">${escapeHtml(s.name)}</span>
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
    container.className = state.viewMode === 'list' ? 'view-mode-list' : 'view-mode-grid';
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
    resetCategoryFilters();
    state.selectedTag = { id, name };
    switchTab('books');
  }

  /**
   * Active Filter Chips
   */
  function updateFilterChips() {
    const container = document.getElementById('active-filters');
    if (!container) return;
    container.innerHTML = '';
    const chips = [];

    if (state.selectedAuthor) {
      chips.push({
        label: `Auteur : ${state.selectedAuthor.name}`,
        onRemove: () => { state.selectedAuthor = null; loadBooks(true); }
      });
    }

    if (state.selectedSeries) {
      chips.push({
        label: `Série : ${state.selectedSeries.name}`,
        onRemove: () => { state.selectedSeries = null; loadBooks(true); }
      });
    }

    if (state.selectedTag) {
      chips.push({
        label: `Étiquette : ${state.selectedTag.name}`,
        onRemove: () => { state.selectedTag = null; loadBooks(true); }
      });
    }

    if (state.selectedPublisher) {
      chips.push({
        label: `Éditeur : ${state.selectedPublisher.name}`,
        onRemove: () => { state.selectedPublisher = null; loadBooks(true); }
      });
    }

    if (state.selectedLanguage) {
      chips.push({
        label: `Langue : ${state.selectedLanguage.name}`,
        onRemove: () => { state.selectedLanguage = null; loadBooks(true); }
      });
    }

    if (state.selectedRating !== null && state.selectedRating !== undefined) {
      chips.push({
        label: `Note : ${state.selectedRating} ★`,
        onRemove: () => { state.selectedRating = null; loadBooks(true); }
      });
    }

    if (state.selectedIdentifier) {
      chips.push({
        label: `ID : ${state.selectedIdentifier.toUpperCase()}`,
        onRemove: () => { state.selectedIdentifier = null; loadBooks(true); }
      });
    }

    if (state.selectedFormat) {
      chips.push({
        label: `Format : ${state.selectedFormat}`,
        onRemove: () => { state.selectedFormat = null; loadBooks(true); }
      });
    }

    chips.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = `${escapeHtml(c.label)} <button type="button" aria-label="Supprimer le filtre">×</button>`;
      chip.querySelector('button').addEventListener('click', c.onRemove);
      container.appendChild(chip);
    });

    container.hidden = chips.length === 0;
  }

  /**
   * Set View Mode: 'grid' (Content Server), 'table' (Calibre Desktop Table), or 'list'
   */
  function setViewMode(mode, save = true) {
    state.viewMode = mode;

    const booksContainer = document.getElementById('books-container');
    const tableRegion = document.getElementById('calibre-table-region');

    if (mode === 'table') {
      if (booksContainer) booksContainer.hidden = true;
      if (tableRegion) tableRegion.hidden = false;
    } else {
      if (booksContainer) booksContainer.hidden = false;
      if (tableRegion) tableRegion.hidden = true;
    }

    const containers = document.querySelectorAll('#books-container, #shelf-books-container, #author-books-container, #series-books-container');
    containers.forEach((c) => {
      c.classList.toggle('view-mode-grid', mode !== 'list');
      c.classList.toggle('view-mode-list', mode === 'list');
    });

    const btnGrid = document.getElementById('btn-view-grid');
    const btnTable = document.getElementById('btn-view-table');
    const btnList = document.getElementById('btn-view-list');
    if (btnGrid) btnGrid.classList.toggle('active', mode === 'grid');
    if (btnTable) btnTable.classList.toggle('active', mode === 'table');
    if (btnList) btnList.classList.toggle('active', mode === 'list');

    if (save) CalibreStorage.setSetting('view_mode', mode);
  }

  async function setupTheme() {
    const savedTheme = await CalibreStorage.getSetting('app_theme', 'dark');
    state.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeButtonIcon(savedTheme);
  }

  function updateThemeButtonIcon(themeName) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    btn.textContent = themeName === 'dark' ? '🌙' : themeName === 'light' ? '☀️' : '📜';
  }

  function cycleTheme() {
    const themes = ['dark', 'light', 'sepia'];
    const curIdx = themes.indexOf(state.theme);
    const nextTheme = themes[(curIdx + 1) % themes.length];
    state.theme = nextTheme;
    document.documentElement.setAttribute('data-theme', nextTheme);
    updateThemeButtonIcon(nextTheme);
    CalibreStorage.setSetting('app_theme', nextTheme);
    const label = nextTheme === 'dark'
      ? 'Mode Nuit Calibre'
      : nextTheme === 'light'
        ? 'Mode Jour (Serveur Calibre)'
        : 'Mode Sépia';
    showToast(`Thème : ${label}`, 'info');
  }

  async function handleDbFileImport(file) {
    if (!file.name.toLowerCase().endsWith('.db')) {
      showToast('Veuillez sélectionner un fichier .db (ex: metadata.db)', 'error');
      return;
    }

    updateDbStatusBadge('Chargement...', 'badge-loading');
    showToast('Lecture de la base de données Calibre...', 'info');

    try {
      const buffer = await file.arrayBuffer();
      CalibreDB.loadFromArrayBuffer(buffer, file.name);
      await CalibreStorage.saveMetadataDB(buffer, file.name);

      const libName = file.name.replace(/\.db$/i, '');
      updateHeaderLibraryTitle(libName);
      updateDbStatusBadge(`${file.name}`, 'badge-success');
      showToast(`Base ${file.name} chargée avec succès !`, 'success');
      refreshStats();
      renderTagBrowserTree();
      switchTab('books');
    } catch (err) {
      console.error('Erreur import base:', err);
      updateDbStatusBadge('Erreur DB', 'badge-danger');
      showToast('Erreur : ' + err.message, 'error');
    }
  }

  async function loadDemoDatabase(silent = false) {
    updateDbStatusBadge('Chargement...', 'badge-loading');
    if (!silent) showToast('Chargement de la bibliothèque démo Calibre...', 'info');

    try {
      const resp = await fetch('./sample-metadata.db');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      CalibreDB.loadFromArrayBuffer(buffer, 'demo library');
      await CalibreStorage.saveMetadataDB(buffer, 'demo library');

      updateHeaderLibraryTitle('demo library');
      updateDbStatusBadge('demo library', 'badge-success');
      if (!silent) showToast('Bibliothèque démo Calibre prête !', 'success');
      refreshStats();
      renderTagBrowserTree();
      switchTab('books');
    } catch (err) {
      if (!silent) showToast('Erreur démo : ' + err.message, 'error');
    }
  }

  function exportDatabase() {
    try {
      const data = CalibreDB.export();
      const blob = new Blob([data], { type: 'application/x-sqlite3' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const rawName = CalibreDB.getDbName() || 'metadata.db';
      a.download = rawName.endsWith('.db') ? rawName : `${rawName}.db`;
      a.click();
      showToast('Base metadata.db exportée.', 'success');
    } catch (err) {
      showToast('Erreur export : ' + err.message, 'error');
    }
  }

  async function clearLibrary() {
    if (!confirm('Voulez-vous réinitialiser le stockage local ?')) return;
    await CalibreStorage.clearAll();
    CalibreDB.close();
    updateDbStatusBadge('Aucune base', 'badge-warning');
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
        <div class="stat-card"><div class="stat-number">${stats.tags.toLocaleString('fr-FR')}</div><div class="stat-label">Étiquettes</div></div>
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
        <p><strong>Bibliothèque active :</strong> ${escapeHtml(CalibreDB.getDbName() || 'Aucune')}</p>
        <p><strong>Taille base SQLite :</strong> ${dbSaved ? formatBytes(dbSaved.size) : '0 B'}</p>
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
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">📚</div>
        <h2>calibre PWA pour Android</h2>
        <p>Chargez votre bibliothèque Calibre pour gérer et lire vos livres hors-ligne :</p>
        <div class="empty-state-actions">
          <button class="btn btn-primary" onclick="CalibreApp.defineLocalDirectory()">
            📁 Définir le dossier local des livres
          </button>
          <button class="btn btn-primary" onclick="CalibreApp.defineLocalZipArchive()" style="background: var(--surface-3); border: 1px solid var(--accent); color: var(--text);">
            📦 Ouvrir une archive .ZIP (metadata.db + EPUBs)
          </button>
          <button class="btn btn-secondary" onclick="document.getElementById('input-file-db').click()">
            🗄️ Charger metadata.db
          </button>
          <button class="btn btn-ghost" onclick="CalibreApp.loadDemoDatabase()">
            🚀 Ouvrir la bibliothèque démo Calibre
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
    resetAndGoBooks,
    openTagDrawer,
    defineLocalDirectory,
    defineLocalZipArchive,
    rescanLocalDirectory,
    disconnectLocalDirectory,
    loadDemoDatabase,
    openBookDetail,
    recheckCurrentBookFile,
    navigateDetailBook,
    openSelectedBookDetail,
    readSelectedBook,
    shareSelectedBook,
    saveSelectedToDisk,
    openEditMetadataForSelected,
    openEditMetadataModal,
    deleteSelectedBookPrompt,
    deleteCurrentBook,
    stepCoverFlow,
    toggleCoverFlow,
    toggleCalibreToolbar,
    triggerSearch,
    focusSearchBar,
    cycleQuickSort,
    selectVirtualTab,
    saveCurrentSearchAsTab,
    closeVirtualTab,
    sortTableByColumn,
    closeShelfDetail,
    closeAuthorDetail,
    closeSeriesDetail,
    filterByTag,
    copyToClipboard
  };
})();

window.CalibreApp = CalibreApp;

document.addEventListener('DOMContentLoaded', () => {
  CalibreApp.init();
});
