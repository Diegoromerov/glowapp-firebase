# Provenance

## Desviaciones respecto al origen 1cc8694

1. El BFF impone `X-App-Audience: admin` en el servidor; el origen no la enviaba.
2. Academia deja de llamar a `NEXT_PUBLIC_API_URL` y pasa por el BFF (13 fetch).
3. Detalle de pedido: `/api/admin/store/orders/:id` (inexistente) cambia a `/api/store/orders/:id`, y se renderiza el modal declarado.
