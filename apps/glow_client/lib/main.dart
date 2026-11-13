// GlowApp Client - App Usuario (app.glowapp.com)
// Entry point para la aplicación del cliente final

import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart' hide AppUpdateGate;
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/crash_reporting_service.dart';
import 'firebase_options.dart';
import 'services/deep_link_service.dart';
import 'services/push_service.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/invite_welcome_screen.dart';
import 'screens/auth/forgot_password_screen.dart';
import 'screens/auth/verification_pending_screen.dart';
import 'screens/provider_detail_screen.dart';
import 'screens/providers_screen.dart';
import 'screens/client_bookings_screen.dart';
import 'screens/chat_list_screen.dart';
import 'screens/chat_screen.dart';
import 'screens/store_screen.dart';
import 'screens/disputes_list_screen.dart';
import 'screens/open_dispute_screen.dart';
import 'screens/support_center_screen.dart';
import 'screens/create_ticket_screen.dart';
import 'screens/ticket_chat_screen.dart';
import 'screens/terms_conditions_screen.dart';
import 'screens/privacy_policy_screen.dart';
import 'screens/account_deletion_screen.dart';
import 'screens/user_profile.dart';
import 'screens/my_glow_dashboard_screen.dart';
import 'screens/invite_friends_screen.dart';
import 'screens/rewards_xp_screen.dart';
import 'screens/niveles_screen.dart';
import 'screens/programa_puntos_screen.dart';
import 'screens/glowstore_orders_screen.dart';
import 'screens/biometric_history_screen.dart';
import 'screens/booking_screen.dart';
import 'screens/booking_tracking_screen.dart';
import 'screens/habeas_data_screen.dart';
import 'screens/faq_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/aura_welcome_screen.dart';
import 'screens/capture_screen.dart';
import 'screens/evolution_screen.dart';
import 'screens/glowstore_recipe_screen.dart';
import 'screens/makeup_lookbook_screen.dart';
import 'screens/nail_vto_screen.dart';
import 'screens/processing_screen.dart';
import 'screens/results_screen.dart';
import 'screens/vto_live_screen.dart';
import 'screens/welcome_screen.dart';
import 'widgets/audience_toggle.dart';
import 'widgets/deep_link_host.dart';
import 'glowguide/glow_guide_host.dart';
import 'package:glow_core/glowguide/config/client_guide.dart';
import 'app_keys.dart';
import 'widgets/app_update_gate.dart';

void main() async {
  // El enlace compartido llega en la URL de la pestaña. Hay que guardarlo antes
  // de `ensureInitialized()`: el router escribe `/#/home` enseguida y el path
  // del enlace se pierde.
  DeepLinkService.capturarUrlDeArranque();

  WidgetsFlutterBinding.ensureInitialized();

  // Ítem 56 — NO forzar el árbol de semántica.
  //
  // Se probó y hubo que revertirlo: con `ensureSemantics()` en web, Flutter
  // crea capas `flt-semantics` por encima de todo y se comen los clics sobre
  // los platform views. El botón de Google (iframe de GIS) quedó inservible:
  // el cursor ni siquiera lo detectaba. Se deja el comportamiento por defecto
  // (el usuario activa accesibilidad con el enlace de Flutter), que es el
  // patrón soportado.

  // Red de errores: sin esto, un build que revienta deja una caja gris y nadie
  // se entera. El codigo que se muestra es el correlation id que viaja al
  // backend como X-Trace-Id.
  await CrashReportingService.instance.init();
  FlutterError.onError = (details) {
    FlutterError.presentError(details); // sigue saliendo en la consola
    unawaited(CrashReportingService.instance.reportFlutterError(details));
  };
  // Errores asíncronos fuera del árbol de widgets (futuros sin catch, isolates):
  // FlutterError no los ve y hasta ahora se perdían sin dejar rastro.
  PlatformDispatcher.instance.onError = (error, stack) {
    unawaited(CrashReportingService.instance.reportFlutterError(
      FlutterErrorDetails(exception: error, stack: stack, library: 'platform'),
    ));
    return true;
  };
  ErrorWidget.builder = (details) => ErrorFallback(
        codigo: details.exception
            .toString()
            .hashCode
            .toRadixString(16)
            .toUpperCase(),
      );

  // Inicializar Firebase (solo si está configurado)
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (_) {
    // Firebase no configurado en este build
  }

  // Inicializar servicios core
  await AudienceService.init();

  // Una sola lectura del almacén cifrado para saber si hay sesión. Con el cache
  // en memoria, las puertas de acción no dependen de una lectura lenta en web.
  await AuthService.hidratarSesion();

  // Push (FCM, gratuito): si ya hay sesión se registra el dispositivo. Es
  // best-effort: sin permiso o sin red la app arranca igual.
  if (await AuthService.getToken() != null) {
    unawaited(PushService.iniciar());
  }

  // Configurar audiencia de la app para backend (Fase 4).
  // Explicito: el backend exige X-App-Audience en todo /api y AuthService
  // toma el valor de aqui. Antes dependia del default 'client' de ApiService.
  ApiService.appAudience =
      const String.fromEnvironment('APP_AUDIENCE', defaultValue: 'client');

  // GlowGuide: un solo engine para toda la app, con su propio navigatorKey.
  // Los pasos ejecutan `navigate(route:)` y el presenter se pinta encima del
  // Navigator (ver GlowGuideHost), asi el video sigue visible mientras el guide
  // recorre las secciones.
  // Banderas de función (ítem 80): se piden una vez al arrancar y no bloquean.
  // Si falla, FeatureFlags queda fail-open: todo encendido.
  unawaited(FeatureFlags.instance.cargar(
    obtener: () => ApiService.get('/api/config/flags'),
  ));

  GlowGuideService.instance.initialize();
  // Con una invitación en la URL el tour no arranca: se pinta encima y tapa
  // justo la pantalla de bienvenida que la persona vino a ver.
  final codigoInvitacion = codigoInvitacionDeLaUrl(Uri.base);
  if (codigoInvitacion == null || codigoInvitacion.isEmpty) {
    GlowGuideService.instance.createEngine(
      steps: ClientGuide.steps,
      guideId: ClientGuide.guideId,
    );
  }

  runZonedGuarded(
    () => runApp(const ProviderScope(child: GlowClientApp())),
    (error, stack) {
      unawaited(CrashReportingService.instance.reportAsyncError(error, stack));
    },
  );

  // El enlace de invitación llega como `/register?ref=CODIGO` (o el formato
  // viejo con `#`). La app abre en el inicio y aquí se empuja la ruta que pedía
  // la URL: en `initialRoute` no funcionaba, porque la pila inicial se resuelve
  // antes de que el Navigator exista y la invitada quedaba en el mapa.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    final nav = GlowGuideService.instance.navigatorKey.currentState;
    if (nav == null) return;
    final codigo = codigoInvitacionDeLaUrl(Uri.base);
    if (codigo != null && codigo.isNotEmpty) {
      nav.pushNamed('/bienvenida-invitacion');
      return;
    }
    final ruta = rutaDeArranque();
    if (ruta == '/home') return;
    nav.pushNamed(ruta);
  });
}

/// Ruta con la que debe abrir la app.
///
/// Prioriza lo que venga en la URL —el `#/register?ref=...` de una invitación o
/// el `/provider-detail/3` de una ficha compartida— y cae en `/home` cuando no
/// hay ninguna, que es el modo exploración normal.
String rutaDeArranque([Uri? url]) {
  final base = url ?? Uri.base;

  // La ruta limpia manda: es el formato del enlace nuevo (`/register?ref=...`).
  // Importa el orden porque Flutter, al arrancar, añade su propio `#/home` al
  // final de la URL: leer el fragmento primero devolvía `/home` y la invitada
  // se quedaba en el mapa aunque la ruta estuviera ahí al principio.
  final ruta = base.path.trim();
  final esRaiz = ruta.isEmpty || ruta == '/' || ruta == '/index.html';
  if (!esRaiz) return ruta;

  // Formato viejo, con almohadilla: `/#/register?ref=...`.
  final fragmento = base.fragment.trim();
  if (fragmento.startsWith('/')) return fragmento;

  return '/home';
}

class GlowClientApp extends ConsumerWidget {
  const GlowClientApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final audienceMode = ref.watch(audienceModeProvider);
    final isMen = audienceMode == AudienceMode.men;

    return MaterialApp(
      title: 'GlowApp',
      debugShowCheckedModeBanner: false,
      navigatorKey: GlowGuideService.instance.navigatorKey,
      scaffoldMessengerKey: rootMessengerKey,
      // El guide se monta encima del Navigator: es lo que le permite navegar la
      // app sin desaparecer. Dentro de una pantalla, la ruta nueva lo tapaba.
      builder: (context, child) => Column(
        children: [
          // Ítem 21: la franja solo ocupa alto cuando de verdad no hay red.
          const FranjaConexion(),
          Expanded(
            // Ítem 79: la política de versión mínima la publica /api/health y
            // existía AppUpdateGate, pero no estaba montado en ninguna parte:
            // el backend podía exigir una versión y la app nunca se enteraba.
            // Es fail-open: si el chequeo falla, no bloquea el arranque.
            child: AppUpdateGate(
              navigatorKey: GlowGuideService.instance.navigatorKey,
              child: DeepLinkHost(
                child: GlowGuideHost(child: child ?? const SizedBox.shrink()),
              ),
            ),
          ),
        ],
      ),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        // Sin este delegate, `AppLocalizations.of(context)` devuelve null y las
        // pantallas que lo usan con `!` (register) revientan en build: en web
        // release eso se ve como una pantalla gris.
        AppLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('es'),
        Locale('en'),
      ],
      locale: const Locale('es'),
      // Regla del Director: las pantallas se ven CLARAS en todo momento; la
      // única excepción es el selector Hombres, cuya interfaz entera es oscura.
      // Antes estaba en `ThemeMode.system`, así que un móvil con el sistema en
      // oscuro teñía la app: los campos de formulario tomaban `surfaceLevel0`
      // (#0A0C10) dentro de tarjetas fijas en blanco — campos negros sobre
      // tarjeta clara. Fijar `ThemeMode.light` cierra esa vía.
      //
      // El modo Hombres no usa `darkTheme`: con `ThemeMode.light` nunca se
      // aplicaría. Se le pasa su tema oscuro como tema BASE, con
      // `Brightness.dark`, porque `Token.of` resuelve la paleta por brillo; con
      // brillo claro los componentes de Hombres tomarían la gama clara y
      // quedarían mezclados sobre el fondo obsidiana.
      theme: isMen ? _buildMensDarkTheme() : AppTheme.light(),
      themeMode: ThemeMode.light,
      // La app abre en modo exploración: el catálogo, el mapa y el detalle de
      // cada prestador se ven sin cuenta. La identificación se pide en la
      // acción concreta (reservar, comprar, Glow IA+) vía AuthGate, no al entrar.
      // La app abre siempre en el modo exploración y, si la URL pedía otra
      // ruta, se empuja después del primer frame (ver `_abrirRutaDeLaUrl`).
      // Pasar la ruta a `initialRoute` no servía: Flutter resuelve la pila
      // inicial antes de que el Navigator exista y se quedaba en el inicio.
      initialRoute: '/home',
      routes: <String, WidgetBuilder>{
        // Auth
        // Las cuatro pantallas de acceso van SIEMPRE claras: su hero y sus
        // tarjetas son de marca clara, y con el tema oscuro de Hombres los campos
        // (que sí resuelven por token) quedaban negros sobre tarjeta blanca.
        '/auth/login': (_) => _authSiempreClaro(const LoginScreen()),
        '/auth/register': (_) => _authSiempreClaro(const RegisterScreen()),
        // Compatibilidad con enlaces antiguos: la app cliente ya no requiere
        // el onboarding de negocio y aterriza directamente en el catálogo.
        '/auth/onboarding': (_) => const ProvidersScreen(),
        '/auth/forgot-password':
            (_) => _authSiempreClaro(const ForgotPasswordScreen()),
        '/auth/verification-pending':
            (_) => _authSiempreClaro(const VerificationPendingScreen()),

        // Home / Navegación principal
        '/home': (_) => const ProvidersScreen() as Widget,

        // Bienvenida de una invitación: se ve ANTES del inicio, con el código
        // ya puesto. Al continuar guarda el código y sigue al inicio normal.
        '/bienvenida-invitacion': (_) => const InviteWelcomeScreen(),

        // Mis Reservas
        '/my-bookings': (_) => const ClientBookingsScreen(),

        // Chat
        '/chat': (_) => const ChatListScreen(),

        // GlowStore
        '/store': (_) => const StoreScreen(),

        // Disputas
        '/disputes': (_) => const DisputesListScreen(),
        '/disputes/open': (_) => const OpenDisputeScreen(),

        // Soporte
        '/support': (_) => const SupportCenterScreen(),
        '/support/create': (_) => const CreateTicketScreen(),
        '/terms': (_) => const TermsConditionsScreen(),
        '/privacy': (_) => const PrivacyPolicyScreen(),
        '/delete-account': (_) => const AccountDeletionScreen(),

        // Perfil
        '/profile': (_) => const UserProfileScreen(),
        '/my-glow': (_) => const MyGlowDashboardScreen(),
        '/rewards': (_) => const RewardsXpScreen(),
        '/niveles': (_) => const NivelesScreen(),
        '/programa-puntos': (_) => const ProgramaPuntosScreen(),
        '/invite': (_) => const InviteFriendsScreen(),
        '/glowstore-orders': (_) => const GlowStoreOrdersScreen(),
        '/biometric-history': (_) => const BiometricHistoryScreen(),
        '/habeas-data': (_) => const HabeasDataScreen(),
        '/faq': (_) => const FaqScreen(),
        '/settings': (_) => const SettingsScreen(userEmail: '', onLogout: null),

        // Ideas / Contenido - solo las que no requieren parámetros obligatorios
        '/ideas/welcome': (_) => const BiometricWelcomeScreen(),
        '/ideas/aura-welcome': (_) => const AuraWelcomeScreen(),
        '/ideas/capture': (_) => const CaptureScreen(),
      },
      onGenerateRoute: (settings) {
        // La query no forma parte de la ruta. El enlace de invitación llega
        // como `#/register?ref=GLOW927E`, y ese `?ref=` hacía que ningún `case`
        // coincidiera: caía en `default`, que devolvía null, y el Navigator
        // lanzaba «Null check operator used on a null value» dejando la
        // pantalla en blanco. De ahí venía también que el enlace nunca abriera
        // el formulario de registro.
        final nombre = (settings.name ?? '').split('?').first;
        switch (nombre) {
          case '/register':
            return MaterialPageRoute(
              builder: (_) => const RegisterScreen(),
              settings: settings,
            );
          case '/chat/detail':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => ChatScreen(
                partnerId: args?['partnerId'] ?? '',
                partnerName: args?['partnerName'] ?? '',
                partnerRole: args?['partnerRole'] ?? '',
                partnerAvatar: args?['partnerAvatar'],
                initialMessage: args?['initialMessage'],
                initialImagePath: args?['initialImagePath'],
              ),
            );
          case '/support/ticket':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => TicketChatScreen(
                ticketId: args?['ticketId'] ?? '',
                ticketSubject: args?['ticketSubject'] ?? '',
                ticketStatus: args?['ticketStatus'] ?? '',
              ),
            );
          // Ideas / Contenido - pantallas que requieren parámetros obligatorios
          case '/ideas/evolution':
            return MaterialPageRoute(builder: (_) => const EvolutionScreen());
          case '/ideas/glowstore-recipe':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => GlowstoreRecipeScreen(
                onAddToCart: args?['onAddToCart'],
                onCheckout: args?['onCheckout'],
              ),
            );
          case '/ideas/makeup-lookbook':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => MakeupLookbookScreen(
                biometricResult: args?['biometricResult'],
              ),
            );
          case '/ideas/nail-vto':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => NailVtoScreen(
                biometricResult: args?['biometricResult'],
                handsImage: args?['handsImage'],
              ),
            );
          case '/ideas/processing':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => ProcessingScreen(
                faceImage: args?['faceImage'],
                handsImage: args?['handsImage'],
                geometry: args?['geometry'],
              ),
            );
          case '/ideas/results':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => ResultsScreen(
                result: args?['result'],
              ),
            );
          case '/ideas/vto-live':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => VtoLiveScreen(
                biometricResult: args?['biometricResult'],
                faceImage: args?['faceImage'],
              ),
            );
          // Stubs para pantallas no implementadas aun
          case '/booking':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => BookingScreen(
                providerId: (args?['providerId'] ?? '').toString(),
                providerName: (args?['providerName'] ?? 'Prestador').toString(),
                services: ((args?['services'] as List?) ?? const [])
                    .map((e) => Map<String, dynamic>.from(e as Map))
                    .toList(),
                initialServiceId: args?['initialServiceId']?.toString(),
                initialNotes: args?['initialNotes']?.toString(),
                initialAddress: args?['initialAddress']?.toString(),
                preselectedProductId: args?['preselectedProductId']?.toString(),
              ),
            );
          case '/booking-tracking':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => BookingTrackingScreen(booking: args ?? const {}),
            );
          // Un enlace compartido puede llegar como `/provider-detail/3`: el id
          // viene en el nombre de la ruta, no en `arguments`. Antes caía en
          // `default` (null) y la pantalla abría con id vacío → petición a
          // `/api/providers/` y pantalla en blanco.
          case final String ruta when ruta.startsWith('/provider-detail'):
            final args = settings.arguments as Map<String, dynamic>?;
            final partes =
                ruta.split('/').where((p) => p.isNotEmpty).toList();
            final idDeLaRuta = partes.length > 1 ? partes.last : '';
            return MaterialPageRoute(
              builder: (_) => ProviderDetailScreen(
                providerId: (args?['providerId'] ?? idDeLaRuta).toString(),
                nombreInicial: args?['providerName']?.toString(),
                avatarInicial: args?['avatarUrl']?.toString(),
              ),
            );
          default:
            // Antes: `return null`, que hace que el Navigator lance y la app
            // quede en blanco con cualquier ruta no listada. Una ruta
            // desconocida ahora cae en el inicio, que es preferible a no ver
            // nada.
            return MaterialPageRoute(
              builder: (_) => const ProvidersScreen(),
              settings: settings,
            );
        }
      },
    );
  }
}

// Las pantallas de acceso se ven SIEMPRE claras, también con el selector
// Hombres activo. Sus tarjetas y su hero son de marca clara, mientras los campos
// resuelven `Token.of` por brillo: sin este envoltorio, en Hombres la tarjeta
// seguía blanca y los campos se pintaban obsidiana (relleno #0A0C10).
// Se aplica en la ruta, que es el único punto por el que se abren las cuatro.
Widget _authSiempreClaro(Widget child) => Theme(
      data: AppTheme.light(),
      child: child,
    );

// El tema "Hombres claro" se retiró junto con `ThemeMode.system`: declaraba
// Brightness.light sobre fondo obsidiana, así que `Token.of` devolvía la gama
// clara y los componentes quedaban mezclados. Hombres usa `_buildMensDarkTheme`.
ThemeData _buildMensDarkTheme() {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: const ColorScheme.dark(
      primary: MensTheme.champagneGoldLight,
      onPrimary: MensTheme.obsidianBg,
      secondary: MensTheme.bronzeAccent,
      onSecondary: MensTheme.obsidianBg,
      surface: MensTheme.obsidianCard,
      onSurface: MensTheme.textPrimary,
      surfaceContainerHighest: MensTheme.obsidianCardHover,
      outline: MensTheme.textMuted,
      outlineVariant: MensTheme.textMuted,
      error: Colors.redAccent,
      onError: Colors.white,
    ),
    scaffoldBackgroundColor: MensTheme.obsidianBg,
    cardColor: MensTheme.obsidianCard,
    dividerColor: MensTheme.textMuted,
    appBarTheme: const AppBarTheme(
      backgroundColor: MensTheme.obsidianCard,
      foregroundColor: MensTheme.textPrimary,
      elevation: 0,
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: MensTheme.obsidianCard,
      selectedItemColor: MensTheme.champagneGoldLight,
      unselectedItemColor: MensTheme.textMuted,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
  );
}

// Pantalla stub temporal
class _StubScreen extends StatelessWidget {
  final String title;
  const _StubScreen({required this.title});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.construction, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            const Text('Pantalla en desarrollo',
                style: TextStyle(color: Color(0xFF6F5F4E))),
          ],
        ),
      ),
    );
  }
}

// Provider para AudienceMode (ValueNotifier wrapper)
final audienceModeProvider =
    StateNotifierProvider<AudienceModeNotifier, AudienceMode>((ref) {
  return AudienceModeNotifier();
});

class AudienceModeNotifier extends StateNotifier<AudienceMode> {
  AudienceModeNotifier() : super(AudienceService.currentAudience.value) {
    AudienceService.currentAudience.addListener(_onChange);
  }

  void _onChange() {
    state = AudienceService.currentAudience.value;
  }

  @override
  void dispose() {
    AudienceService.currentAudience.removeListener(_onChange);
    super.dispose();
  }
}
