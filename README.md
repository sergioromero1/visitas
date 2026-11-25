# DAK · Visitas de inspección

App web instalable para registrar hallazgos en campo (peritajes, evaluaciones, patología) con fotos ubicadas sobre el plano. Funciona sin señal y sincroniza entre los dispositivos del equipo cuando vuelve la conexión.

Está hecha con HTML, CSS y JavaScript puro, sin Node.js ni paso de compilación. Usa Firebase (ingreso con Google y base de datos Firestore) y se publica en Cloudflare Pages.

## Cómo se usa

1. **Proyecto → Visita.** Se crea el proyecto una vez; cada ida a la obra es una visita.
2. **Plano.** Se agrega de una de estas formas:
   - Foto del plano impreso, enderezada arrastrando las 4 esquinas.
   - Imagen guardada en el dispositivo.
   - PDF (un DWG se imprime antes a PDF desde AutoCAD).
   - Croquis a mano alzada.
3. **＋ Hallazgo → tocar el plano.** Se abre la ficha con:
   - Fotos (cámara o galería).
   - Nivel y ejes.
   - Elemento, patología y severidad, que se marcan con un toque.
   - Descripción y anotaciones.
   - Marca de "pendiente por verificar".

   Todo se guarda solo.
4. **Visita y exportar.** Hay tres acciones:
   - **Descargar ZIP:** fotos renombradas (`H03_Piso_2_C-4_Columna_Fisura_01.jpg`), planos con los pines numerados, `informe.md` y `hallazgos.csv` para Excel.
   - **Vista para PDF:** abre el informe con fotos para imprimir o guardar como PDF.
   - **Liberar imágenes:** cuando el ZIP ya está en el PC o el disco, borra las imágenes completas de la nube y conserva fichas, notas y miniaturas.

`informe.md` se puede convertir a Word o PDF con Pandoc, si está instalado:

```
pandoc informe.md -o informe.docx
```

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Página y estilos |
| `js/app.js` | Pantallas y navegación |
| `js/nube.js` | Firebase (sesión, datos, subida de imágenes en trozos) o modo local |
| `js/almacen.js` | Imágenes guardadas en el dispositivo (IndexedDB) y cola de subida |
| `js/plano.js` | Visor con zoom y pines, editor para enderezar, croquis |
| `js/imagenes.js` | Compresión de fotos, enderezado de perspectiva, PDF (pdf.js por CDN) |
| `js/exportar.js` | ZIP, `informe.md`, `hallazgos.csv` y vista para PDF |
| `js/catalogos.js` | Listas de elementos, patologías, severidades y tipos de visita (se editan aquí) |
| `sw.js`, `manifest.webmanifest` | Uso sin señal e instalación en el celular |
| `firebase-config.js`, `firestore.rules` | Conexión y reglas de seguridad de Firebase |

Las fotos se guardan a 2560 px de lado mayor (cerca de 1 MB). Firestore no admite más de 1 MB por documento, así que cada imagen se parte en trozos (colección `trozos`). Las fichas llevan una miniatura, y los planos una vista reducida, para que se vean en todos los dispositivos sin descargar la imagen completa.

## Probar en el PC

```
py -m http.server 5501
```

Luego se abre http://localhost:5501. Mientras `firebase-config.js` diga `REEMPLAZAR`, la app funciona en **modo local**: todo queda solo en ese navegador. En localhost el service worker no se activa, para ver siempre la última versión; para probar el modo sin señal se abre http://localhost:5501/?sw.

## Configurar Firebase (una sola vez)

1. En https://console.firebase.google.com, **Agregar proyecto** (por ejemplo `dak-visitas`); Google Analytics no hace falta.
2. **Authentication → Comenzar → Método de acceso → Google →** habilitar.
3. **Firestore Database → Crear base de datos →** modo producción, ubicación cercana (por ejemplo `southamerica-east1`).
4. **Firestore → Reglas →** pegar el contenido de `firestore.rules` y publicar.
5. **Firestore → Datos → Iniciar colección** `autorizados`. Se crea el primer documento:
   - **ID del documento:** tu correo de Google en minúsculas.
   - **Campos:** `rol` = `admin` y `nombre` = tu nombre (ambos de tipo string).

   Las demás personas se agregan después desde la app, en **⋯ → Usuarios autorizados**.
6. **Configuración del proyecto (engranaje) → Tus apps → Web (`</>`) →** registrar la app y copiar los valores de `firebaseConfig` en `firebase-config.js`.
7. **Authentication → Configuración → Dominios autorizados →** agregar el dominio de Cloudflare (por ejemplo `dak-visitas.pages.dev`).

## Publicar en Cloudflare Pages

1. Crear un repositorio **privado** vacío en GitHub y subir este código:
   ```
   git remote add origin <url del repositorio>
   git push -u origin main
   ```
2. En Cloudflare: **Workers & Pages → Create → Pages → Connect to Git →** elegir el repositorio.
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: `/`
3. Cada `git push` a `main` publica la versión nueva. Los celulares la toman en el segundo arranque, porque el primero abre la copia guardada para no depender de la señal.

## A tener en cuenta

- **Cuota gratuita de Firestore (plan Spark):** 1 GiB guardado, 50.000 lecturas y 20.000 escrituras al día. Alcanza para unas 1.000 fotos a la vez; por eso existe "Liberar imágenes". Las cifras son las publicadas por Google y conviene confirmarlas en la consola.
- **iPhone:** hay que instalar la app en la pantalla de inicio (Compartir → Agregar a inicio). Si se usa solo desde Safari, iOS puede borrar los datos locales no sincronizados tras días sin abrirla.
- **Cámara en el celular:** solo funciona con HTTPS, es decir, desde la versión publicada en Cloudflare y no desde el PC por la red local.
