/**
 * Decisión del portero del panel: qué camino exige sesión de ADMIN y qué camino no.
 *
 * Vive fuera de `middleware.ts` a propósito. El middleware importa `next/server`, que el
 * resolutor de Node no sabe cargar sin extensión (el empaquetador de Next sí), de modo que
 * una prueba que quiera EJERCER la decisión —y no leer el fuente como texto— necesita que la
 * decisión sea un módulo sin dependencias. `middleware.ts` es ahora el adaptador.
 *
 * La lista de lo público es EXPLÍCITA por un defecto concreto: la regla anterior
 * (`/\.[a-zA-Z0-9]+$/.test(pathname)`) daba por público cualquier camino terminado en
 * `.algo`, así que nada que llevara extensión pasaba por el portero. Comprobado contra el
 * panel real y sin sesión: `/admin/pqrsf` respondía 307 mientras `/admin/pqrsf.json`,
 * `/admin/precios.csv`, `/prestador/datos.json` y `/perfil/x.txt` llegaban al router. Hoy no
 * hay nada detrás de esos caminos, pero el App Router admite un segmento de ruta con punto:
 * una exportación, un CSV o un JSON futuro habría nacido público sin que nadie lo notara.
 *
 * Con la lista, una ruta nueva nace protegida. Quien agregue un archivo a `public/` tiene que
 * declararlo en `ASSETS_PUBLICOS`, y hay un caso de prueba que compara esta lista con el
 * contenido real del directorio para que no se separen.
 */

/** Rutas que se sirven sin sesión, y sus subrutas. */
export const CAMINOS_PUBLICOS = ['/login', '/register'];

/**
 * Archivos servidos sin sesión. Son los cinco SVG que trae la plantilla de Next; el panel no
 * tiene assets propios fuera de `_next/static`, que ni siquiera llega al middleware porque
 * está excluido en el matcher.
 */
export const ASSETS_PUBLICOS = new Set([
  '/file.svg',
  '/globe.svg',
  '/next.svg',
  '/vercel.svg',
  '/window.svg',
]);

export type Clase = 'publico' | 'api' | 'asset' | 'protegido';

export function clasificarCamino(pathname: string): Clase {
  // 1. Rutas públicas
  if (CAMINOS_PUBLICOS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return 'publico';
  }

  // 2. Las rutas de API las gestiona su controlador / el BFF proxy, que autentica por su cuenta.
  if (pathname.startsWith('/api')) {
    return 'api';
  }

  // 3. Archivos estáticos declarados.
  if (ASSETS_PUBLICOS.has(pathname)) {
    return 'asset';
  }

  // 4. Todo lo demás exige sesión de ADMIN.
  return 'protegido';
}
