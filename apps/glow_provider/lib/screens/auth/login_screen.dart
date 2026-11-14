// frontend/lib/screens/auth/login_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:flutter/foundation.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'dart:async';
import 'google_signin_button.dart'
    if (dart.library.js) 'google_signin_button_web.dart' as gis_button;
import 'package:glow_core/design/components/s4_text_field.dart';
import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/widgets/invitation_code_entry.dart';
import 'package:glow_core/glow_core.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _error;

  static const String _googleClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
    defaultValue: String.fromEnvironment(
      'GOOGLE_CLIENT_ID',
      defaultValue: '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com',
    ),
  );

  // Solo nativo. En web NO se instancia GoogleSignIn: su constructor llama
  // _ensureInitialized() (google_sign_in 6.x) y el plugin web inyecta GIS y
  // ejecuta id.initialize() con su propio IdConfiguration
  // (auto_select: true, use_fedcm_for_prompt: null), compitiendo con el One Tap
  // de esta pantalla.
  final GoogleSignIn? _googleSignIn = kIsWeb
      ? null
      : GoogleSignIn(
          scopes: ['email', 'openid', 'profile'],
          serverClientId: _googleClientId.isNotEmpty ? _googleClientId : null,
        );

  StreamSubscription<GoogleSignInAccount?>? _googleUserSub;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) {
      // One Tap se inicializa lazily al renderizar el botón (ver google_signin_button_web.dart)
      // No necesitamos listener de onCurrentUserChanged
    } else {
      // Nativo: listener para signInSilently / signIn
      _googleUserSub = _googleSignIn!.onCurrentUserChanged.listen((user) {
        if (user != null && mounted) _finishGoogleLogin(user);
      });
    }
  }

  @override
  void dispose() {
    _googleUserSub?.cancel();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    // Forzar limpieza de base url cache por si no se limpió en logout
    ApiService.resetCachedBaseUrl();
    try {
      final result =
          await AuthService.login(_emailCtrl.text.trim(), _passCtrl.text);
      if (result != null && mounted) {
        if (result['requires_context_selection'] == true && result['available_contexts'] != null) {
          Navigator.pushReplacementNamed(context, '/auth/context-selection',
            arguments: result['available_contexts'],
          );
          return;
        }
        final bool onboardingCompleto =
            result['user']['onboarding_completo'] ?? false;
        final String rLower = (result['user']['role'] ?? '').toString().toLowerCase();
        if (onboardingCompleto) {
          if (rLower == 'salon') {
            Navigator.pushReplacementNamed(context, '/salon');
          } else if (rLower == 'provider') {
            Navigator.pushReplacementNamed(context, '/provider/dashboard');
          } else {
            Navigator.pushReplacementNamed(context, '/home');
          }
        } else {
          Navigator.pushReplacementNamed(context, '/auth/onboarding');
        }
      } else {
        setState(() => _error = 'Credenciales incorrectas');
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: ${mensajeHumano(e)}');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleGoogleSignIn() async {
    // En web One Tap el flujo es: botón -> prompt() -> callback -> loginWithGoogle(idToken)
    // Este método solo se usa en nativo (iOS/Android).
    if (kIsWeb) {
      setState(() => _error = 'Usa el botón de Google para continuar.');
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    GoogleSignInAccount? googleUser;
    try {
      googleUser = await _googleSignIn!.signIn().timeout(
        const Duration(seconds: 60),
        onTimeout: () => null,
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Error al conectar con Google: ${mensajeHumano(e)}';
        });
      }
      return;
    }

    // googleUser == null: el usuario canceló o el flujo falló silenciosamente
    if (googleUser == null) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Inicio de sesión cancelado o no completado. Intenta de nuevo.';
        });
      }
      return;
    }

    await _finishGoogleLogin(googleUser);
  }

  /// Completa el login con la cuenta de Google ya obtenida.
  /// Camino nativo: después de signIn(). Camino web: desde onCurrentUserChanged.
  Future<void> _finishGoogleLogin(GoogleSignInAccount googleUser) async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _error = null;
      });
    }
    try {
      // Obtener tokens de la autenticación Google
      String? idToken;
      String? accessToken;
      try {
        final GoogleSignInAuthentication googleAuth = await googleUser.authentication.timeout(
          const Duration(seconds: 15),
        );
        idToken = googleAuth.idToken;
        accessToken = googleAuth.accessToken;
      } catch (authErr) {
        idToken = null;
        accessToken = null;
      }

      // PATH 1: idToken disponible → verificación segura en backend
      if (idToken != null && idToken.isNotEmpty) {
        final result = await AuthService.loginWithGoogle(idToken);
        if (result != null && result['token'] != null && mounted) {
          return _navigateAfterLogin(result);
        }
        if (mounted) {
          final errMessage = result?['details'] ?? result?['error'] ?? 'El servidor rechazó el token de Google. Intenta de nuevo.';
          setState(() => _error = errMessage);
        }
        return;
      }

      // PATH 2: GIS popup devuelve solo accessToken (comportamiento normal en 6.x web)
      // El backend verifica el accessToken contra https://www.googleapis.com/oauth2/v3/userinfo
      if (accessToken != null && accessToken.isNotEmpty) {
        final result = await AuthService.loginWithGoogleAccessToken(accessToken);
        if (result != null && result['token'] != null && mounted) {
          return _navigateAfterLogin(result);
        }
        if (mounted) {
          final errMessage = result?['details'] ?? result?['error'] ?? 'No se pudo autenticar con Google. Intenta de nuevo.';
          setState(() => _error = errMessage);
        }
        return;
      }

      // Ningún token disponible
      if (mounted) {
        setState(() => _error = 'Google no devolvió credenciales. Verifica la configuración del cliente OAuth.');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Error al conectar con Google: ${mensajeHumano(e)}');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Completa el login con idToken de One Tap (flujo web).
  /// Llamado desde google_signin_button_web.dart -> _handleCredential.
  Future<void> finishGoogleLoginWithIdToken(String idToken) async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await AuthService.loginWithGoogle(idToken);
      if (result != null && result['token'] != null && mounted) {
        return _navigateAfterLogin(result);
      }
      if (mounted) {
        final errMessage =
            result?['details'] ?? result?['error'] ?? 'El servidor rechazó el token de Google. Intenta de nuevo.';
        setState(() => _error = errMessage);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Error al conectar con Google: ${mensajeHumano(e)}');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _navigateAfterLogin(Map<String, dynamic> result) {
    if (!mounted) return;
    // El backend devuelve {token, user:{role, onboarding_completo}}.
    // Solo se navega a rutas declaradas en main.dart: '/home', '/salon' y
    // '/auth/onboarding'. Antes se empujaba a '/provider' y '/onboarding',
    // que no existen: el login exitoso terminaba en excepcion al navegar.
    final dynamic user = result['user'];
    final String role =
        (user is Map && user['role'] != null ? user['role'] : '').toString().toLowerCase();
    final bool onboardingCompleto =
        user is Map && (user['onboarding_completo'] ?? false) == true;

    if (!onboardingCompleto) {
      Navigator.pushReplacementNamed(context, '/auth/onboarding');
      return;
    }
    // En la app provider el salón aterriza en su shell; el resto en /home.
    Navigator.pushReplacementNamed(context, role == 'salon' ? '/salon' : '/home');
  }


  Future<void> _handleOAuth(String provider) async {
      if (provider == 'GOOGLE') {
        await _handleGoogleSignIn();
        return;
      }
    }

    Widget _buildSocialButton({
    required Token t,
    required Widget icon,
    required VoidCallback? onTap,
    required String label,
    bool proximamente = false,
  }) {
    final boton = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.pill),
        child: Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: t.surfaceLevel1,
            border: Border.all(color: t.borderDefault, width: 1.0),
          ),
          child: Center(
            child: Opacity(
              opacity: proximamente ? 0.45 : 1.0,
              child: icon,
            ),
          ),
        ),
      ),
    );

    if (!proximamente) return boton;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        boton,
        const SizedBox(height: 4),
        Text(
          'Próximamente',
          style: TextStyle(fontSize: 9, letterSpacing: 0.3, color: t.n500),
        ),
      ],
    );
  }

  @override
    Widget build(BuildContext context) {
    final t = Token.of(context);
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: Stack(
        children: [
          // Background Image
          Positioned.fill(
                      child: Image.asset(
                        'assets/images/auth/auth_login_hero_v2.webp',
                        fit: BoxFit.cover,
                      ),
                    ),
          // Foreground content
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 24.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          const SizedBox(height: 140),

                      // Tarjeta Luxe
                      Container(
                        padding: const EdgeInsets.all(28.0),
                        decoration: BoxDecoration(
                                                  color: Colors.white.withOpacity(0.5),
                                                  borderRadius: BorderRadius.circular(24),
                          border: Border.all(
                            color: const Color(0xFFEFE8DE),
                            width: 1.2,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x08000000),
                              blurRadius: 20,
                              offset: Offset(0, 8),
                            ),
                          ],
                        ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'INICIAR SESIÓN',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontFamily: 'Didot',
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15), // AppTheme.nude900
                                letterSpacing: 1.2,
                              ),
                            ),
                            const SizedBox(height: 20),

                            // Email Input
                            S4TextField(
                              controller: _emailCtrl,
                              keyboardType: TextInputType.emailAddress,
                              label: 'Correo electrónico',
                              hint: 'Correo electrónico',
                              prefixIcon: Icon(Icons.email_outlined, color: t.brandPrimary, size: 20),
                              validator: (v) => v!.isEmpty ? 'Ingresa tu correo' : null,
                              style: AppTypography.bodyMedium(t).copyWith(fontFamily: 'CormorantGaramond'),
                            ),
                            const SizedBox(height: 16),

                            // Password Input
                            S4TextField(
                              controller: _passCtrl,
                              obscureText: _obscurePassword,
                              label: 'Contraseña',
                              hint: 'Contraseña',
                              prefixIcon: Icon(Icons.lock_outlined, color: t.brandPrimary, size: 20),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                  color: t.brandPrimary,
                                  size: 20,
                                ),
                                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                              ),
                              validator: (v) => v!.length < 6 ? 'Mínimo 6 caracteres' : null,
                              style: AppTypography.bodyMedium(t).copyWith(fontFamily: 'CormorantGaramond'),
                            ),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton(
                                onPressed: () => Navigator.pushNamed(context, '/auth/forgot-password'),
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  minimumSize: const Size(50, 30),
                                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                ),
                                child: Text(
                                                                  '¿Olvidaste tu contraseña?',
                                                                  style: TextStyle(
                                                                    color: const Color(0xFF1F1A15),
                                                                    fontSize: 13,
                                                                    fontWeight: FontWeight.w600,
                                                                    fontFamily: 'CormorantGaramond',
                                                                  ),
                                                                ),
                              ),
                            ),

                            // Entrada al flujo de invitación de equipo.
                            //
                            // La ruta /accept-invitation existía en main.dart y
                            // la pantalla de aceptación estaba construida, pero
                            // NINGUNA pantalla navegaba a ella: el dueño copiaba
                            // un enlace y el colaborador no tenía forma de
                            // consumirlo, así que la invitación moría.
                            Align(
                              alignment: Alignment.center,
                              child: TextButton(
                                onPressed: () => pedirCodigoInvitacion(context),
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  minimumSize: const Size(50, 30),
                                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                ),
                                child: Text(
                                                                  '¿Tienes un código de invitación?',
                                                                  style: TextStyle(
                                                                    color: const Color(0xFF1F1A15),
                                                                    fontSize: 13,
                                                                    fontWeight: FontWeight.w600,
                                                                    fontFamily: 'CormorantGaramond',
                                                                  ),
                                                                ),
                              ),
                            ),
                            const SizedBox(height: 16),

                            if (_error != null)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: Text(
                                  _error!,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: t.error,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13),
                                ),
                              ),

                            // Submit Button (Haute Joaillerie Gold Gradient)
                            Container(
                              width: double.infinity,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(16),
                                gradient: const LinearGradient(
                                  colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: Color(0xFFC5A052).withOpacity(0.35),
                                    blurRadius: 14,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: ElevatedButton(
                                onPressed: _isLoading ? null : _handleLogin,
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  shadowColor: Colors.transparent,
                                  foregroundColor: const Color(0xFF1F1A15),
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(16)),
                                  elevation: 0,
                                ),
                                child: _isLoading
                                    ? const SizedBox(
                                        width: 22,
                                        height: 22,
                                        child: CircularProgressIndicator(
                                            color: Color(0xFF1F1A15),
                                            strokeWidth: 2.5),
                                      )
                                    : const Text(
                                        'ENTRAR AL RITUAL',
                                        style: TextStyle(
                                            fontFamily: 'Inter',
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF1F1A15),
                                            letterSpacing: 0.8),
                                      ),
                              ),
                            ),

                            const SizedBox(height: 24),

                            // Separador para Social Logins
                            Row(
                              children: [
                                Expanded(child: Divider(color: t.borderDefault)),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 16),
                                  child: Text(
                                                                      'o accede con',
                                                                      style: TextStyle(
                                                                          color: const Color(0xFF1F1A15),
                                                                          fontSize: 12,
                                                                          fontFamily: 'CormorantGaramond'),
                                                                    ),
                                ),
                                Expanded(child: Divider(color: t.borderDefault)),
                              ],
                            ),
                            const SizedBox(height: 20),

                            // Social Buttons (Google only)
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                              children: [
                                // En web: botón One Tap (evita COOP). Fuera de web: botón propio que dispara signIn().
                                if (kIsWeb)
                                  gis_button.googleSignInButton(
                                    clientId: _googleClientId,
                                    onCredential: finishGoogleLoginWithIdToken,
                                  ) ??
                                  const SizedBox.shrink()
                                else
                                  _buildSocialButton(
                                    icon: const Icon(
                                      Icons.g_mobiledata,
                                      color: Color(0xFFC5A052),
                                      size: 32,
                                    ),
                                    onTap: _isLoading
                                        ? null
                                        : () => _handleOAuth('GOOGLE'),
                                    label: 'Google',
                                    t: t,
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Link de Registro
                    TextButton(
                      onPressed: () => Navigator.pushNamed(context, '/auth/register'),
                      style: TextButton.styleFrom(
                        foregroundColor: t.brandPrimary,
                      ),
                      child: RichText(
                        text: TextSpan(
                          text: '¿No tienes cuenta? ',
                          style: TextStyle(color: t.n500, fontSize: 14, fontFamily: 'CormorantGaramond'),
                          children: [
                            TextSpan(
                              text: 'Regístrate aquí',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: const Color(0xFF1F1A15),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // Términos y condiciones — la ruta '/terms' existía declarada
                    // en main.dart pero NINGUNA pantalla navegaba a ella (Gate 4).
                    TextButton(
                      onPressed: () => Navigator.pushNamed(context, '/terms'),
                      style: TextButton.styleFrom(
                        foregroundColor: t.brandPrimary,
                      ),
                      child: Text(
                                              'Términos y condiciones',
                                              style: TextStyle(
                                                  color: const Color(0xFF1F1A15),
                                                  fontSize: 13,
                                                  decoration: TextDecoration.underline,
                                                  decorationColor: const Color(0xFF1F1A15),
                                                  fontFamily: 'CormorantGaramond'),
                                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
}