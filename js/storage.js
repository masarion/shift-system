// storage.js — localStorage wrapper

const DEFAULT_KEY = 'shiftSystem_PRJ001_202506';

export const StorageManager = {
  save(data, key = DEFAULT_KEY) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[storage] save failed:', e);
    }
  },

  load(key = DEFAULT_KEY) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[storage] load failed:', e);
      return null;
    }
  },

  clear(key = DEFAULT_KEY) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('[storage] clear failed:', e);
    }
  },
};
