// ─────────────────────────────────────────────
//  DAK · Visitas de inspección — pantallas y navegación
//
//  Rutas (en el #):  #/                    proyectos
//                    #/p/{id}              proyecto y sus visitas
//                    #/p/{id}/v/{id}       visita: plano, hallazgos, exportar
//                    …/h/{id}              ficha de un hallazgo (hoja)
//                    …/h/{id}/f/{id}       foto ampliada
//                    #/admin               usuarios autorizados
// ─────────────────────────────────────────────

import { $, $$, esc, nuevoId, sinTildes, hoyISO, fechaCorta, fechaHora, numH, tamano, debouncePorClave, toast, dialogo, confirmar, elegir, elegirArchivos, ocupado, descargar } from './util.js';
import * as nube from './nube.js';
import * as C from './catalogos.js';
import { Visor, editorRecorte, editorCroquis } from './plano.js';
import { prepararFoto, cargarImagen, soltar, escalar, aBlob, dataUrl, abrirPdf, renderizarPagina, LADO_PLANO, LADO_VISTA } from './imagenes.js';
import { exportarZip, abrirVistaImpresion } from './exportar.js';

const E = {
  usuario: null, acceso: {},
  proyectos: [], visitas: [], planos: [], hallazgos: [], fotos: [], autorizados: [],
  listos: { proyectos: false, visitas: false },
  sync: { pendientes: 0, enLinea: true },
  ruta: {}, pantalla: null, tab: 'plano', planoSel: null, modo: null,
  visor: null, visorFoto: null, busqueda: '', instalar: null
};
const app = $('#app');

// ── Suscripciones a datos ──
const subs = {};
function suscribir(clave, fn) { if (!subs[clave]) subs[clave] = fn(); }
function cancelar(prefijo) {
  for (const k of Object.keys(subs)) if (k.startsWith(prefijo)) { subs[k](); delete subs[k]; }
}

// ── Navegación ──
function leerRuta() {
  const s = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (s[0] === 'admin') return { admin: true };
  const r = {};
  for (let i = 0; i + 1 < s.length; i += 2) r[s[i]] = s[i + 1];
  return r;
}
function aHash(r) {
  if (r.admin) return '#/admin';
  return '#/' + ['p', 'v', 'h', 'f'].filter(k => r[k]).map(k => `${k}/${r[k]}`).join('/');
}
function ir(r, reemplazar = false) {
  const h = aHash(r);
  if (h === location.hash && !reemplazar) return;
  history[reemplazar ? 'replaceState' : 'pushState']({ app: 1 }, '', h);
  alCambiarRuta();
}
// Vuelve atrás si la pantalla anterior es de la app; si se entró por un enlace directo, sube un nivel
function volver(padre) {
  if (history.state?.app) history.back();
  else ir(padre, true);
}
const rutaVisita = () => ({ p: E.ruta.p, v: E.ruta.v });

window.addEventListener('popstate', alCambiarRuta);
window.addEventListener('hashchange', alCambiarRuta);

function alCambiarRuta() {
  const r = leerRuta();
  E.ruta = r;
  if (!E.usuario || !E.acceso.autorizado) return;
  if (!r.admin) cancelar('a:');
  if (r.admin) { cancelar('v:'); cerrarCapas(); pantallaAdmin(); return; }
  if (!r.v) { cancelar('v:'); cerrarCapas(); E.visor?.destruir(); E.visor = null; }
  if (!r.p) { pantallaProyectos(); return; }
  if (!r.v) { pantallaProyecto(); return; }
  if (E.pantalla !== 'visita:' + r.v) construirVisita();
  sincronizarCapas();
}

// ── Consultas sobre el estado ──
const proyectoActual = () => E.proyectos.find(p => p.id === E.ruta.p);
const visitaActual = () => E.visitas.find(v => v.id === E.ruta.v);
const planosOrdenados = () => [...E.planos].sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0) || a.id.localeCompare(b.id));
const planoActual = () => E.planos.find(p => p.id === E.planoSel);
const hallazgosActivos = () => E.hallazgos.filter(h => !h.eliminado);
const idsActivos = () => new Set(hallazgosActivos().map(h => h.id));
const fotosDe = hid => E.fotos.filter(f => f.hallazgoId === hid).sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0));
const fotosActivas = () => { const ids = idsActivos(); return E.fotos.filter(f => ids.has(f.hallazgoId)); };

// Numeración H01, H02… por orden de creación. Los eliminados conservan su número para no correr los demás.
let cacheNum = { ref: null, map: new Map() };
function numeros() {
  if (cacheNum.ref !== E.hallazgos) {
    const orden = [...E.hallazgos].sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0) || a.id.localeCompare(b.id));
    cacheNum = { ref: E.hallazgos, map: new Map(orden.map((h, i) => [h.id, i + 1])) };
  }
  return cacheNum.map;
}
const etiqueta = id => numH(numeros().get(id));

function nivelesUsados() {
  const s = new Set();
  [...E.planos, ...E.hallazgos].forEach(x => { if (x.nivel) s.add(x.nivel); });
  return [...s].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

const autorVisible = a => a && a !== 'local' ? a : '';

// ── Indicador de sincronización ──
function htmlSync() {
  if (nube.modo === 'local') return `<span class="sync local" title="Firebase no está configurado: los datos quedan solo en este dispositivo">Modo local</span>`;
  const { pendientes, enLinea } = E.sync;
  if (!enLinea) return `<span class="sync off" title="Todo se guarda en el dispositivo y se sube al volver la señal">Sin señal${pendientes ? ` · ${pendientes} por subir` : ''}</span>`;
  if (pendientes) return `<span class="sync sube">Subiendo ${pendientes}…</span>`;
  return `<span class="sync ok">Al día</span>`;
}
const pintarSync = () => $$('[data-sync]').forEach(n => { n.innerHTML = htmlSync(); });

// ── Refresco cuando cambian los datos ──
function refrescar() {
  const p = E.pantalla || '';
  if (p === 'proyectos') pintarListaProyectos();
  else if (p.startsWith('proyecto:')) pantallaProyecto();
  else if (p.startsWith('visita:')) actualizarVisita();
  else if (p === 'admin') pintarAdmin();
}

// ════════════════════════════════════════════
//  Arranque y sesión
// ════════════════════════════════════════════
async function arrancar() {
  app.innerHTML = `<div class="centro"><div class="giro"></div><p>Cargando…</p></div>`;
  registrarSW();
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); E.instalar = e; });
  try {
    await nube.iniciar();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="centro"><p>No se pudo iniciar la aplicación.<br><small>${esc(e.message)}</small></p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
    return;
  }
  nube.estadoSync(s => { E.sync = s; pintarSync(); if (E.pantalla?.startsWith('visita:')) pintarExportar(); });
  nube.alCambiarUsuario((u, acceso) => {
    E.usuario = u;
    E.acceso = acceso || {};
    cancelar('');
    cerrarCapas();
    E.pantalla = null;
    if (!u) return pantallaIngreso();
    if (!E.acceso.autorizado) return pantallaNoAutorizado();
    E.listos = { proyectos: false, visitas: false };
    suscribir('g:proyectos', () => nube.escuchar('proyectos', null, null, l => { E.proyectos = l; E.listos.proyectos = true; refrescar(); }));
    suscribir('g:visitas', () => nube.escuchar('visitas', null, null, l => { E.visitas = l; E.listos.visitas = true; refrescar(); }));
    alCambiarRuta();
  });
}

function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  // En el PC de desarrollo no se usa, para ver siempre la última versión (agregar ?sw para probarlo)
  const desarrollo = ['localhost', '127.0.0.1'].includes(location.hostname) && !location.search.includes('sw');
  if (!desarrollo) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker:', e));
}

function pantallaIngreso() {
  E.pantalla = 'ingreso';
  app.innerHTML = `
    <div class="ingreso"><div class="ingreso-tarjeta">
      <img src="iconos/icono-192.png" alt="DAK" class="ingreso-logo">
      <h1>Visitas de inspección</h1>
      <p>Registro de hallazgos en campo con fotos ubicadas sobre el plano.</p>
      <button class="btn primario grande" id="b-google">Continuar con Google</button>
      <p class="error" id="ingreso-error" role="alert"></p>
    </div></div>`;
  $('#b-google').onclick = async () => {
    $('#ingreso-error').textContent = '';
    try { await nube.ingresar(); } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') $('#ingreso-error').textContent = 'No se pudo ingresar: ' + (e.message || e.code);
    }
  };
}

function pantallaNoAutorizado() {
  E.pantalla = 'no-autorizado';
  const msg = E.acceso.sinVerificar
    ? 'No se pudo verificar tu acceso porque no hay conexión. Conéctate a internet e intenta de nuevo.'
    : 'Tu cuenta no está autorizada. Pide al administrador de DAK que la agregue a la lista de usuarios.';
  app.innerHTML = `
    <div class="ingreso"><div class="ingreso-tarjeta">
      <img src="iconos/icono-192.png" alt="DAK" class="ingreso-logo">
      <h1>Acceso restringido</h1>
      <p><b>${esc(E.usuario.email)}</b></p>
      <p>${msg}</p>
      <button class="btn" id="b-reintentar">Reintentar</button>
      <button class="btn" id="b-salir">Usar otra cuenta</button>
    </div></div>`;
  $('#b-reintentar').onclick = () => location.reload();
  $('#b-salir').onclick = () => nube.salir();
}

async function menuGeneral() {
  const ops = [];
  if (E.acceso.admin) ops.push({ texto: 'Usuarios autorizados', detalle: 'Agregar o quitar personas de DAK', valor: 'admin' });
  ops.push({ texto: 'Espacio en este dispositivo', detalle: 'Imágenes guardadas y pendientes por subir', valor: 'espacio' });
  if (E.instalar) ops.push({ texto: 'Instalar la aplicación', detalle: 'Ícono en la pantalla de inicio y uso sin señal', valor: 'instalar' });
  if (nube.modo === 'nube') ops.push({ texto: 'Cerrar sesión', detalle: E.usuario.email, valor: 'salir' });
  const v = await elegir({ titulo: E.usuario.nombre, opciones: ops });
  if (v === 'admin') ir({ admin: true });
  else if (v === 'espacio') dialogoEspacio();
  else if (v === 'instalar') { E.instalar.prompt(); E.instalar = null; }
  else if (v === 'salir') {
    if (E.sync.pendientes && !await confirmar(`Hay ${E.sync.pendientes} imagen(es) sin subir. Si cierras sesión se subirán la próxima vez que ingreses en este dispositivo.`, { aceptar: 'Cerrar sesión' })) return;
    nube.salir();
  }
}

async function dialogoEspacio() {
  const i = await nube.infoLocal();
  const botones = [{ texto: 'Cerrar', valor: null }];
  if (nube.modo === 'nube' && i.imagenes > i.pendientes) botones.unshift({ texto: 'Liberar imágenes ya subidas', valor: 'liberar' });
  const r = await dialogo({
    titulo: 'Espacio en este dispositivo',
    html: `<ul class="lista-datos">
      <li><span>Imágenes guardadas</span><b>${i.imagenes} (${tamano(i.bytes)})</b></li>
      <li><span>Pendientes por subir</span><b>${i.pendientes}</b></li>
      ${i.cuota ? `<li><span>Uso total del navegador</span><b>${tamano(i.uso)} de ${tamano(i.cuota)}</b></li>` : ''}
    </ul>
    ${nube.modo === 'nube' ? '<p class="nota">Las imágenes que ya están en la nube se pueden quitar de este dispositivo; se vuelven a descargar al abrirlas.</p>' : ''}`,
    botones
  });
  if (r.valor === 'liberar') {
    const n = await nube.liberarLocalesSubidos();
    toast(`${n} imagen(es) quitadas de este dispositivo`);
  }
}

// ════════════════════════════════════════════
//  Proyectos
// ════════════════════════════════════════════
function cabeceraPrincipal() {
  return `<header class="barra">
    <div class="marca"><img src="iconos/icono-96.png" alt="DAK" class="logo"><div><b>Visitas de inspección</b><small>${esc(E.usuario.nombre)}</small></div></div>
    <div class="barra-der"><span data-sync></span><button class="btn-icono" id="b-menu" aria-label="Menú">⋯</button></div>
  </header>`;
}

function pantallaProyectos() {
  E.pantalla = 'proyectos';
  app.className = '';
  app.innerHTML = `${cabeceraPrincipal()}
    <main class="contenido">
      ${nube.modo === 'local' ? `<div class="aviso">Modo local: Firebase aún no está configurado y los datos quedan solo en este dispositivo.</div>` : ''}
      <div class="fila-busqueda">
        <input type="search" id="q" placeholder="Buscar proyecto, cliente o dirección" value="${esc(E.busqueda)}" aria-label="Buscar">
        <button class="btn primario" id="b-nuevo">＋ Proyecto</button>
      </div>
      <div id="lista-proyectos" class="lista"></div>
    </main>`;
  pintarSync();
  $('#q').addEventListener('input', e => { E.busqueda = e.target.value; pintarListaProyectos(); });
  $('#b-nuevo').onclick = () => formProyecto();
  $('#b-menu').onclick = menuGeneral;
  $('#lista-proyectos').addEventListener('click', e => {
    const t = e.target.closest('[data-p]');
    if (t) ir({ p: t.dataset.p });
  });
  pintarListaProyectos();
}

function pintarListaProyectos() {
  const cont = $('#lista-proyectos');
  if (!cont) return;
  if (!E.listos.proyectos) { cont.innerHTML = `<p class="vacio">Cargando proyectos…</p>`; return; }
  const q = sinTildes(E.busqueda).toLowerCase().trim();
  const visitasDe = id => E.visitas.filter(v => v.proyectoId === id);
  const lista = E.proyectos
    .filter(p => !q || sinTildes([p.nombre, p.cliente, p.direccion, p.ciudad].join(' ')).toLowerCase().includes(q))
    .map(p => {
      const vs = visitasDe(p.id);
      const ultima = vs.map(v => v.fecha || '').sort().pop() || '';
      return { p, vs, ultima, orden: Math.max(p.creadoEn || 0, ...vs.map(v => v.creadoEn || 0)) };
    })
    .sort((a, b) => b.orden - a.orden);
  cont.innerHTML = lista.length ? lista.map(({ p, vs, ultima }) => `
    <button class="tarjeta" data-p="${p.id}">
      <b>${esc(p.nombre)}</b>
      <span>${esc([p.cliente, p.ciudad].filter(Boolean).join(' · ') || 'Sin cliente')}</span>
      <small>${esc(p.tipoEstudio || '')}${p.tipoEstudio ? ' · ' : ''}${vs.length} visita(s)${ultima ? ' · última ' + fechaCorta(ultima) : ''}</small>
    </button>`).join('')
    : `<p class="vacio">${q ? 'Ningún proyecto coincide con la búsqueda.' : 'Aún no hay proyectos. Crea el primero con “＋ Proyecto”.'}</p>`;
}

async function formProyecto(p = null) {
  const vs = p ? E.visitas.filter(v => v.proyectoId === p.id) : [];
  const botones = [{ texto: 'Cancelar', valor: null }, { texto: p ? 'Guardar' : 'Crear proyecto', valor: 'guardar', clase: 'primario' }];
  if (p && !vs.length) botones.unshift({ texto: 'Eliminar', valor: 'eliminar', clase: 'peligro' });
  const r = await dialogo({
    titulo: p ? 'Editar proyecto' : 'Nuevo proyecto',
    html: `
      <label>Nombre del proyecto *<input name="nombre" required maxlength="100" value="${esc(p?.nombre)}" placeholder="Ej. Edificio Calle 45"></label>
      <label>Cliente<input name="cliente" maxlength="100" value="${esc(p?.cliente)}"></label>
      <div class="fila2">
        <label>Dirección<input name="direccion" maxlength="120" value="${esc(p?.direccion)}"></label>
        <label>Ciudad<input name="ciudad" maxlength="60" value="${esc(p?.ciudad)}"></label>
      </div>
      <label>Tipo de estudio<select name="tipoEstudio">${C.TIPOS_ESTUDIO.map(t => `<option ${p?.tipoEstudio === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>Notas<textarea name="notas" rows="2">${esc(p?.notas)}</textarea></label>
      ${p && vs.length ? '<p class="nota">Para eliminar el proyecto primero elimina sus visitas.</p>' : ''}`,
    botones
  });
  if (r.valor === 'eliminar') {
    if (await confirmar(`¿Eliminar el proyecto “${p.nombre}”?`, { aceptar: 'Eliminar', peligro: true })) { nube.borrar('proyectos', p.id); ir({}, true); }
    return;
  }
  if (r.valor !== 'guardar') return;
  const v = n => r.form.elements[n].value.trim();
  const datos = { nombre: v('nombre'), cliente: v('cliente'), direccion: v('direccion'), ciudad: v('ciudad'), tipoEstudio: v('tipoEstudio'), notas: v('notas') };
  if (p) { nube.guardar('proyectos', p.id, datos); return; }
  const id = nuevoId();
  nube.guardar('proyectos', id, { ...datos, creadoEn: Date.now(), autor: E.usuario.email });
  ir({ p: id });
}

// ════════════════════════════════════════════
//  Proyecto y sus visitas
// ════════════════════════════════════════════
function pantallaProyecto() {
  E.pantalla = 'proyecto:' + E.ruta.p;
  app.className = '';
  const p = proyectoActual();
  const atras = `<button class="btn-icono" id="b-atras" aria-label="Volver">←</button>`;
  if (!p) {
    app.innerHTML = `<header class="barra">${atras}<div class="titulo"><b>Proyecto</b></div></header>
      <main class="contenido"><p class="vacio">${E.listos.proyectos ? 'Este proyecto no existe o fue eliminado.' : 'Cargando…'}</p></main>`;
    $('#b-atras').onclick = () => volver({});
    return;
  }
  const vs = E.visitas.filter(v => v.proyectoId === p.id)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creadoEn || 0) - (a.creadoEn || 0));
  const scroll = $('main.contenido')?.scrollTop || 0;
  app.innerHTML = `
    <header class="barra">${atras}
      <div class="titulo"><b>${esc(p.nombre)}</b><small>${esc(p.tipoEstudio || '')}</small></div>
      <div class="barra-der"><span data-sync></span><button class="btn-icono" id="b-editar" aria-label="Editar proyecto">✎</button></div>
    </header>
    <main class="contenido">
      <section class="ficha-proyecto">
        ${p.cliente ? `<p><span>Cliente</span>${esc(p.cliente)}</p>` : ''}
        ${p.direccion || p.ciudad ? `<p><span>Dirección</span>${esc([p.direccion, p.ciudad].filter(Boolean).join(', '))}</p>` : ''}
        ${p.notas ? `<p><span>Notas</span>${esc(p.notas)}</p>` : ''}
      </section>
      <div class="fila-titulo"><h2>Visitas</h2><button class="btn primario" id="b-visita">＋ Visita</button></div>
      <div class="lista" id="lista-visitas">
        ${vs.length ? vs.map(v => `
          <button class="tarjeta" data-v="${v.id}">
            <b>${esc(v.tipo || 'Visita')} · ${fechaCorta(v.fecha)}</b>
            ${v.asistentes ? `<span>${esc(v.asistentes)}</span>` : ''}
            <small>${v.exportadoEn ? 'Exportada ' + fechaHora(v.exportadoEn) : 'Sin exportar'}${v.liberadaEn ? ' · imágenes archivadas fuera de la nube' : ''}</small>
          </button>`).join('') : `<p class="vacio">Aún no hay visitas. Crea una con “＋ Visita” al llegar a la obra.</p>`}
      </div>
    </main>`;
  $('main.contenido').scrollTop = scroll;
  pintarSync();
  $('#b-atras').onclick = () => volver({});
  $('#b-editar').onclick = () => formProyecto(p);
  $('#b-visita').onclick = () => formNuevaVisita(p);
  $('#lista-visitas').addEventListener('click', e => {
    const t = e.target.closest('[data-v]');
    if (t) ir({ p: p.id, v: t.dataset.v });
  });
}

async function formNuevaVisita(p) {
  const r = await dialogo({
    titulo: 'Nueva visita',
    html: `
      <div class="fila2">
        <label>Fecha<input type="date" name="fecha" value="${hoyISO()}" required></label>
        <label>Tipo<select name="tipo">${C.TIPOS_VISITA.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
      </div>
      <label>Asistentes<input name="asistentes" maxlength="200" placeholder="Ej. Ing. S. Romero, propietario"></label>
      <label>Objetivo<textarea name="objetivo" rows="2" placeholder="Ej. Visita preliminar para peritaje por fisuras en muros"></textarea></label>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear visita', valor: true, clase: 'primario' }]
  });
  if (!r.valor) return;
  const v = n => r.form.elements[n].value.trim();
  const id = nuevoId();
  nube.guardar('visitas', id, {
    proyectoId: p.id, fecha: v('fecha'), tipo: v('tipo'), asistentes: v('asistentes'), objetivo: v('objetivo'),
    creadoEn: Date.now(), autor: E.usuario.email
  });
  E.tab = 'plano';
  ir({ p: p.id, v: id });
}

// ════════════════════════════════════════════
//  Visita: plano, hallazgos, exportar
// ════════════════════════════════════════════
function construirVisita() {
  const vid = E.ruta.v;
  E.pantalla = 'visita:' + vid;
  E.planos = []; E.hallazgos = []; E.fotos = [];
  E.planoSel = null; E.modo = null;
  E.visor?.destruir();
  app.className = 'app-visita';
  app.innerHTML = `
    <header class="barra">
      <button class="btn-icono" id="b-atras" aria-label="Volver">←</button>
      <div class="titulo"><b id="t-visita">Visita</b><small id="t-proyecto"></small></div>
      <div class="barra-der"><span data-sync></span></div>
    </header>
    <nav class="pestanas" role="tablist">
      <button data-tab="plano" role="tab">Plano</button>
      <button data-tab="hallazgos" role="tab">Hallazgos <span id="n-hallazgos"></span></button>
      <button data-tab="visita" role="tab">Visita y exportar</button>
    </nav>
    <section class="tab tab-plano" data-panel="plano">
      <div class="planos-barra"><div class="chips-planos" id="chips-planos"></div><button class="btn chico" id="b-plano-mas">＋ Plano</button></div>
      <div class="zona-plano" id="zona-plano">
        <div id="visor-plano"></div>
        <div class="vacio-plano" id="vacio-plano" hidden>
          <h3>Agrega el plano de la visita</h3>
          <p>Toma una foto del plano impreso, carga una imagen o un PDF, o dibuja un croquis. Luego ubica cada hallazgo con un toque.</p>
          <div class="opciones-plano">
            <button class="btn primario grande" data-nuevo-plano="foto">📷 Foto del plano</button>
            <button class="btn grande" data-nuevo-plano="imagen">🖼 Imagen guardada</button>
            <button class="btn grande" data-nuevo-plano="pdf">📄 PDF</button>
            <button class="btn grande" data-nuevo-plano="croquis">✎ Croquis</button>
          </div>
          <p class="nota">¿Tienes el plano en DWG? Imprímelo a PDF desde AutoCAD y cárgalo como PDF.</p>
        </div>
        <div class="aviso-modo" id="aviso-modo" hidden><span></span><button class="btn chico" id="b-cancelar-modo">Cancelar</button></div>
        <button class="fab" id="b-hallazgo">＋ Hallazgo</button>
      </div>
    </section>
    <section class="tab" data-panel="hallazgos">
      <div class="contenido">
        <div id="lista-hallazgos" class="lista"></div>
        <button class="btn" id="b-hallazgo-libre">＋ Hallazgo sin ubicar en el plano</button>
      </div>
    </section>
    <section class="tab" data-panel="visita">
      <div class="contenido"><div id="form-visita"></div><div id="bloque-exportar"></div></div>
    </section>`;
  pintarSync();

  $('#b-atras').onclick = () => volver({ p: E.ruta.p });
  $$('.pestanas [data-tab]').forEach(b => { b.onclick = () => mostrarTab(b.dataset.tab); });
  $('#b-plano-mas').onclick = menuNuevoPlano;
  $('#vacio-plano').addEventListener('click', e => { const b = e.target.closest('[data-nuevo-plano]'); if (b) nuevoPlano(b.dataset.nuevoPlano); });
  $('#chips-planos').addEventListener('click', e => {
    if (e.target.closest('#b-plano-opc')) { opcionesPlano(); return; }
    const c = e.target.closest('[data-plano]');
    if (c) { E.planoSel = c.dataset.plano; pintarChipsPlanos(); pintarPlano(); }
  });
  $('#b-hallazgo').onclick = () => { E.modo = E.modo?.tipo === 'nuevo' ? null : { tipo: 'nuevo' }; pintarModo(); };
  $('#b-cancelar-modo').onclick = () => { E.modo = null; pintarModo(); };
  $('#b-hallazgo-libre').onclick = () => crearHallazgo({});
  $('#lista-hallazgos').addEventListener('click', e => { const t = e.target.closest('[data-h]'); if (t) ir({ ...rutaVisita(), h: t.dataset.h }); });
  $('#form-visita').addEventListener('input', guardarFormVisita);
  $('#form-visita').addEventListener('change', guardarFormVisita);
  $('#bloque-exportar').addEventListener('click', e => {
    const acc = e.target.closest('[data-acc]')?.dataset.acc;
    if (acc === 'zip') accionZip();
    else if (acc === 'pdf') accionPdf();
    else if (acc === 'liberar') accionLiberar();
    else if (acc === 'eliminar-visita') accionEliminarVisita();
  });

  E.visor = new Visor($('#visor-plano'), { alTocar: tocarPlano });

  suscribir('v:planos', () => nube.escuchar('planos', 'visitaId', vid, l => { E.planos = l; refrescar(); }));
  suscribir('v:hallazgos', () => nube.escuchar('hallazgos', 'visitaId', vid, l => { E.hallazgos = l; refrescar(); }));
  suscribir('v:fotos', () => nube.escuchar('fotos', 'visitaId', vid, l => { E.fotos = l; refrescar(); }));
  mostrarTab(E.tab);
  actualizarVisita();
}

function mostrarTab(t) {
  E.tab = t;
  $$('.pestanas [data-tab]').forEach(b => { b.classList.toggle('activo', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  $$('[data-panel]').forEach(s => { s.hidden = s.dataset.panel !== t; });
}

function actualizarVisita() {
  if (!$('#t-visita')) return;
  const v = visitaActual();
  const p = proyectoActual();
  $('#t-visita').textContent = v ? `${v.tipo || 'Visita'} · ${fechaCorta(v.fecha)}` : (E.listos.visitas ? 'Visita no encontrada' : 'Visita');
  $('#t-proyecto').textContent = p?.nombre || '';
  const n = hallazgosActivos().length;
  $('#n-hallazgos').textContent = n ? `(${n})` : '';
  pintarChipsPlanos();
  pintarPlano();
  pintarListaHallazgos();
  pintarFormVisita();
  pintarExportar();
  actualizarHoja();
  actualizarVisorFoto();
}

// ── Plano ──
function pintarChipsPlanos() {
  const ps = planosOrdenados();
  if (!ps.find(x => x.id === E.planoSel)) E.planoSel = ps[0]?.id || null;
  $('#chips-planos').innerHTML = ps.map((pl, i) =>
    `<button class="chip ${pl.id === E.planoSel ? 'activo' : ''}" data-plano="${pl.id}">P${i + 1} · ${esc(pl.nombre || 'Plano')}${pl.nivel ? ` <small>${esc(pl.nivel)}</small>` : ''}</button>`).join('')
    + (E.planoSel ? `<button class="btn-icono chico" id="b-plano-opc" aria-label="Opciones del plano">⋯</button>` : '');
  $('#chips-planos .chip.activo')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function pintarPlano() {
  const pl = planoActual();
  $('#vacio-plano').hidden = !!pl;
  $('#visor-plano').hidden = !pl;
  $('#b-hallazgo').hidden = !pl;
  if (!pl) { E.modo = E.modo?.tipo === 'reubicar' ? E.modo : null; pintarModo(); return; }
  if (E.visor.planoId !== pl.id) {
    E.visor.planoId = pl.id;
    E.visor.ponerImagen(pl.vista || '', pl.ancho, pl.alto, pl.id);
    nube.leerArchivo(pl.id).then(b => {
      if (b && E.visor?.planoId === pl.id) E.visor.cambiarFuente(URL.createObjectURL(b));
    }).catch(e => console.warn('Plano completo no disponible', e));
  }
  const n = numeros();
  E.visor.ponerPines(hallazgosActivos().filter(h => h.planoId === pl.id && h.x != null).map(h => ({
    id: h.id, x: h.x, y: h.y, texto: String(n.get(h.id)), color: C.colorSeveridad(h.severidad), verificar: h.pendiente, activo: h.id === E.ruta.h
  })));
  pintarModo();
}

function pintarModo() {
  const aviso = $('#aviso-modo');
  if (!aviso) return;
  aviso.hidden = !E.modo;
  $('#zona-plano').classList.toggle('modo-ubicar', !!E.modo);
  $('#b-hallazgo').classList.toggle('activo', E.modo?.tipo === 'nuevo');
  if (E.modo?.tipo === 'nuevo') aviso.querySelector('span').textContent = 'Toca en el plano el punto del hallazgo';
  else if (E.modo?.tipo === 'reubicar') aviso.querySelector('span').textContent = planoActual() ? `Toca la ubicación de ${etiqueta(E.modo.hid)}` : 'Primero agrega un plano';
}

function tocarPlano(x, y, pinId) {
  const pl = planoActual();
  if (E.modo && pl) {
    const modo = E.modo;
    E.modo = null;
    pintarModo();
    if (modo.tipo === 'nuevo') crearHallazgo({ planoId: pl.id, x, y, nivel: pl.nivel || '' });
    else {
      nube.guardar('hallazgos', modo.hid, { planoId: pl.id, x, y });
      toast(`${etiqueta(modo.hid)} ubicado en el plano`);
    }
    return;
  }
  if (pinId) ir({ ...rutaVisita(), h: pinId });
}

function crearHallazgo(extra) {
  const id = nuevoId();
  nube.guardar('hallazgos', id, {
    visitaId: E.ruta.v, proyectoId: E.ruta.p, planoId: null, x: null, y: null,
    nivel: '', ejes: '', elemento: '', patologias: [], severidad: '', descripcion: '', notas: '',
    pendiente: false, eliminado: false, creadoEn: Date.now(), autor: E.usuario.email, ...extra
  });
  ir({ ...rutaVisita(), h: id });
}

async function menuNuevoPlano() {
  const v = await elegir({
    titulo: 'Agregar plano',
    opciones: [
      { texto: '📷 Foto del plano', detalle: 'Fotografía el plano impreso y endereza la perspectiva', valor: 'foto' },
      { texto: '🖼 Imagen guardada', detalle: 'Una foto o captura que ya está en el dispositivo', valor: 'imagen' },
      { texto: '📄 PDF', detalle: 'Para DWG, imprímelo primero a PDF desde AutoCAD', valor: 'pdf' },
      { texto: '✎ Croquis', detalle: 'Dibujo a mano alzada sobre cuadrícula', valor: 'croquis' }
    ]
  });
  if (v) nuevoPlano(v);
}

async function nuevoPlano(origen) {
  let fuente = null;
  let nombre = '';
  try {
    if (origen === 'foto' || origen === 'imagen') {
      const [f] = await elegirArchivos({ accept: 'image/*', camara: origen === 'foto' });
      if (!f) return;
      const fin = ocupado('Abriendo imagen…');
      try {
        const img = await cargarImagen(f);
        fuente = escalar(img, img.naturalWidth, img.naturalHeight, 3600);
        soltar(img);
      } finally { fin(); }
    } else if (origen === 'pdf') {
      const [f] = await elegirArchivos({ accept: 'application/pdf,.pdf' });
      if (!f) return;
      let fin = ocupado('Abriendo PDF…');
      let pdf;
      try { pdf = await abrirPdf(f); } finally { fin(); }
      let n = 1;
      if (pdf.numPages > 1) {
        const r = await dialogo({
          titulo: 'Página del PDF',
          mensaje: `El PDF tiene ${pdf.numPages} páginas. ¿En cuál está el plano? (Puedes agregar otras páginas después como planos nuevos.)`,
          html: `<label>Página<input type="number" name="pag" min="1" max="${pdf.numPages}" value="1" required></label>`,
          botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Usar esta página', valor: true, clase: 'primario' }]
        });
        if (!r.valor) return;
        n = Math.min(pdf.numPages, Math.max(1, Math.round(+r.form.elements.pag.value) || 1));
      }
      fin = ocupado('Convirtiendo la página…');
      try { fuente = await renderizarPagina(pdf, n); } finally { fin(); }
      nombre = f.name.replace(/\.pdf$/i, '').slice(0, 50) + (pdf.numPages > 1 ? ` p${n}` : '');
    }
  } catch (e) {
    console.error(e);
    toast('No se pudo abrir el archivo: ' + e.message, { tipo: 'error', ms: 6000 });
    return;
  }
  const r = origen === 'croquis'
    ? await editorCroquis({ niveles: nivelesUsados(), nombre: 'Croquis' })
    : await editorRecorte(fuente, { niveles: nivelesUsados(), nombre });
  if (r) await guardarPlano(r, origen);
}

async function guardarPlano({ canvas, nombre, nivel }, origen) {
  const fin = ocupado('Guardando plano…');
  try {
    const c = Math.max(canvas.width, canvas.height) > LADO_PLANO ? escalar(canvas, canvas.width, canvas.height, LADO_PLANO) : canvas;
    const tipo = origen === 'croquis' ? 'image/png' : 'image/jpeg';
    const blob = await aBlob(c, tipo, 0.9);
    const id = nuevoId();
    nube.guardar('planos', id, {
      visitaId: E.ruta.v, proyectoId: E.ruta.p, nombre: nombre || 'Plano', nivel: nivel || '', origen,
      ancho: c.width, alto: c.height, vista: dataUrl(c, LADO_VISTA, 0.7),
      creadoEn: Date.now(), autor: E.usuario.email,
      archivo: { tipo, bytes: blob.size, subido: nube.modo === 'local' }
    });
    await nube.guardarArchivo({ id, col: 'planos', visitaId: E.ruta.v, blob });
    E.planoSel = id;
    mostrarTab('plano');
    pintarChipsPlanos();
    pintarPlano();
    toast('Plano guardado. Toca “＋ Hallazgo” y luego el punto del plano.');
  } catch (e) {
    console.error(e);
    toast('No se pudo guardar el plano: ' + e.message, { tipo: 'error' });
  } finally { fin(); }
}

async function opcionesPlano() {
  const pl = planoActual();
  if (!pl) return;
  const enPlano = hallazgosActivos().filter(h => h.planoId === pl.id);
  const v = await elegir({
    titulo: pl.nombre || 'Plano',
    opciones: [
      { texto: 'Cambiar nombre o nivel', valor: 'editar' },
      { texto: 'Eliminar plano', detalle: enPlano.length ? `Sus ${enPlano.length} hallazgo(s) quedarán sin ubicar` : '', valor: 'eliminar', clase: 'peligro' }
    ]
  });
  if (v === 'editar') {
    const r = await dialogo({
      titulo: 'Plano',
      html: `<label>Nombre<input name="nombre" maxlength="60" value="${esc(pl.nombre)}"></label>
        <label>Nivel<input name="nivel" maxlength="30" value="${esc(pl.nivel)}" list="dl-niv"></label>
        <datalist id="dl-niv">${nivelesUsados().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`,
      botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: true, clase: 'primario' }]
    });
    if (r.valor) nube.guardar('planos', pl.id, { nombre: r.form.elements.nombre.value.trim() || 'Plano', nivel: r.form.elements.nivel.value.trim() });
  } else if (v === 'eliminar') {
    if (!await confirmar(`¿Eliminar el plano “${pl.nombre}”? ${enPlano.length ? 'Los hallazgos y sus fotos se conservan, sin ubicación.' : ''}`, { aceptar: 'Eliminar', peligro: true })) return;
    enPlano.forEach(h => nube.guardar('hallazgos', h.id, { planoId: null, x: null, y: null }));
    await nube.borrarConArchivo('planos', pl);
    E.visor.planoId = null;
  }
}

// ── Lista de hallazgos ──
function pintarListaHallazgos() {
  const cont = $('#lista-hallazgos');
  const n = numeros();
  const pls = planosOrdenados();
  const hs = hallazgosActivos().sort((a, b) => n.get(a.id) - n.get(b.id));
  cont.innerHTML = hs.length ? hs.map(h => {
    const fs = fotosDe(h.id);
    const pi = pls.findIndex(p => p.id === h.planoId);
    const porSubir = fs.some(f => !f.archivo?.subido && !f.archivo?.liberado);
    return `<button class="item-h" data-h="${h.id}">
      <span class="item-h-foto">${fs[0] ? `<img src="${fs[0].miniatura}" alt="">` : '<span>Sin foto</span>'}</span>
      <span class="item-h-txt">
        <b><i class="punto" style="background:${C.colorSeveridad(h.severidad)}"></i>${numH(n.get(h.id))} · ${esc(h.elemento || 'Sin elemento')}${h.patologias?.length ? ' — ' + esc(h.patologias.join(', ')) : ''}</b>
        <small>${esc([h.nivel, h.ejes].filter(Boolean).join(' · ') || 'Sin nivel ni ejes')} · ${pi >= 0 ? 'P' + (pi + 1) : 'sin ubicar'} · ${fs.length} foto(s)${porSubir ? ' · ⇡ por subir' : ''}${h.pendiente ? ' · ⚑ verificar' : ''}</small>
        ${h.descripcion ? `<small class="desc">${esc(h.descripcion)}</small>` : ''}
      </span>
    </button>`;
  }).join('') : `<p class="vacio">Aún no hay hallazgos. En la pestaña Plano toca “＋ Hallazgo” y luego el punto del plano.</p>`;
}

// ── Datos de la visita ──
function pintarFormVisita() {
  const v = visitaActual();
  const cont = $('#form-visita');
  if (!v || cont.dataset.listo === v.id) return;
  cont.dataset.listo = v.id;
  cont.innerHTML = `
    <h3>Datos de la visita</h3>
    <div class="fila2">
      <label>Fecha<input type="date" name="fecha" value="${esc(v.fecha)}"></label>
      <label>Tipo<select name="tipo">${C.TIPOS_VISITA.map(t => `<option ${v.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    </div>
    <label>Asistentes<input name="asistentes" maxlength="200" value="${esc(v.asistentes)}"></label>
    <label>Objetivo y observaciones generales<textarea name="objetivo" rows="4" placeholder="Estado general, uso, año de construcción, sistema estructural, reformas…">${esc(v.objetivo)}</textarea></label>`;
}

const guardarCampoVisita = debouncePorClave((id, campo, valor) => nube.guardar('visitas', id, { [campo]: valor }), 500);
function guardarFormVisita(e) {
  const el = e.target;
  const v = visitaActual();
  if (!v || !el.name) return;
  guardarCampoVisita(v.id + el.name, v.id, el.name, el.value);
}

// ── Exportar ──
function duenosConImagen() {
  const ids = idsActivos();
  return [
    ...E.planos.map(p => ({ ...p, col: 'planos' })),
    ...E.fotos.filter(f => ids.has(f.hallazgoId)).map(f => ({ ...f, col: 'fotos' }))
  ];
}

function pintarExportar() {
  const v = visitaActual();
  const cont = $('#bloque-exportar');
  if (!v || !cont) return;
  const fotos = fotosActivas();
  const duenos = duenosConImagen();
  const sinSubir = duenos.filter(d => !d.archivo?.subido && !d.archivo?.liberado).length;
  const ultimoCambio = Math.max(0, ...duenos.map(d => d.creadoEn || 0));
  const alDia = v.exportadoEn && v.exportadoEn >= ultimoCambio;
  const puedeLiberar = alDia && (!v.liberadaEn || ultimoCambio > v.liberadaEn);
  cont.innerHTML = `
    <h3>Exportar</h3>
    <p class="resumen">${E.planos.length} plano(s) · ${hallazgosActivos().length} hallazgo(s) · ${fotos.length} foto(s)${nube.modo === 'nube' && sinSubir ? ` · <b>${sinSubir} imagen(es) aún sin subir</b>` : ''}</p>
    <div class="botones-col">
      <button class="btn primario" data-acc="zip">⬇ Descargar ZIP</button>
      <button class="btn" data-acc="pdf">🖨 Vista para PDF</button>
    </div>
    <p class="nota">El ZIP trae las fotos renombradas por hallazgo (H01_nivel_ejes_elemento…), los planos con los pines, <b>informe.md</b> y <b>hallazgos.csv</b> para Excel.</p>
    ${v.exportadoEn ? `<p class="nota">Última exportación completa: ${fechaHora(v.exportadoEn)}${autorVisible(v.exportadoPor) ? ' por ' + esc(v.exportadoPor) : ''}.</p>` : ''}
    <h3>Liberar espacio</h3>
    <p class="nota">Borra las imágenes completas de la nube y de este dispositivo. Se conservan las fichas, las notas, las miniaturas y el plano reducido. Hazlo cuando el ZIP ya esté guardado en el PC o en el disco.</p>
    ${v.liberadaEn && !puedeLiberar ? `<p class="ok">Imágenes liberadas el ${fechaHora(v.liberadaEn)}.</p>` : ''}
    ${!v.liberadaEn || puedeLiberar ? `<button class="btn" data-acc="liberar" ${puedeLiberar ? '' : 'disabled'}>Liberar imágenes de esta visita</button>
      ${puedeLiberar ? '' : '<p class="nota">Se habilita después de descargar un ZIP completo, sin fotos nuevas desde entonces.</p>'}` : ''}
    <h3 class="titulo-peligro">Zona de cuidado</h3>
    <button class="btn peligro" data-acc="eliminar-visita">Eliminar visita</button>`;
}

function contextoExport() {
  const ids = idsActivos();
  return {
    proyecto: proyectoActual() || { nombre: 'Proyecto' },
    visita: visitaActual(),
    planos: planosOrdenados(),
    hallazgos: hallazgosActivos(),
    fotos: E.fotos.filter(f => ids.has(f.hallazgoId)),
    numeros: numeros(),
    usuario: autorVisible(E.usuario.email) || E.usuario.nombre,
    leerArchivo: nube.leerArchivo
  };
}

async function accionZip() {
  const v = visitaActual();
  const fin = ocupado('Preparando la exportación…');
  let res;
  try {
    res = await exportarZip(contextoExport(), (i, n) => fin.texto(`Agregando imágenes ${i} de ${n}…`));
  } catch (e) {
    console.error(e);
    toast('No se pudo exportar: ' + e.message, { tipo: 'error', ms: 6000 });
    return;
  } finally { fin(); }
  descargar(res.blob, res.nombre);
  if (res.faltantes.length) {
    await dialogo({
      titulo: 'Exportación incompleta',
      mensaje: `Faltaron ${res.faltantes.length} imagen(es): aún no se suben desde otro dispositivo o ya se liberaron de la nube. La lista está en FALTANTES.txt dentro del ZIP.`
    });
  } else {
    nube.guardar('visitas', v.id, { exportadoEn: Date.now(), exportadoPor: E.usuario.email });
    toast(`ZIP descargado (${tamano(res.blob.size)})`);
  }
}

async function accionPdf() {
  const fin = ocupado('Preparando la vista…');
  try {
    const p = abrirVistaImpresion(contextoExport(), (i, n) => fin.texto(`Preparando imágenes ${i} de ${n}…`));
    // La vista se abre cuando termina de cargar; el diálogo de espera se quita apenas aparece
    const espera = setInterval(() => { if ($('.impresion')) { fin(); clearInterval(espera); } }, 100);
    await p;
    clearInterval(espera);
  } catch (e) {
    console.error(e);
    toast('No se pudo preparar la vista: ' + e.message, { tipo: 'error' });
  } finally { fin(); }
}

async function accionLiberar() {
  const v = visitaActual();
  const ok = await confirmar('Se borrarán las imágenes completas de esta visita en la nube y en este dispositivo. Confirma que el ZIP ya está guardado en el PC o en el disco.', { titulo: 'Liberar imágenes', aceptar: 'Liberar', peligro: true });
  if (!ok) return;
  const fin = ocupado('Liberando…');
  try {
    await nube.liberarArchivos(v.id, duenosConImagen());
    nube.guardar('visitas', v.id, { liberadaEn: Date.now() });
    if (E.visor) E.visor.planoId = null;
    toast('Imágenes liberadas');
  } finally { fin(); }
}

async function accionEliminarVisita() {
  const v = visitaActual();
  if (!v) return;
  const ok = await confirmar('Se borrarán la visita, sus planos, hallazgos y fotos, en la nube y en este dispositivo. No se puede deshacer.', { titulo: 'Eliminar visita', aceptar: 'Eliminar', peligro: true });
  if (!ok) return;
  await nube.eliminarVisita(v.id, { planos: E.planos, hallazgos: E.hallazgos, fotos: E.fotos });
  ir({ p: E.ruta.p }, true);
}

// ════════════════════════════════════════════
//  Ficha del hallazgo (hoja) y foto ampliada
// ════════════════════════════════════════════
const hoja = $('#hoja');
const capaFoto = $('#visor-foto');

// Cerrar la ficha o la foto una sola vez, aunque varias partes lo pidan a la vez
// (p. ej. al borrar: el aviso de cambio de datos y el botón piden volver casi al mismo tiempo)
function salirDeHoja() {
  if (hoja.hidden || hoja.dataset.cerrando) return;
  hoja.dataset.cerrando = '1';
  volver(rutaVisita());
}
function salirDeFoto() {
  if (capaFoto.hidden || capaFoto.dataset.cerrando) return;
  capaFoto.dataset.cerrando = '1';
  volver({ ...rutaVisita(), h: E.ruta.h });
}

function sincronizarCapas() {
  if (E.ruta.h) abrirHoja(E.ruta.h); else cerrarHoja();
  if (E.ruta.f) abrirVisorFoto(E.ruta.f); else cerrarVisorFoto();
  if (E.pantalla?.startsWith('visita:') && E.visor) pintarPlano();
}
function cerrarCapas() { cerrarHoja(); cerrarVisorFoto(); }

function abrirHoja(hid) {
  hoja.hidden = false;
  document.body.classList.add('con-hoja');
  if (hoja.dataset.id !== hid) { hoja.dataset.id = hid; hoja.dataset.listo = ''; hoja.dataset.cerrando = ''; }
  actualizarHoja();
}
function cerrarHoja() {
  if (hoja.hidden) return;
  hoja.hidden = true;
  hoja.dataset.id = '';
  hoja.dataset.cerrando = '';
  hoja.innerHTML = '';
  document.body.classList.remove('con-hoja');
}

function actualizarHoja() {
  if (hoja.hidden) return;
  const h = E.hallazgos.find(x => x.id === hoja.dataset.id);
  if (!h) {
    if (!hoja.dataset.listo) hoja.innerHTML = `<div class="hoja-panel"><div class="centro"><div class="giro"></div></div></div>`;
    return;
  }
  if (h.eliminado) { salirDeHoja(); return; }
  if (hoja.dataset.listo !== '1') { renderHoja(h); hoja.dataset.listo = '1'; }
  pintarHojaParcial(h);
}

const chip = (valor, activo, extra = '') => `<button type="button" class="chip ${activo ? 'activo' : ''}" data-valor="${esc(valor)}" ${extra}>${esc(valor)}</button>`;

function renderHoja(h) {
  hoja.innerHTML = `
    <div class="hoja-panel" role="dialog" aria-label="Hallazgo">
      <header class="hoja-cab">
        <span class="pin-muestra" id="h-pin"></span>
        <div class="titulo"><b id="h-titulo"></b><small id="h-ubic"></small></div>
        <button class="btn-icono" data-acc="menu" aria-label="Opciones del hallazgo">⋯</button>
        <button class="btn-icono" data-acc="cerrar" aria-label="Cerrar">✕</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="fotos-botones">
          <button class="btn primario grande" data-acc="camara">📷 Tomar foto</button>
          <button class="btn grande" data-acc="galeria">🖼 Galería</button>
        </div>
        <div class="fotos-grid" id="h-fotos"></div>
        <div class="fila2">
          <label>Nivel<input name="nivel" value="${esc(h.nivel)}" list="dl-niveles" maxlength="30" placeholder="Ej. Piso 2"></label>
          <label>Ejes / ubicación<input name="ejes" value="${esc(h.ejes)}" maxlength="40" placeholder="Ej. C-4"></label>
        </div>
        <datalist id="dl-niveles">${nivelesUsados().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <fieldset><legend>Elemento</legend>
          <div class="chips" data-campo="elemento" data-tipo="uno">${C.ELEMENTOS.map(x => chip(x, h.elemento === x)).join('')}</div></fieldset>
        <fieldset><legend>Patología <small>(una o varias)</small></legend>
          <div class="chips" data-campo="patologias" data-tipo="varios">${C.PATOLOGIAS.map(x => chip(x, (h.patologias || []).includes(x))).join('')}</div></fieldset>
        <fieldset><legend>Severidad</legend>
          <div class="chips" data-campo="severidad" data-tipo="uno">${C.SEVERIDADES.map(s =>
            `<button type="button" class="chip sev ${h.severidad === s.id ? 'activo' : ''}" data-valor="${s.id}" style="--c:${s.color}">${esc(s.nombre)}</button>`).join('')}</div></fieldset>
        <label>Descripción<textarea name="descripcion" rows="3" placeholder="Qué se observa: dirección y ancho de fisuras, extensión, humedad…">${esc(h.descripcion)}</textarea></label>
        <label>Anotaciones / hipótesis<textarea name="notas" rows="3" placeholder="Posibles causas, qué revisar o ensayar en el peritaje…">${esc(h.notas)}</textarea></label>
        <label class="check"><input type="checkbox" name="pendiente" ${h.pendiente ? 'checked' : ''}> Pendiente por verificar</label>
        <p class="pie" id="h-pie"></p>
      </div>
    </div>`;
}

function pintarHojaParcial(h) {
  const n = numeros().get(h.id);
  const pls = planosOrdenados();
  const pi = pls.findIndex(p => p.id === h.planoId);
  $('#h-pin').textContent = n;
  $('#h-pin').style.background = C.colorSeveridad(h.severidad);
  $('#h-titulo').textContent = `${numH(n)}${h.elemento ? ' · ' + h.elemento : ''}`;
  $('#h-ubic').textContent = pi >= 0 ? `P${pi + 1} · ${pls[pi].nombre || 'Plano'}` : 'Sin ubicar en el plano';
  const fs = fotosDe(h.id);
  $('#h-fotos').innerHTML = fs.map(f => `
    <button class="foto-mini" data-foto="${f.id}">
      <img src="${f.miniatura}" alt="">
      ${f.archivo?.liberado ? '<span class="insignia">archivada</span>' : !f.archivo?.subido ? '<span class="insignia" title="Aún no sube a la nube">⇡</span>' : ''}
      ${f.nota ? '<span class="insignia nota-i" title="Tiene nota">✎</span>' : ''}
    </button>`).join('') || '<p class="nota">Sin fotos todavía.</p>';
  $('#h-pie').textContent = `Registrado ${fechaHora(h.creadoEn)}${autorVisible(h.autor) ? ' por ' + h.autor : ''}. Los cambios se guardan solos.`;
}

const guardarCampoHallazgo = debouncePorClave((id, campo, valor) => nube.guardar('hallazgos', id, { [campo]: valor }), 500);

hoja.addEventListener('click', async e => {
  const hid = hoja.dataset.id;
  if (!hid) return;
  if (e.target === hoja) { salirDeHoja(); return; }
  const c = e.target.closest('.chips .chip');
  if (c) {
    const cont = c.parentElement;
    const campo = cont.dataset.campo;
    if (cont.dataset.tipo === 'uno') {
      const estaba = c.classList.contains('activo');
      $$('.chip', cont).forEach(x => x.classList.remove('activo'));
      if (!estaba) c.classList.add('activo');
      nube.guardar('hallazgos', hid, { [campo]: estaba ? '' : c.dataset.valor });
    } else {
      c.classList.toggle('activo');
      nube.guardar('hallazgos', hid, { [campo]: $$('.chip.activo', cont).map(x => x.dataset.valor) });
    }
    return;
  }
  const foto = e.target.closest('[data-foto]');
  if (foto) { ir({ ...rutaVisita(), h: hid, f: foto.dataset.foto }); return; }
  const acc = e.target.closest('[data-acc]')?.dataset.acc;
  if (acc === 'cerrar') salirDeHoja();
  else if (acc === 'camara') agregarFotos(hid, await elegirArchivos({ accept: 'image/*', camara: true }));
  else if (acc === 'galeria') agregarFotos(hid, await elegirArchivos({ accept: 'image/*', multiple: true }));
  else if (acc === 'menu') opcionesHallazgo(hid);
});
hoja.addEventListener('input', e => {
  const el = e.target;
  if (!el.name || el.type === 'checkbox' || !hoja.dataset.id) return;
  guardarCampoHallazgo(hoja.dataset.id + el.name, hoja.dataset.id, el.name, el.value);
});
hoja.addEventListener('change', e => {
  if (e.target.type === 'checkbox' && hoja.dataset.id) nube.guardar('hallazgos', hoja.dataset.id, { [e.target.name]: e.target.checked });
});

async function opcionesHallazgo(hid) {
  const h = E.hallazgos.find(x => x.id === hid);
  if (!h) return;
  const v = await elegir({
    titulo: etiqueta(hid),
    opciones: [
      { texto: h.planoId ? 'Cambiar ubicación en el plano' : 'Ubicar en el plano', valor: 'ubicar' },
      { texto: 'Eliminar hallazgo', detalle: 'Se puede deshacer durante unos segundos', valor: 'eliminar', clase: 'peligro' }
    ]
  });
  if (v === 'ubicar') {
    if (!E.planos.length) { toast('Primero agrega un plano en la pestaña Plano'); return; }
    if (h.planoId) E.planoSel = h.planoId;
    E.modo = { tipo: 'reubicar', hid };
    salirDeHoja();
    mostrarTab('plano');
    pintarChipsPlanos();
    pintarPlano();
  } else if (v === 'eliminar') {
    nube.guardar('hallazgos', hid, { eliminado: true });
    salirDeHoja();
    toast(`${etiqueta(hid)} eliminado`, { ms: 7000, accion: { texto: 'Deshacer', fn: () => nube.guardar('hallazgos', hid, { eliminado: false }) } });
  }
}

async function agregarFotos(hid, archivos) {
  if (!archivos.length) return;
  const fin = ocupado(archivos.length > 1 ? `Procesando ${archivos.length} fotos…` : 'Procesando foto…');
  let ok = 0;
  try {
    for (const [i, f] of archivos.entries()) {
      if (archivos.length > 1) fin.texto(`Procesando foto ${i + 1} de ${archivos.length}…`);
      try {
        const r = await prepararFoto(f);
        const id = nuevoId();
        nube.guardar('fotos', id, {
          visitaId: E.ruta.v, proyectoId: E.ruta.p, hallazgoId: hid, nota: '',
          miniatura: r.miniatura, ancho: r.ancho, alto: r.alto,
          tomadaEn: f.lastModified || Date.now(), creadoEn: Date.now(), autor: E.usuario.email,
          archivo: { tipo: 'image/jpeg', bytes: r.blob.size, subido: nube.modo === 'local' }
        });
        await nube.guardarArchivo({ id, col: 'fotos', visitaId: E.ruta.v, blob: r.blob });
        ok++;
      } catch (e) {
        console.error(e);
        toast(`No se pudo procesar ${f.name}`, { tipo: 'error' });
      }
    }
  } finally { fin(); }
  if (ok > 1) toast(`${ok} fotos agregadas a ${etiqueta(hid)}`);
}

// ── Foto ampliada ──
function abrirVisorFoto(fid) {
  const f = E.fotos.find(x => x.id === fid);
  capaFoto.hidden = false;
  document.body.classList.add('con-foto');
  if (!f) {
    if (capaFoto.dataset.id !== fid) capaFoto.innerHTML = `<div class="centro"><div class="giro"></div></div>`;
    return;
  }
  if (capaFoto.dataset.id === fid && capaFoto.dataset.listo) { actualizarVisorFoto(); return; }
  capaFoto.dataset.id = fid;
  capaFoto.dataset.listo = '1';
  capaFoto.dataset.cerrando = '';
  capaFoto.innerHTML = `
    <header class="barra oscura">
      <button class="btn-icono" data-acc="cerrar" aria-label="Volver">←</button>
      <div class="titulo"><b id="vf-titulo"></b><small id="vf-sub"></small></div>
      <button class="btn-icono" data-acc="borrar" aria-label="Eliminar foto">🗑</button>
    </header>
    <div id="vf-visor"></div>
    <button class="nav-foto ant" data-acc="ant" aria-label="Foto anterior">‹</button>
    <button class="nav-foto sig" data-acc="sig" aria-label="Foto siguiente">›</button>
    <div class="vf-nota"><textarea name="nota" rows="2" placeholder="Nota de esta foto (qué muestra, medida, dirección)…">${esc(f.nota)}</textarea></div>`;
  E.visorFoto?.destruir();
  E.visorFoto = new Visor($('#vf-visor'));
  E.visorFoto.ponerImagen(f.miniatura, f.ancho, f.alto, fid);
  nube.leerArchivo(fid).then(b => {
    if (capaFoto.dataset.id !== fid) return;
    if (b) E.visorFoto.cambiarFuente(URL.createObjectURL(b));
    else $('#vf-sub').textContent += ' · solo miniatura disponible';
  }).catch(() => {});
  actualizarVisorFoto();
}

function actualizarVisorFoto() {
  if (capaFoto.hidden || !capaFoto.dataset.listo) { if (!capaFoto.hidden && E.ruta.f) abrirVisorFoto(E.ruta.f); return; }
  const f = E.fotos.find(x => x.id === capaFoto.dataset.id);
  if (!f) { salirDeFoto(); return; }
  const fs = fotosDe(f.hallazgoId);
  const i = fs.findIndex(x => x.id === f.id);
  $('#vf-titulo').textContent = `${etiqueta(f.hallazgoId)} · foto ${i + 1} de ${fs.length}`;
  if (!$('#vf-sub').textContent) $('#vf-sub').textContent = `${fechaHora(f.tomadaEn || f.creadoEn)}${autorVisible(f.autor) ? ' · ' + f.autor : ''}`;
  capaFoto.querySelector('.ant').hidden = i <= 0;
  capaFoto.querySelector('.sig').hidden = i >= fs.length - 1;
}

function cerrarVisorFoto() {
  if (capaFoto.hidden) return;
  capaFoto.hidden = true;
  capaFoto.dataset.id = '';
  capaFoto.dataset.listo = '';
  capaFoto.dataset.cerrando = '';
  capaFoto.innerHTML = '';
  E.visorFoto?.destruir();
  E.visorFoto = null;
  document.body.classList.remove('con-foto');
}

function fotoVecina(paso) {
  const f = E.fotos.find(x => x.id === capaFoto.dataset.id);
  if (!f) return;
  const fs = fotosDe(f.hallazgoId);
  const otra = fs[fs.findIndex(x => x.id === f.id) + paso];
  if (otra) ir({ ...rutaVisita(), h: f.hallazgoId, f: otra.id }, true);
}

const guardarNotaFoto = debouncePorClave((id, nota) => nube.guardar('fotos', id, { nota }), 500);

capaFoto.addEventListener('click', async e => {
  const acc = e.target.closest('[data-acc]')?.dataset.acc;
  const f = E.fotos.find(x => x.id === capaFoto.dataset.id);
  if (acc === 'cerrar') salirDeFoto();
  else if (acc === 'ant') fotoVecina(-1);
  else if (acc === 'sig') fotoVecina(1);
  else if (acc === 'borrar' && f) {
    if (!await confirmar('¿Eliminar esta foto? No se puede deshacer.', { aceptar: 'Eliminar', peligro: true })) return;
    await nube.borrarConArchivo('fotos', f);
    salirDeFoto();
  }
});
capaFoto.addEventListener('input', e => {
  if (e.target.name === 'nota' && capaFoto.dataset.id) guardarNotaFoto(capaFoto.dataset.id, capaFoto.dataset.id, e.target.value);
});

document.addEventListener('keydown', e => {
  if (document.querySelector('.dialogo-capa, .editor, .impresion')) return;
  const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (!capaFoto.hidden) {
    if (e.key === 'Escape') salirDeFoto();
    else if (!escribiendo && e.key === 'ArrowLeft') fotoVecina(-1);
    else if (!escribiendo && e.key === 'ArrowRight') fotoVecina(1);
  } else if (!hoja.hidden && e.key === 'Escape') salirDeHoja();
  else if (E.modo && e.key === 'Escape') { E.modo = null; pintarModo(); }
});

// ════════════════════════════════════════════
//  Usuarios autorizados (solo administradores)
// ════════════════════════════════════════════
function pantallaAdmin() {
  if (!E.acceso.admin || nube.modo !== 'nube') { ir({}, true); return; }
  E.pantalla = 'admin';
  app.className = '';
  app.innerHTML = `
    <header class="barra">
      <button class="btn-icono" id="b-atras" aria-label="Volver">←</button>
      <div class="titulo"><b>Usuarios autorizados</b><small>Solo estas cuentas de Google pueden entrar</small></div>
    </header>
    <main class="contenido">
      <form class="tarjeta-form" id="f-usuario">
        <div class="fila2">
          <label>Correo de Google<input type="email" name="correo" required placeholder="nombre@gmail.com"></label>
          <label>Nombre<input name="nombre" maxlength="60"></label>
        </div>
        <div class="fila-acciones">
          <label class="check"><input type="checkbox" name="admin"> Administrador (puede gestionar usuarios)</label>
          <button class="btn primario">Agregar</button>
        </div>
      </form>
      <div class="lista" id="lista-usuarios"></div>
    </main>`;
  $('#b-atras').onclick = () => volver({});
  $('#f-usuario').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    const correo = f.correo.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { f.correo.focus(); return; }
    nube.guardar('autorizados', correo, { nombre: f.nombre.value.trim(), rol: f.admin.checked ? 'admin' : 'miembro', agregadoEn: Date.now() });
    e.target.reset();
    toast(`${correo} autorizado`);
  });
  $('#lista-usuarios').addEventListener('click', async e => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    const correo = b.dataset.quitar;
    if (await confirmar(`¿Quitar el acceso de ${correo}?`, { aceptar: 'Quitar', peligro: true })) nube.borrar('autorizados', correo);
  });
  suscribir('a:usuarios', () => nube.escuchar('autorizados', null, null, l => { E.autorizados = l; refrescar(); }));
  pintarAdmin();
}

function pintarAdmin() {
  const cont = $('#lista-usuarios');
  if (!cont) return;
  cont.innerHTML = [...E.autorizados].sort((a, b) => a.id.localeCompare(b.id)).map(u => `
    <div class="tarjeta fila-usuario">
      <div><b>${esc(u.nombre || u.id)}</b><small>${esc(u.id)} · ${u.rol === 'admin' ? 'Administrador' : 'Miembro'}</small></div>
      ${u.id === E.usuario.email ? '<small>(tú)</small>' : `<button class="btn chico peligro" data-quitar="${esc(u.id)}">Quitar</button>`}
    </div>`).join('');
}

arrancar();
