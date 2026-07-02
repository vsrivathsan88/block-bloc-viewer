// Minimal IndexedDB wrapper: two object stores — "projects" (JSON) and
// "images" (dataURL strings, keyed by imageId). No deps.

const DB_NAME = "shotboard";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects");
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  getProject: (id: string) => tx<unknown>("projects", "readonly", (s) => s.get(id)),
  putProject: (id: string, p: unknown) => tx("projects", "readwrite", (s) => s.put(p, id)),
  deleteProject: (id: string) => tx("projects", "readwrite", (s) => s.delete(id)),
  listProjectKeys: () => tx<IDBValidKey[]>("projects", "readonly", (s) => s.getAllKeys()),
  listProjects: () => tx<unknown[]>("projects", "readonly", (s) => s.getAll()),

  getImage: (id: string) => tx<string | undefined>("images", "readonly", (s) => s.get(id)),
  putImage: (id: string, dataUrl: string) => tx("images", "readwrite", (s) => s.put(dataUrl, id)),
  deleteImage: (id: string) => tx("images", "readwrite", (s) => s.delete(id)),
};
