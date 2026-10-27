// GlowApp Provider - App Proveedor/Sal\u00f3n (app.glowapp.com/provider)
// Entry point para la aplicaci\u00f3n del proveedor/sal\u00f3n

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart' hide ProviderServicesScreen;
import 'firebase_options.dart';

// Auth
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/auth/onboarding_screen.dart';
import 'screens/auth/forgot_password_screen.dart';
import 'screens/auth/accept_invitation_screen.dart';
import 'screens/auth/verification_pending_screen.dart';
import 'screens/auth/context_selection_screen.dart';
import 'screens/auth/role_selection_modal.dart';

// Provider Dashboard & Core
import 'screens/provider/provider_dashboard_screen.dart';
import 'screens/provider/provider_services_screen.dart';
import 'screens/provider/provider_portfolio_screen.dart';
import 'screens/provider/provider_profile_screen.dart';
import 'screens/provider/provider_route_screen.dart';
import 'screens/provider/provider_ai_copilot_screen.dart';

// Provider Business
import 'screens/provider/business/business_dashboard_screen.dart';
import 'screens/provider/business/business_onboarding_screen.dart';
import 'screens/provider/business/business_document_generator_screen.dart';
import 'screens/provider/business/business_task_detail_screen.dart';

// SaaS
import 'screens/saas/billing_screen.dart';
import 'screens/saas/usage_screen.dart';
import 'screens/saas/team_management_screen.dart';
import 'screens/saas/api_keys_screen.dart';

// Salon
import 'screens/salon/salon_shell.dart';
import 'screens/salon/salon_hub_screen.dart';
import 'screens/salon/caja_screen.dart';

// Owner
import 'screens/owner/owner_dashboard_screen.dart';

// Academy
import 'screens/academy/academy_screen.dart';
import 'screens/academy/course_detail_screen.dart';
import 'screens/academy/glow_beauty_screen.dart';
import 'screens/academy/glow_color_screen.dart';
import 'screens/academy/glow_nback_screen.dart';
import 'screens/academy/quiz_screen.dart';

// Chat
import 'screens/chat/chat_list_screen.dart';
import 'screens/chat/chat_screen.dart';

// Booking
import 'screens/booking/booking_screen.dart';
import 'screens/booking/booking_tracking_screen.dart';

// Profile
import 'screens/profile/user_profile.dart';
import 'screens/profile/my_glow_dashboard_screen.dart';
import 'screens/profile/rewards_xp_screen.dart';
import 'screens/profile/glowstore_orders_screen.dart';
import 'screens/profile/faq_screen.dart';
import 'screens/profile/settings_screen.dart';

// Support
import 'screens/support/support_center_screen.dart';

// Store
import 'screens/store/store_screen.dart';

// Wallet
import 'screens/wallet/wallet_screen.dart';

// Services (hide ProviderServicesScreen to avoid ambiguous import)
import 'screens/services/provider_services_screen.dart' hide ProviderServicesScreen;

// Widgets
import 'widgets/audience_toggle.dart';
import 'widgets/app_update_gate.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Inicializar Firebase (solo si est\u00e1 configurado)
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (_) {
    // Firebase no configurado en este build
  }

  // Inicializar servicios core
  await AudienceService.init();

  runApp(const ProviderScope(child: GlowProviderApp()));
}

class GlowProviderApp extends ConsumerWidget {
  const GlowProviderApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final audienceMode = ref.watch(audienceModeProvider);
    final isMen = audienceMode == AudienceMode.men;

    return MaterialApp(
      title: 'GlowApp Proveedor',
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

        // Provider Dashboard (Home)
        '/home': (_) => const ProviderDashboardScreen(),
        '/provider/dashboard': (_) => const ProviderDashboardScreen(),

        // Provider Core
                '/provider/services': (_) => const ProviderServicesScreen(),
                '/provider/portfolio': (_) => const ProviderPortfolioScreen(),
                '/provider/profile': (_) => const ProviderProfileScreen(),
                '/provider/ai-copilot': (_) => const ProviderAiCopilotScreen(),

                // Provider Business
                '/provider/business': (_) => const BusinessDashboardScreen(),
                '/provider/business/onboarding': (_) => const BusinessOnboardingScreen(),
                '/provider/business/documents': (_) => const BusinessDocumentGeneratorScreen(),

                // SaaS
                '/saas/billing': (_) => const BillingScreen(),
                '/saas/usage': (_) => const UsageScreen(),
                '/saas/team': (_) => const TeamManagementScreen(),
                '/saas/api-keys': (_) => const ApiKeysScreen(),

                // Salon
                '/salon': (_) => const SalonShell(),
                '/salon/hub': (_) => const SalonHubScreen(),

                // Owner
                '/owner/dashboard': (_) => const OwnerDashboardScreen(),

                // Academy
                '/academy': (_) => const AcademyScreen(),
                '/academy/beauty': (_) => const GlowBeautyScreen(),
                '/academy/color': (_) => const GlowColorScreen(),
                '/academy/nback': (_) => const GlowNBackScreen(),

                // Chat
                '/chat': (_) => const ChatListScreen(),

                // Profile
                '/profile': (_) => const UserProfileScreen(),
                '/my-glow': (_) => const MyGlowDashboardScreen(),
                '/rewards': (_) => const RewardsXpScreen(),
                '/glowstore-orders': (_) => const GlowStoreOrdersScreen(),
                '/faq': (_) => const FaqScreen(),
                '/settings': (_) => SettingsScreen(userEmail: '', onLogout: () {}),

                // Support
                '/support': (_) => const SupportCenterScreen(),

                // Store
                '/store': (_) => const StoreScreen(),

                // Wallet
                '/wallet': (_) => const WalletScreen(),

                // Services (legacy route)
                '/services': (_) => const ProviderServicesScreen(),
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
          case '/booking/tracking':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => BookingTrackingScreen(
                bookingId: args?['bookingId'] ?? '',
              ),
            );
          case '/provider/detail':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => ProviderDetailScreen(
                providerId: args?['providerId'] ?? '',
              ),
            );
          case '/provider/business/task':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => BusinessTaskDetailScreen(
                taskId: args?['taskId'] ?? '',
              ),
            );
          case '/academy/course':
            final args = settings.arguments as Map<String, dynamic>?;
            return MaterialPageRoute(
              builder: (_) => CourseDetailScreen(
                courseId: args?['courseId'] ?? '',
              ),
            );
          case '/academy/quiz':
                      final args = settings.arguments as Map<String, dynamic>?;
                      return MaterialPageRoute(
                        builder: (_) => QuizScreen(
                          courseId: args?['courseId'] ?? '',
                          lessonId: args?['lessonId'] ?? '',
                        ),
                      );
                    case '/provider/route':
                      final args = settings.arguments as Map<String, dynamic>?;
                      return MaterialPageRoute(
                        builder: (_) => ProviderRouteScreen(
                          booking: args?['booking'] ?? <String, dynamic>{},
                        ),
                      );
                    case '/salon/caja':
                      final args = settings.arguments as Map<String, dynamic>?;
                      return MaterialPageRoute(
                        builder: (_) => CajaScreen(
                          salonId: args?['salonId'] ?? 0,
                        ),
                      );
                    case '/booking':
                      final args = settings.arguments as Map<String, dynamic>?;
                      return MaterialPageRoute(
                        builder: (_) => BookingScreen(
                          providerId: args?['providerId'] ?? '',
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
      error: MensTheme.error,
      onError: MensTheme.obsidianBg,
    ),
    scaffoldBackgroundColor: MensTheme.obsidianBg,
    appBarTheme: AppBarTheme(
      backgroundColor: MensTheme.obsidianBg,
      foregroundColor: MensTheme.textPrimary,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(
        fontFamily: 'CormorantGaramond',
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      iconTheme: IconThemeData(color: MensTheme.textPrimary),
    ),
    cardTheme: CardThemeData(
      color: MensTheme.obsidianCard,
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: MensTheme.champagneGold.withValues(alpha: 0.3)),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: MensTheme.champagneGold,
        foregroundColor: MensTheme.obsidianBg,
        elevation: 2,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: MensTheme.champagneGold,
        side: BorderSide(color: MensTheme.champagneGold, width: 1.5),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(
          fontFamily: 'Manrope',
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: MensTheme.obsidianCard,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: MensTheme.champagneGold.withValues(alpha: 0.5)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: MensTheme.champagneGold.withValues(alpha: 0.5)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: MensTheme.champagneGold, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: MensTheme.error, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      labelStyle: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        color: MensTheme.textSecondary,
      ),
      hintStyle: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        color: MensTheme.textMuted,
      ),
    ),
    textTheme: TextTheme(
      displayLarge: TextStyle(
        fontFamily: 'CormorantGaramond',
        fontSize: 56,
        fontWeight: FontWeight.w700,
        color: MensTheme.textPrimary,
      ),
      displayMedium: TextStyle(
        fontFamily: 'CormorantGaramond',
        fontSize: 44,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      displaySmall: TextStyle(
        fontFamily: 'CormorantGaramond',
        fontSize: 36,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      headlineLarge: TextStyle(
        fontFamily: 'CormorantGaramond',
        fontSize: 32,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      headlineMedium: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 28,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      headlineSmall: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 24,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      titleLarge: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      titleMedium: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 16,
        fontWeight: FontWeight.w500,
        color: MensTheme.textPrimary,
      ),
      titleSmall: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        fontWeight: FontWeight.w500,
        color: MensTheme.textSecondary,
      ),
      bodyLarge: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 16,
        color: MensTheme.textPrimary,
      ),
      bodyMedium: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        color: MensTheme.textPrimary,
      ),
      bodySmall: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 12,
        color: MensTheme.textSecondary,
      ),
      labelLarge: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: MensTheme.textPrimary,
      ),
      labelMedium: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: MensTheme.textSecondary,
      ),
      labelSmall: TextStyle(
        fontFamily: 'Manrope',
        fontSize: 11,
        fontWeight: FontWeight.w500,
        color: MensTheme.textMuted,
      ),
    ),
    iconTheme: IconThemeData(
      color: MensTheme.textSecondary,
      size: 24,
    ),
    dividerColor: MensTheme.champagneGold.withValues(alpha: 0.2),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: MensTheme.champagneGold,
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: MensTheme.obsidianBg,
      selectedItemColor: MensTheme.champagneGold,
      unselectedItemColor: MensTheme.textMuted,
      type: BottomNavigationBarType.fixed,
      elevation: 8,
      selectedLabelStyle: const TextStyle(fontFamily: 'Manrope', fontWeight: FontWeight.w600),
      unselectedLabelStyle: const TextStyle(fontFamily: 'Manrope', fontWeight: FontWeight.w400),
    ),
  );
}

ThemeData _buildMensDarkTheme() {
  return _buildMensTheme().copyWith(
    brightness: Brightness.dark,
    colorScheme: const ColorScheme.dark(
      primary: MensTheme.champagneGoldLight,
      onPrimary: MensTheme.obsidianBg,
      secondary: MensTheme.champagneGold,
      onSecondary: MensTheme.obsidianBg,
      surface: MensTheme.obsidianCard,
      onSurface: MensTheme.textPrimary,
      surfaceContainerHighest: MensTheme.obsidianCardHover,
      outline: MensTheme.textMuted,
      outlineVariant: MensTheme.textMuted,
      error: MensTheme.error,
      onError: MensTheme.obsidianBg,
    ),
  );
}

// Stub screens for not-yet-implemented routes
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
            Text(title, style: const TextStyle(fontSize: 18, color: Colors.grey)),
            const SizedBox(height: 8),
            const Text('En desarrollo', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

// Stub for ProviderDetailScreen (not in glow_core yet)
class ProviderDetailScreen extends StatelessWidget {
  final String providerId;
  const ProviderDetailScreen({super.key, required this.providerId});

  @override
  Widget build(BuildContext context) {
    return _StubScreen(title: 'Detalle proveedor: $providerId');
  }
}

// Stub for BookingTrackingScreen
class BookingTrackingScreen extends StatelessWidget {
  final String bookingId;
  const BookingTrackingScreen({super.key, required this.bookingId});

  @override
  Widget build(BuildContext context) {
    return _StubScreen(title: 'Tracking reserva: $bookingId');
  }
}

// Stub for CourseDetailScreen
class CourseDetailScreen extends StatelessWidget {
  final String courseId;
  const CourseDetailScreen({super.key, required this.courseId});

  @override
  Widget build(BuildContext context) {
    return _StubScreen(title: 'Curso: $courseId');
  }
}

// Stub for QuizScreen
class QuizScreen extends StatelessWidget {
  final String courseId;
  final String lessonId;
  const QuizScreen({super.key, required this.courseId, required this.lessonId});

  @override
  Widget build(BuildContext context) {
    return _StubScreen(title: 'Quiz: $courseId / $lessonId');
  }
}

// Stub for BusinessTaskDetailScreen
class BusinessTaskDetailScreen extends StatelessWidget {
  final String taskId;
  const BusinessTaskDetailScreen({super.key, required this.taskId});

  @override
  Widget build(BuildContext context) {
    return _StubScreen(title: 'Tarea: $taskId');
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
