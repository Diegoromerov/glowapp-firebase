# Auditoria cliente

| ID | Comprobacion | Estado | Evidencia |
|---|---|---|---|
| A1 | flutter analyze | **PASA** | 0 errores, 24 warnings, 359 infos |
| A2 | flutter test | **PASA** | 60 pruebas verdes |
| A3 | contrato app<->API | **PASA** | OK: todas las rutas usadas por las apps existen (330 publicadas) |
| B1 | errores crudos en UI | **FALLA** | 3 directos: apps/glow_client/lib/screens/otp_confirm_screen.dart:100, apps/glow_client/lib/screens/store_screen.dart:92, apps/glow_client/lib/screens/store_screen.dart:757 | 3 por variable: apps/glow_client/lib/screens/chat_list_screen.dart, apps/glow_client/lib/screens/chat_screen.dart, apps/glow_client/lib/screens/client_bookings_screen.dart |
| B2 | accesibilidad: etiquetas | **FALLA** | 8 Semantics, 19 tooltips, 46 IconButton en 29118 lineas |
| B3 | contraste de texto | **FALLA** | #D4AF37 2.10:1 x12, #E05A47 3.67:1 x3, #C88A68 2.88:1 x2, #F3E5AB 1.26:1 x1, #E58C73 2.52:1 x1 |
| B4 | tema del sistema / reduce-motion | **PARCIAL** | themeMode fijo en light: darkTheme es codigo muerto |
| B5 | debugPrint (no visible en release) | **PARCIAL** | 34 llamadas |
| B6 | permisos declarados (release) | **PASA** | INTERNET, CAMERA, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, POST_NOTIFICATIONS, USE_BIOMETRIC |
| B7 | deep links | **PARCIAL** | servicio + host montados; falta prueba cold/warm en dispositivo |
| B8 | i18n | **N/V** | sin l10n.yaml: es-CO hardcodeado, 'en' declarado e inalcanzable |
| C1 | metadatos de marca | **PARCIAL** | title='glow_client' desc='A new Flutter project.' |
| C2 | secretos en el bundle | **PASA** | 5.18 MB, 0 claves Google |
| C3 | Firebase inicializable en el build | **FALLA** | sin apiKey el try/catch de main.dart:89 apaga Firebase: push y Firestore muertos |
| C4 | bundle desplegado == build local | **PASA** | identicos |
| C5 | peso del bundle | **PARCIAL** | main.dart.js 5.18 MB (+ canvaskit desde gstatic) |
| C6 | cabeceras del sitio | **PASA** | HSTS si, COOP si, CSP no (P-091) |
| D1 | politica de privacidad | **PASA** | HTTP 200, 5052 B |
| D2 | pagina de borrado de cuenta | **PASA** | HTTP 200, 3021 B |
| D3 | terminos publicados | **FALLA** | HTTP 200, 1556 B (shell del SPA, no la pagina) |
| E1 | /api/health sin X-App-Audience | **PASA** | HTTP 200 commit 78fb1070 |
| E2 | catalogo /api/providers | **PASA** | HTTP 200, count=3 |
| E3 | catalogo /api/products | **FALLA** | HTTP 200, count=0: GlowShop queda vacio en la app |
| E4 | analitica/crash anonimos | **FALLA** | POST sin token -> HTTP 401: el embudo anonimo y los crashes sin sesion se pierden |
| E5 | feature flags | **PASA** | GET /api/config/flags -> 200 |
| F1 | CI de apps | **FALLA** | ultima: failure en codex/remove-home-aura-button @ 2026-11-08T13:14:46Z (workflow manual: no corre en push) |
