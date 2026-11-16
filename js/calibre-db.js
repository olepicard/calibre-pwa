/**
 * Calibre-Web PWA - Calibre SQLite Engine & Library Manager
 * Powered by WebAssembly SQLite (sql.js) for high performance on mobile devices.
 */

const CalibreDB = (function () {
  'use strict';

  let sqlEngine = null;
  let dbInstance = null;
  let dbName = 'metadata.db';

  // In-memory map of local files when a Calibre folder is selected
  // Key: normalized relative path (lowercase, forward slashes), Value: File or FileSystemFileHandle
  const localFileMap = new Map();
  let directoryHandle = null;

  // Cache of generated object URLs to revoke them when unloading
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
   * Normalize file paths for directory lookup
   */
  function normalizePath(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  /**
   * Generate an SVG data URI cover with tasteful book typography
   */
  function generateSvgCover(title, author, bookId = 0) {
    const safeTitle = (title || 'Sans Titre')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeAuthor = (author || 'Auteur Inconnu')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Color palettes based on book ID
    const palettes = [
      { bg1: '#1e3c72', bg2: '#2a5298', accent: '#f39c12' }, // Navy
      { bg1: '#3a1c71', bg2: '#d76d77', accent: '#ffaf7b' }, // Purple-coral
      { bg1: '#134e5e', bg2: '#71b280', accent: '#2ecc71' }, // Emerald
      { bg1: '#4b134f', bg2: '#c94b4b', accent: '#f1c40f' }, // Burgundy
      { bg1: '#2c3e50', bg2: '#3498db', accent: '#e74c3c' }, // Slate & blue
      { bg1: '#1f1c18', bg2: '#8e0e00', accent: '#e67e22' }, // Dark ruby
      { bg1: '#0f2027', bg2: '#203a43', accent: '#00adb5' }  // Teal night
    ];

    const idx = Math.abs(Number(bookId) || 0) % palettes.length;
    const p = palettes[idx];

    // Truncate title nicely for SVG display
    let displayTitle = safeTitle;
    if (displayTitle.length > 55) {
      displayTitle = displayTitle.substring(0, 52) + '...';
    }

    // Split title into 2-3 lines if long
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
      const y = 200 + (i * 26);
      return `<tspan x="150" y="${y}">${line}</tspan>`;
    }).join('');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="100%" height="100%">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${p.bg1}" />
            <stop offset="100%" stop-color="${p.bg2}" />
          </linearGradient>
          <linearGradient id="spine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="rgba(0,0,0,0.5)" />
            <stop offset="4%" stop-color="rgba(255,255,255,0.2)" />
            <stop offset="8%" stop-color="rgba(0,0,0,0.3)" />
            <stop offset="12%" stop-color="rgba(0,0,0,0)" />
          </linearGradient>
          <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
          </filter>
        </defs>

        <!-- Book background -->
        <rect width="300" height="450" rx="6" fill="url(#grad)" />

        <!-- Border frame -->
        <rect x="18" y="18" width="264" height="414" rx="3" fill="none" stroke="${p.accent}" stroke-width="1.5" stroke-opacity="0.6" />
        <rect x="23" y="23" width="254" height="404" rx="2" fill="none" stroke="${p.accent}" stroke-width="0.7" stroke-opacity="0.3" />

        <!-- Header / Genre ornament -->
        <circle cx="150" cy="70" r="16" fill="none" stroke="${p.accent}" stroke-width="1.2" stroke-opacity="0.8"/>
        <path d="M 144 70 L 156 70 M 150 64 L 150 76" stroke="${p.accent}" stroke-width="1.2" stroke-opacity="0.8"/>

        <!-- Title -->
        <text text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="20" fill="#ffffff" filter="url(#shadow)">
          ${titleSpans}
        </text>

        <!-- Divider -->
        <line x1="80" y1="310" x2="220" y2="310" stroke="${p.accent}" stroke-width="1" stroke-opacity="0.7" />

        <!-- Author -->
        <text x="150" y="345" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="400" font-size="14" fill="#f0f0f0" letter-spacing="1">
          ${safeAuthor.length > 30 ? safeAuthor.substring(0, 28) + '...' : safeAuthor}
        </text>

        <!-- Calibre logo footer -->
        <text x="150" y="405" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" fill="rgba(255,255,255,0.4)" letter-spacing="2">
          CALIBRE-WEB
        </text>

        <!-- Book Spine 3D effect -->
        <rect width="300" height="450" fill="url(#spine)" pointer-events="none" />
      </svg>
    `.trim();

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  return {
    /**
     * Initialize engine and try loading database from IndexedDB
     */
    async init() {
      await initEngine();

      // Check if metadata.db already stored in IndexedDB
      const saved = await CalibreStorage.getMetadataDB();
      if (saved && saved.data) {
        try {
          this.loadFromArrayBuffer(saved.data, saved.name || 'metadata.db');
          return { loaded: true, name: saved.name, size: saved.size };
        } catch (err) {
          console.warn('Erreur lors du chargement de la base enregistrée:', err);
        }
      }
      return { loaded: false };
    },

    /**
     * Load database from ArrayBuffer or Uint8Array
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

    /**
     * Check if a database is actively loaded
     */
    isLoaded() {
      return dbInstance !== null;
    },

    getDbName() {
      return dbName;
    },

    /**
     * Close the database instance
     */
    close() {
      if (dbInstance) {
        try { dbInstance.close(); } catch (e) {}
        dbInstance = null;
      }
      localFileMap.clear();
      directoryHandle = null;
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      createdObjectUrls.clear();
    },

    /**
     * Export database as Uint8Array
     */
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
          hasDirectory: directoryHandle !== null
        };
      } catch (e) {
        console.error('Erreur getStats:', e);
        return null;
      }
    },

    /**
     * Query books with filters, sorting, and pagination
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

      // Search term (by title or author_sort)
      if (search && search.trim()) {
        const s = '%' + search.trim() + '%';
        whereClauses.push('(b.title LIKE ? OR b.author_sort LIKE ?)');
        params.push(s, s);
      }

      // Filter by Author
      if (authorId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_authors_link bal WHERE bal.book = b.id AND bal.author = ?)');
        params.push(Number(authorId));
      }

      // Filter by Series
      if (seriesId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_series_link bsl WHERE bsl.book = b.id AND bsl.series = ?)');
        params.push(Number(seriesId));
      }

      // Filter by Tag
      if (tagId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_tags_link btl WHERE btl.book = b.id AND btl.tag = ?)');
        params.push(Number(tagId));
      }

      // Filter by Format
      if (format) {
        whereClauses.push('EXISTS (SELECT 1 FROM data d WHERE d.book = b.id AND UPPER(d.format) = ?)');
        params.push(String(format).toUpperCase());
      }

      const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

      // Sorting
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
        case 'id_desc':
        default:
          orderSql = 'ORDER BY b.timestamp DESC, b.id DESC';
          break;
      }

      // 1. Get total count
      const countQuery = `SELECT COUNT(*) FROM books b ${whereSql}`;
      let total = 0;
      try {
        const countRes = dbInstance.exec(countQuery, params);
        total = countRes[0]?.values[0][0] || 0;
      } catch (err) {
        console.error('Erreur countQuery:', err);
      }

      if (total === 0) {
        return { total: 0, books: [] };
      }

      // 2. Fetch books with subqueries for fast execution on large databases
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

      const queryParams = [...params, limit, offset];
      let books = [];

      try {
        const res = dbInstance.exec(dataQuery, queryParams);
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
     * Get complete book details including synopsis, tags, files, identifiers
     */
    getBookDetails(bookId) {
      if (!dbInstance) return null;
      const id = Number(bookId);

      // Book record
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

      // Comments / Description
      let comment = '';
      try {
        const cRes = dbInstance.exec('SELECT text FROM comments WHERE book = ?', [id]);
        if (cRes.length && cRes[0].values.length) {
          comment = cRes[0].values[0][0] || '';
        }
      } catch (e) {}

      // Formats / Files
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

      // Identifiers (ISBN, etc.)
      let identifiers = [];
      try {
        const iRes = dbInstance.exec('SELECT type, val FROM identifiers WHERE book = ?', [id]);
        if (iRes.length) {
          identifiers = iRes[0].values.map(([type, val]) => ({ type, val }));
        }
      } catch (e) {}

      return {
        id: book.id,
        title: book.title,
        sort: book.sort,
        author_sort: book.author_sort,
        authors,
        series,
        series_index: book.series_index || 1.0,
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
     * Get list of authors with book counts
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
      params.push(limit, offset);

      try {
        const res = dbInstance.exec(q, params);
        if (!res.length) return [];
        return res[0].values.map(([id, name, sort, count]) => ({ id, name, sort, book_count: count }));
      } catch (e) {
        console.error('Erreur getAuthors:', e);
        return [];
      }
    },

    /**
     * Get list of series with book counts
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
      params.push(limit, offset);

      try {
        const res = dbInstance.exec(q, params);
        if (!res.length) return [];
        return res[0].values.map(([id, name, sort, count]) => ({ id, name, sort, book_count: count }));
      } catch (e) {
        console.error('Erreur getSeries:', e);
        return [];
      }
    },

    /**
     * Get list of tags with book counts
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
      params.push(limit, offset);

      try {
        const res = dbInstance.exec(q, params);
        if (!res.length) return [];
        return res[0].values.map(([id, name, count]) => ({ id, name, book_count: count }));
      } catch (e) {
        console.error('Erreur getTags:', e);
        return [];
      }
    },

    /**
     * Register local file list (e.g. from webkitdirectory or file input)
     */
    registerFileList(files) {
      localFileMap.clear();
      for (const file of files) {
        const relPath = file.webkitRelativePath || file.name;
        // Normalize relative path: remove root directory name if present
        let cleanPath = normalizePath(relPath);
        // If webkitRelativePath starts with "calibre_dir/...", strip top dir
        const parts = cleanPath.split('/');
        if (parts.length > 1) {
          parts.shift();
          cleanPath = parts.join('/');
        }
        localFileMap.set(cleanPath, file);
        // Also index by filename alone for quick lookup
        localFileMap.set(normalizePath(file.name), file);
      }
      return localFileMap.size;
    },

    /**
     * Register DirectoryHandle from showDirectoryPicker()
     */
    async registerDirectoryHandle(handle) {
      directoryHandle = handle;
      localFileMap.clear();

      // Scan directory recursively
      async function scanDir(currentHandle, currentPath = '') {
        for await (const entry of currentHandle.values()) {
          const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          if (entry.kind === 'file') {
            const norm = normalizePath(entryPath);
            localFileMap.set(norm, entry);
            localFileMap.set(normalizePath(entry.name), entry);
          } else if (entry.kind === 'directory') {
            await scanDir(entry, entryPath);
          }
        }
      }

      await scanDir(handle);
      return localFileMap.size;
    },

    /**
     * Retrieve cover URL for a book (from local folder, IndexedDB, or generated SVG)
     */
    async getCoverUrl(book) {
      if (!book) return generateSvgCover('Calibre', '', 0);

      const bookId = Number(book.id);

      // 1. Check if cover blob was saved in IndexedDB
      try {
        const storedCover = await CalibreStorage.getCover(bookId);
        if (storedCover) {
          const url = URL.createObjectURL(storedCover);
          createdObjectUrls.add(url);
          return url;
        }
      } catch (e) {}

      // 2. Check if a local Calibre folder was selected with cover.jpg
      if (book.path && localFileMap.size > 0) {
        const basePath = normalizePath(book.path);
        const coverCandidates = [
          `${basePath}/cover.jpg`,
          `${basePath}/cover.jpeg`,
          `${basePath}/cover.png`
        ];

        for (const cand of coverCandidates) {
          const match = localFileMap.get(cand);
          if (match) {
            try {
              let fileObj = match;
              if (typeof match.getFile === 'function') {
                fileObj = await match.getFile();
              }
              const url = URL.createObjectURL(fileObj);
              createdObjectUrls.add(url);
              return url;
            } catch (err) {
              console.warn('Erreur lecture cover depuis dossier:', err);
            }
          }
        }
      }

      // 3. Fallback: generate high-quality SVG cover
      const authorText = book.authors || book.author_sort || '';
      return generateSvgCover(book.title, authorText, book.id);
    },

    /**
     * Retrieve book file Blob (EPUB, PDF...) from IndexedDB or local directory
     */
    async getBookBlob(bookId, format = 'EPUB') {
      const bId = Number(bookId);
      const fmt = String(format).toUpperCase();

      // 1. Check IndexedDB
      const stored = await CalibreStorage.getBookFile(bId, fmt);
      if (stored && stored.blob) {
        return { blob: stored.blob, filename: stored.filename || `${bId}.${fmt.toLowerCase()}` };
      }

      // 2. Check local folder map if attached
      if (localFileMap.size > 0) {
        const bookDetails = this.getBookDetails(bId);
        if (bookDetails && bookDetails.path) {
          const basePath = normalizePath(bookDetails.path);
          // Look for matching data records
          const matchingFiles = bookDetails.dataFiles.filter((d) => d.format === fmt);

          for (const d of matchingFiles) {
            const candidatePaths = [
              `${basePath}/${d.name}.${fmt.toLowerCase()}`,
              `${basePath}/${d.name}.${fmt.toUpperCase()}`,
              normalizePath(`${d.name}.${fmt.toLowerCase()}`)
            ];

            for (const cand of candidatePaths) {
              const match = localFileMap.get(cand);
              if (match) {
                let fileObj = match;
                if (typeof match.getFile === 'function') {
                  fileObj = await match.getFile();
                }
                return { blob: fileObj, filename: `${d.name}.${fmt.toLowerCase()}` };
              }
            }
          }
        }
      }

      // 3. Fallback for demo sample book (bookId 1)
      if (bId === 1 && fmt === 'EPUB') {
        try {
          const resp = await fetch('./sample.epub');
          if (resp.ok) {
            const blob = await resp.blob();
            return { blob, filename: 'Vingt mille lieues sous les mers.epub' };
          }
        } catch (e) {}
      }

      return null;
    },

    /**
     * Find metadata.db inside localFileMap
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
    }
  };
})();
