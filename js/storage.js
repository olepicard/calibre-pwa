/**
 * Calibre-Web NextGen PWA - Storage Module (IndexedDB)
 * Manages persistent storage for metadata.db, local directory handle, custom shelves, and reading status.
 */

const CalibreStorage = (function () {
  'use strict';

  const DB_NAME = 'CalibreNextGenPWA_DB';
  const DB_VERSION = 2;
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

        // Store for book files (EPUB, PDF...)
        if (!db.objectStoreNames.contains('book_files')) {
          const filesStore = db.createObjectStore('book_files', { keyPath: 'key' });
          filesStore.createIndex('bookId', 'bookId', { unique: false });
        }

        // Store for book covers
        if (!db.objectStoreNames.contains('book_covers')) {
          db.createObjectStore('book_covers', { keyPath: 'bookId' });
        }

        // Store for reading progress & position (CFI, %)
        if (!db.objectStoreNames.contains('reading_progress')) {
          db.createObjectStore('reading_progress', { keyPath: 'bookId' });
        }

        // Store for reading status (unread, reading, read)
        if (!db.objectStoreNames.contains('reading_status')) {
          db.createObjectStore('reading_status', { keyPath: 'bookId' });
        }

        // Store for custom user shelves
        if (!db.objectStoreNames.contains('custom_shelves')) {
          db.createObjectStore('custom_shelves', { keyPath: 'id' });
        }

        // Store for user preferences & directory handle
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

  return {
    /**
     * Save metadata.db file buffer into IndexedDB
     */
    async saveMetadataDB(buffer, filename = 'metadata.db') {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('calibre_db', 'readwrite');
        const store = tx.objectStore('calibre_db');

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
     * Retrieve stored metadata.db
     */
    async getMetadataDB() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('calibre_db', 'readonly');
        const store = tx.objectStore('calibre_db');
        const req = store.get('current_metadata_db');

        req.onsuccess = () => resolve(req.result || null);
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
     * Save FileSystemDirectoryHandle for the local library / EPUBs directory
     */
    async saveDirectoryHandle(handle) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');

        const req = store.put({
          key: 'local_library_dir_handle',
          handle: handle,
          name: handle.name,
          savedAt: Date.now()
        });

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Retrieve saved FileSystemDirectoryHandle
     */
    async getDirectoryHandle() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get('local_library_dir_handle');

        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Remove saved DirectoryHandle
     */
    async removeDirectoryHandle() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.delete('local_library_dir_handle');

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Reading progress (CFI, percentage)
     */
    async saveProgress(bookId, progress) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['reading_progress', 'reading_status'], 'readwrite');
        const progStore = tx.objectStore('reading_progress');
        const statStore = tx.objectStore('reading_status');

        const bId = Number(bookId);
        const progRecord = {
          bookId: bId,
          cfi: progress.cfi || null,
          percentage: progress.percentage || 0,
          chapter: progress.chapter || '',
          updatedAt: Date.now()
        };
        progStore.put(progRecord);

        // Update status automatically: reading or read
        const newStatus = (progress.percentage >= 95) ? 'read' : 'reading';
        statStore.put({
          bookId: bId,
          status: newStatus,
          lastReadAt: Date.now()
        });

        tx.oncomplete = () => resolve(progRecord);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

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
     * Reading Status (unread, reading, read)
     */
    async setReadingStatus(bookId, status) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_status', 'readwrite');
        const store = tx.objectStore('reading_status');
        const req = store.put({
          bookId: Number(bookId),
          status: status, // 'unread', 'reading', 'read'
          updatedAt: Date.now()
        });

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getReadingStatus(bookId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_status', 'readonly');
        const store = tx.objectStore('reading_status');
        const req = store.get(Number(bookId));

        req.onsuccess = () => resolve(req.result ? req.result.status : 'unread');
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getAllReadingStatus() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('reading_status', 'readonly');
        const store = tx.objectStore('reading_status');
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Custom Shelves Management (Étagères personnalisées)
     */
    async getShelves() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('custom_shelves', 'readonly');
        const store = tx.objectStore('custom_shelves');
        const req = store.getAll();

        req.onsuccess = () => {
          let list = req.result || [];
          if (list.length === 0) {
            // Seed default shelf
            const defaultShelf = {
              id: 'shelf_favorites',
              name: 'Coups de cœur',
              description: 'Mes livres favoris',
              icon: '⭐',
              bookIds: [],
              createdAt: Date.now()
            };
            this.createShelf(defaultShelf.name, defaultShelf.description, defaultShelf.icon, defaultShelf.id);
            list = [defaultShelf];
          }
          resolve(list);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async createShelf(name, description = '', icon = '📚', customId = null) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('custom_shelves', 'readwrite');
        const store = tx.objectStore('custom_shelves');
        const shelf = {
          id: customId || 'shelf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          name: name.trim(),
          description: description.trim(),
          icon: icon || '📚',
          bookIds: [],
          createdAt: Date.now()
        };

        const req = store.put(shelf);
        req.onsuccess = () => resolve(shelf);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async deleteShelf(shelfId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('custom_shelves', 'readwrite');
        const store = tx.objectStore('custom_shelves');
        const req = store.delete(shelfId);

        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async addBookToShelf(shelfId, bookId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('custom_shelves', 'readwrite');
        const store = tx.objectStore('custom_shelves');
        const req = store.get(shelfId);

        req.onsuccess = () => {
          const shelf = req.result;
          if (!shelf) return resolve(false);

          const bId = Number(bookId);
          if (!shelf.bookIds.includes(bId)) {
            shelf.bookIds.push(bId);
            store.put(shelf);
          }
          resolve(true);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async removeBookFromShelf(shelfId, bookId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('custom_shelves', 'readwrite');
        const store = tx.objectStore('custom_shelves');
        const req = store.get(shelfId);

        req.onsuccess = () => {
          const shelf = req.result;
          if (!shelf) return resolve(false);

          const bId = Number(bookId);
          shelf.bookIds = shelf.bookIds.filter((id) => id !== bId);
          store.put(shelf);
          resolve(true);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Stored book files (manual attachments)
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

    async getStorageEstimate() {
      if (navigator.storage && navigator.storage.estimate) {
        return await navigator.storage.estimate();
      }
      return { usage: 0, quota: 0 };
    },

    /**
     * Clear all stored data
     */
    async clearAll() {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([
          'calibre_db',
          'book_files',
          'book_covers',
          'reading_progress',
          'reading_status',
          'custom_shelves',
          'settings'
        ], 'readwrite');

        tx.objectStore('calibre_db').clear();
        tx.objectStore('book_files').clear();
        tx.objectStore('book_covers').clear();
        tx.objectStore('reading_progress').clear();
        tx.objectStore('reading_status').clear();
        tx.objectStore('custom_shelves').clear();
        tx.objectStore('settings').clear();

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    }
  };
})();
