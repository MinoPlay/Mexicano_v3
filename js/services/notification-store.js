/**
 * Notification history store — IndexedDB-backed list of received push
 * notifications. Shared by sw.js (writes on `push`) and the notification
 * bell (reads/marks read/clears). Works in both the page and the service
 * worker context: both expose a global `indexedDB`.
 */

const DB_NAME = 'mexicano-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';
export const MAX_HISTORY = 30;

function isSupported() {
  return typeof indexedDB !== 'undefined';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, callback) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }));
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let sequence = 0;

/** Read all notifications, newest-first. */
export async function getNotifications() {
  if (!isSupported()) return [];
  const all = await withStore('readonly', store => requestToPromise(store.getAll()));
  return all.slice().sort((a, b) => (b.receivedAt - a.receivedAt) || (b.seq - a.seq));
}

/** Store a new notification, pruning history down to the newest MAX_HISTORY. */
export async function addNotification({ title, body = '', url = './' }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title,
    body,
    url,
    receivedAt: Date.now(),
    seq: sequence++,
    read: false,
  };
  if (!isSupported()) return entry;
  await withStore('readwrite', store => store.add(entry));

  const all = await getNotifications();
  if (all.length > MAX_HISTORY) {
    const toRemove = all.slice(MAX_HISTORY);
    await withStore('readwrite', store => {
      toRemove.forEach(n => store.delete(n.id));
    });
  }
  return entry;
}

/** Count unread notifications. */
export async function getUnreadCount() {
  const all = await getNotifications();
  return all.filter(n => !n.read).length;
}

/** Mark every notification as read. */
export async function markAllRead() {
  if (!isSupported()) return;
  const all = await getNotifications();
  await withStore('readwrite', store => {
    all.forEach(n => store.put({ ...n, read: true }));
  });
}

/** Remove all notification history. */
export async function clearAll() {
  if (!isSupported()) return;
  await withStore('readwrite', store => store.clear());
}
