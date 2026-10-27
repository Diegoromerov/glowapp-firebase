// frontend/lib/screens/auth/register_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/design/components/s4_text_field.dart';
import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/l10n/app_localizations.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();

  String _selectedRole = 'CLIENTE';
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;

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
        _selectedRole,
      );

      if (success && mounted) {
        final scaffoldMessenger = ScaffoldMessenger.of(context);
        final navigator = Navigator.of(context);

        final loginResult = await AuthService.login(email, password);
        if (!mounted) return;

        if (loginResult != null) {
          final bool onboardingCompleto =
              loginResult['user']['onboarding_completo'] ?? false;
          final String? role = loginResult['user']['role'];

          scaffoldMessenger.showSnackBar(
            SnackBar(
              content: Text(
                '✅ Registro exitoso como '
                '${_selectedRole == 'SALON' ? 'Salón de Belleza' : _selectedRole == 'PRESTADOR' ? 'Prestador' : 'Cliente'}.',
              ),
              backgroundColor: const Color(0xFF10B981),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          );

          if (onboardingCompleto) {
            if (role == 'salon') {
              navigator.pushNamedAndRemoveUntil(
                '/salon',
                (route) => false,
              );
            } else if (role == 'provider') {
              navigator.pushNamedAndRemoveUntil(
                '/provider',
                (route) => false,
              );
            } else {
              navigator.pushNamedAndRemoveUntil(
                '/home',
                (route) => false,
              );
            }
          } else {
            navigator.pushNamedAndRemoveUntil(
              '/onboarding',
              (route) => false,
            );
          }
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
      setState(() => _error = 'Error de conexión: $e');
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
            'images/auth/auth_register_concierge_hero.webp',
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
                    icon: Icon(
                      Icons.arrow_back_ios_new,
                      color: t.n800,
                      size: 20,
                    ),
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleSelector(BuildContext context) {
    final t = context.glowTokens;

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: t.surfaceLevel2,
        borderRadius: BorderRadius.circular(Radii.round),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedRole = 'CLIENTE'),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: _selectedRole == 'CLIENTE'
                      ? t.surfaceLevel1
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Center(
                  child: Text(
                    'Cliente',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: _selectedRole == 'CLIENTE'
                          ? t.n800
                          : t.n400,
                      fontSize: 13,
                      fontFamily: 'CormorantGaramond',
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedRole = 'PRESTADOR'),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: _selectedRole == 'PRESTADOR'
                      ? t.surfaceLevel1
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Center(
                  child: Text(
                    'Prestador',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: _selectedRole == 'PRESTADOR'
                          ? t.n800
                          : t.n400,
                      fontSize: 12,
                      fontFamily: 'CormorantGaramond',
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedRole = 'SALON'),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: _selectedRole == 'SALON'
                      ? t.surfaceLevel1
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Center(
                  child: Text(
                    'Salón / SaaS',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: _selectedRole == 'SALON'
                          ? t.n800
                          : t.n400,
                      fontSize: 11,
                      fontFamily: 'CormorantGaramond',
                    ),
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
    final l10n = AppLocalizations.of(context)!;

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
            Text(
              l10n.registerUserType,
              style: context.labelLargeContext,
            ),
            const SizedBox(height: 10),

            _buildRoleSelector(context),
            const SizedBox(height: 10),

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
                _selectedRole == 'CLIENTE'
                    ? '✨ Acceso a diagnósticos de IA Aura, GlowStore y reserva de servicios concierge.'
                    : _selectedRole == 'PRESTADOR'
                        ? '💼 Ofrece tus servicios independientes, gestiona tu agenda y recibe pagos directos.'
                        : '🏢 Administra tu salón de belleza, tu equipo de trabajo y licencias SaaS integradas.',
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

            const SizedBox(height: 18),
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
                    color: Color(0xFFC5A052).withValues(alpha: 0.35),
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
