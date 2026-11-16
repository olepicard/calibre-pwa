/**
 * Calibre-Web NextGen PWA - SQLite Engine & Local Filesystem Manager
 * Supports WebAssembly SQLite, persistent Local Directory Handles (File System Access API),
 * Calibre standard folder resolution, and NextGen Smart Shelves.
 */

const CalibreDB = (function () {
  'use strict';

  let sqlEngine = null;
  let dbInstance = null;
  let dbName = 'metadata.db';

  // Persistent Directory Handle (File System Access API)
  let localDirectoryHandle = null;
  let localDirectoryName = '';
  let localDirectoryStatus = 'none'; // 'none' | 'connected' | 'needs_permission'

  // Fast in-memory index of files found in the local directory
  // Key: normalized relative path or filename (lowercase), Value: File or FileSystemFileHandle
  const localFileMap = new Map();
  const epubIndex = new Map(); // filename (lowercase) -> handle/file
  const coverIndex = new Map(); // bookPath/cover -> handle/file

  // Cache of created object URLs to release on unload
  const createdObjectUrls = new Set();

  /**
   * Initialize sql.js WebAssembly engine
   */
  async function initEngine() {
    if (sqlEngine) return sqlEngine;

    if (typeof initSqlJs !== 'function') {
      throw new Error('sql.js non chargé. Vérifiez lib/sql-wasm.js.');
    }

    sqlEngine = await initSqlJs({
      locateFile: (file) => './lib/' + file
    });
    return sqlEngine;
  }

  /**
   * Normalize path for file resolution
   */
  function normalizePath(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  }

  /**
   * Generate NextGen elevated SVG Book Cover
   */
  function generateNextGenCover(title, author, bookId = 0) {
    const safeTitle = (title || 'Sans Titre')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeAuthor = (author || 'Auteur Inconnu')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // NextGen elevated caliBlur palettes
    const palettes = [
      { bg1: '#141c24', bg2: '#1b2530', accent: '#cc7b19', accentLight: '#e6a13f' }, // CaliBlur signature amber
      { bg1: '#16222f', bg2: '#203345', accent: '#3b82f6', accentLight: '#60a5fa' }, // Deep Blue
      { bg1: '#1a221b', bg2: '#223326', accent: '#10b981', accentLight: '#34d399' }, // Forest Emerald
      { bg1: '#261723', bg2: '#381f33', accent: '#d946ef', accentLight: '#f472b6' }, // Velvet Plum
      { bg1: '#241a15', bg2: '#36241c', accent: '#f97316', accentLight: '#fb923c' }, // Warm Rust
      { bg1: '#151f28', bg2: '#1d2c3a', accent: '#06b6d4', accentLight: '#22d3ee' }  // Nordic Teal
    ];

    const idx = Math.abs(Number(bookId) || 0) % palettes.length;
    const p = palettes[idx];

    let displayTitle = safeTitle;
    if (displayTitle.length > 55) {
      displayTitle = displayTitle.substring(0, 52) + '...';
    }

    const words = displayTitle.split(' ');
    const lines = [];
    let curLine = '';
    for (const w of words) {
      if ((curLine + ' ' + w).trim().length > 18 && curLine) {
        lines.push(curLine.trim());
        curLine = w;
      } else {
        curLine += (curLine ? ' ' : '') + w;
      }
      if (lines.length >= 3) break;
    }
    if (curLine && lines.length < 3) lines.push(curLine.trim());

    const titleSpans = lines.map((line, i) => {
      const y = 195 + (i * 26);
      return `<tspan x="150" y="${y}">${line}</tspan>`;
    }).join('');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="100%" height="100%">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${p.bg1}" />
            <stop offset="50%" stop-color="${p.bg2}" />
            <stop offset="100%" stop-color="${p.bg1}" />
          </linearGradient>
          <linearGradient id="spineEffect" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="rgba(0,0,0,0.6)" />
            <stop offset="3%" stop-color="rgba(255,255,255,0.18)" />
            <stop offset="7%" stop-color="rgba(0,0,0,0.35)" />
            <stop offset="12%" stop-color="rgba(0,0,0,0)" />
          </linearGradient>
          <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.4" />
          </filter>
        </defs>

        <!-- Base -->
        <rect width="300" height="450" rx="8" fill="url(#bgGrad)" />

        <!-- Double border -->
        <rect x="16" y="16" width="268" height="418" rx="5" fill="none" stroke="${p.accent}" stroke-width="1.2" stroke-opacity="0.4" />
        <rect x="22" y="22" width="256" height="406" rx="3" fill="none" stroke="${p.accent}" stroke-width="0.6" stroke-opacity="0.25" />

        <!-- NextGen Book Emblem -->
        <g transform="translate(150, 75)" opacity="0.85">
          <circle cx="0" cy="0" r="18" fill="none" stroke="${p.accent}" stroke-width="1.2" />
          <path d="M -8 -4 C -4 -7 0 -7 0 6 C 0 -7 4 -7 8 -4 L 8 4 C 4 1 0 1 0 14 C 0 1 -4 1 -8 4 Z" fill="${p.accentLight}" opacity="0.9"/>
        </g>

        <!-- Title -->
        <text text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="20" fill="#ece8e1" filter="url(#cardShadow)">
          ${titleSpans}
        </text>

        <!-- Separator -->
        <line x1="85" y1="315" x2="215" y2="315" stroke="${p.accent}" stroke-width="1.2" stroke-opacity="0.6" />

        <!-- Author -->
        <text x="150" y="348" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="14" fill="#9aa7b2" letter-spacing="0.5">
          ${safeAuthor.length > 32 ? safeAuthor.substring(0, 30) + '...' : safeAuthor}
        </text>

        <!-- Calibre NextGen Badge -->
        <text x="150" y="410" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9" font-weight="600" fill="${p.accent}" letter-spacing="2" opacity="0.7">
          CALIBRE-WEB NEXTGEN
        </text>

        <!-- 3D Spine overlay -->
        <rect width="300" height="450" rx="8" fill="url(#spineEffect)" pointer-events="none" />
      </svg>
    `.trim();

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /**
   * Helper to resolve a file inside a DirectoryHandle given a relative path like "Author/Book (1)/file.epub"
   */
  async function resolveFileInHandle(dirHandle, relPath) {
    if (!dirHandle || !relPath) return null;
    const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) return null;

    let current = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        current = await current.getDirectoryHandle(parts[i]);
      } catch (e) {
        return null;
      }
    }

    try {
      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch (e) {
      return null;
    }
  }

  return {
    /**
     * Initialize CalibreDB engine and restore saved local directory and database
     */
    async init() {
      await initEngine();

      // 1. Try restoring saved DirectoryHandle from IndexedDB
      await this.restoreSavedDirectoryHandle();

      // 2. Try loading metadata.db from IndexedDB
      const saved = await CalibreStorage.getMetadataDB();
      if (saved && saved.data) {
        try {
          this.loadFromArrayBuffer(saved.data, saved.name || 'metadata.db');
          return {
            loaded: true,
            name: saved.name,
            size: saved.size,
            directoryStatus: localDirectoryStatus,
            directoryName: localDirectoryName
          };
        } catch (err) {
          console.warn('Erreur lors du chargement de la base enregistrée:', err);
        }
      }

      return {
        loaded: false,
        directoryStatus: localDirectoryStatus,
        directoryName: localDirectoryName
      };
    },

    /**
     * Restore saved DirectoryHandle from storage
     */
    async restoreSavedDirectoryHandle() {
      if (!('showDirectoryPicker' in window)) {
        return;
      }

      try {
        const saved = await CalibreStorage.getDirectoryHandle();
        if (saved && saved.handle) {
          localDirectoryHandle = saved.handle;
          localDirectoryName = saved.name || localDirectoryHandle.name || 'Dossier Calibre';

          // Check permissions
          const perm = await localDirectoryHandle.queryPermission({ mode: 'read' });
          if (perm === 'granted') {
            localDirectoryStatus = 'connected';
            // Index directory in background
            this.scanDirectoryHandle(localDirectoryHandle).catch(console.warn);
          } else {
            localDirectoryStatus = 'needs_permission';
          }
        }
      } catch (err) {
        console.warn('Erreur restauration DirectoryHandle:', err);
      }
    },

    /**
     * Request re-granting permission on the saved DirectoryHandle
     */
    async requestDirectoryPermission() {
      if (!localDirectoryHandle) return false;
      try {
        const perm = await localDirectoryHandle.requestPermission({ mode: 'read' });
        if (perm === 'granted') {
          localDirectoryStatus = 'connected';
          await this.scanDirectoryHandle(localDirectoryHandle);
          return true;
        }
      } catch (e) {
        console.warn('Permission refusée:', e);
      }
      return false;
    },

    /**
     * Set a new local directory handle and persist it
     */
    async setLocalDirectoryHandle(dirHandle) {
      localDirectoryHandle = dirHandle;
      localDirectoryName = dirHandle.name;
      localDirectoryStatus = 'connected';

      // Persist in IndexedDB
      await CalibreStorage.saveDirectoryHandle(dirHandle);

      // Scan directory and build fast indexes
      await this.scanDirectoryHandle(dirHandle);

      // If metadata.db is in the directory, load and persist it!
      const dbFile = await this.findMetadataDbInMap();
      if (dbFile) {
        this.loadFromArrayBuffer(dbFile.buffer, 'metadata.db');
        await CalibreStorage.saveMetadataDB(dbFile.buffer, 'metadata.db');
      }

      return {
        name: localDirectoryName,
        filesIndexed: localFileMap.size,
        epubsCount: epubIndex.size,
        hasMetadataDb: dbFile !== null
      };
    },

    /**
     * Remove the local directory connection
     */
    async removeLocalDirectory() {
      localDirectoryHandle = null;
      localDirectoryName = '';
      localDirectoryStatus = 'none';
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();
      await CalibreStorage.removeDirectoryHandle();
    },

    getLocalDirectoryInfo() {
      return {
        handle: localDirectoryHandle,
        name: localDirectoryName,
        status: localDirectoryStatus,
        filesCount: localFileMap.size,
        epubsCount: epubIndex.size
      };
    },

    /**
     * Scan directory handle recursively and build fast lookup indices
     */
    async scanDirectoryHandle(dirHandle) {
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();

      async function walk(currentHandle, currentPath = '') {
        for await (const entry of currentHandle.values()) {
          const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          const normPath = normalizePath(entryPath);
          const normName = normalizePath(entry.name);

          if (entry.kind === 'file') {
            localFileMap.set(normPath, entry);
            localFileMap.set(normName, entry);

            // Index EPUBs
            if (normName.endsWith('.epub')) {
              epubIndex.set(normName, entry);
              epubIndex.set(normPath, entry);
            }
            // Index covers
            if (normName === 'cover.jpg' || normName === 'cover.jpeg' || normName === 'cover.png') {
              coverIndex.set(normPath, entry);
            }
          } else if (entry.kind === 'directory') {
            await walk(entry, entryPath);
          }
        }
      }

      await walk(dirHandle);
    },

    /**
     * Register fallback file list (e.g. from webkitdirectory input)
     */
    registerFileList(files) {
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();

      for (const file of files) {
        const relPath = file.webkitRelativePath || file.name;
        let cleanPath = normalizePath(relPath);
        const parts = cleanPath.split('/');
        if (parts.length > 1) {
          parts.shift(); // remove root folder name
          cleanPath = parts.join('/');
        }
        const normName = normalizePath(file.name);

        localFileMap.set(cleanPath, file);
        localFileMap.set(normName, file);

        if (normName.endsWith('.epub')) {
          epubIndex.set(normName, file);
          epubIndex.set(cleanPath, file);
        }
        if (normName === 'cover.jpg' || normName === 'cover.jpeg' || normName === 'cover.png') {
          coverIndex.set(cleanPath, file);
        }
      }

      if (files.length > 0 && files[0].webkitRelativePath) {
        localDirectoryName = files[0].webkitRelativePath.split('/')[0];
        localDirectoryStatus = 'connected';
      }

      return {
        filesCount: localFileMap.size,
        epubsCount: epubIndex.size
      };
    },

    /**
     * Find metadata.db inside local files
     */
    async findMetadataDbInMap() {
      const match = localFileMap.get('metadata.db');
      if (match) {
        let fileObj = match;
        if (typeof match.getFile === 'function') {
          fileObj = await match.getFile();
        }
        const buf = await fileObj.arrayBuffer();
        return { buffer: buf, file: fileObj };
      }
      return null;
    },

    /**
     * Load database from ArrayBuffer / Uint8Array
     */
    loadFromArrayBuffer(buffer, filename = 'metadata.db') {
      if (!sqlEngine) {
        throw new Error('Moteur SQL non initialisé.');
      }
      if (dbInstance) {
        try { dbInstance.close(); } catch (e) {}
      }

      const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      dbInstance = new sqlEngine.Database(u8);
      dbName = filename;
      return true;
    },

    isLoaded() {
      return dbInstance !== null;
    },

    getDbName() {
      return dbName;
    },

    close() {
      if (dbInstance) {
        try { dbInstance.close(); } catch (e) {}
        dbInstance = null;
      }
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      createdObjectUrls.clear();
    },

    export() {
      if (!dbInstance) throw new Error('Aucune base chargée.');
      return dbInstance.export();
    },

    /**
     * Get global statistics
     */
    getStats() {
      if (!dbInstance) return null;

      try {
        const countBooks = dbInstance.exec('SELECT COUNT(*) FROM books')[0]?.values[0][0] || 0;
        const countAuthors = dbInstance.exec('SELECT COUNT(*) FROM authors')[0]?.values[0][0] || 0;
        const countSeries = dbInstance.exec('SELECT COUNT(*) FROM series')[0]?.values[0][0] || 0;
        const countTags = dbInstance.exec('SELECT COUNT(*) FROM tags')[0]?.values[0][0] || 0;

        let formats = [];
        try {
          const resFmts = dbInstance.exec('SELECT format, COUNT(DISTINCT book) as count FROM data GROUP BY format ORDER BY count DESC');
          if (resFmts.length > 0) {
            formats = resFmts[0].values.map(([fmt, count]) => ({ format: fmt, count }));
          }
        } catch (e) {}

        return {
          books: countBooks,
          authors: countAuthors,
          series: countSeries,
          tags: countTags,
          formats: formats,
          localFilesMapped: localFileMap.size,
          epubsMapped: epubIndex.size,
          hasDirectory: localDirectoryStatus === 'connected',
          directoryName: localDirectoryName
        };
      } catch (e) {
        console.error('Erreur getStats:', e);
        return null;
      }
    },

    /**
     * Query books with pagination, sorting, and filters
     */
    getBooks(options = {}) {
      if (!dbInstance) return { total: 0, books: [] };

      const {
        search = '',
        authorId = null,
        seriesId = null,
        tagId = null,
        format = null,
        sortBy = 'timestamp_desc',
        offset = 0,
        limit = 24
      } = options;

      const whereClauses = [];
      const params = [];

      if (search && search.trim()) {
        const s = '%' + search.trim() + '%';
        whereClauses.push('(b.title LIKE ? OR b.author_sort LIKE ?)');
        params.push(s, s);
      }

      if (authorId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_authors_link bal WHERE bal.book = b.id AND bal.author = ?)');
        params.push(Number(authorId));
      }

      if (seriesId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_series_link bsl WHERE bsl.book = b.id AND bsl.series = ?)');
        params.push(Number(seriesId));
      }

      if (tagId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_tags_link btl WHERE btl.book = b.id AND btl.tag = ?)');
        params.push(Number(tagId));
      }

      if (format) {
        whereClauses.push('EXISTS (SELECT 1 FROM data d WHERE d.book = b.id AND UPPER(d.format) = ?)');
        params.push(String(format).toUpperCase());
      }

      const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

      let orderSql = 'ORDER BY b.timestamp DESC, b.id DESC';
      switch (sortBy) {
        case 'title_asc':
          orderSql = 'ORDER BY b.sort COLLATE NOCASE ASC, b.id DESC';
          break;
        case 'title_desc':
          orderSql = 'ORDER BY b.sort COLLATE NOCASE DESC, b.id DESC';
          break;
        case 'author_asc':
          orderSql = 'ORDER BY b.author_sort COLLATE NOCASE ASC, b.id DESC';
          break;
        case 'pubdate_desc':
          orderSql = 'ORDER BY b.pubdate DESC, b.id DESC';
          break;
        case 'rating_desc':
          orderSql = 'ORDER BY rating DESC, b.id DESC';
          break;
        case 'random':
          orderSql = 'ORDER BY RANDOM()';
          break;
        case 'id_desc':
        default:
          orderSql = 'ORDER BY b.timestamp DESC, b.id DESC';
          break;
      }

      let total = 0;
      try {
        const countRes = dbInstance.exec(`SELECT COUNT(*) FROM books b ${whereSql}`, params);
        total = countRes[0]?.values[0][0] || 0;
      } catch (err) {
        console.error('Erreur countQuery:', err);
      }

      if (total === 0) {
        return { total: 0, books: [] };
      }

      const dataQuery = `
        SELECT
          b.id,
          b.title,
          b.sort,
          b.author_sort,
          b.path,
          b.has_cover,
          b.series_index,
          b.pubdate,
          b.timestamp,
          (SELECT GROUP_CONCAT(a.name, ', ') FROM books_authors_link bal JOIN authors a ON bal.author = a.id WHERE bal.book = b.id) AS authors,
          (SELECT GROUP_CONCAT(s.name, ', ') FROM books_series_link bsl JOIN series s ON bsl.series = s.id WHERE bsl.book = b.id) AS series,
          (SELECT GROUP_CONCAT(d.format, ', ') FROM data d WHERE d.book = b.id) AS formats,
          (SELECT r.rating FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id LIMIT 1) AS rating
        FROM books b
        ${whereSql}
        ${orderSql}
        LIMIT ? OFFSET ?
      `;

      let books = [];
      try {
        const res = dbInstance.exec(dataQuery, [...params, limit, offset]);
        if (res.length > 0) {
          const cols = res[0].columns;
          books = res[0].values.map((row) => {
            const b = {};
            cols.forEach((c, i) => { b[c] = row[i]; });
            return {
              id: b.id,
              title: b.title || 'Sans titre',
              sort: b.sort,
              author_sort: b.author_sort,
              authors: b.authors || b.author_sort || 'Auteur inconnu',
              series: b.series || null,
              series_index: b.series_index || 1.0,
              path: b.path,
              has_cover: Boolean(b.has_cover),
              pubdate: b.pubdate,
              timestamp: b.timestamp,
              formats: b.formats ? b.formats.split(',').map((f) => f.trim()) : [],
              rating: b.rating ? Number(b.rating) : 0
            };
          });
        }
      } catch (err) {
        console.error('Erreur dataQuery:', err);
      }

      return { total, books };
    },

    /**
     * Get complete book details
     */
    getBookDetails(bookId) {
      if (!dbInstance) return null;
      const id = Number(bookId);

      const bRes = dbInstance.exec('SELECT * FROM books WHERE id = ?', [id]);
      if (!bRes.length || !bRes[0].values.length) return null;

      const cols = bRes[0].columns;
      const row = bRes[0].values[0];
      const book = {};
      cols.forEach((c, i) => { book[c] = row[i]; });

      // Authors
      let authors = [];
      try {
        const aRes = dbInstance.exec(`
          SELECT a.id, a.name, a.sort, a.link
          FROM authors a
          JOIN books_authors_link bal ON a.id = bal.author
          WHERE bal.book = ?
        `, [id]);
        if (aRes.length) {
          authors = aRes[0].values.map(([aid, name, sort, link]) => ({ id: aid, name, sort, link }));
        }
      } catch (e) {}

      // Series
      let series = [];
      try {
        const sRes = dbInstance.exec(`
          SELECT s.id, s.name, s.sort
          FROM series s
          JOIN books_series_link bsl ON s.id = bsl.series
          WHERE bsl.book = ?
        `, [id]);
        if (sRes.length) {
          series = sRes[0].values.map(([sid, name, sort]) => ({ id: sid, name, sort }));
        }
      } catch (e) {}

      // Tags
      let tags = [];
      try {
        const tRes = dbInstance.exec(`
          SELECT t.id, t.name
          FROM tags t
          JOIN books_tags_link btl ON t.id = btl.tag
          WHERE btl.book = ?
        `, [id]);
        if (tRes.length) {
          tags = tRes[0].values.map(([tid, name]) => ({ id: tid, name }));
        }
      } catch (e) {}

      // Rating
      let rating = 0;
      try {
        const rRes = dbInstance.exec(`
          SELECT r.rating
          FROM ratings r
          JOIN books_ratings_link brl ON r.id = brl.rating
          WHERE brl.book = ?
        `, [id]);
        if (rRes.length && rRes[0].values.length) {
          rating = rRes[0].values[0][0];
        }
      } catch (e) {}

      // Publishers
      let publishers = [];
      try {
        const pRes = dbInstance.exec(`
          SELECT p.id, p.name, p.sort
          FROM publishers p
          JOIN books_publishers_link bpl ON p.id = bpl.publisher
          WHERE bpl.book = ?
        `, [id]);
        if (pRes.length) {
          publishers = pRes[0].values.map(([pid, name, sort]) => ({ id: pid, name, sort }));
        }
      } catch (e) {}

      // Comments / Synopsis
      let comment = '';
      try {
        const cRes = dbInstance.exec('SELECT text FROM comments WHERE book = ?', [id]);
        if (cRes.length && cRes[0].values.length) {
          comment = cRes[0].values[0][0] || '';
        }
      } catch (e) {}

      // Data files
      let dataFiles = [];
      try {
        const dRes = dbInstance.exec('SELECT id, format, uncompressed_size, name FROM data WHERE book = ?', [id]);
        if (dRes.length) {
          dataFiles = dRes[0].values.map(([did, fmt, size, name]) => ({
            id: did,
            format: String(fmt).toUpperCase(),
            size: Number(size),
            name: name
          }));
        }
      } catch (e) {}

      // Identifiers
      let identifiers = [];
      try {
        const iRes = dbInstance.exec('SELECT type, val FROM identifiers WHERE book = ?', [id]);
        if (iRes.length) {
          identifiers = iRes[0].values.map(([type, val]) => ({ type, val }));
        }
      } catch (e) {}

      // Next / Previous books in series if in a series
      let seriesNavigation = null;
      if (series.length > 0) {
        const sId = series[0].id;
        try {
          const navRes = dbInstance.exec(`
            SELECT b.id, b.title, b.series_index
            FROM books b
            JOIN books_series_link bsl ON b.id = bsl.book
            WHERE bsl.series = ?
            ORDER BY b.series_index ASC
          `, [sId]);
          if (navRes.length && navRes[0].values.length > 1) {
            const list = navRes[0].values.map(([bid, title, sidx]) => ({ id: bid, title, index: sidx }));
            const currentPos = list.findIndex((item) => item.id === id);
            seriesNavigation = {
              seriesName: series[0].name,
              prev: currentPos > 0 ? list[currentPos - 1] : null,
              next: currentPos < list.length - 1 ? list[currentPos + 1] : null,
              all: list
            };
          }
        } catch (e) {}
      }

      return {
        id: book.id,
        title: book.title,
        sort: book.sort,
        author_sort: book.author_sort,
        authors,
        series,
        series_index: book.series_index || 1.0,
        seriesNavigation,
        tags,
        rating,
        publishers,
        comment,
        dataFiles,
        identifiers,
        path: book.path,
        has_cover: Boolean(book.has_cover),
        pubdate: book.pubdate,
        timestamp: book.timestamp,
        uuid: book.uuid
      };
    },

    /**
     * NextGen Smart Shelves (Magic Shelves)
     */
    async getMagicShelfBooks(shelfType, limit = 18) {
      if (!dbInstance) return [];

      switch (shelfType) {
        case 'recently_added':
          return this.getBooks({ sortBy: 'timestamp_desc', limit }).books;

        case 'top_rated':
          return this.getBooks({ sortBy: 'rating_desc', limit }).books;

        case 'random':
          return this.getBooks({ sortBy: 'random', limit }).books;

        case 'continue_reading': {
          // Read from IndexedDB reading_status & reading_progress
          const progressList = await CalibreStorage.getAllProgress();
          if (!progressList.length) return [];

          // Sort by last updated
          progressList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const bookIds = progressList
            .filter((p) => p.percentage > 0 && p.percentage < 95)
            .slice(0, limit)
            .map((p) => p.bookId);

          return this.getBooksByIds(bookIds);
        }

        case 'finished': {
          const progressList = await CalibreStorage.getAllProgress();
          const finishedIds = progressList
            .filter((p) => p.percentage >= 95)
            .slice(0, limit)
            .map((p) => p.bookId);

          return this.getBooksByIds(finishedIds);
        }

        default:
          return [];
      }
    },

    /**
     * Get books by an array of IDs (preserving order)
     */
    getBooksByIds(bookIds) {
      if (!dbInstance || !bookIds || !bookIds.length) return [];
      const placeholders = bookIds.map(() => '?').join(',');

      const q = `
        SELECT
          b.id,
          b.title,
          b.sort,
          b.author_sort,
          b.path,
          b.has_cover,
          b.series_index,
          b.pubdate,
          b.timestamp,
          (SELECT GROUP_CONCAT(a.name, ', ') FROM books_authors_link bal JOIN authors a ON bal.author = a.id WHERE bal.book = b.id) AS authors,
          (SELECT GROUP_CONCAT(s.name, ', ') FROM books_series_link bsl JOIN series s ON bsl.series = s.id WHERE bsl.book = b.id) AS series,
          (SELECT GROUP_CONCAT(d.format, ', ') FROM data d WHERE d.book = b.id) AS formats,
          (SELECT r.rating FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id LIMIT 1) AS rating
        FROM books b
        WHERE b.id IN (${placeholders})
      `;

      try {
        const res = dbInstance.exec(q, bookIds);
        if (!res.length) return [];
        const cols = res[0].columns;
        const map = new Map();

        res[0].values.forEach((row) => {
          const b = {};
          cols.forEach((c, i) => { b[c] = row[i]; });
          map.set(b.id, {
            id: b.id,
            title: b.title || 'Sans titre',
            sort: b.sort,
            author_sort: b.author_sort,
            authors: b.authors || b.author_sort || 'Auteur inconnu',
            series: b.series || null,
            series_index: b.series_index || 1.0,
            path: b.path,
            has_cover: Boolean(b.has_cover),
            pubdate: b.pubdate,
            timestamp: b.timestamp,
            formats: b.formats ? b.formats.split(',').map((f) => f.trim()) : [],
            rating: b.rating ? Number(b.rating) : 0
          });
        });

        // Return in requested order
        return bookIds.map((id) => map.get(id)).filter(Boolean);
      } catch (err) {
        console.error('Erreur getBooksByIds:', err);
        return [];
      }
    },

    /**
     * Author details and related books
     */
    getAuthorDetails(authorId) {
      if (!dbInstance) return null;
      const id = Number(authorId);

      const aRes = dbInstance.exec('SELECT id, name, sort, link FROM authors WHERE id = ?', [id]);
      if (!aRes.length || !aRes[0].values.length) return null;

      const [aid, name, sort, link] = aRes[0].values[0];
      const booksRes = this.getBooks({ authorId: id, limit: 200 });

      // Find series by this author
      const seriesRes = dbInstance.exec(`
        SELECT DISTINCT s.id, s.name, COUNT(bsl.book) as count
        FROM series s
        JOIN books_series_link bsl ON s.id = bsl.series
        JOIN books_authors_link bal ON bsl.book = bal.book
        WHERE bal.author = ?
        GROUP BY s.id
        ORDER BY s.name ASC
      `, [id]);

      let series = [];
      if (seriesRes.length) {
        series = seriesRes[0].values.map(([sid, sname, count]) => ({ id: sid, name: sname, book_count: count }));
      }

      return {
        id: aid,
        name,
        sort,
        link,
        totalBooks: booksRes.total,
        books: booksRes.books,
        series
      };
    },

    /**
     * Series details and books in order
     */
    getSeriesDetails(seriesId) {
      if (!dbInstance) return null;
      const id = Number(seriesId);

      const sRes = dbInstance.exec('SELECT id, name, sort FROM series WHERE id = ?', [id]);
      if (!sRes.length || !sRes[0].values.length) return null;

      const [sid, name, sort] = sRes[0].values[0];

      // Fetch all books in series sorted by series_index
      const q = `
        SELECT
          b.id,
          b.title,
          b.sort,
          b.author_sort,
          b.path,
          b.has_cover,
          b.series_index,
          b.pubdate,
          (SELECT GROUP_CONCAT(a.name, ', ') FROM books_authors_link bal JOIN authors a ON bal.author = a.id WHERE bal.book = b.id) AS authors,
          (SELECT GROUP_CONCAT(d.format, ', ') FROM data d WHERE d.book = b.id) AS formats,
          (SELECT r.rating FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id LIMIT 1) AS rating
        FROM books b
        JOIN books_series_link bsl ON b.id = bsl.book
        WHERE bsl.series = ?
        ORDER BY b.series_index ASC
      `;

      let books = [];
      try {
        const bRes = dbInstance.exec(q, [id]);
        if (bRes.length) {
          const cols = bRes[0].columns;
          books = bRes[0].values.map((row) => {
            const b = {};
            cols.forEach((c, i) => { b[c] = row[i]; });
            return {
              id: b.id,
              title: b.title,
              authors: b.authors || b.author_sort || '',
              series: name,
              series_index: b.series_index,
              formats: b.formats ? b.formats.split(',').map((f) => f.trim()) : [],
              rating: b.rating ? Number(b.rating) : 0
            };
          });
        }
      } catch (e) {}

      return {
        id: sid,
        name,
        sort,
        totalBooks: books.length,
        books
      };
    },

    /**
     * Authors list
     */
    getAuthors(options = {}) {
      if (!dbInstance) return [];
      const { search = '', limit = 100, offset = 0 } = options;

      let where = '';
      const params = [];
      if (search && search.trim()) {
        where = 'WHERE a.name LIKE ?';
        params.push('%' + search.trim() + '%');
      }

      const q = `
        SELECT a.id, a.name, a.sort, COUNT(bal.book) as book_count
        FROM authors a
        JOIN books_authors_link bal ON a.id = bal.author
        ${where}
        GROUP BY a.id
        ORDER BY book_count DESC, a.sort COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `;
      try {
        const res = dbInstance.exec(q, [...params, limit, offset]);
        if (!res.length) return [];
        return res[0].values.map(([id, name, sort, count]) => ({ id, name, sort, book_count: count }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Series list
     */
    getSeries(options = {}) {
      if (!dbInstance) return [];
      const { search = '', limit = 100, offset = 0 } = options;

      let where = '';
      const params = [];
      if (search && search.trim()) {
        where = 'WHERE s.name LIKE ?';
        params.push('%' + search.trim() + '%');
      }

      const q = `
        SELECT s.id, s.name, s.sort, COUNT(bsl.book) as book_count
        FROM series s
        JOIN books_series_link bsl ON s.id = bsl.series
        ${where}
        GROUP BY s.id
        ORDER BY book_count DESC, s.sort COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `;
      try {
        const res = dbInstance.exec(q, [...params, limit, offset]);
        if (!res.length) return [];
        return res[0].values.map(([id, name, sort, count]) => ({ id, name, sort, book_count: count }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Tags list
     */
    getTags(options = {}) {
      if (!dbInstance) return [];
      const { search = '', limit = 100, offset = 0 } = options;

      let where = '';
      const params = [];
      if (search && search.trim()) {
        where = 'WHERE t.name LIKE ?';
        params.push('%' + search.trim() + '%');
      }

      const q = `
        SELECT t.id, t.name, COUNT(btl.book) as book_count
        FROM tags t
        JOIN books_tags_link btl ON t.id = btl.tag
        ${where}
        GROUP BY t.id
        ORDER BY book_count DESC, t.name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `;
      try {
        const res = dbInstance.exec(q, [...params, limit, offset]);
        if (!res.length) return [];
        return res[0].values.map(([id, name, count]) => ({ id, name, book_count: count }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Retrieve cover URL (from local folder, IndexedDB, or generated SVG)
     */
    async getCoverUrl(book) {
      if (!book) return generateNextGenCover('Calibre', '', 0);
      const bookId = Number(book.id);

      // 1. Check IndexedDB cover cache
      try {
        const storedCover = await CalibreStorage.getCover(bookId);
        if (storedCover) {
          const url = URL.createObjectURL(storedCover);
          createdObjectUrls.add(url);
          return url;
        }
      } catch (e) {}

      // 2. Check local directory handle or folder map
      if (book.path) {
        const basePath = normalizePath(book.path);

        // A. If we have a connected DirectoryHandle, try resolving directly
        if (localDirectoryHandle && localDirectoryStatus === 'connected') {
          for (const candName of ['cover.jpg', 'cover.jpeg', 'cover.png']) {
            const file = await resolveFileInHandle(localDirectoryHandle, `${book.path}/${candName}`);
            if (file) {
              const url = URL.createObjectURL(file);
              createdObjectUrls.add(url);
              return url;
            }
          }
        }

        // B. Check coverIndex / localFileMap
        for (const cand of [`${basePath}/cover.jpg`, `${basePath}/cover.jpeg`, `${basePath}/cover.png`]) {
          const match = localFileMap.get(cand);
          if (match) {
            let fileObj = match;
            if (typeof match.getFile === 'function') {
              fileObj = await match.getFile();
            }
            const url = URL.createObjectURL(fileObj);
            createdObjectUrls.add(url);
            return url;
          }
        }
      }

      // 3. Fallback: generate NextGen SVG cover
      const authorText = book.authors || book.author_sort || '';
      return generateNextGenCover(book.title, authorText, book.id);
    },

    /**
     * Retrieve book EPUB file directly from the local directory defined in settings!
     */
    async getBookBlob(bookId, format = 'EPUB') {
      const bId = Number(bookId);
      const fmt = String(format).toUpperCase();

      // 1. Check local directory (File System Access API DirectoryHandle)
      const bookDetails = this.getBookDetails(bId);

      if (localDirectoryHandle && localDirectoryStatus === 'connected' && bookDetails) {
        const matchingFiles = bookDetails.dataFiles.filter((d) => d.format === fmt);

        for (const d of matchingFiles) {
          // Standard Calibre path: `<books.path>/<data.name>.<fmt>`
          const relPath = `${bookDetails.path}/${d.name}.${fmt.toLowerCase()}`;
          const file = await resolveFileInHandle(localDirectoryHandle, relPath);
          if (file) {
            return { blob: file, filename: `${d.name}.${fmt.toLowerCase()}`, source: 'local_dir' };
          }
        }

        // Also check if any file inside `bookDetails.path` has .epub extension
        const generalRelPath = `${bookDetails.path}/${bookDetails.title}.${fmt.toLowerCase()}`;
        const fileByTitle = await resolveFileInHandle(localDirectoryHandle, generalRelPath);
        if (fileByTitle) {
          return { blob: fileByTitle, filename: fileByTitle.name, source: 'local_dir' };
        }
      }

      // 2. Check localFileMap / epubIndex (from webkitdirectory or previous scan)
      if (bookDetails && localFileMap.size > 0) {
        const basePath = normalizePath(bookDetails.path);
        const matchingFiles = bookDetails.dataFiles.filter((d) => d.format === fmt);

        for (const d of matchingFiles) {
          const cands = [
            `${basePath}/${normalizePath(d.name)}.${fmt.toLowerCase()}`,
            normalizePath(`${d.name}.${fmt.toLowerCase()}`)
          ];
          for (const cand of cands) {
            const match = localFileMap.get(cand);
            if (match) {
              let fileObj = match;
              if (typeof match.getFile === 'function') {
                fileObj = await match.getFile();
              }
              return { blob: fileObj, filename: fileObj.name, source: 'local_dir' };
            }
          }
        }
      }

      // 3. Check IndexedDB stored book files
      const stored = await CalibreStorage.getBookFile(bId, fmt);
      if (stored && stored.blob) {
        return { blob: stored.blob, filename: stored.filename, source: 'indexeddb' };
      }

      // 4. Fallback for demo sample book (bookId 1)
      if (bId === 1 && fmt === 'EPUB') {
        try {
          const resp = await fetch('./sample.epub');
          if (resp.ok) {
            const blob = await resp.blob();
            return { blob, filename: 'Vingt mille lieues sous les mers.epub', source: 'demo' };
          }
        } catch (e) {}
      }

      return null;
    }
  };
})();
