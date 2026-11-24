# Fase 7 — Propuesta comercial SaaS V3

**Estado:** propuesta funcional recibida para orientar la implementación; precios y cuotas requieren validación en piloto.  
**Fecha:** 23 de noviembre de 2026.  
**Fuente:** documento compartido por el usuario, «SaaS para salones: niveles, servicios y entitlements GlowApp», versión 3.

## Propósito

Registrar la matriz propuesta de niveles, servicios, cuotas y reglas comerciales que se usará para delimitar el SaaS de salones. Es una especificación de producto, no evidencia de que estas condiciones ya estén implementadas ni autorización para cobrar los nuevos precios en producción.

## Niveles propuestos

| Nivel | Mensual | Anual propuesto | Personas | Perfil |
|---|---:|---:|---:|---|
| Prueba Gratis (14 días) | Gratis | No aplica | 3 | Salón nuevo que quiere probar casi todas las funciones |
| Freemium | Gratis permanente | No aplica | 1 | Prestador independiente o agenda mínima |
| Básico | $99.000 COP | $79.200 COP/mes equivalente | 5 | Salón pequeño que necesita agenda, caja e inventario |
| Crecimiento | $169.000 COP (hipótesis) | $135.200 COP/mes equivalente | 10 | Salón que quiere facturación, marca propia y fidelización |
| Profesional | $249.000 COP | $199.200 COP/mes equivalente | 20 | Salón que requiere recetas, analítica y contratos |
| Empresarial | Desde $449.000 COP, cotizado | Desde $359.200 COP/mes equivalente | Ilimitadas | Cadenas y operación multi-sede |

El descuento anual del 20% y los precios de esta matriz son propuestas; requieren confirmación comercial y validación de piloto. La tarifa Empresarial sería precio inicial de referencia, con cotización asistida.

## Matriz propuesta de servicios

| Servicio | Prueba | Freemium | Básico | Crecimiento | Profesional | Empresarial |
|---|---|---|---|---|---|---|
| Presencia en el mapa | Sí | Sí | Sí | Sí | Sí | Sí |
| Reservas en línea | Sí | Sí, con tope | Sí | Sí | Sí | Sí |
| Equipo, roles y permisos | Sí | Solo propietario | Sí | Sí | Sí | Sí |
| Caja, ventas y POS | Sí | Recibos no fiscales | Sí | Sí | Sí | Sí |
| Facturación electrónica | Modo de pruebas | No | Complemento | 400 documentos/mes | 800 documentos/mes | 2.500 documentos/mes |
| Inventario | Sí | No | Sí | Sí | Sí | Sí |
| Reportes básicos | Sí | Sí | Sí | Sí | Sí | Sí |
| Recursos (sillas/cabinas) | Ilimitados | No | Hasta 5 | Hasta 15 | Ilimitados | Ilimitados |
| Checklists de cumplimiento | Sí | No | Sí | Sí | Sí | Sí |
| Marca personalizada | Sí | No | No | Sí | Sí | Sí |
| Fidelización del salón | Sí | No | No | Sí | Sí | Sí |
| Recetas y consumo | Sí | No | No | No | Sí | Sí |
| Analítica avanzada | Sí | No | No | No | Sí | Sí |
| Contratos y alquiler de silla | No | No | No | No | Sí | Sí |
| Aura para el negocio | 10 consultas | No | Por paquete | 50 consultas/mes | 150 consultas/mes | 600 consultas/mes |
| WhatsApp | 20 mensajes | No | Por paquete | 50 mensajes/mes | 100 mensajes/mes | 500 mensajes/mes |
| Multi-sede/consolidado | No | No | No | No | 1 sede | 3 sedes |
| API abierta | No | No | No | No | No | Sí |

El documento considera funciones base de plataforma, sin venta separada: alta del salón, roles y permisos, cobro de la suscripción GlowApp y medición de uso.

## Cuotas propuestas

| Cuota por mes o cuenta | Prueba | Freemium | Básico | Crecimiento | Profesional | Empresarial |
|---|---:|---:|---:|---:|---:|---:|
| Personas | 3 | 1 | 5 | 10 | 20 | Ilimitadas |
| Reservas directas/mes | 150 | 30 | Ilimitadas | Ilimitadas | Ilimitadas | Ilimitadas |
| Documentos/mes | Modo pruebas | 0 | 0; 250 con complemento | 400 | 800 | 2.500 |
| NIT con facturación | 1 de pruebas | 0 | 0; 1 con complemento | 1 | 1 | 1 más adicionales |
| Recursos | Ilimitados | 0 | 5 | 15 | Ilimitados | Ilimitados |
| Consultas Aura | 10 | 0 | Por paquete | 50 | 150 | 600 |
| Mensajes WhatsApp | 20 | 0 | Por paquete | 50 | 100 | 500 |
| Sedes | 1 | 1 | 1 | 1 | 1 | 3 más adicionales |
| Llamadas API | 0 | 0 | 0 | 0 | 0 | 500.000 |

## Reglas de producto propuestas

- Medir personas, reservas, documentos, recursos, sedes, Aura, WhatsApp y API con contadores independientes.
- Contar como reserva directa solo la creada en agenda/enlace/sitio propio del salón; no bloquear ni descontar reservas del marketplace.
- Incluir presencia en mapa también en Freemium.
- Reservar la API abierta para Empresarial. Una llamada API equivale a una solicitud HTTP autenticada.
- La facturación electrónica se integraría mediante adaptador a un proveedor tecnológico habilitado; el salón sería emisor con su propio NIT.
- Prueba y Freemium no emitirían documentos fiscales reales. La prueba usaría ambiente de pruebas.
- Consultar capacidades por flags de entitlement, no por nombre de plan.
- Aviso de uso al 80%; al 100%, aplicar comportamiento específico: impedir nuevas altas de personas, reservas directas o recursos/sedes; detener Aura/WhatsApp; responder 429 en API. El documento mantiene como hipótesis el tratamiento de documentos excedentes y debe confirmarse.
- Al vencer la prueba, bajar a Freemium sin borrar datos y suspender, sin eliminar, los miembros sobre el límite.
- Las mejoras de plan serían inmediatas; las bajas al siguiente ciclo y bloqueadas si el tenant excede límites del plan destino.

## Complementos propuestos

| Complemento | Precio propuesto | Aplica a |
|---|---:|---|
| Facturación electrónica, 250 documentos/mes | $59.000 COP/mes | Básico |
| Activación de facturación | $79.000 COP en plan mensual; gratis en anual | Niveles con facturación |
| 100 documentos adicionales | $9.000 COP | Niveles con facturación |
| 50 mensajes WhatsApp | $10.000 COP | Básico en adelante |
| 100 consultas Aura | $39.000 COP | Básico |
| NIT adicional con facturación | $35.000 COP/mes | Empresarial |
| Sede adicional | $79.000 COP/mes | Empresarial |

Todos estos valores son hipótesis comerciales hasta confirmar costos de proveedores y piloto.

## Diferencias frente a la oferta y código actuales

- El catálogo actual tiene cinco planes y no contiene Crecimiento.
- El onboarding conserva solo Prueba Gratis y Freemium, de acuerdo con la regla de alta; la propuesta mantiene esa regla.
- Básico hoy limita reservas a 200/mes; la propuesta las hace ilimitadas. Freemium pasa de 20 a 30 y Prueba de 50 a 150, además de distinguir reservas directas de marketplace.
- El catálogo actual no habilita mapa en Freemium; la propuesta lo incluye en todos los niveles.
- La API hoy está habilitada en Profesional y Empresarial; la propuesta la reserva a Empresarial y cambia cuota a 500.000.
- Empresarial hoy figura a $599.000 COP/mes con varias cuotas ilimitadas; la propuesta lo reemplaza por «desde $449.000» y cuotas definidas.
- Caja/POS, inventario, checklists, recetas, recursos y fidelización ya tienen implementación parcial o de operación, pero falta uniformar sus entitlements conforme a esta matriz.
- Facturación electrónica por PT, complementos, periodos anuales con descuento y prorrateo requieren implementación y validación adicional; no quedan habilitados por este documento.

## Hipótesis que deben confirmarse antes de activar cobros

1. Precio de Crecimiento: $169.000 o alternativa de $149.000.
2. Ciclo de contadores: mes calendario en `America/Bogota` o ciclo de cada suscripción.
3. Cobro automático de documentos excedentes frente a aviso y bloqueo; no bloquear una obligación fiscal sin una política confirmada.
4. Costos y condiciones reales de MATIAS API y Nextpyme Plus, certificado, habilitación DIAN y soporte.
5. Porcentaje de ventas que necesitará documento fiscal y márgenes reales del servicio.
6. Reglas de prorrateo de mejoras de nivel en Wompi.
7. Preparación comercial y operativa de fidelización, WhatsApp y Aura.
8. Perfil tributario que se pedirá en onboarding y alcance legal de la facturación del marketplace/tienda.

## Criterio de implementación y salida

Implementar los entitlements de forma centralizada y con compatibilidad para los cinco planes existentes; migrar los tenants sin degradación accidental; mantener catálogo, UI, cobro y cuotas sincronizados; ofrecer reversión antes de ampliar el piloto. Los precios propuestos no se deben activar para clientes productivos hasta validar el piloto y conciliar planes externos de la pasarela, renovaciones y facturación histórica.

## Documento relacionado

- [Informe principal de Fase 7](FASE_7_PAQUETES_Y_LANZAMIENTO.md)
- [Pendientes de Fase 7](FASE_7_PENDIENTES_POR_RESOLVER.md)
