/// Servicios de red de GlowApp.
///
/// Biblioteca pública acotada: expone solo los servicios, sin arrastrar el tema
/// ni los widgets. Existe para que las pantallas puedan usar `ApiService` sin
/// importar `lib/src/...` (que dispara `implementation_imports`) ni cargar el
/// barrel completo.
library;

export 'src/services/api_service.dart';
export 'src/services/api_error.dart';
export 'src/services/booking_selection.dart';
export 'src/services/analytics_service.dart';
export 'src/services/payload.dart';
