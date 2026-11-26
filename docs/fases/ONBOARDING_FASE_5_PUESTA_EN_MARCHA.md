# Onboarding SaaS — Fase 5: Puesta en marcha operativa

**Corte:** 26 de noviembre de 2026  
**Avance estimado:** 85 %; integrado en `main` y desplegado a producción. Falta validar el flujo de reserva y atención de extremo a extremo.

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
- En esa revisión se detectó que el encabezado contaba `_bookings.length` pero decía «servicios registrados». PR #93 corrigió el texto a «citas registradas» y se integró en `main` como `782bf0950205981518bfb0032e2fc41acf7da553`.
- Validación local: `flutter test test/salon_shell_first_operation_test.dart` (**2/2**) y análisis focalizado del dashboard con exit code 0 (135 lints preexistentes informativos/advertencias, sin errores fatales). CI push `45756043645` terminó `success`; el workflow manual `45756346894` compiló y desplegó únicamente `glow_provider` a Firebase Hosting live con resultado `success`.
- Verificación posterior al despliegue en la sesión autenticada QA: recargué la app y abrí «Ver cómo atender citas». «Mi Agenda Pro» mostró exactamente «0 citas registradas en total» y el estado vacío de citas. Quedó comprobada la etiqueta corregida en producción, además de la guía y su navegación.
- Revisión de prerrequisitos de QA en producción, sin crear citas: el perfil del propietario indica **25 %** y **Verificación Pendiente**, con teléfono y bio vacíos. El horario se ve configurado de lunes a viernes 06:00–20:00, sábado 08:00–18:00 y domingo cerrado.
- El único servicio encontrado era «Servicio QA Fase 2 - No publicar QA • Reservas sin dato», precio **$0**, 30 min. El formulario lo mostraba activo/visible en el catálogo público. Se desactivó desde el panel para que no quedara como oferta pública de prueba; la lista confirmó **Activos (0)** e **Inactivos (1)**. No se alteró precio ni se publicó otro servicio.
- En la app Cliente, el catálogo público cercano mostró seis resultados y no mostró «QA Salón Fase 2». Esto es evidencia de esa búsqueda/localización, no prueba de ausencia global. El código de descubrimiento individual exige prestador activo y `estatus_verificacion = 'APROBADO'`; la inclusión como salón depende de `location_enabled`, `location_public` y del entitlement `MAP_VISIBILITY` del plan.
- Revisión de código: `GET /api/salon/my-salon` expone `can_show_on_map`, calculado con `location_enabled`, `location_public` y `MAP_VISIBILITY`. La guía ahora muestra el estado recibido y, si es falso, indica estos prerrequisitos. La interfaz no modifica ubicación ni plan.
- PR #94 se integró a `main` como **`0c34b77908de04dde17eaba4505c30478339f9ff`**. Workflow de producción **45758513947** terminó `success`: análisis/pruebas del proveedor aprobados, build web y publicación a Firebase Hosting `live` completados; cliente omitido.
- Smoke posterior al despliegue: `https://glowapp-provider.web.app/` y `main.dart.js` respondieron HTTP 200; el bundle (5.722.752 bytes) contiene `can_show_on_map` y ambos textos de estado (Dart los compila con secuencias escapadas). Última modificación observada: `Thu, 26 Nov 2026 05:02:14 GMT`.
- Validación local previa: prueba widget focalizada **3/3** aprobada; `flutter analyze --no-pub` terminó con código 0 y un aviso informativo preexistente por `withOpacity` en la línea 465 de `salon_shell.dart`.
- La cuenta entregada es del propietario: valida el lado prestador, pero no permite demostrar una reserva como cliente distinto. Además, no queda un servicio activo con precio apto para reservar. No se insertó ninguna cita ni se inició un flujo de pago.
- La verificación de reservas se debe completar con una cuenta cliente de QA distinta y una cita de prueba controlada, incluyendo la confirmación/inicio y el cierre de la atención según los controles disponibles.
- Auditoría del cierre detectó que `POST /api/payments/bookings/:id/confirm-otp` exigía `RECIBIR_RESERVAS` del prestador también al cliente autenticado. Como esa capacidad no aplica a `CLIENTE`, se bloqueaba la confirmación antes del chequeo de propiedad del OTP. PR #96 retiró solo esa compuerta de la ruta del cliente; se mantienen autenticación, propiedad `otp.client_id === req.user.id` y validación del código. La emisión del OTP continúa detrás de la capacidad del prestador.
- La prueba de regresión aprobó **2/2** localmente y en CI. Backend CI run **45760868633** terminó `success`, incluyendo contratos, PostgreSQL real, aislamiento multi-tenant y E2E del catálogo. PR #96 se integró a `main` como **`890f5798d3c552e7f2597d15bd0def072d51b92a`**. Railway confirmó `glowapp-api` en estado `SUCCESS` con ese commit (deploy `74588120-d3d3-4946-8fcf-363c4a9898c3`). No se confirmó OTP ni se creó una reserva productiva.

## Pendientes para cerrar la fase

- Ejecutar el recorrido autenticado Cliente → reserva → agenda del salón y comprobar que la cita pertenece al `salonId` correcto.
- Completar el flujo de atención de la cita y registrar evidencia de los estados antes/después.
- Preparar con datos aprobados una oferta de prueba reservable (precio mayor que cero y servicio activo/visible) y validar los requisitos de visibilidad del salón, sin publicar valores inventados.
- Obtener una identidad cliente QA distinta. Antes de confirmar el OTP final, definir que el recorrido usa instrumentos sandbox y controlar que no genere un asiento financiero real o irreversible en producción.
- Limpiar o cancelar la cita de prueba con el mecanismo normal de la app, si el estado final lo permite.

**Estado:** abierta. El 85 % estimado incluye la corrección publicada de autorización del OTP del cliente y sus pruebas; aún no demuestra una reserva del cliente ni la atención completa. Continúa pendiente preparar datos QA aptos y recorrer el criterio E2E de cierre.
