// ─────────────────────────────────────────────
//  Capa de datos: Firebase (Google + Firestore) o modo local
//
//  Colecciones (todas planas, compartidas por los usuarios autorizados):
//    autorizados/{correo}  → { rol: 'admin' | 'miembro', nombre }
//    proyectos/{id}
//    visitas/{id}          → proyectoId
//    planos/{id}           → visitaId, vista (imagen reducida), archivo {tipo, bytes, subido, partes, liberado}
//    hallazgos/{id}        → visitaId, planoId, x, y (0–1 sobre el plano)
//    fotos/{id}            → visitaId, hallazgoId, miniatura, archivo {…}
//    trozos/{id}_{n}       → la imagen completa partida en trozos de < 1 MB (Firestore no admite más por documento)
//
//  Las imágenes se guardan primero en el dispositivo (almacen.js) y una cola las sube cuando hay señal.
//  app.js solo usa las funciones exportadas aquí; no importa nada de Firebase.
// ─────────────────────────────────────────────

import { firebaseConfig } from '../firebase-config.js';
import * as almacen from './almacen.js';

const VERSION_FB = '12.4.0';
const CDN_FB = `https://www.gstatic.com/firebasejs/${VERSION_FB}/`;
const TROZO = 900 * 1024;   // bytes por trozo; el límite de Firestore es 1 MiB por documento
const LOTE = 400;           // operaciones por lote (Firestore admite 500)

export const modo = String(firebaseConfig.apiKey || '').includes('REEMPLAZAR') ? 'local' : 'nube';
const enNube = modo === 'nube';

let fb = null;       // { a: módulo auth, f: módulo firestore, auth, db }
let usuario = null;

// ── Modo local: documentos en memoria + IndexedDB ──
const loc = { docs: new Map(), oyentes: new Set() };

function filasLocales(col, campo, valor) {
  const out = [];
  loc.docs.forEach(r => {
    if (r.col === col && (campo == null || r.data[campo] === valor)) out.push({ ...r.data, id: r.id });
  });
  return out;
}
function notificar(col) {
  queueMicrotask(() => loc.oyentes.forEach(o => { if (o.col === col) o.emitir(); }));
}
const esMapa = v => v && typeof v === 'object' && !Array.isArray(v);
function fusionar(a, b) {
  const r = { ...a };
  for (const [k, v] of Object.entries(b)) r[k] = esMapa(v) && esMapa(a[k]) ? fusionar(a[k], v) : v;
  return r;
}

// ── Arranque ──
export async function iniciar() {
  if (!enNube) {
    (await almacen.docs.todos()).forEach(r => loc.docs.set(r.k, r));
    return;
  }
  const [appM, a, f] = await Promise.all([
    import(CDN_FB + 'firebase-app.js'),
    import(CDN_FB + 'firebase-auth.js'),
    import(CDN_FB + 'firebase-firestore.js')
  ]);
  const app = appM.initializeApp(firebaseConfig);
  fb = {
    a, f,
    auth: a.getAuth(app),
    // Caché persistente: la app abre y funciona sin conexión, y sincroniza al volver
    db: f.initializeFirestore(app, {
      localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    })
  };
}

// ── Sesión ──
// cb(usuario | null, { autorizado, admin, sinVerificar })
export function alCambiarUsuario(cb) {
  if (!enNube) {
    usuario = { uid: 'local', email: 'local', nombre: 'Este dispositivo' };
    cb(usuario, { autorizado: true, admin: false });
    return;
  }
  fb.a.onAuthStateChanged(fb.auth, async u => {
    if (!u) { usuario = null; cb(null, {}); return; }
    usuario = { uid: u.uid, email: (u.email || '').toLowerCase(), nombre: u.displayName || u.email, foto: u.photoURL };
    const clave = 'dak_acceso_' + u.uid;
    let acceso = { autorizado: false, admin: false };
    try {
      const s = await fb.f.getDoc(fb.f.doc(fb.db, 'autorizados', usuario.email));
      acceso = { autorizado: s.exists(), admin: s.exists() && s.data().rol === 'admin' };
      localStorage.setItem(clave, JSON.stringify(acceso));
    } catch (e) {
      // Sin conexión: se usa el último acceso conocido en este dispositivo
      const previo = localStorage.getItem(clave);
      if (previo) acceso = JSON.parse(previo);
      else acceso.sinVerificar = true;
    }
    cb(usuario, acceso);
    if (acceso.autorizado) { actualizarPendientes(); procesarCola(); }
  });
}

export async function ingresar() {
  const { a } = fb;
  const p = new a.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    await a.signInWithPopup(fb.auth, p);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') return a.signInWithRedirect(fb.auth, p);
    throw e;
  }
}

export function salir() { return enNube ? fb.a.signOut(fb.auth) : Promise.resolve(); }

// ── Documentos ──
// cb(lista) en cada cambio, local o de otro dispositivo. campo/valor filtran por igualdad.
export function escuchar(col, campo, valor, cb) {
  if (!enNube) {
    const o = { col, emitir: () => cb(filasLocales(col, campo, valor)) };
    loc.oyentes.add(o);
    o.emitir();
    return () => loc.oyentes.delete(o);
  }
  const { f } = fb;
  const ref = campo ? f.query(f.collection(fb.db, col), f.where(campo, '==', valor)) : f.collection(fb.db, col);
  return f.onSnapshot(ref, snap => cb(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
    e => console.error('No se pudo leer', col, e));
}

// Escribe (fusionando) un documento. No se espera la confirmación del servidor: sin señal
// la escritura queda en el dispositivo y Firestore la envía al volver la conexión.
export function guardar(col, id, datos) {
  const d = { ...datos, actualizadoEn: Date.now(), actualizadoPor: usuario?.email || '' };
  if (!enNube) {
    const k = col + '/' + id;
    const r = { k, col, id, data: fusionar(loc.docs.get(k)?.data || {}, d) };
    loc.docs.set(k, r);
    almacen.docs.put(r);
    notificar(col);
    return;
  }
  fb.f.setDoc(fb.f.doc(fb.db, col, id), d, { merge: true }).catch(e => console.error('No se pudo guardar', col, id, e));
}

export function borrarVarios(refs) {
  if (!refs.length) return;
  if (!enNube) {
    refs.forEach(({ col, id }) => { loc.docs.delete(col + '/' + id); almacen.docs.del(col + '/' + id); });
    new Set(refs.map(r => r.col)).forEach(notificar);
    return;
  }
  const { f } = fb;
  for (let i = 0; i < refs.length; i += LOTE) {
    const b = f.writeBatch(fb.db);
    refs.slice(i, i + LOTE).forEach(r => b.delete(f.doc(fb.db, r.col, r.id)));
    b.commit().catch(e => console.error('No se pudo borrar', e));
  }
}

export const borrar = (col, id) => borrarVarios([{ col, id }]);

const refsTrozos = d => Array.from({ length: d.archivo?.partes || 0 }, (_, n) => ({ col: 'trozos', id: `${d.id}_${n}` }));

// Borra un documento que tiene imagen (foto o plano), sus trozos en la nube y la copia local
export async function borrarConArchivo(col, d) {
  borrarVarios([{ col, id: d.id }, ...refsTrozos(d)]);
  await almacen.archivos.del(d.id);
  actualizarPendientes();
}

export async function eliminarVisita(visitaId, { planos, hallazgos, fotos }) {
  borrarVarios([
    ...planos.flatMap(p => [{ col: 'planos', id: p.id }, ...refsTrozos(p)]),
    ...fotos.flatMap(x => [{ col: 'fotos', id: x.id }, ...refsTrozos(x)]),
    ...hallazgos.map(h => ({ col: 'hallazgos', id: h.id })),
    { col: 'visitas', id: visitaId }
  ]);
  for (const k of await almacen.archivos.clavesDeVisita(visitaId)) await almacen.archivos.del(k);
  actualizarPendientes();
}

// Borra las imágenes completas (nube y dispositivo) y conserva fichas, notas y miniaturas.
// duenos: [{ col, id, archivo }]
export async function liberarArchivos(visitaId, duenos) {
  borrarVarios(duenos.flatMap(refsTrozos));
  duenos.forEach(d => guardar(d.col, d.id, { archivo: { liberado: true } }));
  for (const k of await almacen.archivos.clavesDeVisita(visitaId)) await almacen.archivos.del(k);
  actualizarPendientes();
}

// ── Imágenes ──
export async function guardarArchivo({ id, col, visitaId, blob }) {
  const r = { id, col, visitaId, tipo: blob.type, blob, creado: Date.now() };
  if (enNube) r.pendiente = 1;
  await almacen.archivos.put(r);
  if (enNube) { await actualizarPendientes(); procesarCola(); }
}

const enCurso = new Map();
export function leerArchivo(id) {
  if (!enCurso.has(id)) enCurso.set(id, leer(id).finally(() => enCurso.delete(id)));
  return enCurso.get(id);
}

async function leer(id) {
  const r = await almacen.archivos.get(id);
  if (r) return r.blob;
  if (!enNube || !navigator.onLine) return null;
  const { f } = fb;
  const s = await f.getDocs(f.query(f.collection(fb.db, 'trozos'), f.where('ref', '==', id)));
  if (s.empty) return null;
  const partes = s.docs.map(d => d.data()).sort((a, b) => a.n - b.n);
  if (partes.length !== partes[0].total) return null;  // aún subiendo desde otro dispositivo
  const blob = new Blob(partes.map(p => p.datos.toUint8Array()), { type: partes[0].tipo || 'image/jpeg' });
  await almacen.archivos.put({ id, col: partes[0].col, visitaId: partes[0].visitaId, tipo: blob.type, blob, creado: Date.now() });
  return blob;
}

// ── Cola de subida ──
let subiendo = false;
let reintento = null;
let pendientes = 0;
const oyentesSync = new Set();

function emitirSync() {
  const s = { pendientes, enLinea: navigator.onLine };
  oyentesSync.forEach(cb => cb(s));
}
export function estadoSync(cb) {
  oyentesSync.add(cb);
  cb({ pendientes, enLinea: navigator.onLine });
}
async function actualizarPendientes() {
  if (!enNube) return;
  pendientes = (await almacen.archivos.pendientes()).length;
  emitirSync();
}

window.addEventListener('online', () => { emitirSync(); procesarCola(); });
window.addEventListener('offline', emitirSync);

async function procesarCola() {
  if (!enNube || subiendo || !usuario || !navigator.onLine) return;
  subiendo = true;
  clearTimeout(reintento);
  let saltados = 0;
  try {
    for (const r of await almacen.archivos.pendientes()) {
      if (!navigator.onLine) { saltados++; continue; }
      try {
        const res = await subir(r);
        if (res === 'esperar') { saltados++; continue; }
        if (res === 'descartar') await almacen.archivos.del(r.id);
        else { delete r.pendiente; await almacen.archivos.put(r); }
      } catch (e) {
        console.warn('No se pudo subir', r.id, e);
        saltados++;
      }
      await actualizarPendientes();
    }
  } finally {
    subiendo = false;
    await actualizarPendientes();
    if (pendientes > saltados) setTimeout(procesarCola, 0);        // llegaron fotos nuevas durante la subida
    else if (pendientes) reintento = setTimeout(procesarCola, 30000);
  }
}

async function subir(r) {
  const { f } = fb;
  const ref = f.doc(fb.db, r.col, r.id);
  const s = await f.getDoc(ref);
  if (!s.exists()) {
    // La ficha aún no llega o fue eliminada en otro dispositivo
    return Date.now() - (r.creado || 0) > 7 * 864e5 ? 'descartar' : 'esperar';
  }
  if (s.data().archivo?.liberado) return 'descartar';
  const buf = new Uint8Array(await r.blob.arrayBuffer());
  const total = Math.max(1, Math.ceil(buf.length / TROZO));
  for (let n = 0; n < total; n++) {
    await f.setDoc(f.doc(fb.db, 'trozos', `${r.id}_${n}`), {
      ref: r.id, col: r.col, visitaId: r.visitaId, tipo: r.tipo, n, total,
      datos: f.Bytes.fromUint8Array(buf.subarray(n * TROZO, (n + 1) * TROZO))
    });
  }
  await f.setDoc(ref, { archivo: { subido: true, partes: total } }, { merge: true });
  return 'ok';
}

// ── Espacio en el dispositivo ──
export async function infoLocal() {
  const todos = await almacen.archivos.todos();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  return {
    imagenes: todos.length,
    pendientes: todos.filter(r => r.pendiente).length,
    bytes: todos.reduce((s, r) => s + (r.blob?.size || 0), 0),
    uso: est?.usage || 0,
    cuota: est?.quota || 0
  };
}

// Quita del dispositivo las imágenes que ya están en la nube (se vuelven a descargar al abrirlas)
export async function liberarLocalesSubidos() {
  if (!enNube) return 0;
  let n = 0;
  for (const r of await almacen.archivos.todos()) {
    if (!r.pendiente) { await almacen.archivos.del(r.id); n++; }
  }
  return n;
}
