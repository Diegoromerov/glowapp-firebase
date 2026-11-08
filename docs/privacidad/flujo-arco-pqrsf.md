# Flujo ARCO y PQRSF

## Radicación y atención

1. Cliente o prestador radica desde el Centro de Soporte. El servidor valida tipo/categoría, longitud, cita asociada y hasta 3 imágenes JPEG, PNG o WebP (1,5 MB cada una; 4,5 MB por ticket).
2. El ticket queda en `tickets` y aparece en `GET /api/admin/tickets`, protegido para administradores. Si `SUPPORT_INBOX_EMAIL` y Brevo/SMTP están configurados, se notifica a soporte; de otro modo queda disponible en la API. El cliente recibe el número de ticket y puede consultar el hilo en `GET /api/tickets/my-tickets`.
3. El operador contesta por el endpoint administrativo o por el hilo. La respuesta queda en `ticket_mensajes`; se intenta notificar al correo solo con un proveedor real configurado y se devuelve `notification.status` con el resultado.
4. El detalle administrativo incluye `auditoria` y también se puede consultar en `GET /api/admin/tickets/:id/audit`. La bitácora no guarda el texto del mensaje.

## Supresión ARCO

1. El usuario abre la solicitud desde Configuración de Cuenta; se crea un ticket `ARCO_SUPRESION` consultable junto a sus demás solicitudes.
2. El operador recibe y verifica la identidad por su procedimiento documental. Después registra resultado, método y referencia interna del comprobante (sin cargar el documento) con `POST /api/admin/tickets/:id/arco/verify` y `{ "identity_verified": true, "verification_method": "DOCUMENTO", "verification_reference": "CASE-2026-0001" }`.
3. Solo entonces puede ejecutar `POST /api/admin/tickets/:id/arco/execute` con `{ "confirm": "SUPRIMIR_DATOS_VERIFICADOS" }`. El servidor borra datos biométricos conocidos, preferencias y token FCM, desactiva y anonimiza la cuenta, redacta otros hilos y evidencias de soporte y marca el ticket resuelto.
4. `suppression_manifest`, `ticket_workflow_audit` y `admin_audit_logs` conservan un rastro mínimo de fecha, actor, resultado y categorías afectadas. No conservan fotos, métricas biométricas, correo original ni texto/evidencias de soporte. El rastro en esta base no es inmutable ante el propietario/superusuario.
5. La ejecución no borra de forma indiscriminada registros financieros, de pagos, disputas o contratos que puedan estar sujetos a deberes de conservación. El manifiesto los declara como retenidos donde aplique. El responsable debe aprobar la matriz de retención y sus plazos; el código no inventa un plazo legal único.

## Rutas para integraciones administrativas

- `GET /api/admin/tickets` y `GET /api/admin/tickets/:id`: bandeja y detalle/hilo.
- `GET /api/admin/tickets/metricas` y `GET /api/admin/tickets/esquema`: SLA, volumen y opciones.
- `POST /api/admin/tickets/:id/arco/verify`, `POST /api/admin/tickets/:id/arco/execute`.
- `GET /api/admin/tickets/:id/audit`: eventos de ciclo de vida.

Todas requieren un JWT de administrador. Aún no hay interfaz administrativa propia en este repositorio; un dashboard puede consumir estas APIs. Las solicitudes no desaparecen de la cola si no se configuró correo.

## Plazos y operación

El código calcula para solicitudes ARCO el plazo que ya usa el proyecto (15 días hábiles), excluyendo festivos porque no hay calendario de festivos conectado. Se debe validar el cómputo y el punto inicial aplicable por tipo de solicitud con el responsable legal antes de tratarlo como un SLA normativo. La Ley 1581 distingue consultas de reclamos y fija reglas diferentes; revisar el caso concreto y la reglamentación vigente.

Antes de desplegar, aplicar en orden las migraciones 131–134. Configurar `SUPPORT_INBOX_EMAIL` más `BREVO_API_KEY` o credenciales SMTP para avisos; sin ello, operar la bandeja desde los endpoints protegidos.
