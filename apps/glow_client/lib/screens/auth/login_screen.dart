// frontend/lib/screens/auth/login_screen.dart
import 'package:glow_core/glow_core.dart';
import '../invite_welcome_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'dart:async';
import '../../services/push_service.dart';
import 'google_signin_button.dart'
    if (dart.library.js) 'google_signin_button_web.dart' as gis_button;

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
  bool _biometricLoginAvailable = false;
  bool _obscurePassword = true;
  String? _error;

  static const String _googleClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
    defaultValue: String.fromEnvironment(
      'GOOGLE_CLIENT_ID',
      defaultValue:
          '374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com',
    ),
  );

  // En web: clientId Y serverClientId son requeridos para obtener el idToken.
  // google_sign_in_web solo rellena googleAuth.idToken cuando serverClientId está presente.
  final GoogleSignIn _googleSignIn = kIsWeb
      ? GoogleSignIn(
          scopes: ['email', 'openid', 'profile'],
          clientId: _googleClientId.isNotEmpty ? _googleClientId : null,
          serverClientId: _googleClientId.isNotEmpty ? _googleClientId : null,
        )
      : GoogleSignIn(
          scopes: ['email', 'openid', 'profile'],
          serverClientId: _googleClientId.isNotEmpty ? _googleClientId : null,
        );

  StreamSubscription<GoogleSignInAccount?>? _googleUserSub;

  @override
  void initState() {
    super.initState();
    _loadBiometricLogin();
    // En web el unico flujo soportado es el boton de GIS: la cuenta llega por
    // onCurrentUserChanged. `signIn()` ya no entrega credenciales (0.12+).
    if (kIsWeb) {
      _googleUserSub = _googleSignIn.onCurrentUserChanged.listen((user) {
        if (user != null && mounted) _finishGoogleLogin(user);
      });
    }
  }

  Future<void> _loadBiometricLogin() async {
    if (kIsWeb || !await BiometricLoginService.isEnabled) return;
    final hasSession = await AuthService.getToken() != null;
    if (mounted && hasSession) setState(() => _biometricLoginAvailable = true);
  }

  Future<void> _handleBiometricLogin() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final authenticated = await BiometricLoginService.authenticate();
      if (!authenticated) return;
      final result = await AuthService.restoreBiometricSession();
      if (result != null && mounted) {
        _navigateAfterLogin(result);
      } else if (mounted) {
        setState(() => _error =
            'La sesión venció. Ingresa con tu contraseña para continuar.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = mensajeHumano(error));
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
        // Un solo camino de navegacion para todos los metodos de login.
        // Antes esta rama podia desviar a la pantalla de seleccion de rol, que
        // ya no existe: en la app cliente el rol es siempre cliente.
        _navigateAfterLogin(result);
      } else {
        setState(() => _error = 'Credenciales incorrectas');
      }
    } catch (e) {
      setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleGoogleSignIn() async {
    // En web el unico flujo soportado por GIS es el boton: `signIn()` ya no
    // entrega credenciales (google_sign_in_web 0.12), solo abre un popup que el
    // COOP bloquea. La cuenta llega por onCurrentUserChanged -> _finishGoogleLogin.
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
      googleUser = await _googleSignIn.signIn().timeout(
            const Duration(seconds: 60),
            onTimeout: () => null,
          );
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'No pudimos conectar con Google. Inténtalo de nuevo.';
        });
      }
      return;
    }

    // googleUser == null: el usuario canceló o el flujo falló silenciosamente
    if (googleUser == null) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error =
              'Inicio de sesión cancelado o no completado. Intenta de nuevo.';
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
        final GoogleSignInAuthentication googleAuth =
            await googleUser.authentication.timeout(
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
          if (result['es_nuevo'] == true) mostrarBienvenidaXp(context);
          unawaited(confirmarInvitacionAplicada(context));
          return _navigateAfterLogin(result);
        }
        if (mounted) {
          final errMessage = result?['details'] ??
              result?['error'] ??
              'El servidor rechazó el token de Google. Intenta de nuevo.';
          setState(() => _error = errMessage);
        }
        return;
      }

      // PATH 2: GIS popup devuelve solo accessToken (comportamiento normal en 6.x web)
      // El backend verifica el accessToken contra https://www.googleapis.com/oauth2/v3/userinfo
      if (accessToken != null && accessToken.isNotEmpty) {
        final result =
            await AuthService.loginWithGoogleAccessToken(accessToken);
        if (result != null && result['token'] != null && mounted) {
          if (result['es_nuevo'] == true) mostrarBienvenidaXp(context);
          unawaited(confirmarInvitacionAplicada(context));
          return _navigateAfterLogin(result);
        }
        if (mounted) {
          final errMessage = result?['details'] ??
              result?['error'] ??
              'No se pudo autenticar con Google. Intenta de nuevo.';
          setState(() => _error = errMessage);
        }
        return;
      }

      // Ningún token disponible
      if (mounted) {
        setState(() => _error =
            'Google no devolvió credenciales. Verifica la configuración del cliente OAuth.');
      }
    } catch (e) {
      if (mounted) {
        setState(() =>
            _error = 'No pudimos conectar con Google. Inténtalo de nuevo.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _navigateAfterLogin(Map<String, dynamic> result) {
    if (!mounted) return;
    // La app puede arrancar sin sesión guardada; registrar FCM aquí cubre
    // también el login iniciado después de mostrar la pantalla de acceso.
    unawaited(PushService.iniciar());
    // Esta app es solo para clientes. El onboarding de negocio y las pantallas
    // de proveedor/salón pertenecen a GlowApp Provider.
    Navigator.pushReplacementNamed(context, '/home');
  }

  Future<void> _handleOAuth(String provider) async {
    if (provider == 'GOOGLE') {
      await _handleGoogleSignIn();
      return;
    }
    if (provider == 'FACEBOOK') {
      await _handleFacebookSignIn();
      return;
    }
    // Residuo: el flujo de demostración de Apple. Ya no se invoca desde la UI
    // (el botón está en «Próximamente»), pero se conserva para no perder la
    // referencia de lo que había. Outlook se retiró.
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final email = 'appleuser@icloud.com';
      final name = 'Usuario de Apple';
      final fotoUrl =
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=200&auto=format&fit=crop';
      final providerId = 'apple_555666777';

      final result = await AuthService.loginOAuth(
        email: email,
        nombre: name,
        fotoUrl: fotoUrl,
        authProvider: provider,
        providerId: providerId,
      );

      if (result != null && mounted) {
        _navigateAfterLogin(result);
      } else {
        setState(() => _error = 'Error al autenticar con $provider');
      }
    } catch (e) {
      setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Facebook: flujo estructurado de punta a punta salvo el origen del token.
  ///
  /// Cadena: botón -> [_obtainFacebookAccessToken] -> [AuthService.loginWithFacebook]
  /// -> `POST /api/auth/facebook` (verifica contra la Graph API y emite el JWT).
  ///
  /// Lo que falta para que funcione de verdad, y no se simula:
  ///   1. App de Facebook creada (App ID + client token).
  ///   2. Endpoint `POST /api/auth/facebook` en el backend.
  ///   3. En web, habilitar el proveedor Facebook en Firebase Console y usar
  ///      `FacebookAuthProvider`/`signInWithPopup`; en móvil, el paquete
  ///      `facebook_auth`. Eso se resuelve en [_obtainFacebookAccessToken].
  Future<void> _handleFacebookSignIn() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final accessToken = await _obtainFacebookAccessToken();
      if (accessToken == null || accessToken.isEmpty) {
        if (mounted) {
          setState(() => _error =
              'Facebook: falta la App ID de Facebook. El resto del flujo ya está conectado.');
        }
        return;
      }
      final result = await AuthService.loginWithFacebook(accessToken);
      if (result == null || !mounted) {
        if (mounted) {
          setState(() => _error = 'Facebook: el servidor rechazó el token.');
        }
        return;
      }
      _navigateAfterLogin(result);
    } catch (e) {
      if (mounted) setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Único punto pendiente del login con Facebook: conseguir el accessToken.
  ///
  /// Devuelve `null` a propósito mientras no exista la app de Facebook; devolver
  /// un token inventado haría que el botón "funcionara" con sesiones falsas, que
  /// es justo el defecto que tenían los botones de Outlook y Apple.
  Future<String?> _obtainFacebookAccessToken() async => null;

  /// Botón social. Con `proximamente: true` se muestra atenuado, con la leyenda
  /// «Próximamente» debajo y sin ejecutar el flujo: es el estado de Apple y
  /// Facebook mientras no estén configurados (P-052, P-053). Un botón que solo
  /// devuelve un error técnico es peor que uno que dice que aún no está.
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
          style: TextStyle(
            fontSize: 9,
            letterSpacing: 0.3,
            color: t.n500,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    final isMobileLayout = MediaQuery.sizeOf(context).shortestSide < 600;
    final inputFontSize = isMobileLayout ? 16.0 : 14.0;
    final inputTextStyle = TypographyTokens.body(t).copyWith(
      fontFamily: 'CormorantGaramond',
      fontSize: inputFontSize,
    );
    final inputHintStyle = inputTextStyle.copyWith(
      fontSize: isMobileLayout ? 16 : 13,
      color: t.textSecondary,
    );
    // Botón oficial de GIS, en su forma redonda (icono de Google en círculo).
    // En web GIS solo entrega credenciales por su propio botón, así que se pinta
    // tal cual: sin recortes ni capas encima, que es lo que deja el clic muerto.
    final googleOverlay = gis_button.googleSignInButton();
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
                  padding: const EdgeInsets.symmetric(
                      horizontal: 24.0, vertical: 24.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(height: 60),

                      // Tarjeta Luxe
                      Container(
                        padding: const EdgeInsets.all(28.0),
                        decoration: BoxDecoration(
                          color: Colors.white,
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
                                'ENTRÁ O CREÁ TU CUENTA',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontFamily: 'Didot',
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color:
                                      Color(0xFF1F1A15), // LuxeColors.nude900
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
                                prefixIcon: Icon(Icons.email_outlined,
                                    color: t.brandPrimary, size: 20),
                                validator: (v) =>
                                    v!.isEmpty ? 'Ingresa tu correo' : null,
                                style: inputTextStyle,
                                hintStyle: inputHintStyle,
                              ),
                              const SizedBox(height: 16),

                              // Password Input
                              S4TextField(
                                controller: _passCtrl,
                                obscureText: _obscurePassword,
                                label: 'Contraseña',
                                hint: 'Contraseña',
                                prefixIcon: Icon(Icons.lock_outlined,
                                    color: t.brandPrimary, size: 20),
                                suffixIcon: IconButton(
                                  tooltip: 'Mostrar contraseña',
                                  icon: Icon(
                                    _obscurePassword
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined,
                                    color: t.brandPrimary,
                                    size: 20,
                                  ),
                                  onPressed: () => setState(() =>
                                      _obscurePassword = !_obscurePassword),
                                ),
                                validator: (v) => v!.length < 6
                                    ? 'Mínimo 6 caracteres'
                                    : null,
                                style: inputTextStyle,
                                hintStyle: inputHintStyle,
                              ),
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: () => Navigator.pushNamed(
                                      context, '/auth/forgot-password'),
                                  style: TextButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                    minimumSize: const Size(50, 30),
                                    tapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: Text(
                                    '¿Olvidaste tu contraseña?',
                                    style: TextStyle(
                                      color: t.brandPrimary,
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
                                    colors: [
                                      Color(0xFFF3D59B),
                                      Color(0xFFC5A052)
                                    ],
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: const Color(0xFFC5A052)
                                          .withValues(alpha: 0.35),
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
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 16),
                                    shape: RoundedRectangleBorder(
                                        borderRadius:
                                            BorderRadius.circular(16)),
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

                              if (_biometricLoginAvailable) ...[
                                const SizedBox(height: 12),
                                OutlinedButton.icon(
                                  onPressed:
                                      _isLoading ? null : _handleBiometricLogin,
                                  icon: const Icon(Icons.fingerprint),
                                  label: const Text('Ingresar con biometría'),
                                ),
                              ],

                              const SizedBox(height: 24),

                              // Separador para Social Logins
                              Row(
                                children: [
                                  Expanded(
                                      child: Divider(color: t.borderDefault)),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 16),
                                    child: Text(
                                      'o accede con',
                                      style: TextStyle(
                                          color: t.n400,
                                          fontSize: 12,
                                          fontFamily: 'CormorantGaramond'),
                                    ),
                                  ),
                                  Expanded(
                                      child: Divider(color: t.borderDefault)),
                                ],
                              ),
                              const SizedBox(height: 20),

                              // Acceso social: solo Google.
                              // Facebook y Apple se retiraron: mostraban "disponible
                              // próximamente" (botón muerto) y Apple no tiene endpoint
                              // en el backend. Vuelven cuando funcionen de verdad.
                              Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  // Google: botón OFICIAL de GIS en forma redonda
                                  // (icono, 40x40, pastilla = círculo), a la
                                  // altura de los círculos de 52 del diseño.
                                  // Nada se apila encima: un iframe tapado u
                                  // oculto no entrega clics, y el login queda
                                  // muerto. Fuera de web, el botón propio llama
                                  // a signIn().
                                  if (googleOverlay != null)
                                    Padding(
                                      padding: const EdgeInsets.all(6),
                                      child: googleOverlay,
                                    )
                                  else
                                    _buildSocialButton(
                                      icon: const Icon(Icons.g_mobiledata,
                                          color: Color(0xFFC5A052), size: 32),
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
                        onPressed: () =>
                            Navigator.pushNamed(context, '/auth/register'),
                        style: TextButton.styleFrom(
                          foregroundColor: t.brandPrimary,
                        ),
                        child: RichText(
                          text: TextSpan(
                            text: '¿Preferís tu correo? ',
                            style: TextStyle(
                                color: t.n500,
                                fontSize: 14,
                                fontFamily: 'CormorantGaramond'),
                            children: [
                              TextSpan(
                                text: 'Crear cuenta',
                                style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.black),
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
                              color: t.n500,
                              fontSize: 13,
                              decoration: TextDecoration.underline,
                              decorationColor: t.n500,
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
