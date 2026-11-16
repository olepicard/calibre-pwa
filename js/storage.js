/**
 * Calibre-Web PWA - Storage Module (IndexedDB)
 * Manages persistent storage for metadata.db, book files, covers, and reading progress.
 */

const CalibreStorage = (function () {
  'use strict';

  const DB_NAME = 'CalibrePWA_DB';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for metadata.db file
        if (!db.objectStoreNames.contains('calibre_db')) {
          db.createObjectStore('calibre_db', { keyPath: 'id' });
        }

        // Store for book files (EPUB, PDF, etc.)
        if (!db.objectStoreNames.contains('book_files')) {
          const filesStore = db.createObjectStore('book_files', { keyPath: 'key' });
          filesStore.createIndex('bookId', 'bookId', { unique: false });
        }

        // Store for book covers
        if (!db.objectStoreNames.contains('book_covers')) {
          db.createObjectStore('book_covers', { keyPath: 'bookId' });
        }

        // Store for reading progress & bookmarks
        if (!db.objectStoreNames.contains('reading_progress')) {
          db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        }

        // Store for user preferences
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });

    return dbPromise;
  }

  async function getStore(storeName, mode = 'readonly') {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  return {
    /**
     * Save the metadata.db binary into IndexedDB
     */
    async saveMetadataDB(buffer, filename = 'metadata.db') {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('calibre_db', 'readwrite');
        const store = tx.objectStore('calibre_db');

        // buffer can be ArrayBuffer or Uint8Array
        const record = {
          id: 'current_metadata_db',
          name: filename,
          data: buffer,
          size: buffer.byteLength || buffer.length,
          lastUpdated: Date.now()
        };

        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Retrieve the stored metadata.db
     */
    async getMetadataDB() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('calibre_db', 'readonly');
        const store = tx.objectStore('calibre_db');
        const req = store.get('current_metadata_db');

        req.onsuccess = () => {
          resolve(req.result || null);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Delete stored metadata.db
     */
    async deleteMetadataDB() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('calibre_db', 'readwrite');
        const store = tx.objectStore('calibre_db');
        const req = store.delete('current_metadata_db');

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Save a local ebook file (EPUB, PDF...) associated with a book ID
     */
    async saveBookFile(bookId, format, blob, filename) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_files', 'readwrite');
        const store = tx.objectStore('book_files');

        const key = `${bookId}_${format.toUpperCase()}`;
        const record = {
          key: key,
          bookId: Number(bookId),
          format: format.toUpperCase(),
          blob: blob,
          filename: filename || `${bookId}.${format.toLowerCase()}`,
          size: blob.size,
          savedAt: Date.now()
        };

        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Retrieve a book file by ID and format
     */
    async getBookFile(bookId, format) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_files', 'readonly');
        const store = tx.objectStore('book_files');
        const key = `${bookId}_${format.toUpperCase()}`;
        const req = store.get(key);

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Check if a book file exists in local storage
     */
    async hasBookFile(bookId, format) {
      const file = await this.getBookFile(bookId, format);
      return file !== null;
    },

    /**
     * Get list of all book files stored locally
     */
    async getAllBookFiles() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_files', 'readonly');
        const store = tx.objectStore('book_files');
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Delete a stored book file
     */
    async deleteBookFile(bookId, format) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_files', 'readwrite');
        const store = tx.objectStore('book_files');
        const key = `${bookId}_${format.toUpperCase()}`;
        const req = store.delete(key);

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Save cover image for a book
     */
    async saveCover(bookId, blob) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_covers', 'readwrite');
        const store = tx.objectStore('book_covers');
        const req = store.put({
          bookId: Number(bookId),
          blob: blob,
          savedAt: Date.now()
        });

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Retrieve cover image blob for a book
     */
    async getCover(bookId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('book_covers', 'readonly');
        const store = tx.objectStore('book_covers');
        const req = store.get(Number(bookId));

        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Save reading progress (CFI, percentage, chapter)
     */
    async saveProgress(bookId, progress) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_progress', 'readwrite');
        const store = tx.objectStore('reading_progress');
        const record = {
          bookId: Number(bookId),
          cfi: progress.cfi || null,
          percentage: progress.percentage || 0,
          chapter: progress.chapter || '',
          updatedAt: Date.now()
        };

        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Get reading progress for a book
     */
    async getProgress(bookId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_progress', 'readonly');
        const store = tx.objectStore('reading_progress');
        const req = store.get(Number(bookId));

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Get all reading progress records
     */
    async getAllProgress() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_progress', 'readonly');
        const store = tx.objectStore('reading_progress');
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * User setting getter / setter
     */
    async getSetting(key, defaultValue = null) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);

        req.onsuccess = () => {
          resolve(req.result ? req.result.value : defaultValue);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async setSetting(key, value) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.put({ key, value });

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Query browser storage estimate (quota and usage)
     */
    async getStorageEstimate() {
      if (navigator.storage && navigator.storage.estimate) {
        return await navigator.storage.estimate();
      }
      return { usage: 0, quota: 0 };
    },

    /**
     * Clear all stored data (reset)
     */
    async clearAll() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['calibre_db', 'book_files', 'book_covers', 'reading_progress'], 'readwrite');
        tx.objectStore('calibre_db').clear();
        tx.objectStore('book_files').clear();
        tx.objectStore('book_covers').clear();
        tx.objectStore('reading_progress').clear();

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    }
  };
})();
