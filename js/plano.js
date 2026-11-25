// ─────────────────────────────────────────────
//  Visor con zoom y pines, editor para enderezar planos y lienzo de croquis
// ─────────────────────────────────────────────

import { esc, ocupado, toast, siguienteCuadro, confirmar } from './util.js';
import { enderezar, rotar90, lienzo } from './imagenes.js';

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

// ── Visor: imagen con desplazamiento, zoom (pellizco, rueda, doble clic) y pines ──
// alTocar(x, y, pinId): toque corto; x, y entre 0 y 1 sobre la imagen; pinId si se tocó un pin
export class Visor {
  constructor(cont, { alTocar = null } = {}) {
    this.cont = cont;
    this.alTocar = alTocar;
    cont.classList.add('visor');
    cont.innerHTML = `<div class="visor-capa"><img class="visor-img" alt="" draggable="false"><div class="visor-pines"></div></div>`;
    this.capa = cont.firstElementChild;
    this.img = this.capa.querySelector('img');
    this.pinesEl = this.capa.querySelector('.visor-pines');
    this.s = 1; this.tx = 0; this.ty = 0; this.w = 1; this.h = 1;
    this.min = 0.1; this.max = 4;
    this.tocado = false;
    this.url = null;
    this.clave = null;
    this.ptrs = new Map();
    cont.addEventListener('pointerdown', e => this.bajar(e));
    cont.addEventListener('pointermove', e => this.mover(e));
    cont.addEventListener('pointerup', e => this.subir(e, false));
    cont.addEventListener('pointercancel', e => this.subir(e, true));
    cont.addEventListener('wheel', e => this.rueda(e), { passive: false });
    cont.addEventListener('dblclick', e => { const p = this.local(e); this.zoomEn(p.x, p.y, this.s * 2); });
    this.ro = new ResizeObserver(() => {
      const r = cont.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (!this.tocado || !this.ancho) this.ajustar();
      this.ancho = r.width;
    });
    this.ro.observe(cont);
  }

  // Cambia de imagen. Mientras la "clave" no cambie se conserva el zoom.
  ponerImagen(src, w, h, clave) {
    if (clave === this.clave) return;
    this.clave = clave;
    this.w = w || 1; this.h = h || 1;
    this.capa.style.width = this.w + 'px';
    this.capa.style.height = this.h + 'px';
    this.soltarUrl();
    this.img.src = src || '';
    this.tocado = false;
    this.ajustar();
  }

  // Reemplaza la fuente por la imagen completa (mismas proporciones)
  cambiarFuente(url) {
    this.soltarUrl();
    this.url = url;
    this.img.src = url;
  }

  soltarUrl() { if (this.url) URL.revokeObjectURL(this.url); this.url = null; }

  ajustar() {
    const r = this.cont.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ajuste = Math.min(r.width / this.w, r.height / this.h);
    this.min = ajuste * 0.8;
    this.max = Math.max(ajuste * 12, 3);
    this.s = ajuste;
    this.tx = (r.width - this.w * ajuste) / 2;
    this.ty = (r.height - this.h * ajuste) / 2;
    this.aplicar();
  }

  aplicar() {
    this.capa.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    this.capa.style.setProperty('--s', this.s);
  }

  zoomEn(px, py, s2) {
    s2 = limitar(s2, this.min, this.max);
    const cx = (px - this.tx) / this.s, cy = (py - this.ty) / this.s;
    this.s = s2;
    this.tx = px - cx * s2;
    this.ty = py - cy * s2;
    this.tocado = true;
    this.aplicar();
  }

  local(e) {
    const r = this.cont.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bajar(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.cont.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) {
      this.ini = { ...p, tx: this.tx, ty: this.ty, t: Date.now(), movido: false, pin: e.target.closest('.pin')?.dataset.id || null };
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinza = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s: this.s,
        cx: ((a.x + b.x) / 2 - this.tx) / this.s,
        cy: ((a.y + b.y) / 2 - this.ty) / this.s
      };
      if (this.ini) this.ini.movido = true;
    }
  }

  mover(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    const p = this.local(e);
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1 && this.ini) {
      const dx = p.x - this.ini.x, dy = p.y - this.ini.y;
      if (!this.ini.movido && Math.hypot(dx, dy) > 8) this.ini.movido = true;
      if (this.ini.movido) {
        this.tx = this.ini.tx + dx;
        this.ty = this.ini.ty + dy;
        this.tocado = true;
        this.aplicar();
      }
    } else if (this.ptrs.size >= 2 && this.pinza) {
      const [a, b] = [...this.ptrs.values()];
      const s2 = limitar(this.pinza.s * Math.hypot(a.x - b.x, a.y - b.y) / this.pinza.d, this.min, this.max);
      this.s = s2;
      this.tx = (a.x + b.x) / 2 - this.pinza.cx * s2;
      this.ty = (a.y + b.y) / 2 - this.pinza.cy * s2;
      this.tocado = true;
      this.aplicar();
    }
  }

  subir(e, cancelado) {
    if (!this.ptrs.has(e.pointerId)) return;
    const p = this.local(e);
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size === 0) {
      const ini = this.ini;
      this.ini = null;
      this.pinza = null;
      if (!cancelado && ini && !ini.movido && Date.now() - ini.t < 700 && this.alTocar) {
        const x = (p.x - this.tx) / this.s / this.w;
        const y = (p.y - this.ty) / this.s / this.h;
        if (ini.pin || (x >= 0 && x <= 1 && y >= 0 && y <= 1)) this.alTocar(limitar(x, 0, 1), limitar(y, 0, 1), ini.pin);
      }
    } else if (this.ptrs.size === 1) {
      // Al soltar un dedo del pellizco se sigue desplazando con el otro, sin saltos
      const q = [...this.ptrs.values()][0];
      this.ini = { ...q, tx: this.tx, ty: this.ty, t: 0, movido: true };
      this.pinza = null;
    }
  }

  rueda(e) {
    e.preventDefault();
    const p = this.local(e);
    this.zoomEn(p.x, p.y, this.s * Math.exp(-e.deltaY * 0.0015));
  }

  // pines: [{ id, x, y, texto, color, verificar, activo }]
  ponerPines(pines) {
    this.pinesEl.innerHTML = pines.map(p =>
      `<div class="pin${p.verificar ? ' pin-verificar' : ''}${p.activo ? ' pin-activo' : ''}" data-id="${esc(p.id)}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${p.color}">${esc(p.texto)}</div>`
    ).join('');
  }

  destruir() { this.ro.disconnect(); this.soltarUrl(); }
}

// ── Estructura común de los editores de pantalla completa ──
function crearEditor({ titulo, cuerpo, herramientas = '', nombre = '', nivel = '', niveles = [], textoGuardar = 'Guardar plano' }) {
  const ed = document.createElement('div');
  ed.className = 'editor';
  ed.innerHTML = `
    <header class="barra"><button class="btn-icono" data-acc="cancelar" aria-label="Cancelar">✕</button><div class="titulo"><b>${esc(titulo)}</b></div></header>
    <div class="ed-cuerpo">${cuerpo}</div>
    <footer class="ed-pie">
      ${herramientas ? `<div class="ed-herr">${herramientas}</div>` : ''}
      <div class="fila2">
        <label>Nombre del plano<input name="nombre" value="${esc(nombre)}" placeholder="Ej. Planta piso 2" maxlength="60"></label>
        <label>Nivel<input name="nivel" value="${esc(nivel)}" list="ed-niveles" placeholder="Ej. Piso 2" maxlength="30"></label>
      </div>
      <datalist id="ed-niveles">${niveles.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="ed-acciones"><button class="btn" data-acc="cancelar">Cancelar</button><button class="btn primario" data-acc="guardar">${esc(textoGuardar)}</button></div>
    </footer>`;
  document.body.appendChild(ed);
  document.body.classList.add('con-editor');
  let alEscape = null;
  const tecla = e => { if (e.key === 'Escape' && alEscape) { e.stopPropagation(); alEscape(); } };
  document.addEventListener('keydown', tecla, true);
  return {
    ed,
    valores: () => ({ nombre: ed.querySelector('[name=nombre]').value.trim(), nivel: ed.querySelector('[name=nivel]').value.trim() }),
    alEscape: fn => { alEscape = fn; },
    cerrar: () => { ed.remove(); document.body.classList.remove('con-editor'); document.removeEventListener('keydown', tecla, true); }
  };
}

// Ajusta un canvas para que quepa centrado en la escena (deja margen para las esquinas)
function encajar(escena, c, margen) {
  const r = escena.getBoundingClientRect();
  const k = Math.min((r.width - 2 * margen) / c.width, (r.height - 2 * margen) / c.height);
  const w = c.width * k, h = c.height * k;
  const ox = (r.width - w) / 2, oy = (r.height - h) / 2;
  Object.assign(c.style, { width: w + 'px', height: h + 'px', left: ox + 'px', top: oy + 'px' });
  return { ox, oy, k, r };
}

// ── Enderezar / girar un plano fotografiado o convertido de PDF ──
// Devuelve { canvas, nombre, nivel } o null si se cancela
export function editorRecorte(fuente, opciones = {}) {
  return new Promise(res => {
    let c = fuente;
    let q = [];
    let g = null;
    const MARGEN = 22;
    const E = crearEditor({
      titulo: 'Ajustar plano',
      cuerpo: `<p class="ed-ayuda">Arrastra las cuatro esquinas a los bordes del plano para enderezarlo. Si ya está derecho, guarda sin moverlas.</p>
        <div class="ed-escena"><svg class="ed-svg"><polygon></polygon></svg>${[0, 1, 2, 3].map(i => `<div class="ed-esquina" data-i="${i}"></div>`).join('')}</div>`,
      herramientas: `<button class="btn chico" data-acc="girar">⟳ Girar 90°</button><button class="btn chico" data-acc="completo">Restablecer esquinas</button>`,
      ...opciones
    });
    const { ed } = E;
    const escena = ed.querySelector('.ed-escena');
    const poly = ed.querySelector('polygon');
    const esquinas = [...ed.querySelectorAll('.ed-esquina')];
    const completo = () => [{ x: 0, y: 0 }, { x: c.width, y: 0 }, { x: c.width, y: c.height }, { x: 0, y: c.height }];

    function pintar() {
      g = encajar(escena, c, MARGEN);
      const pts = q.map(p => [g.ox + p.x * g.k, g.oy + p.y * g.k]);
      esquinas.forEach((el, i) => { el.style.left = pts[i][0] + 'px'; el.style.top = pts[i][1] + 'px'; });
      poly.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    }
    function poner() {
      c.classList.add('ed-lienzo');
      escena.prepend(c);
      q = completo();
      pintar();
    }
    poner();
    const ro = new ResizeObserver(pintar);
    ro.observe(escena);

    let arrastre = null;
    escena.addEventListener('pointerdown', e => {
      const el = e.target.closest('.ed-esquina');
      if (!el) return;
      arrastre = +el.dataset.i;
      escena.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    escena.addEventListener('pointermove', e => {
      if (arrastre == null) return;
      const r = escena.getBoundingClientRect();
      q[arrastre] = {
        x: limitar((e.clientX - r.left - g.ox) / g.k, 0, c.width),
        y: limitar((e.clientY - r.top - g.oy) / g.k, 0, c.height)
      };
      pintar();
    });
    const soltarEsquina = () => { arrastre = null; };
    escena.addEventListener('pointerup', soltarEsquina);
    escena.addEventListener('pointercancel', soltarEsquina);

    const terminar = v => { ro.disconnect(); E.cerrar(); res(v); };
    E.alEscape(() => terminar(null));
    ed.addEventListener('click', async e => {
      const acc = e.target.closest('[data-acc]')?.dataset.acc;
      if (acc === 'cancelar') terminar(null);
      else if (acc === 'girar') { c.remove(); c = rotar90(c); poner(); }
      else if (acc === 'completo') { q = completo(); pintar(); }
      else if (acc === 'guardar') {
        const base = completo();
        const sinCambio = q.every((p, i) => Math.abs(p.x - base[i].x) < 2 && Math.abs(p.y - base[i].y) < 2);
        let out = c;
        if (!sinCambio) {
          const fin = ocupado('Enderezando el plano…');
          await siguienteCuadro();
          try { out = enderezar(c, q); } catch (err) { fin(); toast(err.message, { tipo: 'error' }); return; }
          fin();
        }
        terminar({ canvas: out, ...E.valores() });
      }
    });
  });
}

// ── Croquis a mano alzada sobre cuadrícula ──
export function editorCroquis(opciones = {}) {
  return new Promise(res => {
    let W = 2400, H = 1700;
    const c = lienzo(W, H);
    const x = c.getContext('2d');
    let trazos = [];
    let actual = null;
    let herr = 'fino';
    let color = '#111111';
    const ANCHOS = { fino: 7, grueso: 16 };
    const TAM_TEXTO = 46;

    const E = crearEditor({
      titulo: 'Croquis',
      cuerpo: `<div class="ed-escena croquis"></div>`,
      herramientas: `
        <div class="segmentado" data-grupo="herr"><button data-v="fino" class="activo">✎ Fino</button><button data-v="grueso">✎ Grueso</button><button data-v="texto">T Texto</button><button data-v="borrar">⌫ Borrar</button></div>
        <div class="segmentado colores" data-grupo="color"><button data-v="#111111" class="activo" style="--c:#111111" aria-label="Negro"></button><button data-v="#d0312d" style="--c:#d0312d" aria-label="Rojo"></button><button data-v="#1565c0" style="--c:#1565c0" aria-label="Azul"></button></div>
        <button class="btn chico" data-acc="deshacer">↶ Deshacer</button>
        <button class="btn chico" data-acc="orientacion">⇄ Girar hoja</button>
        <button class="btn chico" data-acc="limpiar">Limpiar</button>`,
      textoGuardar: 'Guardar croquis',
      ...opciones
    });
    const { ed } = E;
    const escena = ed.querySelector('.ed-escena');
    c.className = 'ed-lienzo';
    escena.appendChild(c);

    function fondo() {
      x.fillStyle = '#fff';
      x.fillRect(0, 0, W, H);
      x.lineWidth = 1;
      for (let paso of [50, 250]) {
        x.strokeStyle = paso === 50 ? '#eef2f6' : '#d3dbe4';
        x.beginPath();
        for (let i = 0; i <= W; i += paso) { x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, H); }
        for (let j = 0; j <= H; j += paso) { x.moveTo(0, j + 0.5); x.lineTo(W, j + 0.5); }
        x.stroke();
      }
    }
    function dibujar(t) {
      if (t.tipo === 'texto') {
        x.fillStyle = t.color;
        x.font = `600 ${t.tam}px system-ui, sans-serif`;
        x.textBaseline = 'middle';
        x.fillText(t.texto, t.x, t.y);
        return;
      }
      x.strokeStyle = t.color;
      x.lineWidth = t.ancho;
      x.lineCap = 'round';
      x.lineJoin = 'round';
      x.beginPath();
      t.p.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py));
      if (t.p.length === 1) x.lineTo(t.p[0][0] + 0.1, t.p[0][1]);
      x.stroke();
    }
    const redibujar = () => { fondo(); trazos.forEach(dibujar); };
    const ajustar = () => encajar(escena, c, 8);
    redibujar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(escena);

    const punto = e => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
    };
    const distSeg = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = dx * dx + dy * dy;
      const t = l ? limitar(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1) : 0;
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    function borrarEn(p) {
      const R = 26;
      const antes = trazos.length;
      trazos = trazos.filter(t => {
        if (t.tipo === 'texto') {
          x.font = `600 ${t.tam}px system-ui, sans-serif`;
          const w = x.measureText(t.texto).width;
          return !(p[0] > t.x - R && p[0] < t.x + w + R && Math.abs(p[1] - t.y) < t.tam / 2 + R);
        }
        if (t.p.length === 1) return Math.hypot(p[0] - t.p[0][0], p[1] - t.p[0][1]) > R + t.ancho / 2;
        for (let i = 1; i < t.p.length; i++) if (distSeg(p, t.p[i - 1], t.p[i]) < R + t.ancho / 2) return false;
        return true;
      });
      if (trazos.length !== antes) redibujar();
    }

    c.addEventListener('pointerdown', e => {
      const p = punto(e);
      if (herr === 'texto') {
        const t = prompt('Texto (ej. "Eje C", "C-4", "Fachada norte"):');
        if (t && t.trim()) { trazos.push({ tipo: 'texto', x: p[0], y: p[1], texto: t.trim(), tam: TAM_TEXTO, color }); redibujar(); }
        return;
      }
      c.setPointerCapture(e.pointerId);
      if (herr === 'borrar') { actual = { borrando: true }; borrarEn(p); return; }
      actual = { tipo: 'linea', color, ancho: ANCHOS[herr], p: [p] };
      dibujar(actual);
    });
    function extender(e) {
      const p = punto(e);
      if (actual.borrando) { borrarEn(p); return; }
      const u = actual.p[actual.p.length - 1];
      if (Math.hypot(p[0] - u[0], p[1] - u[1]) < 2) return;
      actual.p.push(p);
      x.strokeStyle = actual.color;
      x.lineWidth = actual.ancho;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(u[0], u[1]);
      x.lineTo(p[0], p[1]);
      x.stroke();
    }
    c.addEventListener('pointermove', e => { if (actual) extender(e); });
    // El punto donde se suelta también cuenta (trazos rápidos que no alcanzan a enviar movimientos)
    const finTrazo = e => {
      if (!actual) return;
      if (e.type === 'pointerup') extender(e);
      if (!actual.borrando) trazos.push(actual);
      actual = null;
    };
    c.addEventListener('pointerup', finTrazo);
    c.addEventListener('pointercancel', finTrazo);

    const terminar = v => { ro.disconnect(); E.cerrar(); res(v); };
    E.alEscape(async () => { if (!trazos.length || await confirmar('¿Descartar el croquis?', { aceptar: 'Descartar', peligro: true })) terminar(null); });
    ed.addEventListener('click', async e => {
      const seg = e.target.closest('.segmentado button');
      if (seg) {
        const grupo = seg.parentElement.dataset.grupo;
        seg.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('activo', b === seg));
        if (grupo === 'herr') herr = seg.dataset.v; else color = seg.dataset.v;
        return;
      }
      const acc = e.target.closest('[data-acc]')?.dataset.acc;
      if (acc === 'cancelar') {
        if (!trazos.length || await confirmar('¿Descartar el croquis?', { aceptar: 'Descartar', peligro: true })) terminar(null);
      } else if (acc === 'deshacer') { trazos.pop(); redibujar(); }
      else if (acc === 'limpiar') {
        if (trazos.length && await confirmar('¿Borrar todo el croquis?', { aceptar: 'Borrar', peligro: true })) { trazos = []; redibujar(); }
      } else if (acc === 'orientacion') {
        if (trazos.length) { toast('La hoja solo se puede girar cuando está vacía'); return; }
        [W, H] = [H, W];
        c.width = W; c.height = H;
        redibujar();
        ajustar();
      } else if (acc === 'guardar') {
        terminar({ canvas: c, ...E.valores() });
      }
    });
  });
}
