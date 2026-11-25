// ─────────────────────────────────────────────
//  Almacén local del dispositivo (IndexedDB)
//
//  archivos: imágenes completas (fotos y planos). Se guardan aquí primero;
//            "pendiente: 1" marca las que aún no suben a la nube.
//  docs:     solo en modo local (sin Firebase), hace de base de datos.
// ─────────────────────────────────────────────

let conexion = null;

function abrir() {
  if (!conexion) {
    conexion = new Promise((res, rej) => {
      const r = indexedDB.open('dak-visitas', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const a = db.createObjectStore('archivos', { keyPath: 'id' });
        a.createIndex('visitaId', 'visitaId');
        a.createIndex('pendiente', 'pendiente');
        db.createObjectStore('docs', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return conexion;
}

const pedir = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function almacen(nombre, modo = 'readonly') {
  const db = await abrir();
  return db.transaction(nombre, modo).objectStore(nombre);
}

export const archivos = {
  get: async id => pedir((await almacen('archivos')).get(id)),
  put: async rec => pedir((await almacen('archivos', 'readwrite')).put(rec)),
  del: async id => pedir((await almacen('archivos', 'readwrite')).delete(id)),
  pendientes: async () => pedir((await almacen('archivos')).index('pendiente').getAll(1)),
  clavesDeVisita: async vid => pedir((await almacen('archivos')).index('visitaId').getAllKeys(vid)),
  todos: async () => pedir((await almacen('archivos')).getAll())
};

export const docs = {
  todos: async () => pedir((await almacen('docs')).getAll()),
  put: async rec => pedir((await almacen('docs', 'readwrite')).put(rec)),
  del: async k => pedir((await almacen('docs', 'readwrite')).delete(k))
};
