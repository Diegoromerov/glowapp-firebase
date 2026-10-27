// GlowApp Client - App Usuario (app.glowapp.com)
// Entry point para la aplicación del cliente final

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/services/api_service.dart';
import 'firebase_options.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/auth/onboarding_screen.dart';
import 'screens/auth/forgot_password_screen.dart';
import 'screens/auth/accept_invitation_screen.dart';
import 'screens/auth/verification_pending_screen.dart';
import 'screens/auth/context_selection_screen.dart';
import 'screens/auth/role_selection_modal.dart';
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
import 'screens/user_profile.dart';
import 'screens/my_glow_dashboard_screen.dart';
import 'screens/rewards_xp_screen.dart';
import 'screens/glowstore_orders_screen.dart';
import 'screens/biometric_history_screen.dart';
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
import 'widgets/app_update_gate.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
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
  
  runApp(const ProviderScope(child: GlowClientApp()));
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
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('es'),
        Locale('en'),
      ],
      locale: const Locale('es'),
      theme: isMen ? _buildMensTheme() : AppTheme.light(),
      darkTheme: isMen ? _buildMensDarkTheme() : AppTheme.dark(),
      themeMode: ThemeMode.light,
      initialRoute: '/auth/login',
            routes: <String, WidgetBuilder>{
              // Auth
              '/auth/login': (_) => const LoginScreen(),
              '/auth/register': (_) => const RegisterScreen(),
              '/auth/onboarding': (_) => const OnboardingScreen(),
              '/auth/forgot-password': (_) => const ForgotPasswordScreen(),
              '/auth/accept-invitation': (_) => const AcceptInvitationScreen(),
              '/auth/verification-pending': (_) => const VerificationPendingScreen(),
              '/auth/role-selection': (_) => const RoleSelectionModal(),

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
                case '/auth/context-selection':
                  final args = settings.arguments as Map<String, dynamic>?;
                  return MaterialPageRoute(
                    builder: (_) => ContextSelectionScreen(
                      availableContexts: args?['availableContexts'] ?? [],
                    ),
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
                  return MaterialPageRoute(builder: (_) => const _StubScreen(title: 'Reservar cita'));
                case '/booking-tracking':
                  final args = settings.arguments as Map<String, dynamic>?;
                  return MaterialPageRoute(builder: (_) => _StubScreen(title: 'Tracking reserva: \${args?["bookingId"] ?? "N/A"}'));
                case '/provider-detail':
                  final args = settings.arguments as Map<String, dynamic>?;
                  return MaterialPageRoute(builder: (_) => _StubScreen(title: 'Detalle proveedor: \${args?["providerId"] ?? "N/A"}'));
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
            const Text('Pantalla en desarrollo', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

// Provider para AudienceMode (ValueNotifier wrapper)
final audienceModeProvider = StateNotifierProvider<AudienceModeNotifier, AudienceMode>((ref) {
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
