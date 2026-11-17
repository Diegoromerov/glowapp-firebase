# Línea base de sincronización GlowShop entre apps

**Contrato:** glowshop-logistics/v1
**Fuente de verdad:** API de GlowApp y PostgreSQL. La app cliente y la app proveedor no calculan ni mutan por su cuenta estados logísticos.

## Responsabilidad

- **App cliente:** consulta productos, pide cotización, confirma la orden, paga el total devuelto por el servidor, consulta envíos y eventos, y solicita devoluciones para cada paquete recibido.
- **Backend:** valida precios e inventario, cotiza el envío, registra pedido y pago, divide productos por proveedor, crea un envío por proveedor y conserva estados, guías y devoluciones.
- **App proveedor:** consulta paquetes asociados a su perfil, marca todos sus productos preparados, genera etiqueta, programa recogida, confirma despacho y tramita devoluciones.
- **Wompi:** el webhook autenticado confirma el pago. La respuesta visual de la pasarela no pone el pedido en PAGADO.
- **Envíame:** genera etiquetas, guías y recogidas. Puede responder en modo simulado; requiere ENVIAME_API_KEY y secreto de webhook productivos para operación real.

## Contratos de API

| Uso | Ruta | Contrato |
|---|---|---|
| Cotizar antes de pagar | POST /api/store/envio/cotizacion | Entrada: items[{producto_id,cantidad}], dirección, ciudad y puntos/reserva opcionales. Respuesta: subtotal, subtotal_con_iva, iva, envio, total y envio_detalle. |
| Crear pedido | POST /api/store/checkout | El servidor vuelve a validar precio/stock y calcula otra vez el envío. Se cobra data.order.total. Si difiere de la vista previa, pedir confirmación antes de abrir Wompi. |
| Pedidos del cliente | GET /api/store/orders | Cada orden incluye items[] y envios[]. guia identifica el tracking; no se sustituye por el ID interno. |
| Paquetes del proveedor | GET /api/provider/fulfillment/orders | Cada fila contiene envio_id, tracking_number, envio_estado, preparacion_estado e ítems de ese proveedor. |
| Marcar preparación | POST /api/provider/fulfillment/orders/:id/prepare | Debe incluir cada producto asignado una vez y con la cantidad completa. El estado se persiste por envío. |
| Origen proveedor | GET/PUT /api/provider/fulfillment/origin | Dirección de despacho del perfil activo: vía, número, ciudad, departamento, código postal y DANE cuando esté disponible. |
| Etiqueta/recogida/despacho | POST /api/provider/fulfillment/orders/:id/label, /pickup, /dispatch | El proveedor administra su paquete. guia queda en envios.guia; el pedido pasa a DESPACHADO cuando salen todos sus paquetes. |
| Seguimiento | GET /api/tracking/:guia | Devuelve guía, transportadora, estado actual y timeline. |
| Solicitar devolución | POST /api/client/orders/:id/return | Motivo enumerado, descripción, envio_id e items de ese proveedor. Pedido entregado dentro de 30 días. |
| Tramitar devolución | GET /api/provider/returns y POST /api/provider/returns/:id/{approve,reject,receive} | El proveedor aprueba o rechaza, se genera guía inversa, registra recepción e inspección. El reembolso queda pendiente de conciliación Wompi. |

## Identificadores y estados

- pedido_id identifica la compra; envio_id identifica un paquete; guia identifica el tracking. Son valores distintos.
- Un pedido con productos de varios proveedores tiene un registro en envios por proveedor. envios.prestador_id determina acceso y despacho; pedidos_tienda.prestador_comisionado_id solo representa la relación con una reserva.
- El webhook confirma el pago. envios.preparacion_estado guarda la preparación. El pedido pasa a DESPACHADO cuando salen todos sus paquetes y queda ENTREGADO cuando llegan todos. Las devoluciones se validan contra el paquete específico entregado.
- El coste de envío depende de dirección, peso estimado, valor y zona. La gestión de $1.000 se suma al envío cuando aplica. El cliente ve el total antes de pagar; el servidor lo vuelve a calcular al crear el pedido.
- El envío gratis depende del umbral configurado en zonas_envio para una zona activa.

## Secuencia para entregar cambios

1. Revisar y desplegar migraciones del backend antes de las apps. Esta línea base agrega 174 (propietario de envío, dirección de origen, preparación y destino) y 175 (campos de devolución faltantes).
2. Publicar backend y migraciones; validar cotización, pedido, webhook, fulfillment, tracking y devolución en staging.
3. Compilar cliente y proveedor contra la misma API de staging; no publicar apps apuntando a APIs distintas.
4. Promover backend primero y luego publicar ambas apps con el mismo API_URL productivo.
5. Cambios futuros de rutas o JSON actualizan este contrato y ambos consumidores en el mismo cambio lógico. Mantener compatibilidad mientras existan versiones antiguas activas.
6. Confirmar credenciales por entorno. La salud HTTP no acredita por sí sola que Envíame o los reembolsos funcionen.

## Límites operativos conocidos

- El reembolso todavía no se envía a Wompi; tras la inspección queda registrado como pendiente de conciliación manual. Las apps muestran ese estado, no afirman que el pago fue ejecutado.
- Envíame se simula si falta ENVIAME_API_KEY o se usa un valor placeholder/mock.
- Envíos antiguos solo se asignan automáticamente cuando todos los productos pertenecen a un proveedor. Los pedidos antiguos con varios proveedores requieren reasignación.
