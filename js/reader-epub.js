/**
 * Calibre-Web PWA - EPUB Reader Module
 * Powered by epub.js with swipe gestures, theme switcher, TOC drawer, and progress tracking.
 */

const CalibreReader = (function () {
  'use strict';

  let currentBook = null;
  let currentRendition = null;
  let currentBookId = null;
  let currentToc = [];
  let currentFontSizePercent = 100;
  let currentTheme = 'dark';

  const themes = {
    dark: {
      name: 'Sombre',
      styles: {
        body: {
          'background': '#161b22 !important',
          'color': '#e6edf3 !important',
          'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
          'line-height': '1.6 !important'
        },
        'a': { 'color': '#58a6ff !important' },
        'p': { 'margin-bottom': '1em !important' }
      }
    },
    light: {
      name: 'Clair',
      styles: {
        body: {
          'background': '#ffffff !important',
          'color': '#24292f !important',
          'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
          'line-height': '1.6 !important'
        },
        'a': { 'color': '#0969da !important' },
        'p': { 'margin-bottom': '1em !important' }
      }
    },
    sepia: {
      name: 'Sépia',
      styles: {
        body: {
          'background': '#fbf0d9 !important',
          'color': '#5f4b32 !important',
          'font-family': 'Georgia, serif !important',
          'line-height': '1.6 !important'
        },
        'a': { 'color': '#8b572a !important' },
        'p': { 'margin-bottom': '1em !important' }
      }
    },
    black: {
      name: 'OLED Noir',
      styles: {
        body: {
          'background': '#000000 !important',
          'color': '#b3b3b3 !important',
          'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
          'line-height': '1.6 !important'
        },
        'a': { 'color': '#4ea1f3 !important' },
        'p': { 'margin-bottom': '1em !important' }
      }
    }
  };

  /**
   * Open EPUB reader modal and render book
   */
  async function openEpub(bookId, blobOrBuffer, title = 'Livre') {
    const dialog = document.getElementById('reader-dialog');
    const titleEl = document.getElementById('reader-title');
    const container = document.getElementById('reader-viewer');
    const progressEl = document.getElementById('reader-progress-text');
    const progressBar = document.getElementById('reader-progress-bar');
    const tocList = document.getElementById('reader-toc-list');

    if (!dialog || !container) {
      alert('Conteneur du lecteur introuvable.');
      return;
    }

    currentBookId = Number(bookId);
    titleEl.textContent = title;
    container.innerHTML = '';
    tocList.innerHTML = '<li class="loading-item">Chargement de la table des matières...</li>';
    progressEl.textContent = '0%';
    progressBar.style.width = '0%';

    // Open modal
    dialog.showModal();

    // Clean up previous book instance
    if (currentBook) {
      try { currentBook.destroy(); } catch (e) {}
      currentBook = null;
      currentRendition = null;
    }

    try {
      // Determine book data source
      let bookInput = blobOrBuffer;
      if (blobOrBuffer instanceof Blob) {
        bookInput = await blobOrBuffer.arrayBuffer();
      }

      if (typeof ePub !== 'function') {
        throw new Error('Bibliothèque epub.js non chargée.');
      }

      // Initialize ePub book
      currentBook = ePub(bookInput);

      // Render book
      currentRendition = currentBook.renderTo(container, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });

      // Register themes
      Object.keys(themes).forEach((tKey) => {
        currentRendition.themes.register(tKey, themes[tKey].styles);
      });

      // Apply initial theme & font size
      currentTheme = (await CalibreStorage.getSetting('reader_theme')) || 'dark';
      currentRendition.themes.select(currentTheme);

      currentFontSizePercent = (await CalibreStorage.getSetting('reader_font_size')) || 100;
      currentRendition.themes.fontSize(`${currentFontSizePercent}%`);

      // Restore saved progress if available
      const savedProgress = await CalibreStorage.getProgress(currentBookId);
      if (savedProgress && savedProgress.cfi) {
        await currentRendition.display(savedProgress.cfi);
      } else {
        await currentRendition.display();
      }

      // Setup touch swipe events for mobile
      setupTouchSwipe(currentRendition);

      // Setup key navigation
      setupKeyNavigation(currentRendition);

      // Generate locations for progress tracking
      currentBook.ready.then(() => {
        return currentBook.locations.generate(1000);
      }).then(() => {
        updateProgress();
      }).catch((err) => {
        console.warn('Erreur génération locations:', err);
      });

      // Track location changes
      currentRendition.on('relocated', (location) => {
        updateProgress(location);
      });

      // Load TOC (Table of Contents)
      currentBook.loaded.navigation.then((nav) => {
        currentToc = nav.toc || [];
        renderToc(currentToc, tocList);
      });

    } catch (err) {
      console.error('Erreur ouverture EPUB:', err);
      container.innerHTML = `
        <div class="reader-error">
          <p>⚠️ Impossible d'ouvrir l'ebook : ${err.message}</p>
          <button class="btn btn-primary" onclick="CalibreReader.close()">Fermer</button>
        </div>
      `;
    }
  }

  /**
   * Setup touch gestures on reader frame
   */
  function setupTouchSwipe(rendition) {
    let touchStartX = 0;
    let touchStartY = 0;
    const threshold = 50;

    rendition.on('touchstart', (event) => {
      touchStartX = event.changedTouches[0].screenX;
      touchStartY = event.changedTouches[0].screenY;
    });

    rendition.on('touchend', (event) => {
      const touchEndX = event.changedTouches[0].screenX;
      const touchEndY = event.changedTouches[0].screenY;

      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

      // Only horizontal swipe if diffX is significantly larger than vertical movement
      if (Math.abs(diffX) > threshold && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          rendition.next(); // Swipe left -> Next page
        } else {
          rendition.prev(); // Swipe right -> Previous page
        }
      }
    });
  }

  /**
   * Keyboard navigation for tablets with keyboard or desktop
   */
  function setupKeyNavigation(rendition) {
    rendition.on('keyup', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        rendition.next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        rendition.prev();
      }
    });
  }

  /**
   * Update reading progress and persist to storage
   */
  function updateProgress(location) {
    if (!currentBook || !currentRendition) return;

    const loc = location || currentRendition.currentLocation();
    if (!loc || !loc.start) return;

    let percent = 0;
    if (currentBook.locations && currentBook.locations.total > 0 && loc.start.cfi) {
      percent = Math.floor(currentBook.locations.percentageFromCfi(loc.start.cfi) * 100);
    }

    const progressEl = document.getElementById('reader-progress-text');
    const progressBar = document.getElementById('reader-progress-bar');
    if (progressEl) progressEl.textContent = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;

    // Persist progress
    if (currentBookId && loc.start.cfi) {
      CalibreStorage.saveProgress(currentBookId, {
        cfi: loc.start.cfi,
        percentage: percent
      });
    }
  }

  /**
   * Render Table of Contents
   */
  function renderToc(items, listEl) {
    listEl.innerHTML = '';
    if (!items || items.length === 0) {
      listEl.innerHTML = '<li class="empty-item">Aucun sommaire disponible</li>';
      return;
    }

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'toc-item';
      li.textContent = item.label ? item.label.trim() : 'Chapitre';
      li.addEventListener('click', () => {
        if (currentRendition && item.href) {
          currentRendition.display(item.href);
          toggleToc(false);
        }
      });
      listEl.appendChild(li);

      // Sub-items
      if (item.subitems && item.subitems.length > 0) {
        const subUl = document.createElement('ul');
        subUl.className = 'toc-sublist';
        renderToc(item.subitems, subUl);
        listEl.appendChild(subUl);
      }
    });
  }

  /**
   * Toggle TOC drawer
   */
  function toggleToc(force) {
    const drawer = document.getElementById('reader-toc-drawer');
    if (!drawer) return;
    if (typeof force === 'boolean') {
      drawer.classList.toggle('open', force);
    } else {
      drawer.classList.toggle('open');
    }
  }

  return {
    open(bookId, blobOrBuffer, title) {
      return openEpub(bookId, blobOrBuffer, title);
    },

    next() {
      if (currentRendition) currentRendition.next();
    },

    prev() {
      if (currentRendition) currentRendition.prev();
    },

    toggleToc() {
      toggleToc();
    },

    setTheme(themeName) {
      if (!currentRendition || !themes[themeName]) return;
      currentTheme = themeName;
      currentRendition.themes.select(themeName);
      CalibreStorage.setSetting('reader_theme', themeName);

      // Highlight active theme button
      document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === themeName);
      });
    },

    changeFontSize(delta) {
      if (!currentRendition) return;
      currentFontSizePercent = Math.max(70, Math.min(220, currentFontSizePercent + delta));
      currentRendition.themes.fontSize(`${currentFontSizePercent}%`);
      CalibreStorage.setSetting('reader_font_size', currentFontSizePercent);
    },

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      }
    },

    close() {
      const dialog = document.getElementById('reader-dialog');
      if (dialog) dialog.close();
      if (currentBook) {
        try { currentBook.destroy(); } catch (e) {}
        currentBook = null;
        currentRendition = null;
      }
      currentBookId = null;
    }
  };
})();
