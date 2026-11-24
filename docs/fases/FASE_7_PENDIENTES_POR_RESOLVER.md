# Fase 7 — Puntos por resolver

**Estado:** pendientes de definición, implementación o verificación.  
**Fecha de elaboración:** 23 de noviembre de 2026.  
**Contexto:** plan comercial SaaS de GlowApp para salones. El trabajo se publica directamente en producción, sin usar staging, conforme a la instrucción del usuario.

## Propósito

Consolidar los asuntos pendientes para que catálogo, cobro, límites técnicos y oferta comercial describan el mismo producto. Este documento registra trabajo por resolver; no implica que los puntos ya estén aprobados o implementados.

## Lista de pendientes

| N.º | Punto por resolver | Decisión o trabajo requerido | Resultado esperado |
|---:|---|---|---|
| 1 | Días de prueba en planes pagos | Confirmar si los planes Básico, Profesional y Empresarial tienen 0 o 30 días de prueba. Alinear catálogo, checkout, pasarela y términos visibles sin alterar cobros antes de confirmar la política. | Una única política de prueba, aplicada y comunicada igual en todas las superficies. |
| 2 | WhatsApp, POS y soporte prioritario | Precisar si están disponibles hoy para Empresarial, definir alcance, responsables y SLA; integrar los controles de acceso backend que falten. | Beneficios que puedan entregarse, medirse y sostenerse de acuerdo con lo anunciado. |
| 3 | Caja, inventario, recetas y recursos | Definir qué herramientas operativas corresponden a cada plan y establecer capacidades/cuotas donde hagan falta. | Matriz por plan y límites efectivos en backend. |
| 4 | Fidelización propia del salón | Elegir entre incluirla en planes, venderla como complemento o ejecutarla como piloto. Definir costos, límites y reglas; mantenerla separada de los puntos globales GlowApp. | Oferta comercial y técnica clara para el programa de puntos del salón. |
| 5 | Multi-sede | Definir el número de sedes, permisos y funciones de consolidación por plan, especialmente para Empresas. | Límites de sedes explícitos en catálogo, contratos y backend. |
| 6 | Procesos de integración | Explicar qué operaciones consumen la cuota API mensual y qué ocurre al agotarla (bloqueo, aviso, compra de excedente u otra regla). | Métrica entendible y política de excedentes aplicada de forma consistente. |
| 7 | Catálogo local de respaldo | Mantener el fallback Flutter para disponibilidad, pero implementar una comprobación automatizada de paridad con el catálogo del backend. | Alertas cuando precios, límites o capacidades difieran entre ambas fuentes. |
| 8 | Facturación, cambios de plan y piloto | Definir excedentes, upgrade/downgrade, textos de facturación y alcance del piloto. Instrumentar métricas y preparar un mecanismo de rollback antes de ampliar el lanzamiento. | Flujo de contratación y cambio de plan comprensible, medible y reversible. |
| 9 | Verificación integral de límites | Ejecutar pruebas de integración en producción controlada para verificar reservas, invitaciones/asientos, API y capacidades en todos los canales de creación, reintento y cambio de plan. | Evidencia por flujo de que el backend aplica correctamente cuotas y permisos. |

## Orden sugerido de resolución

1. Confirmar las decisiones comerciales de los puntos 1, 2, 4, 5 y 6.
2. Aprobar la matriz de planes y módulos para caja, inventario, recetas y recursos (punto 3).
3. Implementar catálogo, gates y manejo de excesos/cambio de plan en backend (puntos 6–8).
4. Automatizar paridad y ejecutar pruebas de integración con evidencia (puntos 7 y 9).
5. Iniciar el piloto gradual con métricas, rollback y documentación de resultados (punto 8).

## Criterio para cerrar estos pendientes

La Fase 7 podrá cerrarse cuando cada plan tenga una descripción comercial coincidente con el catálogo y el checkout, cada capacidad exclusiva tenga control backend verificable, las cuotas tengan una política de agotamiento definida, el onboarding y la facturación presenten esa información con claridad y el piloto disponga de resultados y procedimiento de reversión documentados.

## Relación con el informe de Fase 7

Este documento amplía la sección de asuntos pendientes del [informe principal de Fase 7](FASE_7_PAQUETES_Y_LANZAMIENTO.md). La auditoría y el despliegue inicial de onboarding están registrados allí; los nueve puntos de esta lista continúan abiertos hasta completar sus decisiones y verificaciones.

## Especificación comercial recibida

El usuario compartió la [Propuesta Comercial V3](FASE_7_PROPUESTA_COMERCIAL_V3.md) con una matriz completa de seis niveles, servicios, cuotas, complementos y comportamientos al límite. Por tanto, los pendientes ya cuentan con una propuesta concreta de asignación para orientar el trabajo técnico. Permanecen abiertos la validación de hipótesis comerciales, los controles backend/UI que faltan, la integración de facturación electrónica y las pruebas de aceptación. Los nuevos precios y cobros son propuestas y aún no están activados en producción.
