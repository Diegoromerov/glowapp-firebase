# Provenance

- Repositorio de origen: `Diegoromerov/belleza-app`.
- Rama de origen: `feat/split-client-provider-apps`.
- SHA de origen: `1cc869492abd80bc4a0424b9b8250677c78bcdf8`.
- Fecha de copia: `2026-11-09`.
- Comando de extracción: `git archive --format=tar --output=<temp>/admin-panel-source.tar 1cc869492abd80bc4a0424b9b8250677c78bcdf8 admin-dashboard` y `tar.exe -xf <temp>/admin-panel-source.tar -C <worktree>/admin --strip-components=1`.

## Desviaciones respecto al origen 1cc8694

1. El BFF impone `X-App-Audience: admin` en el servidor; el origen no la enviaba.
2. Academia deja de llamar a `NEXT_PUBLIC_API_URL` y pasa por el BFF (13 fetch).
3. Detalle de pedido: `/api/admin/store/orders/:id` (inexistente) cambia a `/api/store/orders/:id`, y se renderiza el modal declarado.
4. `RAILWAY_ENV.md` se reescribe para el proyecto `glowapp` (host interno `glowapp-api.railway.internal:3000`, `JWT_SECRET` por referencia, `NEXT_PUBLIC_API_URL` fuera del contrato).

## Conteo de archivos: por qué el umbral «≥120» no aplica

El umbral del brief se derivó de un listado de árbol, no de un conteo de archivos.

| Medición (SHA `1cc8694`, ruta `admin-dashboard/`) | Comando | Resultado |
|---|---|---|
| Archivos rastreados (blobs) | `git ls-tree -r --name-only 1cc8694 admin-dashboard \| wc -l` | **87** |
| Subdirectorios | `git ls-tree -r -t 1cc8694 admin-dashboard \| awk '$2=="tree"' \| wc -l` | 40 (39 + la raíz) |
| Entradas del árbol (archivos + directorios) | `git ls-tree -r -t 1cc8694 admin-dashboard \| wc -l` | 127 |
| Mismo listado vía API de GitHub, excluyendo la raíz | — | **126** ← de aquí salió el umbral |
| Submódulos / symlinks / ejecutables | `git ls-tree -r 1cc8694 admin-dashboard \| awk '{print $1}' \| sort \| uniq -c` | 0 / 0 / 0 (87 × `100644`) |

`126 = 87 archivos + 39 directorios`. El panel no tiene 126 archivos: tiene 87.

## Estado de la copia en esta rama

| Medición | Resultado |
|---|---|
| Archivos bajo `admin/` | **92** |
| Archivos del origen ausentes en la rama | **0** |
| Archivos nuevos (autorizados por el brief) | **5** |

Los 5 añadidos son `PROVENANCE.md`, `KNOWN_GAPS.md` y las tres suites
`tests/{app-audience,no-direct-backend,allowed-paths-contract}.test.mjs`. `87 + 5 = 92`.

De los 87 archivos del origen: **76 son idénticos byte a byte**, **6 difieren solo en fin de línea**
(`globals.css`, `page.tsx`, `components/ui/theme-provider.tsx`, `components/ui/theme-selector.tsx`,
`lib/format.ts`, `lib/utils.ts` — CRLF del origen, LF al extraer en Windows; sin cambio de contenido)
y **5 están modificados a propósito** conforme al brief (`api/[...path]/route.ts`, los dos de
`admin/academia/`, `admin/store/orders/page.tsx` y `RAILWAY_ENV.md`).

## Criterio de aceptación correcto (sustituye al umbral)

El criterio verificable es la igualdad de conjuntos con el origen, no un número mágico:

```bash
SRC=$(mktemp -d) && git clone -q --depth 1 --filter=blob:none --sparse \
  -b feat/split-client-provider-apps https://github.com/Diegoromerov/belleza-app.git "$SRC" && \
git -C "$SRC" sparse-checkout set admin-dashboard
diff <(git -C "$SRC" ls-tree -r --name-only 1cc8694 admin-dashboard | sed 's|^admin-dashboard/||' | sort) \
     <(git -C . ls-tree -r --name-only origin/feat/admin-panel admin | sed 's|^admin/||' | sort) \
  | grep '^<'                      # vacío = no falta ningún archivo del origen
git -C . ls-tree -r --name-only origin/feat/admin-panel admin | wc -l   # 92 (87 + 5 autorizados)
```

`grep '^<'` vacío y 92 archivos es el estado correcto. Cualquier cifra mayor exige justificar el
archivo añadido, y cualquier cifra menor indica una copia incompleta.
