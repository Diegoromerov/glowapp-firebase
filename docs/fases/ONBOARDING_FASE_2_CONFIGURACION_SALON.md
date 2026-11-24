# Onboarding SaaS — Fase 2: configuración inicial del salón

**Estado:** backend y migración desplegados en producción; se completa la interfaz cliente en el cambio actual. Pendiente del despliegue del cliente y de pruebas de flujo autenticadas con cuentas QA.  
**Alcance:** recopilar y mantener los datos básicos, ubicación y horario comercial de una sede, y permitir completar su catálogo de servicios desde el módulo existente.

## Trabajo realizado

- El alta de salón ya captura nombre, identificación tributaria, dirección, ciudad, teléfono y ubicación en el mapa.
- El cambio actual añade al onboarding un editor opcional de horario general por día, guardado mediante el perfil de la sede después del bootstrap idempotente. El horario del establecimiento queda separado de la disponibilidad de cada profesional, que sigue en `perfiles_prestador.weekly_schedule`.
- Se agregó `salones.horario_atencion` como campo JSONB nullable mediante la migración aditiva 198. Una sede puede completar el horario después del registro.
- Se agregó `PATCH /api/salon/:salonId/profile`, protegido por autenticación y el guard de propietario/administrador. Valida los horarios, limita longitudes de campos y sincroniza nombre/ciudad con el perfil SaaS dentro de una transacción de sistema.
- `GET /api/salon/:salonId/profile` devuelve los datos y el horario de la sede seleccionada; evita confundirlos en cuentas con más de una sede.
- El cambio actual agrega desde «Más» una pantalla para editar nombre, identificación tributaria, ciudad, dirección, teléfono y horario sin crear otra sede. La pestaña «Servicios» del shell existente permite administrar el catálogo inicial.
- La actualización posterior al alta es repetible: si falla, el salón existente puede reabrir el perfil y guardar los datos sin volver a registrarse.

## Decisiones de alcance

- El horario aquí guardado es el horario comercial general. No reemplaza ni sobrescribe los horarios individuales del personal.
- Los datos tributarios y de ubicación pueden quedar incompletos durante el alta y completarse después.
- Los servicios se administran desde el catálogo ya existente del panel. Esta fase no crea servicios ficticios ni cambia las reglas existentes para publicar servicios.

## Evidencia comprobada en producción (24 de noviembre de 2026)

- Railway muestra el despliegue backend actual `84b580b6` como exitoso. `/api/health` responde `OK`, `dbMode=postgres`, `pgAvailable=true` y no usa datos de demostración.
- Los logs del despliegue `aa3efeb8` confirman que `198_salon_business_hours.sql` se aplicó exitosamente el 24 de noviembre a las 17:39 UTC. El API actual informa 71 migraciones registradas.
- Las rutas `GET /api/salon/1/profile` y `PATCH /api/salon/1/profile`, llamadas sin token y con `X-App-Audience: provider`, responden `401 UNAUTHORIZED`; no se modificaron datos de salones.
- El onboarding publicado respondió HTTP 200 antes de este cambio; el editor y el enlace al perfil aún requieren publicación del cliente.

## Pendiente para cerrar la fase

1. Integrar y publicar el cambio de cliente; la migración 198 y los endpoints backend ya están en producción.
2. Probar con una cuenta QA el alta con horario, la edición de una sede existente y la persistencia tras recargar.
3. Probar que un miembro que no sea propietario/administrador no puede modificar el perfil de otra sede.
4. Recorrer alta → pestaña «Servicios» → primer servicio y comprobar comportamiento ante reintento.
5. Revisar móvil y escritorio, siete días, días cerrados y validación de horas.

## Evidencia de esta ejecución

- El análisis Dart de las pantallas modificadas no encontró errores de compilación; reportó advertencias e informaciones preexistentes en archivos del cliente.
- El build web local terminó por falta de memoria del entorno (`Out of memory`), por lo que no se considera aprobado; se requiere el build de CI para completar la publicación.
- Las pruebas autenticadas de producción no se realizaron porque no hay una cuenta/tokens QA disponibles en este entorno. Las llamadas sin autenticación fueron de solo lectura o rechazadas antes de acceder a datos.
