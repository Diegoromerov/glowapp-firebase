// GlowApp Client - App Usuario (app.glowapp.com)
// Entry point para la aplicación del cliente final

import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart' hide AppUpdateGate;
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/crash_reporting_service.dart';
import 'firebase_options.dart';
import 'services/push_service.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
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
import 'screens/rewards_xp_screen.dart';
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
import 'widgets/app_update_gate.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Ítem 56: en web el árbol de semántica arranca apagado y el lector de
  // pantalla solo lo enciende si el usuario encuentra el botón «activar
  // accesibilidad». Se deja activo desde el inicio para que la app se pueda
  // recorrer con lector sin ese paso previo.
  SemanticsBinding.instance.ensureSemantics();

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
  GlowGuideService.instance.createEngine(
    steps: ClientGuide.steps,
    guideId: ClientGuide.guideId,
  );

  runZonedGuarded(
    () => runApp(const ProviderScope(child: GlowClientApp())),
    (error, stack) {
      unawaited(CrashReportingService.instance.reportAsyncError(error, stack));
    },
  );
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
      // El guide se monta encima del Navigator: es lo que le permite navegar la
      // app sin desaparecer. Dentro de una pantalla, la ruta nueva lo tapaba.
      builder: (context, child) => Column(
        children: [
          // Ítem 21: la franja solo ocupa alto cuando de verdad no hay red.
          const FranjaConexion(),
          Expanded(
            child: DeepLinkHost(
              child: GlowGuideHost(child: child ?? const SizedBox.shrink()),
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
      theme: isMen ? _buildMensTheme() : AppTheme.light(),
      darkTheme: isMen ? _buildMensDarkTheme() : AppTheme.dark(),
      // El tema sigue al sistema: `darkTheme` existía y nunca se usaba porque
      // aquí estaba fijado en claro. El usuario que tiene el móvil en oscuro
      // veía la app encendida.
      themeMode: ThemeMode.system,
      // La app abre en modo exploración: el catálogo, el mapa y el detalle de
      // cada prestador se ven sin cuenta. La identificación se pide en la
      // acción concreta (reservar, comprar, Glow IA+) vía AuthGate, no al entrar.
      initialRoute: '/home',
      routes: <String, WidgetBuilder>{
        // Auth
        '/auth/login': (_) => const LoginScreen(),
        '/auth/register': (_) => const RegisterScreen(),
        // Compatibilidad con enlaces antiguos: la app cliente ya no requiere
        // el onboarding de negocio y aterriza directamente en el catálogo.
        '/auth/onboarding': (_) => const ProvidersScreen(),
        '/auth/forgot-password': (_) => const ForgotPasswordScreen(),
        '/auth/verification-pending': (_) => const VerificationPendingScreen(),

        // Home / Navegación principal
        '/home': (_) => const ProvidersScreen() as Widget,

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
        switch (settings.name) {
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
          case '/provider-detail':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => ProviderDetailScreen(
                providerId: (args?['providerId'] ?? '').toString(),
                nombreInicial: args?['providerName']?.toString(),
                avatarInicial: args?['avatarUrl']?.toString(),
              ),
            );
          default:
            return null;
        }
      },
    );
  }
}

// Mens ThemeData construido desde MensTheme constants
ThemeData _buildMensTheme() {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: const ColorScheme.light(
      primary: MensTheme.champagneGold,
      onPrimary: MensTheme.obsidianBg,
      secondary: MensTheme.champagneGoldLight,
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
      selectedItemColor: MensTheme.champagneGold,
      unselectedItemColor: MensTheme.textMuted,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
  );
}

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
