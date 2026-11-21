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

  // Persistent Directory Handle or ZIP File Handle (File System Access API / File API)
  let localDirectoryHandle = null;
  let localZipHandle = null;
  let localZipFile = null;
  let localSourceType = 'none'; // 'none' | 'directory' | 'zip'
  let localDirectoryName = '';
  let localDirectoryStatus = 'none'; // 'none' | 'connected' | 'needs_permission'

  // Fast in-memory index of files found in the local directory or ZIP archive
  const localFileMap = new Map();
  const epubIndex = new Map();       // filename or relpath (lowercase) -> handle/file
  const coverIndex = new Map();      // bookPath/cover -> handle/file
  const bookIdCoverMap = new Map();  // Calibre numeric bookId (e.g. 34967) -> cover handle/entry
  const bookIdEpubMap = new Map();   // Calibre numeric bookId (e.g. 34967) -> epub handle/entry
  let lastZipError = null;

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
    let authorStr = 'Auteur Inconnu';
    if (Array.isArray(author)) {
      authorStr = author.map(a => (typeof a === 'string' ? a : (a && (a.name || a.sort)) || '')).filter(Boolean).join(', ') || 'Auteur Inconnu';
    } else if (typeof author === 'string' && author.trim()) {
      authorStr = author.trim();
    } else if (author && typeof author === 'object') {
      authorStr = author.name || author.sort || 'Auteur Inconnu';
    }

    const safeTitle = String(title || 'Sans Titre')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeAuthor = String(authorStr)
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
        // Fallback: try case-insensitive / normalized match in directory entries
        let matchedDir = null;
        try {
          const target = normalizePath(parts[i]);
          for await (const [name, handle] of current.entries()) {
            if (handle.kind === 'directory' && normalizePath(name) === target) {
              matchedDir = handle;
              break;
            }
          }
        } catch (e2) {}

        if (matchedDir) {
          current = matchedDir;
        } else {
          return null;
        }
      }
    }

    const fileName = parts[parts.length - 1];
    try {
      const fileHandle = await current.getFileHandle(fileName);
      return await fileHandle.getFile();
    } catch (e) {
      // Fallback: try case-insensitive or matching format in directory
      try {
        const target = normalizePath(fileName);
        const extMatch = target.endsWith('.epub');
        for await (const [name, handle] of current.entries()) {
          if (handle.kind === 'file') {
            const norm = normalizePath(name);
            if (norm === target || (extMatch && norm.endsWith('.epub'))) {
              return await handle.getFile();
            }
          }
        }
      } catch (e2) {}
      return null;
    }
  }

  // CP437 (DOS/OEM) table for bytes 0x80..0xFF when ZIP General Purpose Bit 11 (UTF-8) is not set
  const CP437_HIGH = [
    '\u00c7','\u00fc','\u00e9','\u00e2','\u00e4','\u00e0','\u00e5','\u00e7',
    '\u00ea','\u00eb','\u00e8','\u00ef','\u00ee','\u00ec','\u00c4','\u00c5',
    '\u00c9','\u00e6','\u00c6','\u00f4','\u00f6','\u00f2','\u00fb','\u00f9',
    '\u00ff','\u00d6','\u00dc','\u00a2','\u00a3','\u00a5','\u20a7','\u0192',
    '\u00e1','\u00ed','\u00f3','\u00fa','\u00f1','\u00d1','\u00aa','\u00ba',
    '\u00bf','\u2310','\u00ac','\u00bd','\u00bc','\u00a1','\u00ab','\u00bb',
    '\u2591','\u2592','\u2593','\u2502','\u2524','\u2561','\u2562','\u2556',
    '\u2555','\u2563','\u2551','\u2557','\u255d','\u255c','\u255b','\u2510',
    '\u2514','\u2534','\u252c','\u251c','\u2500','\u253c','\u255e','\u255f',
    '\u255a','\u2554','\u2569','\u2566','\u2560','\u2550','\u256c','\u2567',
    '\u2568','\u2564','\u2565','\u2559','\u2558','\u2552','\u2553','\u256b',
    '\u256a','\u2518','\u250c','\u2588','\u2584','\u258c','\u2590','\u2580',
    '\u03b1','\u00df','\u0393','\u03c0','\u03a3','\u03c3','\u00b5','\u03c4',
    '\u03a6','\u0398','\u03a9','\u03b4','\u221e','\u03c6','\u03b5','\u2229',
    '\u2261','\u00b1','\u2265','\u2264','\u2320','\u2321','\u00f7','\u2248',
    '\u00b0','\u2219','\u00b7','\u221a','\u207f','\u00b2','\u25a0','\u00a0'
  ];

  const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: false });

  function decodeZipFilename(bytes, gpFlags) {
    if ((gpFlags & 0x0800) !== 0) {
      return utf8StrictDecoder.decode(bytes);
    }
    let hasHigh = false;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 0x80) {
        hasHigh = true;
        break;
      }
    }
    if (!hasHigh) {
      return utf8StrictDecoder.decode(bytes);
    }
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    }
    return out;
  }

  // Concurrency queue for Android ContentResolver File.slice() extractions (max 3 simultaneous reads)
  let activeZipExtractions = 0;
  const zipExtractionWaiters = [];

  async function acquireZipSlot() {
    if (activeZipExtractions < 3) {
      activeZipExtractions++;
      return;
    }
    await new Promise((resolve) => zipExtractionWaiters.push(resolve));
    activeZipExtractions++;
  }

  function releaseZipSlot() {
    activeZipExtractions = Math.max(0, activeZipExtractions - 1);
    if (zipExtractionWaiters.length > 0) {
      const next = zipExtractionWaiters.shift();
      next();
    }
  }

  /**
   * High-Performance Zero-Copy Random-Access ZIP Entry Extractor
   * Slices ONLY the target file's compressed byte range from the .zip File on disk,
   * reads it via 64-bit FileReader arrayBuffer(), and decompresses via DecompressionStream('deflate-raw').
   */
  async function extractZipEntryToFile(zipFile, entry) {
    if (!zipFile || !entry) return null;

    await acquireZipSlot();
    try {
      // 1. Read the 30-byte Local File Header at entry.localHeaderOffset
      const lhBuf = await zipFile.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer();
      const lhView = new DataView(lhBuf);
      if (lhView.getUint32(0, true) !== 0x04034b50) {
        throw new Error('En-tête local ZIP invalide pour ' + entry.name);
      }

      const localNameLen = lhView.getUint16(26, true);
      const localExtraLen = lhView.getUint16(28, true);
      const dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
      const rawSlice = zipFile.slice(dataStart, dataStart + entry.compressedSize);

      const ext = entry.name.split('.').pop().toLowerCase();
      const mimeMap = {
        epub: 'application/epub+zip',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        db: 'application/x-sqlite3',
        pdf: 'application/pdf'
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';

      // Method 0: STORE (uncompressed — read slice into memory buffer so Android content:// handle isn't held)
      if (entry.compressionMethod === 0) {
        const storeBuf = await rawSlice.arrayBuffer();
        return new File([storeBuf], entry.name, { type: mimeType });
      }

      // Method 8: DEFLATE
      // Read compressed slice into an in-memory ArrayBuffer first via 64-bit slice().arrayBuffer()
      // (avoids Android Chromium content:// >4GB Blob.stream() bug when piping directly to DecompressionStream!)
      if (entry.compressionMethod === 8) {
        const compBuf = await rawSlice.arrayBuffer();
        if (typeof DecompressionStream === 'function') {
          const ds = new DecompressionStream('deflate-raw');
          const memStream = new Blob([compBuf]).stream().pipeThrough(ds);
          const decompressedBuf = await new Response(memStream).arrayBuffer();
          return new File([decompressedBuf], entry.name, { type: mimeType });
        }
        throw new Error('DecompressionStream non supporté sur ce navigateur.');
      }

      throw new Error(`Méthode de compression ZIP (${entry.compressionMethod}) non supportée.`);
    } catch (err) {
      lastZipError = err.message || String(err);
      console.error('Erreur extraction entrée ZIP:', entry.name, err);
      throw err;
    } finally {
      releaseZipSlot();
    }
  }

  /**
   * Parse ONLY the Central Directory at the end of a .zip File (supports standard ZIP & ZIP64).
   * Optimized for 65+ GB Calibre archives (150,000+ entries) on Android smartphones.
   */
  async function parseAndIndexZipFile(zipFile) {
    localFileMap.clear();
    epubIndex.clear();
    coverIndex.clear();
    bookIdCoverMap.clear();
    bookIdEpubMap.clear();
    lastZipError = null;

    const fileSize = zipFile.size;
    if (fileSize < 22) {
      throw new Error('Fichier ZIP trop petit ou invalide.');
    }

    // Read the last 65 KB to locate End of Central Directory (EOCD)
    const tailSize = Math.min(fileSize, 65557);
    const tailOffset = fileSize - tailSize;
    const tailBuf = await zipFile.slice(tailOffset, fileSize).arrayBuffer();
    const tailView = new DataView(tailBuf);

    let eocdPos = -1;
    for (let pos = tailBuf.byteLength - 22; pos >= 0; pos--) {
      if (tailView.getUint32(pos, true) === 0x06054b50) {
        eocdPos = pos;
        break;
      }
    }

    if (eocdPos === -1) {
      throw new Error('Signature de fin de répertoire central ZIP (EOCD) introuvable.');
    }

    let cdSize = tailView.getUint32(eocdPos + 12, true);
    let cdOffset = tailView.getUint32(eocdPos + 16, true);

    // Check for ZIP64 EOCD Locator (20 bytes right before EOCD)
    if (eocdPos >= 20 && tailView.getUint32(eocdPos - 20, true) === 0x07064b50) {
      const z64EocdOffset = Number(tailView.getBigUint64(eocdPos - 12, true));
      const z64Buf = await zipFile.slice(z64EocdOffset, z64EocdOffset + 56).arrayBuffer();
      const z64View = new DataView(z64Buf);
      if (z64View.getUint32(0, true) === 0x06064b50) {
        cdSize = Number(z64View.getBigUint64(40, true));
        cdOffset = Number(z64View.getBigUint64(48, true));
      }
    }

    // Slice ONLY the Central Directory
    const cdBuf = await zipFile.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
    const cdView = new DataView(cdBuf);
    const cdBytes = new Uint8Array(cdBuf);

    // First fast pass: find rootPrefix from metadata.db and index relevant entries
    let ptr = 0;
    let totalFilesCount = 0;
    let epubsCount = 0;
    const rawEntries = [];
    let rootPrefix = '';

    while (ptr + 46 <= cdBuf.byteLength) {
      const sig = cdView.getUint32(ptr, true);
      if (sig !== 0x02014b50) break;

      const gpFlags = cdView.getUint16(ptr + 8, true);
      const compressionMethod = cdView.getUint16(ptr + 10, true);
      let compressedSize = cdView.getUint32(ptr + 20, true);
      let uncompressedSize = cdView.getUint32(ptr + 24, true);
      const nameLen = cdView.getUint16(ptr + 28, true);
      const extraLen = cdView.getUint16(ptr + 30, true);
      const commentLen = cdView.getUint16(ptr + 32, true);
      let localHeaderOffset = cdView.getUint32(ptr + 42, true);

      const nameBytes = cdBytes.subarray(ptr + 46, ptr + 46 + nameLen);
      // Skip directories (ending with '/' = 0x2F) and .opf files to save 60% RAM on Android
      const lastByte = nameLen > 0 ? nameBytes[nameLen - 1] : 0x2F;
      const isOpf = nameLen > 4 &&
        nameBytes[nameLen - 4] === 0x2e &&
        (nameBytes[nameLen - 3] | 0x20) === 0x6f &&
        (nameBytes[nameLen - 2] | 0x20) === 0x70 &&
        (nameBytes[nameLen - 1] | 0x20) === 0x66;

      if (lastByte !== 0x2F && !isOpf) {
        totalFilesCount++;
        const rawZipPath = decodeZipFilename(nameBytes, gpFlags);

        // Parse ZIP64 Extra Field (0x0001) if any 32-bit field overflowed (0xFFFFFFFF)
        if (
          extraLen > 0 &&
          (uncompressedSize === 0xFFFFFFFF || compressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF)
        ) {
          let ePtr = ptr + 46 + nameLen;
          const eEnd = ePtr + extraLen;
          while (ePtr + 4 <= eEnd) {
            const headerId = cdView.getUint16(ePtr, true);
            const dataSize = cdView.getUint16(ePtr + 2, true);
            if (headerId === 0x0001) {
              let fPtr = ePtr + 4;
              if (uncompressedSize === 0xFFFFFFFF && fPtr + 8 <= ePtr + 4 + dataSize) {
                uncompressedSize = Number(cdView.getBigUint64(fPtr, true));
                fPtr += 8;
              }
              if (compressedSize === 0xFFFFFFFF && fPtr + 8 <= ePtr + 4 + dataSize) {
                compressedSize = Number(cdView.getBigUint64(fPtr, true));
                fPtr += 8;
              }
              if (localHeaderOffset === 0xFFFFFFFF && fPtr + 8 <= ePtr + 4 + dataSize) {
                localHeaderOffset = Number(cdView.getBigUint64(fPtr, true));
                fPtr += 8;
              }
              break;
            }
            ePtr += 4 + dataSize;
          }
        }

        const normFullPath = normalizePath(rawZipPath);
        if (!rootPrefix && (normFullPath === 'metadata.db' || normFullPath.endsWith('/metadata.db'))) {
          if (normFullPath.endsWith('/metadata.db')) {
            rootPrefix = normFullPath.slice(0, normFullPath.length - 'metadata.db'.length);
          }
        }

        rawEntries.push({
          rawZipPath,
          normFullPath,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          localHeaderOffset
        });
      }

      ptr += 46 + nameLen + extraLen + commentLen;
    }

    const bookIdRegex = /\((\d+)\)\/([^/]+)$/;

    for (let i = 0; i < rawEntries.length; i++) {
      const item = rawEntries[i];
      let relNormPath = item.normFullPath;
      if (rootPrefix && relNormPath.startsWith(rootPrefix)) {
        relNormPath = relNormPath.slice(rootPrefix.length);
      }

      const lastSlash = item.rawZipPath.lastIndexOf('/');
      const baseName = lastSlash !== -1 ? item.rawZipPath.slice(lastSlash + 1) : item.rawZipPath;
      const normName = baseName.toLowerCase();

      const virtualEntry = {
        kind: 'file',
        isZipEntry: true,
        name: baseName,
        normPath: relNormPath,
        compressionMethod: item.compressionMethod,
        compressedSize: item.compressedSize,
        uncompressedSize: item.uncompressedSize,
        localHeaderOffset: item.localHeaderOffset,
        async getFile() {
          return extractZipEntryToFile(zipFile, this);
        }
      };

      localFileMap.set(relNormPath, virtualEntry);
      if (normName === 'metadata.db') {
        localFileMap.set('metadata.db', virtualEntry);
      }

      // Extract Calibre numeric book ID from folder pattern "... (34967)/file"
      const idMatch = bookIdRegex.exec(relNormPath);
      const bookIdNum = idMatch ? Number(idMatch[1]) : 0;

      if (normName.endsWith('.epub')) {
        epubsCount++;
        epubIndex.set(normName, virtualEntry);
        epubIndex.set(relNormPath, virtualEntry);
        if (bookIdNum > 0) {
          bookIdEpubMap.set(bookIdNum, virtualEntry);
        }
      } else if (normName === 'cover.jpg' || normName === 'cover.jpeg' || normName === 'cover.png') {
        coverIndex.set(relNormPath, virtualEntry);
        if (bookIdNum > 0) {
          bookIdCoverMap.set(bookIdNum, virtualEntry);
        }
      } else {
        localFileMap.set(normName, virtualEntry);
      }
    }

    return {
      filesCount: totalFilesCount,
      epubsCount: epubsCount,
      hasMetadataDb: localFileMap.has('metadata.db')
    };
  }

  return {
    /**
     * Initialize CalibreDB engine and restore saved local directory / ZIP archive and database
     */
    async init() {
      await initEngine();

      // 1. Try restoring saved ZIP FileHandle or DirectoryHandle from IndexedDB
      await this.restoreSavedZipHandle();
      if (localDirectoryStatus === 'none') {
        await this.restoreSavedDirectoryHandle();
      }

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
            directoryName: localDirectoryName,
            sourceType: localSourceType
          };
        } catch (err) {
          console.warn('Erreur lors du chargement de la base enregistrée:', err);
        }
      }

      return {
        loaded: false,
        directoryStatus: localDirectoryStatus,
        directoryName: localDirectoryName,
        sourceType: localSourceType
      };
    },

    /**
     * Restore saved ZIP FileHandle from IndexedDB
     */
    async restoreSavedZipHandle() {
      if (!('showOpenFilePicker' in window)) return;
      try {
        const saved = await CalibreStorage.getZipFileHandle();
        if (saved && saved.handle) {
          localZipHandle = saved.handle;
          localSourceType = 'zip';
          localDirectoryName = saved.name || localZipHandle.name || 'bibliotheque.zip';

          const perm = await localZipHandle.queryPermission({ mode: 'read' });
          if (perm === 'granted') {
            localZipFile = await localZipHandle.getFile();
            localDirectoryStatus = 'connected';
            await parseAndIndexZipFile(localZipFile);
          } else {
            localDirectoryStatus = 'needs_permission';
          }
        }
      } catch (err) {
        console.warn('Erreur restauration ZipFileHandle:', err);
      }
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
          localSourceType = 'directory';
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
     * Request re-granting permission on the saved DirectoryHandle or ZipFileHandle
     */
    async requestDirectoryPermission() {
      if (localSourceType === 'zip' && localZipHandle) {
        try {
          const perm = await localZipHandle.requestPermission({ mode: 'read' });
          if (perm === 'granted') {
            localZipFile = await localZipHandle.getFile();
            localDirectoryStatus = 'connected';
            await parseAndIndexZipFile(localZipFile);
            return true;
          }
        } catch (e) {
          console.warn('Permission ZIP refusée:', e);
        }
        return false;
      }

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
     * Connect a local Calibre ZIP archive via FileSystemFileHandle (persistent)
     */
    async setLocalZipHandle(fileHandle) {
      localZipHandle = fileHandle;
      localZipFile = await fileHandle.getFile();
      localDirectoryHandle = null;
      localSourceType = 'zip';
      localDirectoryName = fileHandle.name;
      localDirectoryStatus = 'connected';

      await CalibreStorage.removeDirectoryHandle();
      await CalibreStorage.saveZipFileHandle(fileHandle);

      return this.registerZipFile(localZipFile, true);
    },

    /**
     * Register and index a Calibre .zip File (with metadata.db at root + EPUB folders)
     */
    async registerZipFile(file, keepHandle = false) {
      if (!keepHandle) {
        localZipHandle = null;
        await CalibreStorage.removeDirectoryHandle();
        await CalibreStorage.removeZipFileHandle();
      }
      localZipFile = file;
      localDirectoryHandle = null;
      localSourceType = 'zip';
      localDirectoryName = file.name || 'bibliotheque.zip';
      localDirectoryStatus = 'connected';

      const stats = await parseAndIndexZipFile(file);

      // Automatically extract and load metadata.db if present at the root of the ZIP!
      const dbFile = await this.findMetadataDbInMap();
      if (dbFile) {
        const zipLibName = `${localDirectoryName} (metadata.db)`;
        this.loadFromArrayBuffer(dbFile.buffer, zipLibName);
        await CalibreStorage.saveMetadataDB(dbFile.buffer, zipLibName);
      }

      return {
        name: localDirectoryName,
        sourceType: 'zip',
        filesIndexed: stats.filesCount,
        epubsCount: stats.epubsCount,
        hasMetadataDb: dbFile !== null
      };
    },

    /**
     * Set a new local directory handle and persist it
     */
    async setLocalDirectoryHandle(dirHandle) {
      localDirectoryHandle = dirHandle;
      localZipHandle = null;
      localZipFile = null;
      localSourceType = 'directory';
      localDirectoryName = dirHandle.name;
      localDirectoryStatus = 'connected';

      // Persist in IndexedDB
      await CalibreStorage.removeZipFileHandle();
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
        sourceType: 'directory',
        filesIndexed: localFileMap.size,
        epubsCount: epubIndex.size,
        hasMetadataDb: dbFile !== null
      };
    },

    /**
     * Remove the local directory or ZIP archive connection
     */
    async removeLocalDirectory() {
      localDirectoryHandle = null;
      localZipHandle = null;
      localZipFile = null;
      localSourceType = 'none';
      localDirectoryName = '';
      localDirectoryStatus = 'none';
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();
      bookIdCoverMap.clear();
      bookIdEpubMap.clear();
      lastZipError = null;
      await CalibreStorage.removeDirectoryHandle();
      await CalibreStorage.removeZipFileHandle();
    },

    getLocalDirectoryInfo() {
      return {
        handle: localDirectoryHandle || localZipHandle,
        zipFile: localZipFile,
        sourceType: localSourceType,
        name: localDirectoryName,
        status: localDirectoryStatus,
        filesCount: localFileMap.size,
        epubsCount: bookIdEpubMap.size > 0
          ? bookIdEpubMap.size
          : (localSourceType === 'zip' ? Math.ceil(epubIndex.size / 2) : epubIndex.size),
        coversCount: bookIdCoverMap.size || coverIndex.size,
        lastError: lastZipError,
        isZipMetadataOnly: localDirectoryStatus !== 'connected' && String(dbName || '').toLowerCase().includes('.zip')
      };
    },

    /**
     * Scan directory handle recursively and build fast lookup indices
     */
    async scanDirectoryHandle(dirHandle) {
      localFileMap.clear();
      epubIndex.clear();
      coverIndex.clear();
      bookIdCoverMap.clear();
      bookIdEpubMap.clear();
      const bookIdRegex = /\((\d+)\)\/([^/]+)$/;

      async function walk(currentHandle, currentPath = '') {
        for await (const entry of currentHandle.values()) {
          const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          const normPath = normalizePath(entryPath);
          const normName = normalizePath(entry.name);

          if (entry.kind === 'file') {
            localFileMap.set(normPath, entry);
            localFileMap.set(normName, entry);

            const idMatch = bookIdRegex.exec(normPath);
            const bookIdNum = idMatch ? Number(idMatch[1]) : 0;

            // Index EPUBs
            if (normName.endsWith('.epub')) {
              epubIndex.set(normName, entry);
              epubIndex.set(normPath, entry);
              if (bookIdNum > 0) bookIdEpubMap.set(bookIdNum, entry);
            }
            // Index covers
            if (normName === 'cover.jpg' || normName === 'cover.jpeg' || normName === 'cover.png') {
              coverIndex.set(normPath, entry);
              if (bookIdNum > 0) bookIdCoverMap.set(bookIdNum, entry);
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
      bookIdCoverMap.clear();
      bookIdEpubMap.clear();
      const bookIdRegex = /\((\d+)\)\/([^/]+)$/;

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

        const idMatch = bookIdRegex.exec(cleanPath);
        const bookIdNum = idMatch ? Number(idMatch[1]) : 0;

        if (normName.endsWith('.epub')) {
          epubIndex.set(normName, file);
          epubIndex.set(cleanPath, file);
          if (bookIdNum > 0) bookIdEpubMap.set(bookIdNum, file);
        }
        if (normName === 'cover.jpg' || normName === 'cover.jpeg' || normName === 'cover.png') {
          coverIndex.set(cleanPath, file);
          if (bookIdNum > 0) bookIdCoverMap.set(bookIdNum, file);
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
     * Parse Calibre advanced search query syntax:
     * e.g., author:"Jules Verne" tag:Science format:EPUB rating:>=4 series:Voyages
     */
    parseCalibreSearch(rawSearch, whereClauses, params) {
      if (!rawSearch || !rawSearch.trim()) return;
      let remaining = rawSearch.trim();

      // Match key:"value" or key:value tokens
      const tokenRegex = /\b(author|authors|title|tag|tags|series|format|formats|publisher|rating|lang|language|id):(?:"([^"]+)"|([^\s]+))/gi;
      let match;
      while ((match = tokenRegex.exec(rawSearch)) !== null) {
        const field = match[1].toLowerCase();
        const val = (match[2] || match[3] || '').trim();
        remaining = remaining.replace(match[0], ' ');
        if (!val) continue;

        if (field === 'author' || field === 'authors') {
          whereClauses.push('(b.author_sort LIKE ? OR EXISTS (SELECT 1 FROM books_authors_link bal JOIN authors a ON bal.author = a.id WHERE bal.book = b.id AND a.name LIKE ?))');
          params.push(`%${val}%`, `%${val}%`);
        } else if (field === 'title') {
          whereClauses.push('b.title LIKE ?');
          params.push(`%${val}%`);
        } else if (field === 'tag' || field === 'tags') {
          whereClauses.push('EXISTS (SELECT 1 FROM books_tags_link btl JOIN tags t ON btl.tag = t.id WHERE btl.book = b.id AND t.name LIKE ?)');
          params.push(`%${val}%`);
        } else if (field === 'series') {
          whereClauses.push('EXISTS (SELECT 1 FROM books_series_link bsl JOIN series s ON bsl.series = s.id WHERE bsl.book = b.id AND s.name LIKE ?)');
          params.push(`%${val}%`);
        } else if (field === 'format' || field === 'formats') {
          whereClauses.push('EXISTS (SELECT 1 FROM data d WHERE d.book = b.id AND UPPER(d.format) = ?)');
          params.push(val.toUpperCase());
        } else if (field === 'publisher') {
          whereClauses.push('EXISTS (SELECT 1 FROM books_publishers_link bpl JOIN publishers p ON bpl.publisher = p.id WHERE bpl.book = b.id AND p.name LIKE ?)');
          params.push(`%${val}%`);
        } else if (field === 'lang' || field === 'language') {
          whereClauses.push('EXISTS (SELECT 1 FROM books_languages_link bll JOIN languages l ON bll.lang_code = l.id WHERE bll.book = b.id AND l.lang_code LIKE ?)');
          params.push(`%${val}%`);
        } else if (field === 'id') {
          whereClauses.push('b.id = ?');
          params.push(Number(val) || 0);
        } else if (field === 'rating') {
          const num = parseFloat(val.replace(/[^\d.]/g, ''));
          if (!isNaN(num)) {
            const dbRating = num <= 5 ? num * 2 : num;
            if (val.startsWith('>=')) {
              whereClauses.push('EXISTS (SELECT 1 FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id AND r.rating >= ?)');
              params.push(dbRating);
            } else {
              whereClauses.push('EXISTS (SELECT 1 FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id AND r.rating = ?)');
              params.push(dbRating);
            }
          }
        }
      }

      const cleanRem = remaining.trim();
      if (cleanRem) {
        const s = '%' + cleanRem + '%';
        whereClauses.push(`(
          b.title LIKE ?
          OR b.author_sort LIKE ?
          OR EXISTS (SELECT 1 FROM books_tags_link btl JOIN tags t ON btl.tag = t.id WHERE btl.book = b.id AND t.name LIKE ?)
          OR EXISTS (SELECT 1 FROM books_series_link bsl JOIN series s ON bsl.series = s.id WHERE bsl.book = b.id AND s.name LIKE ?)
        )`);
        params.push(s, s, s, s);
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
        publisherId = null,
        languageId = null,
        ratingStars = null,
        identifierType = null,
        format = null,
        bookIds = null,
        sortBy = 'timestamp_desc',
        offset = 0,
        limit = 36
      } = options;

      const whereClauses = [];
      const params = [];

      if (search && search.trim()) {
        this.parseCalibreSearch(search, whereClauses, params);
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

      if (publisherId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_publishers_link bpl WHERE bpl.book = b.id AND bpl.publisher = ?)');
        params.push(Number(publisherId));
      }

      if (languageId) {
        whereClauses.push('EXISTS (SELECT 1 FROM books_languages_link bll WHERE bll.book = b.id AND bll.lang_code = ?)');
        params.push(Number(languageId));
      }

      if (ratingStars !== null && ratingStars !== undefined) {
        const stars = Number(ratingStars);
        if (stars === 0) {
          whereClauses.push('NOT EXISTS (SELECT 1 FROM books_ratings_link brl WHERE brl.book = b.id)');
        } else {
          whereClauses.push('EXISTS (SELECT 1 FROM books_ratings_link brl JOIN ratings r ON brl.rating = r.id WHERE brl.book = b.id AND ROUND(r.rating / 2.0) = ?)');
          params.push(stars);
        }
      }

      if (identifierType) {
        whereClauses.push('EXISTS (SELECT 1 FROM identifiers idx WHERE idx.book = b.id AND LOWER(idx.type) = LOWER(?))');
        params.push(String(identifierType));
      }

      if (format) {
        whereClauses.push('EXISTS (SELECT 1 FROM data d WHERE d.book = b.id AND UPPER(d.format) = ?)');
        params.push(String(format).toUpperCase());
      }

      if (Array.isArray(bookIds)) {
        if (bookIds.length === 0) {
          return { total: 0, books: [] };
        }
        const ph = bookIds.map(() => '?').join(',');
        whereClauses.push(`b.id IN (${ph})`);
        params.push(...bookIds.map(Number));
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
        case 'author_desc':
          orderSql = 'ORDER BY b.author_sort COLLATE NOCASE DESC, b.id DESC';
          break;
        case 'pubdate_desc':
          orderSql = 'ORDER BY b.pubdate DESC, b.id DESC';
          break;
        case 'pubdate_asc':
          orderSql = 'ORDER BY b.pubdate ASC, b.id ASC';
          break;
        case 'timestamp_asc':
          orderSql = 'ORDER BY b.timestamp ASC, b.id ASC';
          break;
        case 'rating_desc':
          orderSql = 'ORDER BY rating DESC, b.id DESC';
          break;
        case 'rating_asc':
          orderSql = 'ORDER BY rating ASC, b.id ASC';
          break;
        case 'series_asc':
          orderSql = 'ORDER BY series COLLATE NOCASE ASC, b.series_index ASC, b.id DESC';
          break;
        case 'series_desc':
          orderSql = 'ORDER BY series COLLATE NOCASE DESC, b.series_index DESC, b.id DESC';
          break;
        case 'random':
          orderSql = 'ORDER BY RANDOM()';
          break;
        case 'id_asc':
          orderSql = 'ORDER BY b.id ASC';
          break;
        case 'id_desc':
        case 'timestamp_desc':
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
          (SELECT GROUP_CONCAT(t.name, ', ') FROM books_tags_link btl JOIN tags t ON btl.tag = t.id WHERE btl.book = b.id) AS tags,
          (SELECT GROUP_CONCAT(p.name, ', ') FROM books_publishers_link bpl JOIN publishers p ON bpl.publisher = p.id WHERE bpl.book = b.id) AS publisher,
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
              tags: b.tags ? b.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
              publisher: b.publisher || '',
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
     * Publishers list (for Calibre Tag Browser)
     */
    getPublishers(options = {}) {
      if (!dbInstance) return [];
      const { search = '', limit = 100, offset = 0 } = options;
      let where = '';
      const params = [];
      if (search && search.trim()) {
        where = 'WHERE p.name LIKE ?';
        params.push('%' + search.trim() + '%');
      }
      const q = `
        SELECT p.id, p.name, COUNT(bpl.book) as book_count
        FROM publishers p
        JOIN books_publishers_link bpl ON p.id = bpl.publisher
        ${where}
        GROUP BY p.id
        ORDER BY book_count DESC, p.name COLLATE NOCASE ASC
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
     * Languages list (for Calibre Tag Browser)
     */
    getLanguages() {
      if (!dbInstance) return [];
      const langNames = {
        fra: 'Français', fre: 'Français', fr: 'Français',
        eng: 'Anglais', en: 'Anglais',
        spa: 'Espagnol', es: 'Espagnol',
        deu: 'Allemand', ger: 'Allemand', de: 'Allemand',
        ita: 'Italien', it: 'Italien',
        por: 'Portugais', pt: 'Portugais',
        rus: 'Russe', ru: 'Russe',
        jpn: 'Japonais', ja: 'Japonais',
        zho: 'Chinois', chi: 'Chinois', zh: 'Chinois',
        ara: 'Arabe', ar: 'Arabe',
        nld: 'Néerlandais', dut: 'Néerlandais', nl: 'Néerlandais'
      };
      const q = `
        SELECT l.id, l.lang_code, COUNT(bll.book) as book_count
        FROM languages l
        JOIN books_languages_link bll ON l.id = bll.lang_code
        GROUP BY l.id
        ORDER BY book_count DESC
      `;
      try {
        const res = dbInstance.exec(q);
        if (!res.length) return [];
        return res[0].values.map(([id, code, count]) => ({
          id,
          code: String(code || '').toLowerCase(),
          name: langNames[String(code || '').toLowerCase()] || String(code || 'Inconnu').toUpperCase(),
          book_count: count
        }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Formats distribution (for Calibre Tag Browser)
     */
    getFormatsDistribution() {
      if (!dbInstance) return [];
      try {
        const res = dbInstance.exec('SELECT UPPER(format) as fmt, COUNT(DISTINCT book) as cnt FROM data GROUP BY UPPER(format) ORDER BY cnt DESC');
        if (!res.length) return [];
        return res[0].values.map(([format, book_count]) => ({ id: format, name: format, book_count }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Ratings distribution (1..5 stars + unrated for Calibre Tag Browser)
     */
    getRatingsDistribution() {
      if (!dbInstance) return [];
      try {
        const res = dbInstance.exec(`
          SELECT CAST(ROUND(r.rating / 2.0) AS INTEGER) as stars, COUNT(brl.book) as cnt
          FROM ratings r
          JOIN books_ratings_link brl ON r.id = brl.rating
          WHERE r.rating > 0
          GROUP BY stars
          ORDER BY stars DESC
        `);
        const list = [];
        if (res.length) {
          res[0].values.forEach(([stars, cnt]) => {
            if (stars >= 1 && stars <= 5) {
              list.push({
                id: stars,
                stars,
                name: '★'.repeat(stars) + '☆'.repeat(5 - stars) + ` (${stars} étoiles)`,
                book_count: cnt
              });
            }
          });
        }
        return list;
      } catch (e) {
        return [];
      }
    },

    /**
     * Identifier types (ISBN, Google, Amazon, etc. for Calibre Tag Browser)
     */
    getIdentifierTypes() {
      if (!dbInstance) return [];
      try {
        const res = dbInstance.exec('SELECT LOWER(type) as t, COUNT(DISTINCT book) as cnt FROM identifiers GROUP BY LOWER(type) ORDER BY cnt DESC');
        if (!res.length) return [];
        return res[0].values.map(([type, count]) => ({
          id: type,
          name: String(type).toUpperCase(),
          book_count: count
        }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Update Book Metadata directly inside SQLite metadata.db & persist to IndexedDB
     */
    async updateBookMetadata(bookId, meta = {}) {
      if (!dbInstance) throw new Error('Base de données non chargée');
      const id = Number(bookId);

      const title = (meta.title || 'Sans titre').trim();
      const authorStr = (meta.authors || 'Auteur inconnu').trim();
      const seriesName = (meta.series || '').trim();
      const seriesIndex = parseFloat(meta.series_index) || 1.0;
      const publisherName = (meta.publisher || '').trim();
      const ratingStars = Number(meta.ratingStars || 0);
      const tagsStr = (meta.tags || '').trim();
      const comment = (meta.comment || '').trim();

      // 1. Update books table
      dbInstance.run(
        'UPDATE books SET title = ?, sort = ?, author_sort = ?, series_index = ? WHERE id = ?',
        [title, title, authorStr, seriesIndex, id]
      );

      // 2. Update Authors
      const authorNames = authorStr.split(',').map((a) => a.trim()).filter(Boolean);
      if (authorNames.length > 0) {
        dbInstance.run('DELETE FROM books_authors_link WHERE book = ?', [id]);
        for (const aName of authorNames) {
          let aId = null;
          const existA = dbInstance.exec('SELECT id FROM authors WHERE name = ? COLLATE NOCASE', [aName]);
          if (existA.length && existA[0].values.length) {
            aId = existA[0].values[0][0];
          } else {
            dbInstance.run('INSERT INTO authors (name, sort) VALUES (?, ?)', [aName, aName]);
            aId = dbInstance.exec('SELECT last_insert_rowid()')[0].values[0][0];
          }
          dbInstance.run('INSERT OR IGNORE INTO books_authors_link (book, author) VALUES (?, ?)', [id, aId]);
        }
      }

      // 3. Update Series
      try {
        dbInstance.run('DELETE FROM books_series_link WHERE book = ?', [id]);
        if (seriesName) {
          let sId = null;
          const existS = dbInstance.exec('SELECT id FROM series WHERE name = ? COLLATE NOCASE', [seriesName]);
          if (existS.length && existS[0].values.length) {
            sId = existS[0].values[0][0];
          } else {
            dbInstance.run('INSERT INTO series (name, sort) VALUES (?, ?)', [seriesName, seriesName]);
            sId = dbInstance.exec('SELECT last_insert_rowid()')[0].values[0][0];
          }
          dbInstance.run('INSERT OR IGNORE INTO books_series_link (book, series) VALUES (?, ?)', [id, sId]);
        }
      } catch (e) {}

      // 4. Update Publisher
      try {
        dbInstance.run('DELETE FROM books_publishers_link WHERE book = ?', [id]);
        if (publisherName) {
          let pId = null;
          const existP = dbInstance.exec('SELECT id FROM publishers WHERE name = ? COLLATE NOCASE', [publisherName]);
          if (existP.length && existP[0].values.length) {
            pId = existP[0].values[0][0];
          } else {
            dbInstance.run('INSERT INTO publishers (name, sort) VALUES (?, ?)', [publisherName, publisherName]);
            pId = dbInstance.exec('SELECT last_insert_rowid()')[0].values[0][0];
          }
          dbInstance.run('INSERT OR IGNORE INTO books_publishers_link (book, publisher) VALUES (?, ?)', [id, pId]);
        }
      } catch (e) {}

      // 5. Update Rating
      try {
        dbInstance.run('DELETE FROM books_ratings_link WHERE book = ?', [id]);
        if (ratingStars >= 1 && ratingStars <= 5) {
          const dbRating = Math.round(ratingStars * 2);
          let rId = null;
          const existR = dbInstance.exec('SELECT id FROM ratings WHERE rating = ?', [dbRating]);
          if (existR.length && existR[0].values.length) {
            rId = existR[0].values[0][0];
          } else {
            dbInstance.run('INSERT INTO ratings (rating) VALUES (?)', [dbRating]);
            rId = dbInstance.exec('SELECT last_insert_rowid()')[0].values[0][0];
          }
          dbInstance.run('INSERT OR IGNORE INTO books_ratings_link (book, rating) VALUES (?, ?)', [id, rId]);
        }
      } catch (e) {}

      // 6. Update Tags
      try {
        dbInstance.run('DELETE FROM books_tags_link WHERE book = ?', [id]);
        const tagNames = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
        for (const tName of tagNames) {
          let tId = null;
          const existT = dbInstance.exec('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [tName]);
          if (existT.length && existT[0].values.length) {
            tId = existT[0].values[0][0];
          } else {
            dbInstance.run('INSERT INTO tags (name) VALUES (?)', [tName]);
            tId = dbInstance.exec('SELECT last_insert_rowid()')[0].values[0][0];
          }
          dbInstance.run('INSERT OR IGNORE INTO books_tags_link (book, tag) VALUES (?, ?)', [id, tId]);
        }
      } catch (e) {}

      // 7. Update Comments / Summary
      try {
        const existC = dbInstance.exec('SELECT id FROM comments WHERE book = ?', [id]);
        if (existC.length && existC[0].values.length) {
          dbInstance.run('UPDATE comments SET text = ? WHERE book = ?', [comment, id]);
        } else if (comment) {
          dbInstance.run('INSERT INTO comments (book, text) VALUES (?, ?)', [id, comment]);
        }
      } catch (e) {}

      // Persist updated database binary to IndexedDB
      const exported = dbInstance.export();
      await CalibreStorage.saveMetadataDB(exported, dbName || 'metadata.db');
      return this.getBookDetails(id);
    },

    /**
     * Delete a book from the local SQLite database and persist
     */
    async deleteBook(bookId) {
      if (!dbInstance) throw new Error('Base de données non chargée');
      const id = Number(bookId);
      const tables = [
        ['books_authors_link', 'book'],
        ['books_series_link', 'book'],
        ['books_tags_link', 'book'],
        ['books_publishers_link', 'book'],
        ['books_ratings_link', 'book'],
        ['books_languages_link', 'book'],
        ['comments', 'book'],
        ['data', 'book'],
        ['identifiers', 'book'],
        ['books', 'id']
      ];
      for (const [tbl, col] of tables) {
        try {
          dbInstance.run(`DELETE FROM ${tbl} WHERE ${col} = ?`, [id]);
        } catch (e) {}
      }
      const exported = dbInstance.export();
      await CalibreStorage.saveMetadataDB(exported, dbName || 'metadata.db');
      return true;
    },

    /**
     * Retrieve cover URL (from IndexedDB cache, O(1) bookIdCoverMap, local folder, or generated SVG)
     */
    async getCoverUrl(book) {
      if (!book) return generateNextGenCover('Calibre', '', 0);
      const bookId = Number(book.id);

      // 1. Check IndexedDB cover cache (persists across Android reloads!)
      try {
        const storedCover = await CalibreStorage.getCover(bookId);
        if (storedCover) {
          const url = URL.createObjectURL(storedCover);
          createdObjectUrls.add(url);
          return url;
        }
      } catch (e) {}

      // 2. O(1) direct numeric bookId lookup in ZIP / local index (`...(34967)/cover.jpg`)
      if (bookId > 0 && bookIdCoverMap.has(bookId)) {
        try {
          const entry = bookIdCoverMap.get(bookId);
          const fileObj = typeof entry.getFile === 'function' ? await entry.getFile() : entry;
          if (fileObj && fileObj.size > 0) {
            CalibreStorage.saveCover(bookId, fileObj).catch(() => {});
            const url = URL.createObjectURL(fileObj);
            createdObjectUrls.add(url);
            return url;
          }
        } catch (err) {
          console.warn('Erreur lecture couverture ZIP par ID:', bookId, err);
        }
      }

      // 3. Check local directory handle or path map
      if (book.path) {
        const basePath = normalizePath(book.path);

        // A. If we have a connected DirectoryHandle, try resolving directly
        if (localDirectoryHandle && localDirectoryStatus === 'connected') {
          for (const candName of ['cover.jpg', 'cover.jpeg', 'cover.png']) {
            try {
              const file = await resolveFileInHandle(localDirectoryHandle, `${book.path}/${candName}`);
              if (file && file.size > 0) {
                CalibreStorage.saveCover(bookId, file).catch(() => {});
                const url = URL.createObjectURL(file);
                createdObjectUrls.add(url);
                return url;
              }
            } catch (e) {}
          }
        }

        // B. Check coverIndex / localFileMap (works for both Local Directory & ZIP Archive!)
        for (const cand of [`${basePath}/cover.jpg`, `${basePath}/cover.jpeg`, `${basePath}/cover.png`]) {
          const match = localFileMap.get(cand) || coverIndex.get(cand);
          if (match) {
            try {
              const fileObj = typeof match.getFile === 'function' ? await match.getFile() : match;
              if (fileObj && fileObj.size > 0) {
                CalibreStorage.saveCover(bookId, fileObj).catch(() => {});
                const url = URL.createObjectURL(fileObj);
                createdObjectUrls.add(url);
                return url;
              }
            } catch (err) {
              console.warn('Erreur lecture coverIndex:', cand, err);
            }
          }
        }

        // C. Fallback cover match by Calibre book ID suffix `(${bookId})/cover.`
        const idToken = `(${bookId})/cover.`;
        for (const [k, handle] of coverIndex.entries()) {
          if (k.includes(idToken)) {
            try {
              const fileObj = typeof handle.getFile === 'function' ? await handle.getFile() : handle;
              if (fileObj && fileObj.size > 0) {
                CalibreStorage.saveCover(bookId, fileObj).catch(() => {});
                const url = URL.createObjectURL(fileObj);
                createdObjectUrls.add(url);
                return url;
              }
            } catch (e) {}
          }
        }
      }

      // 4. Fallback: generate NextGen SVG cover
      let authorText = '';
      if (Array.isArray(book.authors)) {
        authorText = book.authors.map(a => (typeof a === 'string' ? a : (a && (a.name || a.sort)) || '')).filter(Boolean).join(', ');
      } else if (typeof book.authors === 'string') {
        authorText = book.authors;
      } else if (book.author_sort) {
        authorText = String(book.author_sort);
      }
      return generateNextGenCover(book.title, authorText, book.id);
    },

    /**
     * Retrieve book EPUB file directly from the ZIP archive, local directory, or IndexedDB!
     */
    async getBookBlob(bookId, format = 'EPUB') {
      const bId = Number(bookId);
      const fmt = String(format).toUpperCase();
      const bookDetails = this.getBookDetails(bId);

      // 0. Fast O(1) lookup by Calibre numeric book ID in ZIP / local index (`...(34967)/*.epub`)
      if (fmt === 'EPUB' && bId > 0 && bookIdEpubMap.has(bId)) {
        try {
          const entry = bookIdEpubMap.get(bId);
          const fileObj = typeof entry.getFile === 'function' ? await entry.getFile() : entry;
          if (fileObj && fileObj.size > 0) {
            return {
              blob: fileObj,
              filename: entry.name || fileObj.name || `livre_${bId}.epub`,
              source: entry.isZipEntry ? 'archive_zip' : (localSourceType === 'zip' ? 'archive_zip' : 'local_dir')
            };
          }
        } catch (err) {
          console.warn('Erreur extraction EPUB par ID depuis ZIP:', bId, err);
        }
      }

      // 1. Check local directory (File System Access API DirectoryHandle)
      if (localDirectoryHandle && localDirectoryStatus === 'connected' && bookDetails) {
        const matchingFiles = bookDetails.dataFiles.filter((d) => d.format === fmt);

        for (const d of matchingFiles) {
          const ext = fmt.toLowerCase();
          const fileName = `${d.name}.${ext}`;

          // Standard Calibre path: `<books.path>/<data.name>.<fmt>`
          const relPath = `${bookDetails.path}/${fileName}`;
          let file = await resolveFileInHandle(localDirectoryHandle, relPath);
          if (file) {
            return { blob: file, filename: fileName, source: 'local_dir' };
          }

          // If the handle was connected inside an author or subfolder:
          const pathParts = (bookDetails.path || '').replace(/\\/g, '/').split('/').filter(Boolean);
          if (pathParts.length > 1) {
            const subRelPath = `${pathParts[pathParts.length - 1]}/${fileName}`;
            file = await resolveFileInHandle(localDirectoryHandle, subRelPath);
            if (file) {
              return { blob: file, filename: fileName, source: 'local_dir' };
            }
          }

          // Direct file check
          file = await resolveFileInHandle(localDirectoryHandle, fileName);
          if (file) {
            return { blob: file, filename: fileName, source: 'local_dir' };
          }
        }

        // Also check if any file inside `bookDetails.path` has .epub extension
        const generalRelPath = `${bookDetails.path}/${bookDetails.title}.${fmt.toLowerCase()}`;
        const fileByTitle = await resolveFileInHandle(localDirectoryHandle, generalRelPath);
        if (fileByTitle) {
          return { blob: fileByTitle, filename: fileByTitle.name, source: 'local_dir' };
        }
      }

      // 2. Check localFileMap / epubIndex (from ZIP archive, webkitdirectory, or previous scan)
      if (bookDetails && (localFileMap.size > 0 || epubIndex.size > 0)) {
        const basePath = normalizePath(bookDetails.path);
        const matchingFiles = bookDetails.dataFiles.filter((d) => d.format === fmt);
        const srcTag = localSourceType === 'zip' ? 'archive_zip' : 'local_dir';

        for (const d of matchingFiles) {
          const ext = fmt.toLowerCase();
          const normFile = normalizePath(`${d.name}.${ext}`);
          const cands = [
            `${basePath}/${normFile}`,
            normFile
          ];
          for (const cand of cands) {
            const match = localFileMap.get(cand) || epubIndex.get(cand);
            if (match) {
              try {
                const fileObj = typeof match.getFile === 'function' ? await match.getFile() : match;
                if (fileObj && fileObj.size > 0) {
                  return { blob: fileObj, filename: fileObj.name || `${d.name}.${ext}`, source: match.isZipEntry ? 'archive_zip' : srcTag };
                }
              } catch (err) {
                console.warn('Erreur extraction localFileMap:', cand, err);
              }
            }
          }

          // Fallback search across epubIndex by suffix, normalized name, or Calibre book ID folder `(${bId})/`
          if (fmt === 'EPUB') {
            const idFolderToken = `(${bId})/`;
            for (const [key, fileHandle] of epubIndex.entries()) {
              if (key === normFile || key.endsWith('/' + normFile) || key.includes(idFolderToken)) {
                try {
                  const fileObj = typeof fileHandle.getFile === 'function' ? await fileHandle.getFile() : fileHandle;
                  if (fileObj && fileObj.size > 0) {
                    return { blob: fileObj, filename: fileObj.name || `${d.name}.${ext}`, source: fileHandle.isZipEntry ? 'archive_zip' : srcTag };
                  }
                } catch (err) {
                  console.warn('Erreur extraction epubIndex:', key, err);
                }
              }
            }
          }
        }
      }

      // 3. Check IndexedDB stored book files
      const stored = await CalibreStorage.getBookFile(bId, fmt);
      if (stored && stored.blob) {
        return { blob: stored.blob, filename: stored.filename, source: 'indexeddb' };
      }

      // 4. Fallback for demo sample book (only for demo library)
      if (bId === 1 && fmt === 'EPUB') {
        if (bookDetails && (String(bookDetails.title).toLowerCase().includes('vingt mille lieues') || String(bookDetails.author_sort).toLowerCase().includes('verne'))) {
          try {
            const resp = await fetch('./sample.epub');
            if (resp.ok) {
              const blob = await resp.blob();
              return { blob, filename: 'Vingt mille lieues sous les mers.epub', source: 'demo' };
            }
          } catch (e) {}
        }
      }

      return null;
    }
  };
})();

// Attach globally to window
window.CalibreDB = CalibreDB;
