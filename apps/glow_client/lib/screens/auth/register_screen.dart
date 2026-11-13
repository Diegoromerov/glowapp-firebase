// frontend/lib/screens/auth/register_screen.dart
import 'dart:async';

import 'package:glow_core/glow_core.dart' hide AppLocalizations;
import 'package:glow_core/src/l10n/app_localizations.dart' as glow_l10n;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/deep_link_service.dart';
import '../invite_welcome_screen.dart';
import '../../services/push_service.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

/// Código que llegó por el enlace, ya normalizado. Vacío si no hay.
String _codigoDelEnlace() => normalizarCodigoInvitacion(
      codigoInvitacionDeLaUrl(
        kIsWeb ? (DeepLinkService.urlDeArranque ?? Uri.base) : Uri.base,
      ),
    );

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();

  /// Código de invitación. Antes de este campo, la única forma de atribuir era
  /// abrir el enlace `?ref=`: quien ya tenía la app instalada, o recibía el
  /// código de viva voz, no podía usarlo en ningún sitio y esa invitación se
  /// perdía para siempre.
  final _refCtrl = TextEditingController(text: _codigoDelEnlace());

  /// Código guardado en la bienvenida de la invitación. Se carga al abrir.
  bool _codigoDeLaBienvenidaCargado = false;

  bool _isLoading = false;

  /// Ítem 43: sin esta casilla no se crea la cuenta. Antes el registro
  /// implicaba aceptar términos y política sin que el usuario los viera.
  bool _aceptaTerminos = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Si la persona pasó por la pantalla de bienvenida de la invitación, el
    // código quedó guardado. Se rellena solo cuando el campo está vacío, para
    // no pisar lo que venga en la URL o lo que ella haya escrito.
    leerCodigoInvitacionPendiente().then((guardado) {
      if (!mounted || _codigoDeLaBienvenidaCargado) return;
      _codigoDeLaBienvenidaCargado = true;
      if (guardado.isNotEmpty && _refCtrl.text.trim().isEmpty) {
        setState(() => _refCtrl.text = guardado);
      }
    });
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _phoneCtrl.dispose();
    _refCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_aceptaTerminos) {
      setState(() => _error =
          'Para crear la cuenta debes aceptar los términos y la política de privacidad.');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final name = _nameCtrl.text.trim();
      final email = _emailCtrl.text.trim();
      final password = _passCtrl.text;
      final phone = _phoneCtrl.text.trim();

      final success = await AuthService.register(
        name,
        email,
        password,
        phone.isNotEmpty ? phone : null,
        'CLIENTE',
        // El código sale del campo: llega precargado si vino por el enlace, y
        // si no, se puede escribir a mano. Antes sólo se leía de la URL y quien
        // ya tenía la app instalada no tenía dónde ponerlo.
        ref: normalizarCodigoInvitacion(_refCtrl.text).isEmpty
            ? _codigoDelEnlace()
            : normalizarCodigoInvitacion(_refCtrl.text),
      );

      if (success) {
        // Ya se usó: no debe reaparecer en la próxima cuenta que se cree en
        // este dispositivo.
        unawaited(guardarCodigoInvitacionPendiente(''));
      }

      if (success && mounted) {
        final scaffoldMessenger = ScaffoldMessenger.of(context);
        final navigator = Navigator.of(context);

        final loginResult = await AuthService.login(email, password);
        if (!mounted) return;

        if (loginResult != null) {
          unawaited(PushService.iniciar());
          scaffoldMessenger.showSnackBar(
            SnackBar(
              content: Text(
                '✅ Registro exitoso como Cliente.',
              ),
              backgroundColor: const Color(0xFF10B981),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          );

          // La aplicación cliente no requiere el onboarding de negocio.
          navigator.pushNamedAndRemoveUntil('/home', (route) => false);
        } else {
          scaffoldMessenger.showSnackBar(
            const SnackBar(
              content: Text('✅ Cuenta creada. Inicie sesión para continuar.'),
              backgroundColor: Colors.green,
            ),
          );
          navigator.pop();
        }
      } else {
        setState(
          () => _error =
              'Error al registrar. El correo electrónico podría estar en uso.',
        );
      }
    } catch (e) {
      setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Widget _buildHero(BuildContext context) {
    final t = context.glowTokens;

    return SizedBox(
      height: 320,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/auth/auth_register_concierge_hero.webp',
            fit: BoxFit.cover,
            alignment: Alignment.topCenter,
          ),

          // Suaviza la transición entre la imagen y la tarjeta.
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              height: 90,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    t.surface,
                  ],
                ),
              ),
            ),
          ),

          SafeArea(
            child: Align(
              alignment: Alignment.topLeft,
              child: Padding(
                padding: const EdgeInsets.only(left: 12, top: 8),
                child: Material(
                  color: t.surfaceLevel1.withValues(alpha: 0.86),
                  shape: const CircleBorder(),
                  child: IconButton(
                    tooltip: 'Regresar',
                    icon: Icon(
                      Icons.arrow_back_ios_new,
                      color: t.n800,
                      size: 20,
                    ),
                    onPressed: () {
                      // Si se entró por URL directa (#/auth/register) no hay nada
                      // debajo: pop no hace nada y el botón queda muerto.
                      if (Navigator.canPop(context)) {
                        Navigator.pop(context);
                      } else {
                        Navigator.pushReplacementNamed(context, '/auth/login');
                      }
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormCard(BuildContext context) {
      final t = context.glowTokens;
      final l10n = glow_l10n.AppLocalizations.of(context)!;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 22),
      decoration: BoxDecoration(
        color: t.surfaceLevel1,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(
          color: t.borderDefault,
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 24,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // En la app cliente solo se registran clientes: el selector de rol
            // (CLIENTE / PRESTADOR / SAAS) se retiro. Proveedores y salones se
            // registran en la app provider.

            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: t.surfaceLevel2,
                borderRadius: BorderRadius.circular(Radii.round),
                border: Border.all(
                  color: t.borderDefault,
                  width: 0.5,
                ),
              ),
              child: Text(
                '✨ Acceso a diagnósticos de IA Aura, GlowStore y reserva de servicios concierge.',
                style: TextStyle(
                  fontSize: 12,
                  color: t.n700,
                  fontFamily: 'CormorantGaramond',
                  height: 1.3,
                ),
              ),
            ),

            const SizedBox(height: 18),

            S4TextField(
              controller: _nameCtrl,
              label: l10n.registerFullNameLabel,
              hint: l10n.registerFullNameHint,
              prefixIcon: Icon(
                Icons.person_outline,
                color: t.brandPrimary,
                size: 20,
              ),
              validator: (v) => v!.isEmpty
                  ? l10n.registerFullNameError
                  : null,
              style: context.bodyContext,
            ),

            const SizedBox(height: 12),

            S4TextField(
              controller: _emailCtrl,
              keyboardType: TextInputType.emailAddress,
              label: l10n.registerEmailLabel,
              hint: l10n.registerEmailHint,
              prefixIcon: Icon(
                Icons.email_outlined,
                color: t.brandPrimary,
                size: 20,
              ),
              validator: (v) => v!.isEmpty
                  ? l10n.registerEmailError
                  : null,
              style: context.bodyContext,
            ),

            const SizedBox(height: 12),

            S4TextField(
              controller: _passCtrl,
              obscureText: _obscurePassword,
              label: l10n.registerPasswordLabel,
              hint: l10n.registerPasswordHint,
              prefixIcon: Icon(
                Icons.lock_outlined,
                color: t.brandPrimary,
                size: 20,
              ),
              suffixIcon: IconButton(
                tooltip: 'Mostrar contraseña',
                icon: Icon(
                  _obscurePassword
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                  color: t.brandPrimary,
                  size: 20,
                ),
                onPressed: () => setState(
                  () => _obscurePassword = !_obscurePassword,
                ),
              ),
              validator: (v) => v!.length < 6
                  ? l10n.registerPasswordError
                  : null,
              style: context.bodyContext,
            ),

            const SizedBox(height: 12),

            S4TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              label: l10n.registerPhoneLabel,
              hint: l10n.registerPhoneHint,
              prefixIcon: Icon(
                Icons.phone_outlined,
                color: t.brandPrimary,
                size: 20,
              ),
              style: context.bodyContext,
            ),

            const SizedBox(height: 12),

            S4TextField(
              controller: _refCtrl,
              textCapitalization: TextCapitalization.characters,
              label: 'Código de invitación (opcional)',
              hint: 'GLOW1234',
              prefixIcon: Icon(
                Icons.card_giftcard_outlined,
                color: t.brandPrimary,
                size: 20,
              ),
              style: context.bodyContext,
            ),

            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: context.bodyContext.copyWith(
                  color: t.error,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],

            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 32,
                  height: 32,
                  child: Checkbox(
                    value: _aceptaTerminos,
                    onChanged: (v) =>
                        setState(() => _aceptaTerminos = v ?? false),
                    activeColor: t.brandPrimary,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('Acepto los ',
                            style: context.bodyContext
                                .copyWith(fontSize: 12.5)),
                        GestureDetector(
                          onTap: () => launchUrl(
                              Uri.parse('https://glowapp-client.web.app/terms'),
                              mode: LaunchMode.externalApplication),
                          child: Text('términos',
                              style: context.bodyContext.copyWith(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: t.brandPrimary,
                                  decoration: TextDecoration.underline)),
                        ),
                        Text(' y la ',
                            style: context.bodyContext
                                .copyWith(fontSize: 12.5)),
                        GestureDetector(
                          onTap: () => launchUrl(
                              Uri.parse('https://glowapp-client.web.app/privacy'),
                              mode: LaunchMode.externalApplication),
                          child: Text('política de privacidad',
                              style: context.bodyContext.copyWith(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: t.brandPrimary,
                                  decoration: TextDecoration.underline)),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              height: 52,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: const LinearGradient(
                  colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                    blurRadius: 14,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleRegister,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  foregroundColor: const Color(0xFF1F1A15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  elevation: 0,
                ),
                child: _isLoading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          color: Color(0xFF1F1A15),
                          strokeWidth: 2.5,
                        ),
                      )
                    : Text(
                        l10n.registerCreateAccount,
                        style: const TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15),
                          letterSpacing: 0.8,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 18),

            Center(
              child: TextButton(
                onPressed: () => Navigator.pop(context),
                child: RichText(
                  text: TextSpan(
                    text: '¿Ya tienes cuenta? ',
                    style: context.bodySmallContext,
                    children: [
                      TextSpan(
                        text: 'Inicia sesión',
                        style: context.bodySmallContext.copyWith(
                          color: const Color(0xFFC5A052),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(
                  child: _buildHero(context),
                ),

                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 24),
                  sliver: SliverToBoxAdapter(
                    child: _buildFormCard(context),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
