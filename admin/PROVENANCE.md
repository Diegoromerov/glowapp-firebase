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
