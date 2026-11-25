// ─────────────────────────────────────────────
//  Procesamiento de imágenes: compresión, miniaturas, enderezado de planos y PDF
// ─────────────────────────────────────────────

export const LADO_FOTO = 2560;    // lado mayor de las fotos guardadas
export const LADO_PLANO = 3200;   // lado mayor de los planos guardados
export const LADO_MINI = 360;     // miniaturas que viajan dentro de la ficha
export const LADO_VISTA = 1280;   // vista reducida del plano que viaja dentro de la ficha

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

export function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Carga una imagen desde Blob/File; el navegador aplica la orientación EXIF.
export function cargarImagen(fuente) {
  return new Promise((res, rej) => {
    const url = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente);
    const img = new Image();
    img.onload = () => { img._url = typeof fuente === 'string' ? null : url; res(img); };
    img.onerror = () => { if (typeof fuente !== 'string') URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
export function soltar(img) { if (img?._url) URL.revokeObjectURL(img._url); }

export function aBlob(canvas, tipo = 'image/jpeg', calidad = 0.85) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('No se pudo codificar la imagen')), tipo, calidad));
}

// Copia redimensionada para que el lado mayor no pase de "lado"
export function escalar(fuente, w, h, lado) {
  const k = Math.min(1, lado / Math.max(w, h));
  const c = lienzo(w * k, h * k);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(fuente, 0, 0, c.width, c.height);
  return c;
}

export const dataUrl = (canvas, lado, calidad = 0.6) =>
  escalar(canvas, canvas.width, canvas.height, lado).toDataURL('image/jpeg', calidad);

export async function prepararFoto(archivo) {
  const img = await cargarImagen(archivo);
  try {
    const c = escalar(img, img.naturalWidth, img.naturalHeight, LADO_FOTO);
    const blob = await aBlob(c, 'image/jpeg', 0.85);
    return { blob, miniatura: dataUrl(c, LADO_MINI), ancho: c.width, alto: c.height };
  } finally {
    soltar(img);
  }
}

export function rotar90(c) {
  const r = lienzo(c.height, c.width);
  const x = r.getContext('2d');
  x.translate(r.width, 0);
  x.rotate(Math.PI / 2);
  x.drawImage(c, 0, 0);
  return r;
}

// Corrige la perspectiva: q son las 4 esquinas del plano en la foto (sup-izq, sup-der, inf-der, inf-izq)
// y el resultado es un rectángulo. Transformación proyectiva (Heckbert) con interpolación bilineal.
export function enderezar(fuente, q, maxLado = LADO_PLANO) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  let H = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const k = Math.min(1, maxLado / Math.max(W, H));
  W = Math.max(2, Math.round(W * k));
  H = Math.max(2, Math.round(H * k));

  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (!den) throw new Error('Las esquinas no forman un cuadrilátero válido');
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const dd = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;

  const sw = fuente.width, sh = fuente.height;
  const src = fuente.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = lienzo(W, H);
  const ctx = out.getContext('2d');
  const od = ctx.createImageData(W, H);
  const o = od.data;
  let i = 0;
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    for (let px = 0; px < W; px++, i += 4) {
      const u = (px + 0.5) / W;
      const z = g * u + h * v + 1;
      let sx = (a * u + b * v + c) / z - 0.5;
      let sy = (dd * u + e * v + f) / z - 0.5;
      if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1;
      if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const ix1 = ix < sw - 1 ? ix + 1 : ix, iy1 = iy < sh - 1 ? iy + 1 : iy;
      const p00 = (iy * sw + ix) * 4, p10 = (iy * sw + ix1) * 4, p01 = (iy1 * sw + ix) * 4, p11 = (iy1 * sw + ix1) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const arriba = src[p00 + ch] + (src[p10 + ch] - src[p00 + ch]) * fx;
        const abajo = src[p01 + ch] + (src[p11 + ch] - src[p01 + ch]) * fx;
        o[i + ch] = arriba + (abajo - arriba) * fy;
      }
      o[i + 3] = 255;
    }
  }
  ctx.putImageData(od, 0, 0);
  return out;
}

// ── PDF (pdf.js se carga solo cuando se necesita) ──
let pdfjs = null;
export async function abrirPdf(archivo) {
  if (!pdfjs) {
    pdfjs = await import(PDFJS + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
}

export async function renderizarPagina(pdf, n, lado = LADO_PLANO) {
  const pagina = await pdf.getPage(n);
  const v1 = pagina.getViewport({ scale: 1 });
  const vp = pagina.getViewport({ scale: lado / Math.max(v1.width, v1.height) });
  const c = lienzo(vp.width, vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  // intent 'print': dibuja de una vez, sin esperar cuadros de animación (no se detiene si la pestaña pierde el foco)
  await pagina.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return c;
}
