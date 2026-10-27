// frontend/lib/screens/auth/forgot_password_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _otpController = TextEditingController();
  final _newPasswordController = TextEditingController();

  bool _otpSent = false;
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _message;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    _newPasswordController.dispose();
    super.dispose();
  }

  Future<void> _handleSendOtp() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _message = null;
    });

    try {
      final res = await AuthService.forgotPassword(_emailController.text.trim());
      if (res['error'] != null) {
        setState(() {
          _errorMessage = res['error'];
          _isLoading = false;
        });
      } else {
        setState(() {
          _otpSent = true;
          _isLoading = false;
          _message = res['message'] ?? 'Código OTP de recuperación enviado.';
          if (res['otp'] != null) {
            _otpController.text = res['otp'].toString();
          }
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Error de conexión: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _handleResetPassword() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _message = null;
    });

    try {
      final res = await AuthService.resetPassword(
        email: _emailController.text.trim(),
        otp: _otpController.text.trim(),
        newPassword: _newPasswordController.text.trim(),
      );

      if (res['error'] != null) {
        setState(() {
          _errorMessage = res['error'];
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(res['message'] ?? 'Contraseña restablecida exitosamente.')),
          );
          Navigator.pop(context);
        }
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Error de conexión: $e';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: Stack(
        children: [
          // Background Image
          Positioned.fill(
            child: Image.asset(
              'images/auth/auth_forgot_password.webp',
              fit: BoxFit.cover,
            ),
          ),
          // Foreground content
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.start,
                    children: [
                      // Back button circular
                      Align(
                        alignment: Alignment.centerLeft,
                        child: InkWell(
                          onTap: () => Navigator.pop(context),
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.04),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: const Icon(Icons.arrow_back_ios_new_rounded, size: 15, color: Color(0xFF1F1A15)),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      // Card flotante marfil
                      Container(
                        padding: const EdgeInsets.all(28.0),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
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
                              const SizedBox(height: 12),
                              // Title
                              const Text(
                                '¿Olvidaste tu contraseña?',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1F1A15),
                                ),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 12),
                              // Subtitle
                              Text(
                                _otpSent
                                    ? 'Ingresa el código y tu nueva contraseña'
                                    : 'Ingresa tu correo electrónico registrado para recibir un código OTP de recuperación.',
                                style: const TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 13.5,
                                  color: Color(0xFF8C7E74),
                                  height: 1.4,
                                ),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 28),
                              // Error message
                              if (_errorMessage != null) ...[
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFDF2F0),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: const Color(0xFFF5D6D0), width: 1.0),
                                  ),
                                  child: Text(
                                    _errorMessage!,
                                    style: const TextStyle(color: Color(0xFF9E4B3D), fontSize: 13),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                                const SizedBox(height: 16),
                              ],
                              // Success message
                              if (_message != null) ...[
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFAF6EE),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: const Color(0xFFC5A052), width: 1.0),
                                  ),
                                  child: Text(
                                    _message!,
                                    style: const TextStyle(color: Color(0xFF1F1A15), fontSize: 13, fontWeight: FontWeight.w600),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                                const SizedBox(height: 16),
                              ],
                              // Email field
                              S4TextField(
                                controller: _emailController,
                                label: 'Correo electrónico',
                                hint: 'Ingresa tu correo',
                                prefixIcon: const Icon(Icons.email_outlined, color: Color(0xFFC5A052)),
                                keyboardType: TextInputType.emailAddress,
                                enabled: !_otpSent,
                                validator: (v) {
                                  if (v == null || v.trim().isEmpty) return 'El correo es obligatorio';
                                  if (!v.contains('@')) return 'Correo no válido';
                                  return null;
                                },
                                style: context.bodyContext,
                              ),
                              const SizedBox(height: 16),
                              // OTP and new password fields (shown after OTP sent)
                              if (_otpSent) ...[
                                S4TextField(
                                  controller: _otpController,
                                  label: 'Código OTP (6 dígitos)',
                                  hint: '',
                                  prefixIcon: const Icon(Icons.pin_outlined, color: Color(0xFFC5A052)),
                                  keyboardType: TextInputType.number,
                                  validator: (v) {
                                    if (v == null || v.trim().length < 6) return 'Ingresa el código OTP completo';
                                    return null;
                                  },
                                  style: context.bodyContext,
                                ),
                                const SizedBox(height: 16),
                                S4TextField(
                                  controller: _newPasswordController,
                                  label: 'Nueva contraseña',
                                  hint: 'Mínimo 6 caracteres',
                                  prefixIcon: const Icon(Icons.lock_outline, color: Color(0xFFC5A052)),
                                  obscureText: _obscurePassword,
                                  suffixIcon: IconButton(
                                    icon: Icon(
                                      _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                                      color: const Color(0xFFC5A052),
                                    ),
                                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().length < 6) return 'Mínimo 6 caracteres';
                                    return null;
                                  },
                                  style: context.bodyContext,
                                ),
                              ],
                              const SizedBox(height: 24),
                              // Submit button (Gold Gradient)
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
                                  onPressed: _isLoading
                                      ? null
                                      : (_otpSent ? _handleResetPassword : _handleSendOtp),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.transparent,
                                    shadowColor: Colors.transparent,
                                    foregroundColor: const Color(0xFF1F1A15),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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
                                          _otpSent ? 'Restablecer Contraseña' : 'Enviar Código OTP',
                                          style: const TextStyle(
                                            fontFamily: 'Inter',
                                            fontSize: 15,
                                            fontWeight: FontWeight.bold,
                                            color: Color(0xFF1F1A15),
                                            letterSpacing: 0.6,
                                          ),
                                        ),
                                ),
                              ),
                              // Change email button (shown after OTP sent)
                              if (_otpSent) ...[
                                TextButton(
                                  onPressed: _isLoading
                                      ? null
                                      : () {
                                          setState(() {
                                            _otpSent = false;
                                            _errorMessage = null;
                                            _message = null;
                                          });
                                        },
                                  child: const Text('¿Cambiar correo?', style: TextStyle(color: Color(0xFFC5A052), fontWeight: FontWeight.bold)),
                                ),
                              ],
                            ],
                          ),
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