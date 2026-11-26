# Onboarding SaaS — Fase 5: Puesta en marcha operativa

**Corte:** 26 de noviembre de 2026  
**Avance estimado:** 80 %; integrado en `main` y desplegado a producción. Falta validar el flujo de reserva y atención de extremo a extremo.

## Objetivo y criterio de cierre

Guiar al salón desde su configuración hasta su primera operación. La fase se cierra cuando un cliente crea una reserva, esta aparece en la agenda correcta y el prestador completa la atención dentro del sistema.

## Hallazgos previos

- La pestaña Agenda del shell SaaS ya consultaba las reservas del salón activo.
- Si no había citas, mostraba solo un mensaje informativo, sin guiar a la persona propietaria a completar la puesta en marcha.
- Servicios disponía de una instrucción básica para crear el primer servicio.
- La agenda del dashboard del prestador ya tenía filtros y acciones para operar reservas, pero el acceso desde el shell SaaS no abría esa pestaña directamente y su consulta no recibía el identificador del salón.

## Trabajo implementado en el checkout local

1. El estado vacío de Agenda ahora presenta cuatro pasos: revisar el perfil del salón, configurar disponibilidad semanal, publicar un servicio y recibir una reserva desde GlowApp.
2. Cada paso dirige a su pantalla existente. La guía ofrece un acceso a «Ver cómo atender citas».
3. `ProviderDashboardScreen` acepta una pestaña inicial y un `salonId`; el acceso de la guía abre la Agenda y solicita las reservas con el salón activo.
4. La guía comunica que la reserva se genera desde la app del cliente; no simula ni crea citas desde la app del prestador.

## Evidencia y límites

- Archivos modificados: `apps/glow_provider/lib/screens/salon/salon_shell.dart` y `apps/glow_provider/lib/screens/provider/provider_dashboard_screen.dart`.
- Validación estática: `flutter analyze --no-pub --no-fatal-infos --no-fatal-warnings` terminó correctamente conforme a la configuración del proyecto. El análisis reportó numerosos avisos e informaciones de lint en la app (1.345 en total), incluidos avisos preexistentes; no se reportaron errores fatales.
- Suite existente previa: `flutter test` terminó correctamente con **15/15 pruebas**. Prueba focalizada nueva `salon_shell_first_operation_test.dart`: **2/2**; comprueba los pasos visibles/navegación y que no se abra una agenda si falta el salón.
- PR #90, merge commit `0676e3d5817902b8a6b2c9016ba4920da2b2a728`.
- CI de push `45751393943`: `success`.
- Workflow de despliegue `45751654219`: build web de `glow_provider` y publicación Firebase live finalizaron `success`.
- Smoke productivo: el hosting y `main.dart.js` devolvieron HTTP 200. El bundle contiene el texto de la guía y `x-active-salon-id`.
- Durante la revisión de las mutaciones de agenda se detectó que el listado recibía `salonId`, pero iniciar/completar dependía del store global de sede activa. PR #92 fijó ese contexto en el shell y rechazó IDs ausentes o inválidos; commit `ab003eae203740921f28d2ee1ea99459ea75e522`. CI push `45753120632` y despliegue live `45753408944` terminaron `success`.
- Smoke de la versión corregida: portada y `main.dart.js` HTTP 200, bundle con guía, validación del ID y encabezado de sede; `Last-Modified: Thu, 26 Nov 2026 04:13:37 GMT`.
- Validación visual autenticada posterior en la cuenta QA del propietario: la guía de primera operación aparece con sus cuatro pasos y «Ver cómo atender citas» abre «Mi Agenda Pro», con filtros y lista vacía. Una primera vista conservó el mensaje vacío anterior; tras recargar la app apareció la versión desplegada con la guía. No se creó ni modificó ninguna cita.
- En esa revisión se detectó que el encabezado de la agenda contaba `_bookings.length` pero decía «servicios registrados». Se corrigió localmente a «citas registradas»; ese texto requiere CI y despliegue antes de considerarlo corregido en producción.
- La corrección de etiqueta se validó localmente con `flutter test test/salon_shell_first_operation_test.dart` (**2/2**) y análisis focalizado del dashboard (exit code 0; informa 135 lints preexistentes en el archivo, sin errores fatales). El cambio se encuentra en rama `codex/fase5-agenda-copy-live-qa`; aún no está en `main` ni desplegado.
- La cuenta QA entregada es del propietario del salón y permite verificar la navegación del prestador, pero no representa una identidad cliente distinta para reservar desde la app Cliente. Por eso no se insertó una cita persistente.
- La verificación de reservas se debe completar con una cuenta cliente de QA distinta y una cita de prueba controlada, incluyendo la confirmación/inicio y el cierre de la atención según los controles disponibles.

## Pendientes para cerrar la fase

- Ejecutar el recorrido autenticado Cliente → reserva → agenda del salón y comprobar que la cita pertenece al `salonId` correcto.
- Completar el flujo de atención de la cita y registrar evidencia de los estados antes/después.
- Limpiar o cancelar la cita de prueba con el mecanismo normal de la app, si el estado final lo permite.

**Estado:** abierta. El 80 % estimado corresponde a guía, enlaces y agenda operativa publicados; no representa la validación del criterio E2E de cierre.
