# Revisión de botones de Perfil — tareas pendientes

## Flujo acordado

- El usuario revisará los botones y describirá qué hacen.
- Agregar a esta lista únicamente los hallazgos que el usuario marque como tarea a corregir.
- No implementar correcciones durante la etapa de revisión.
- Al recibir una solicitud para resolver un grupo, corregir juntas solo las tareas de ese grupo y verificar el resultado.

## Hallazgos observados

## Tareas confirmadas para corregir

1. **Autenticación Biométrica en Configuración de la Cuenta:** hacer funcional el interruptor; actualmente solo cambia el estado visual local y no solicita Face ID/huella, no persiste la preferencia ni modifica el inicio de sesión.
2. **Notificaciones Push en Configuración de la Cuenta:** quitar este botón del menú, según lo solicitado.
3. **Novedades y Novedades Luxe:** hacer que el interruptor controle un sistema real de boletines por correo. Crear el flujo de envío usando la preferencia `marketing_enabled` para respetar el consentimiento del usuario.
4. **Telemetría Anónima de Uso:** quitar el interruptor y preparar herramientas de medición internas consultables mediante API, con puntos de integración para un dashboard de control futuro. No crear el dashboard.
5. **Solicitud de supresión de datos ARCO:** crear el flujo integral de ticket desde la radicación hasta la resolución y ejecución de la supresión de datos, incluyendo seguimiento, plazos y evidencia auditable en base de datos que pueda sustentar una auditoría de la SIC. Documentar decisiones y excepciones de conservación legal/contractual cuando apliquen; no borrar evidencia mínima necesaria para demostrar la atención de la solicitud.
6. **Consentimiento y Habeas Data biométrico:** alinear el consentimiento sensible a Ley 1581/2012 y Decreto 1074/2015 (previo, explícito, informado, prueba consultable; opción facultativa; derechos y finalidades claras), exigir reconsentimiento si cambia la versión, corregir estado de revocación/supresión y crear API restringida para auditoría/documentación consultable por dashboard, con minimización de datos y evidencia inmutable.
7. **Centro de Soporte y PQRSF:** corregir lo necesario para que los campos y adjuntos se radiquen correctamente, que los casos —incluidas solicitudes ARCO— queden en una bandeja administrativa gestionable y que el sistema no prometa notificaciones que no envía.

## Ejecución del grupo

Las siete tareas quedaron implementadas en la rama local `staging`. La revisión fue estática (formateo Dart, resolución de dependencias, `node --check` y `git diff --check`); no se ejecutaron pruebas automatizadas ni se desplegó. Las migraciones 131–134 y las variables de correo descritas en `docs/privacidad/flujo-arco-pqrsf.md` deben estar disponibles en el entorno para activar los flujos backend.

- Tarea 1: lista — autenticación local de Face ID/huella, con validación de la sesión JWT vigente.
- Tarea 2: lista — eliminado el interruptor push del menú; los avisos de citas siguen siendo parte del servicio.
- Tarea 3: lista — preferencia de marketing, consentimiento trazable y campañas reanudables por API admin.
- Tarea 4: lista — retirado el interruptor; captura minimizada y endpoint admin de agregados.
- Tarea 5: lista — ticket ARCO, verificación documentada, ejecución, redacción/anónimo y rastro append-only.
- Tarea 6: lista — autorización biométrica explícita/versionada, revocación y API de auditoría.
- Tarea 7: lista — formulario validado, cabecera de audiencia, adjuntos limitados, bandeja API y notificación honesta.

## Corrección posterior en staging

- Al probar «Solicitar Supresión de Datos (ARCO)», el API devolvió 500 porque Sequelize expandía el arreglo vacío de `evidencia_urls` dentro del SQL y dejaba un valor faltante. `ticketController` convierte ahora el JSON de evidencias a `TEXT[]` en PostgreSQL, incluido el caso sin adjuntos. El fallo SQL ocurre antes del INSERT, por lo que ese intento no creó un ticket parcial.
