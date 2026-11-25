// ─────────────────────────────────────────────
//  Exportación de una visita: ZIP con fotos renombradas, planos con pines,
//  informe.md (Markdown) y hallazgos.csv; y vista imprimible para guardar como PDF.
//
//  ctx = { proyecto, visita, planos, hallazgos, fotos, numeros (Map id→n), usuario, leerArchivo(id) }
//  Los planos llegan en orden (P1, P2…); hallazgos y fotos ya sin los eliminados.
// ─────────────────────────────────────────────

import { esc, slug, numH, fechaCorta, fechaHora, hora } from './util.js';
import { colorSeveridad, nombreSeveridad } from './catalogos.js';
import { cargarImagen, soltar, lienzo, escalar, aBlob } from './imagenes.js';

// ── ZIP sin compresión (las fotos JPEG no se comprimen más); nombres en UTF-8 ──
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export class Zip {
  constructor() { this.partes = []; this.central = []; this.offset = 0; this.n = 0; }

  async agregar(nombre, datos, fecha = new Date()) {
    const u8 = datos instanceof Blob ? new Uint8Array(await datos.arrayBuffer())
      : typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
    const nb = new TextEncoder().encode(nombre);
    const crc = crc32(u8);
    const t = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
    const d = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, t, true); lh.setUint16(12, d, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, u8.length, true); lh.setUint32(22, u8.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    this.partes.push(lh.buffer, nb, datos instanceof Blob ? datos : u8);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, t, true); ch.setUint16(14, d, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, u8.length, true); ch.setUint32(24, u8.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, this.offset, true);
    this.central.push(ch.buffer, nb);

    this.offset += 30 + nb.length + u8.length;
    this.n++;
  }

  generar() {
    const tam = this.central.reduce((s, p) => s + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
    e.setUint16(8, this.n, true); e.setUint16(10, this.n, true);
    e.setUint32(12, tam, true); e.setUint32(16, this.offset, true); e.setUint16(20, 0, true);
    return new Blob([...this.partes, ...this.central, e.buffer], { type: 'application/zip' });
  }
}

// ── Estructura común del ZIP y de la vista imprimible ──
const extension = tipo => tipo === 'image/png' ? 'png' : 'jpg';

function nombreFoto(h, n, i, tipo) {
  return [numH(n), slug(h.nivel, 15), slug(h.ejes, 15), slug(h.elemento, 20), slug(h.patologias?.[0], 20), String(i).padStart(2, '0')]
    .filter(Boolean).join('_') + '.' + extension(tipo);
}

export function carpetaRaiz({ proyecto, visita }) {
  return [slug(proyecto?.nombre, 40) || 'proyecto', visita?.fecha, slug(visita?.tipo, 20)].filter(Boolean).join('_');
}

function estructura(ctx) {
  const planos = ctx.planos.map((pl, i) => {
    const base = `P${i + 1}_${slug(pl.nombre, 30) || 'plano'}`;
    return { pl, i: i + 1, archivo: base + '.' + extension(pl.archivo?.tipo), conPines: base + '_hallazgos.jpg', pines: [] };
  });
  const porId = new Map(planos.map(p => [p.pl.id, p]));
  const hallazgos = ctx.hallazgos.map(h => {
    const n = ctx.numeros.get(h.id);
    const p = porId.get(h.planoId) || null;
    if (p && h.x != null) p.pines.push({ x: h.x, y: h.y, texto: String(n), color: colorSeveridad(h.severidad) });
    const fotos = ctx.fotos.filter(f => f.hallazgoId === h.id)
      .sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0))
      .map((f, j) => ({ f, j: j + 1, nombre: nombreFoto(h, n, j + 1, f.archivo?.tipo) }));
    return { h, n, p, fotos };
  }).sort((a, b) => a.n - b.n);
  return { planos, hallazgos, totalFotos: hallazgos.reduce((s, x) => s + x.fotos.length, 0) };
}

const titulo = h => [h.elemento || 'Elemento sin definir', h.patologias?.length ? h.patologias.join(', ') : ''].filter(Boolean).join(' — ');
const ubicacion = (h, p) => [h.nivel, h.ejes && `ejes ${h.ejes}`, p ? `plano P${p.i}` : 'sin ubicar en plano'].filter(Boolean).join(' · ');

// Plano con los pines numerados dibujados encima
export async function planoConPines(fuente, pines, maxLado = 0) {
  const img = await cargarImagen(fuente);
  try {
    const c = maxLado ? escalar(img, img.naturalWidth, img.naturalHeight, maxLado) : lienzo(img.naturalWidth, img.naturalHeight);
    const x = c.getContext('2d');
    if (!maxLado) x.drawImage(img, 0, 0);
    const r = Math.max(14, Math.round(Math.max(c.width, c.height) * 0.016));
    for (const p of pines) {
      const px = p.x * c.width, py = p.y * c.height;
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fillStyle = p.color;
      x.fill();
      x.lineWidth = Math.max(2, r * 0.18);
      x.strokeStyle = '#fff';
      x.stroke();
      x.fillStyle = '#fff';
      x.font = `700 ${Math.round(r * (p.texto.length > 2 ? 0.8 : 1.05))}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(p.texto, px, py + r * 0.05);
    }
    return aBlob(c, 'image/jpeg', 0.88);
  } finally {
    soltar(img);
  }
}

async function fuentePlano(ctx, pl) {
  const blob = await ctx.leerArchivo(pl.id).catch(() => null);
  if (blob) return { blob, completo: true };
  if (pl.vista) return { blob: await (await fetch(pl.vista)).blob(), completo: false };
  return { blob: null, completo: false };
}

// ── informe.md ──
const celda = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function informeMd(ctx, d) {
  const { proyecto: p, visita: v } = ctx;
  const L = [];
  L.push(`# Registro de visita de inspección — ${p.nombre}`, '');
  L.push('| Campo | Detalle |', '|---|---|');
  const fila = (k, val) => { if (val) L.push(`| ${k} | ${celda(val)} |`); };
  fila('Cliente', p.cliente);
  fila('Dirección', [p.direccion, p.ciudad].filter(Boolean).join(', '));
  fila('Tipo de estudio', p.tipoEstudio);
  fila('Visita', `${v.tipo || 'Visita'} · ${fechaCorta(v.fecha)}`);
  fila('Asistentes', v.asistentes);
  fila('Hallazgos', `${d.hallazgos.length} hallazgo(s), ${d.totalFotos} foto(s)`);
  fila('Exportado', `${fechaHora(Date.now())} por ${ctx.usuario}`);

  if (v.objetivo) L.push('', '## Objetivo y observaciones generales', '', v.objetivo);

  if (d.planos.length) {
    L.push('', '## Planos');
    for (const pl of d.planos) {
      L.push('', `### P${pl.i} · ${pl.pl.nombre || 'Plano'}${pl.pl.nivel ? ` (${pl.pl.nivel})` : ''}`, '',
        `![P${pl.i} con hallazgos](planos/${pl.conPines})`, '', `Plano original: [planos/${pl.archivo}](planos/${pl.archivo})`);
    }
  }

  L.push('', '## Resumen de hallazgos', '');
  if (d.hallazgos.length) {
    L.push('| N.° | Nivel | Ejes | Elemento | Patología | Severidad | Plano | Fotos |', '|---|---|---|---|---|---|---|---|');
    for (const { h, n, p, fotos } of d.hallazgos) {
      L.push(`| ${numH(n)} | ${celda(h.nivel)} | ${celda(h.ejes)} | ${celda(h.elemento)} | ${celda((h.patologias || []).join(', '))} | ${nombreSeveridad(h.severidad)}${h.pendiente ? ' ⚑' : ''} | ${p ? 'P' + p.i : '—'} | ${fotos.length} |`);
    }
    if (d.hallazgos.some(x => x.h.pendiente)) L.push('', '⚑ = pendiente por verificar.');
  } else {
    L.push('No se registraron hallazgos.');
  }

  if (d.hallazgos.length) L.push('', '## Detalle de hallazgos');
  for (const { h, n, p, fotos } of d.hallazgos) {
    L.push('', `### ${numH(n)} · ${titulo(h)}`, '');
    L.push(`- **Ubicación:** ${ubicacion(h, p)}`);
    if (h.severidad) L.push(`- **Severidad:** ${nombreSeveridad(h.severidad)}`);
    if (h.pendiente) L.push('- **Pendiente por verificar**');
    L.push(`- **Registrado:** ${fechaHora(h.creadoEn)}${h.autor && h.autor !== 'local' ? ` por ${h.autor}` : ''}`);
    if (h.descripcion) L.push('', `**Descripción.** ${h.descripcion}`);
    if (h.notas) L.push('', `**Anotaciones.** ${h.notas}`);
    for (const { f, j, nombre } of fotos) {
      L.push('', `![${numH(n)} foto ${j}](fotos/${nombre})`, '', `*Foto ${j} — ${hora(f.tomadaEn || f.creadoEn)}*${f.nota ? `: ${f.nota.replace(/\r?\n/g, ' ')}` : ''}`);
    }
  }
  return L.join('\n') + '\n';
}

// ── hallazgos.csv (separador ";" para Excel en español) ──
function csv(ctx, d) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const pct = v => v == null ? '' : (v * 100).toFixed(1).replace('.', ',');
  const filas = [['N.°', 'Nivel', 'Ejes', 'Elemento', 'Patologías', 'Severidad', 'Pendiente por verificar', 'Plano', 'X (%)', 'Y (%)', 'Descripción', 'Anotaciones', 'Registrado', 'Autor', 'Fotos', 'Archivos']];
  for (const { h, n, p, fotos } of d.hallazgos) {
    filas.push([numH(n), h.nivel, h.ejes, h.elemento, (h.patologias || []).join(', '), nombreSeveridad(h.severidad), h.pendiente ? 'Sí' : '',
      p ? `P${p.i} ${p.pl.nombre || ''}`.trim() : '', p ? pct(h.x) : '', p ? pct(h.y) : '', h.descripcion, h.notas,
      fechaHora(h.creadoEn), h.autor === 'local' ? '' : h.autor, fotos.length, fotos.map(x => x.nombre).join(', ')]);
  }
  return '﻿' + filas.map(r => r.map(q).join(';')).join('\r\n') + '\r\n';
}

// ── ZIP completo ──
export async function exportarZip(ctx, progreso = () => {}) {
  const d = estructura(ctx);
  const raiz = carpetaRaiz(ctx) + '/';
  const zip = new Zip();
  const faltantes = [];
  const total = d.planos.length + d.totalFotos;
  let k = 0;

  for (const pl of d.planos) {
    const { blob, completo } = await fuentePlano(ctx, pl.pl);
    if (blob) {
      if (!completo) {
        faltantes.push(`planos/${pl.archivo} (se usó la vista reducida)`);
        pl.archivo = pl.archivo.replace(/\.png$/, '.jpg');
      }
      await zip.agregar(raiz + 'planos/' + pl.archivo, blob);
      await zip.agregar(raiz + 'planos/' + pl.conPines, await planoConPines(blob, pl.pines));
    } else {
      faltantes.push(`planos/${pl.archivo}`);
    }
    progreso(++k, total);
  }
  for (const { fotos } of d.hallazgos) {
    for (const x of fotos) {
      const blob = await ctx.leerArchivo(x.f.id).catch(() => null);
      if (blob) await zip.agregar(raiz + 'fotos/' + x.nombre, blob);
      else faltantes.push('fotos/' + x.nombre);
      progreso(++k, total);
    }
  }
  await zip.agregar(raiz + 'informe.md', informeMd(ctx, d));
  await zip.agregar(raiz + 'hallazgos.csv', csv(ctx, d));
  if (faltantes.length) {
    await zip.agregar(raiz + 'FALTANTES.txt',
      'Imágenes que no estaban disponibles al exportar (aún no subían desde otro dispositivo o ya se liberaron de la nube):\r\n\r\n'
      + faltantes.join('\r\n') + '\r\n');
  }
  return { blob: zip.generar(), nombre: carpetaRaiz(ctx) + '.zip', faltantes };
}

// ── Vista imprimible (Imprimir → Guardar como PDF) ──
export async function abrirVistaImpresion(ctx, progreso = () => {}) {
  const d = estructura(ctx);
  const urls = [];
  const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const total = d.planos.length + d.totalFotos;
  let k = 0;

  const planosUrl = new Map();
  for (const pl of d.planos) {
    const { blob } = await fuentePlano(ctx, pl.pl);
    if (blob) planosUrl.set(pl.pl.id, url(await planoConPines(blob, pl.pines, 2000)));
    progreso(++k, total);
  }
  // Fotos reducidas a 1200 px para que la impresión no agote la memoria del teléfono
  const fotosUrl = new Map();
  for (const { fotos } of d.hallazgos) {
    for (const x of fotos) {
      const blob = await ctx.leerArchivo(x.f.id).catch(() => null);
      if (blob) {
        const img = await cargarImagen(blob);
        fotosUrl.set(x.f.id, url(await aBlob(escalar(img, img.naturalWidth, img.naturalHeight, 1200), 'image/jpeg', 0.8)));
        soltar(img);
      } else {
        fotosUrl.set(x.f.id, x.f.miniatura);
      }
      progreso(++k, total);
    }
  }

  const { proyecto: p, visita: v } = ctx;
  const filaFicha = (k2, val) => val ? `<tr><th>${k2}</th><td>${esc(val)}</td></tr>` : '';
  const capa = document.createElement('div');
  capa.className = 'impresion';
  capa.innerHTML = `
    <div class="imp-barra no-imprimir">
      <button class="btn" data-acc="cerrar">✕ Cerrar</button>
      <span>En el cuadro de impresión elige <b>Guardar como PDF</b>.</span>
      <button class="btn primario" data-acc="imprimir">🖨 Imprimir / PDF</button>
    </div>
    <article class="imp-doc">
      <header class="imp-cab">
        <img src="iconos/icono-96.png" alt="DAK" class="imp-logo">
        <div><h1>Registro de visita de inspección</h1><p>${esc(p.nombre)}</p></div>
      </header>
      <table class="imp-ficha">
        ${filaFicha('Cliente', p.cliente)}
        ${filaFicha('Dirección', [p.direccion, p.ciudad].filter(Boolean).join(', '))}
        ${filaFicha('Tipo de estudio', p.tipoEstudio)}
        ${filaFicha('Visita', `${v.tipo || 'Visita'} · ${fechaCorta(v.fecha)}`)}
        ${filaFicha('Asistentes', v.asistentes)}
        ${filaFicha('Hallazgos', `${d.hallazgos.length} hallazgo(s), ${d.totalFotos} foto(s)`)}
        ${filaFicha('Generado', `${fechaHora(Date.now())} por ${ctx.usuario}`)}
      </table>
      ${v.objetivo ? `<h2>Objetivo y observaciones generales</h2><p class="imp-texto">${esc(v.objetivo)}</p>` : ''}
      ${d.planos.map(pl => `
        <section class="imp-plano">
          <h2>P${pl.i} · ${esc(pl.pl.nombre || 'Plano')}${pl.pl.nivel ? ` (${esc(pl.pl.nivel)})` : ''}</h2>
          ${planosUrl.get(pl.pl.id) ? `<img src="${planosUrl.get(pl.pl.id)}" alt="">` : '<p>Imagen no disponible.</p>'}
        </section>`).join('')}
      <h2>Resumen de hallazgos</h2>
      ${d.hallazgos.length ? `<table class="imp-tabla">
        <thead><tr><th>N.°</th><th>Nivel</th><th>Ejes</th><th>Elemento</th><th>Patología</th><th>Severidad</th><th>Plano</th><th>Fotos</th></tr></thead>
        <tbody>${d.hallazgos.map(({ h, n, p: pp, fotos }) => `<tr>
          <td><span class="imp-num" style="background:${colorSeveridad(h.severidad)}">${n}</span></td>
          <td>${esc(h.nivel)}</td><td>${esc(h.ejes)}</td><td>${esc(h.elemento)}</td><td>${esc((h.patologias || []).join(', '))}</td>
          <td>${nombreSeveridad(h.severidad)}${h.pendiente ? ' ⚑' : ''}</td><td>${pp ? 'P' + pp.i : '—'}</td><td>${fotos.length}</td></tr>`).join('')}</tbody>
      </table>${d.hallazgos.some(x => x.h.pendiente) ? '<p class="imp-nota">⚑ = pendiente por verificar.</p>' : ''}` : '<p>No se registraron hallazgos.</p>'}
      ${d.hallazgos.map(({ h, n, p: pp, fotos }) => `
        <section class="imp-hallazgo">
          <h3><span class="imp-num" style="background:${colorSeveridad(h.severidad)}">${n}</span> ${numH(n)} · ${esc(titulo(h))}</h3>
          <p class="imp-meta">${esc(ubicacion(h, pp))}${h.severidad ? ` · Severidad: ${nombreSeveridad(h.severidad)}` : ''}${h.pendiente ? ' · <b>Pendiente por verificar</b>' : ''} · ${fechaHora(h.creadoEn)}</p>
          ${h.descripcion ? `<p class="imp-texto"><b>Descripción.</b> ${esc(h.descripcion)}</p>` : ''}
          ${h.notas ? `<p class="imp-texto"><b>Anotaciones.</b> ${esc(h.notas)}</p>` : ''}
          ${fotos.length ? `<div class="imp-fotos">${fotos.map(({ f, j }) => `
            <figure><img src="${fotosUrl.get(f.id)}" alt=""><figcaption><b>${numH(n)} · foto ${j}</b> (${hora(f.tomadaEn || f.creadoEn)})${f.nota ? ` — ${esc(f.nota)}` : ''}</figcaption></figure>`).join('')}</div>` : ''}
        </section>`).join('')}
    </article>`;
  document.body.appendChild(capa);
  document.body.classList.add('imprimiendo');

  await Promise.all([...capa.querySelectorAll('img')].map(i => i.decode().catch(() => {})));

  return new Promise(res => {
    const cerrar = () => {
      capa.remove();
      document.body.classList.remove('imprimiendo');
      urls.forEach(u => URL.revokeObjectURL(u));
      document.removeEventListener('keydown', tecla, true);
      res();
    };
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
    document.addEventListener('keydown', tecla, true);
    capa.addEventListener('click', e => {
      const acc = e.target.closest('[data-acc]')?.dataset.acc;
      if (acc === 'cerrar') cerrar();
      else if (acc === 'imprimir') window.print();
    });
  });
}
