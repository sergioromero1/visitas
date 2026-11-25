// ─────────────────────────────────────────────
//  Utilidades de interfaz y formato
// ─────────────────────────────────────────────

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// Id aleatorio de 20 caracteres, como los de Firestore; se crea en el dispositivo para funcionar sin conexión
export function nuevoId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), b => ABC[b % ABC.length]).join('');
}

export const sinTildes = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Texto apto para nombres de archivo: "Columna C-4 (eje)" → "Columna_C-4_eje"
export function slug(s, max = 40) {
  return sinTildes(s).replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max).replace(/_+$/, '');
}

export function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = n => String(n).padStart(2, '0');

export function fechaCorta(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}
export function hora(ms) {
  const d = new Date(ms);
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
export function fechaHora(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()} ${hora(ms)}`;
}

export const numH = n => 'H' + dos(n || 0);

export function tamano(b) {
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
  if (b < 1024 ** 3) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Igual que debounce, pero con un temporizador independiente por clave
// (así escribir en un campo no cancela el guardado pendiente de otro)
export function debouncePorClave(fn, ms) {
  const t = new Map();
  return (clave, ...a) => {
    clearTimeout(t.get(clave));
    t.set(clave, setTimeout(() => { t.delete(clave); fn(...a); }, ms));
  };
}

// Da tiempo a que se pinte un aviso antes de un cálculo pesado (con tope, por si la pestaña está oculta)
export const siguienteCuadro = () => new Promise(r => {
  const listo = () => { clearTimeout(t); r(); };
  const t = setTimeout(listo, 120);
  requestAnimationFrame(() => setTimeout(listo, 0));
});

// ── Avisos breves ──
export function toast(msg, { tipo = 'info', ms = 3500, accion = null } = {}) {
  let cont = $('#toasts');
  if (!cont) { cont = document.createElement('div'); cont.id = 'toasts'; document.body.appendChild(cont); }
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.innerHTML = `<span>${esc(msg)}</span>${accion ? `<button class="btn chico">${esc(accion.texto)}</button>` : ''}`;
  if (accion) t.querySelector('button').onclick = () => { accion.fn(); t.remove(); };
  cont.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ── Diálogos ──
// botones: [{ texto, valor, clase }]; el último es el de "aceptar" (Enter)
export function dialogo({ titulo = '', mensaje = '', html = '', botones = [{ texto: 'Aceptar', valor: true, clase: 'primario' }], clase = '' } = {}) {
  return new Promise(res => {
    const capa = document.createElement('div');
    capa.className = 'dialogo-capa';
    capa.innerHTML = `<form class="dialogo ${clase}" novalidate>
      ${titulo ? `<h3>${esc(titulo)}</h3>` : ''}
      ${mensaje ? `<p class="dialogo-msg">${esc(mensaje)}</p>` : ''}
      ${html}
      <div class="dialogo-botones">${botones.map((b, i) =>
        `<button type="${i === botones.length - 1 ? 'submit' : 'button'}" class="btn ${b.clase || ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div>
    </form>`;
    document.body.appendChild(capa);
    const form = capa.querySelector('form');
    const cerrar = v => { capa.remove(); document.removeEventListener('keydown', tecla, true); res({ valor: v, form }); };
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } };
    document.addEventListener('keydown', tecla, true);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const req = Array.from(form.querySelectorAll('[required]')).find(i => !i.value.trim());
      if (req) { req.focus(); req.classList.add('invalido'); return; }
      cerrar(botones[botones.length - 1].valor);
    });
    capa.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b && b.type === 'button') cerrar(botones[+b.dataset.i].valor);
      else if (e.target === capa) cerrar(null);
    });
    setTimeout(() => (form.querySelector('input:not([type=hidden]),textarea,select') || form.querySelector('[type=submit]'))?.focus(), 40);
  });
}

export async function confirmar(mensaje, { titulo = '', aceptar = 'Aceptar', peligro = false } = {}) {
  const r = await dialogo({ titulo, mensaje, botones: [{ texto: 'Cancelar', valor: false }, { texto: aceptar, valor: true, clase: peligro ? 'peligro' : 'primario' }] });
  return r.valor === true;
}

// Menú de opciones en lista vertical: opciones [{ texto, valor, detalle, clase }]
export function elegir({ titulo = '', mensaje = '', opciones }) {
  return new Promise(res => {
    const capa = document.createElement('div');
    capa.className = 'dialogo-capa';
    capa.innerHTML = `<div class="dialogo menu">
      ${titulo ? `<h3>${esc(titulo)}</h3>` : ''}
      ${mensaje ? `<p class="dialogo-msg">${esc(mensaje)}</p>` : ''}
      ${opciones.map((o, i) => `<button type="button" class="opcion ${o.clase || ''}" data-i="${i}"><b>${esc(o.texto)}</b>${o.detalle ? `<small>${esc(o.detalle)}</small>` : ''}</button>`).join('')}
      <button type="button" class="opcion cancelar" data-i="-1"><b>Cancelar</b></button>
    </div>`;
    document.body.appendChild(capa);
    const cerrar = v => { capa.remove(); document.removeEventListener('keydown', tecla, true); res(v); };
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } };
    document.addEventListener('keydown', tecla, true);
    capa.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) cerrar(+b.dataset.i < 0 ? null : opciones[+b.dataset.i].valor);
      else if (e.target === capa) cerrar(null);
    });
  });
}

// ── Elegir archivos (cámara, galería, PDF) ──
export function elegirArchivos({ accept = 'image/*', camara = false, multiple = false } = {}) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    if (camara) i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    document.body.appendChild(i);
    i.addEventListener('change', () => { res(Array.from(i.files || [])); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    i.click();
  });
}

// ── Indicador de trabajo en curso ──
export function ocupado(texto = 'Procesando…') {
  const capa = document.createElement('div');
  capa.className = 'ocupado';
  capa.innerHTML = `<div class="ocupado-caja"><div class="giro"></div><p>${esc(texto)}</p></div>`;
  document.body.appendChild(capa);
  const fin = () => capa.remove();
  fin.texto = t => { capa.querySelector('p').textContent = t; };
  return fin;
}

export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
