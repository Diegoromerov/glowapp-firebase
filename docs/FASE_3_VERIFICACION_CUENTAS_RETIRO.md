# Fase 3: verificación excepcional de cuentas de retiro

## Hallazgo sobre Wompi

La integración actualmente usada por GlowApp crea dispersiones Wompi a cuentas bancarias tradicionales. La documentación pública describe controles que se aplican al procesar una dispersión y advierte que algunos bancos exigen que el beneficiario coincida con el titular; no documenta un endpoint previo para consultar la titularidad de cualquier cuenta tradicional. Wompi sí documenta una resolución de titular para llaves BRE-B en una API v2 separada. Esa capacidad no valida cuentas bancarias tradicionales.

Wompi ofrece sandbox para probar BRE-B, de modo que la integración puede desarrollarse y validarse antes de producción. El sandbox no habilita automáticamente el backend actual: GlowApp usa Pagos a Terceros v1 para cuentas bancarias, mientras BRE-B requiere un cliente v2, configuración sandbox explícita y manejo de eventos de payouts. La disponibilidad contractual de BRE-B y las credenciales productivas se revisarán antes de pasar a producción. Los requisitos y brechas están detallados en [WOMPI_BREB_SANDBOX_INTEGRACION.md](WOMPI_BREB_SANDBOX_INTEGRACION.md).

## Flujo cuando hay una señal excepcional

1. La cuenta se revisa administrativamente como en la Fase 1. El equipo de Finanzas/Operaciones registra una causa permitida: diferencia de titular, rechazo de transferencia o revisión de seguridad.
2. El panel administrativo envía una solicitud al prestador y la audita. La decisión queda pendiente hasta que se cargue el soporte o se cancele/expire la solicitud.
3. El prestador adjunta JPG/PNG de hasta 1,5 MB. Debe mostrar titular, entidad y terminación de la cuenta; puede ocultar saldos y movimientos. No se solicitan claves, códigos ni extractos completos.
4. El contenido se procesa para quitar metadatos de la imagen y se cifra con AES-256-GCM usando `PAYOUT_DATA_ENCRYPTION_KEY`; además, se liga mediante HMAC a la cuenta revisada. Si los datos de la cuenta cambian, la solicitud deja de servir.
5. Solo el equipo administrativo puede consultar el archivo; esa lectura queda auditada y la respuesta no se almacena en caché. Al resolver la cuenta, el archivo se conserva hasta 30 días desde la revisión; si no se resuelve, se elimina 30 días después de la carga. Una solicitud sin carga expira a los 7 días.
6. El job horario elimina el contenido cifrado vencido. Se conservan los metadatos mínimos de estado y auditoría, nunca el archivo.

## Responsabilidad operativa

- **Responsable:** equipo de Finanzas/Operaciones con acceso administrativo autorizado.
- **Plazo objetivo:** hasta 48 horas calendario, configurable con `payout_account_review_sla_hours`.
- **Criterio de resolución:** comparar titular y datos visibles del soporte con los datos registrados. La app no declara que esta comprobación equivalga a una confirmación bancaria.
- **Cancelación y caducidad:** el administrador puede cancelar una solicitud pendiente; también expira automáticamente a los 7 días.

## Métricas

El panel muestra ventanas móviles de 90 días: inicios de formulario, envíos, abandonos, solicitudes de soporte, rechazos administrativos, fallos de transferencia y tiempo medio entre envío y revisión. Solo hay datos desde la instrumentación de esta fase; no se reconstruye historial anterior. Las tasas derivadas deben calcularse sobre `submitted / starts` y `abandoned / starts`, excluyendo sesiones abiertas aún no vencidas.

## Prerrequisitos de operación

- Desplegar primero la migración 187 y asegurar que `PAYOUT_DATA_ENCRYPTION_KEY` esté configurada y sea la misma clave protegida usada para el resto de datos de retiro.
- Verificar en Railway que el job horario esté activo; revisar el registro de ejecución y el borrado al vencer la retención.
- BRE-B sandbox puede integrarse en una etapa separada con credenciales y URL v2 sandbox. Antes de cambiar retiros reales a BRE-B, confirmar con Wompi la habilitación contractual y configurar por separado las credenciales productivas.
