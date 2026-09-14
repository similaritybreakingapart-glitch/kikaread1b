// IndexedDB storage manager for Kika Mobile
const DB_NAME = 'kika_mobile_db';
const DB_VERSION = 2;

let dbPromise = null;

export function getDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('word_cache')) {
        db.createObjectStore('word_cache', { keyPath: 'word' });
      }
      if (!db.objectStoreNames.contains('sentence_cache')) {
        db.createObjectStore('sentence_cache', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        const bmStore = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
        bmStore.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains('word_tags')) {
        const tagStore = db.createObjectStore('word_tags', { keyPath: 'word' });
        tagStore.createIndex('status', 'status', { unique: false });
        tagStore.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// --- Book Management ---
export async function saveBook(id, title, author, fileBuffer) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    store.put({ id, title, author, data: fileBuffer, addedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllBooks() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const req = store.getAll();
    req.onsuccess = () => {
      // Don't return huge binary data in list view
      const list = (req.result || []).map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        addedAt: b.addedAt,
      }));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getBookData(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBook(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['books', 'progress'], 'readwrite');
    tx.objectStore('books').delete(id);
    tx.objectStore('progress').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// --- Progress ---
export async function saveProgress(bookId, chapterIndex, sentenceIndex, scrollPct = 0) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readwrite');
    tx.objectStore('progress').put({
      bookId,
      chapterIndex,
      sentenceIndex,
      scrollPct,
      updatedAt: Date.now(),
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getProgress(bookId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('progress', 'readonly');
    const req = tx.objectStore('progress').get(bookId);
    req.onsuccess = () => resolve(req.result || { chapterIndex: 0, sentenceIndex: 0, scrollPct: 0 });
    req.onerror = () => reject(req.error);
  });
}

// --- Translation Caching ---
export async function getCachedWord(word) {
  const key = word.trim().toLowerCase();
  const db = await getDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('word_cache', 'readonly');
      const req = tx.objectStore('word_cache').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedWord(wordData) {
  const key = wordData.word.trim().toLowerCase();
  const db = await getDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('word_cache', 'readwrite');
      tx.objectStore('word_cache').put({
        ...wordData,
        word: key,
        cachedAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getCachedSentence(sentenceText) {
  const key = sentenceText.trim().replace(/\s+/g, ' ');
  const db = await getDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('sentence_cache', 'readonly');
      const req = tx.objectStore('sentence_cache').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedSentence(sentenceText, plTranslation, enTranslation) {
  const key = sentenceText.trim().replace(/\s+/g, ' ');
  const db = await getDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('sentence_cache', 'readwrite');
      tx.objectStore('sentence_cache').put({
        hash: key,
        sentence: sentenceText,
        pl: plTranslation,
        en: enTranslation,
        cachedAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// --- Word Tagging (Learned / To-Learn) ---
export async function setWordTag(word, status, contextSentence = '', bookId = '') {
  const key = word.trim().toLowerCase();
  const db = await getDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('word_tags', 'readwrite');
      tx.objectStore('word_tags').put({
        word: key,
        original: word.trim(),
        status, // 'learned' (green) or 'learning' (yellow)
        contextSentence,
        bookId,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function deleteWordTag(word) {
  const key = word.trim().toLowerCase();
  const db = await getDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('word_tags', 'readwrite');
      tx.objectStore('word_tags').delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getAllWordTags() {
  const db = await getDB();
  if (!db) return {};
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('word_tags', 'readonly');
      const req = tx.objectStore('word_tags').getAll();
      req.onsuccess = () => {
        const map = {};
        (req.result || []).forEach(item => {
          map[item.word] = item;
        });
        resolve(map);
      };
      req.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

