// frontend/lib/screens/auth/forgot_password_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

  String? _validateEmail(String? value) {
    final email = value?.trim() ?? '';
    if (email.isEmpty) return 'El correo es obligatorio';
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      return 'Correo no válido';
    }
    return null;
  }

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    _newPasswordController.dispose();
    super.dispose();
  }

  Future<void> _handleSendOtp() async {
    final emailError = _validateEmail(_emailController.text);
    if (emailError != null) {
      setState(() => _errorMessage = emailError);
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _message = null;
    });
    if (_otpSent) {
      _otpController.clear();
    }

    try {
      final res =
          await AuthService.forgotPassword(_emailController.text.trim());
      if (!mounted) return;
      if (res['error'] != null) {
        setState(() {
          _errorMessage = res['error'];
          _isLoading = false;
        });
      } else {
        String? localOtp;
        if (res['otp'] != null) {
          // Older local builds can return the OTP for development only.
          final baseUrl = await AuthService.getBaseUrl();
          if (baseUrl.contains('localhost') || baseUrl.contains('127.0.0.1')) {
            localOtp = res['otp'].toString();
          }
        }
        if (!mounted) return;
        setState(() {
          _otpSent = true;
          _isLoading = false;
          _message = res['message'] ?? 'Código OTP de recuperación enviado.';
          if (localOtp != null) _otpController.text = localOtp;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = mensajeHumano(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _handleResetPassword() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _message = null;
    });

    try {
      final res = await AuthService.resetPassword(
        email: _emailController.text.trim(),
        otp: _otpController.text.trim(),
        newPassword: _newPasswordController.text,
      );

      if (!mounted) return;
      if (res['error'] != null) {
        setState(() {
          _errorMessage = res['error'];
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(
                  res['message'] ?? 'Contraseña restablecida exitosamente.')),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = mensajeHumano(e);
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
              'assets/images/auth/auth_forgot_password.webp',
              fit: BoxFit.cover,
            ),
          ),
          // Foreground content
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 24.0, vertical: 16.0),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.start,
                    children: [
                      // Back button circular
                      Align(
                        alignment: Alignment.centerLeft,
                        child: InkWell(
                          onTap: () {
                            if (Navigator.canPop(context)) {
                              Navigator.pop(context);
                            } else {
                              Navigator.pushReplacementNamed(
                                  context, '/auth/login');
                            }
                          },
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(
                                  color: const Color(0xFFE8DFD8), width: 1),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.04),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: const Icon(Icons.arrow_back_ios_new_rounded,
                                size: 15, color: Color(0xFF1F1A15)),
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
                          border: Border.all(
                              color: const Color(0xFFEFE8DE), width: 1.2),
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
                                    border: Border.all(
                                        color: const Color(0xFFF5D6D0),
                                        width: 1.0),
                                  ),
                                  child: Text(
                                    _errorMessage!,
                                    style: const TextStyle(
                                        color: Color(0xFF9E4B3D), fontSize: 13),
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
                                    border: Border.all(
                                        color: const Color(0xFFC5A052),
                                        width: 1.0),
                                  ),
                                  child: Text(
                                    _message!,
                                    style: const TextStyle(
                                        color: Color(0xFF1F1A15),
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                                const SizedBox(height: 16),
                              ],
                              // Email field
                              _buildFormField(
                                controller: _emailController,
                                label: 'Correo electrónico',
                                hint: 'Ingresa tu correo',
                                icon: Icons.email_outlined,
                                keyboardType: TextInputType.emailAddress,
                                enabled: !_otpSent,
                                validator: _validateEmail,
                              ),
                              const SizedBox(height: 16),
                              // OTP and new password fields (shown after OTP sent)
                              if (_otpSent) ...[
                                _buildFormField(
                                  controller: _otpController,
                                  label: 'Código OTP (6 dígitos)',
                                  hint: 'Ingresa el código del correo',
                                  icon: Icons.pin_outlined,
                                  keyboardType: TextInputType.number,
                                  validator: (value) {
                                    if (value == null ||
                                        !RegExp(r'^\d{6}$')
                                            .hasMatch(value.trim())) {
                                      return 'Ingresa los 6 dígitos del código';
                                    }
                                    return null;
                                  },
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                    LengthLimitingTextInputFormatter(6),
                                  ],
                                ),
                                const SizedBox(height: 16),
                                _buildFormField(
                                  controller: _newPasswordController,
                                  label: 'Nueva contraseña',
                                  hint: 'Mínimo 6 caracteres',
                                  icon: Icons.lock_outline,
                                  obscureText: _obscurePassword,
                                  suffixIcon: IconButton(
                                    tooltip: 'Mostrar contraseña',
                                    icon: Icon(
                                      _obscurePassword
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined,
                                      color: const Color(0xFFC5A052),
                                    ),
                                    onPressed: () => setState(() =>
                                        _obscurePassword = !_obscurePassword),
                                  ),
                                  validator: (value) {
                                    if (value == null ||
                                        value.trim().length < 6) {
                                      return 'Mínimo 6 caracteres';
                                    }
                                    return null;
                                  },
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
                                  onPressed: _isLoading
                                      ? null
                                      : (_otpSent
                                          ? _handleResetPassword
                                          : _handleSendOtp),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.transparent,
                                    shadowColor: Colors.transparent,
                                    foregroundColor: const Color(0xFF1F1A15),
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
                                            strokeWidth: 2.5,
                                          ),
                                        )
                                      : Text(
                                          _otpSent
                                              ? 'Restablecer Contraseña'
                                              : 'Enviar Código OTP',
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
                                            _otpController.clear();
                                            _newPasswordController.clear();
                                          });
                                        },
                                  child: const Text('¿Cambiar correo?',
                                      style: TextStyle(
                                          color: Color(0xFF8A6A2F),
                                          fontWeight: FontWeight.bold)),
                                ),
                                TextButton(
                                  onPressed: _isLoading ? null : _handleSendOtp,
                                  child: const Text('Reenviar código',
                                      style: TextStyle(
                                          color: Color(0xFF8A6A2F),
                                          fontWeight: FontWeight.bold)),
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

  Widget _buildFormField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    required FormFieldValidator<String> validator,
    TextInputType keyboardType = TextInputType.text,
    bool enabled = true,
    bool obscureText = false,
    Widget? suffixIcon,
    List<TextInputFormatter>? inputFormatters,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text(label,
              style: const TextStyle(
                  fontFamily: 'Inter', fontSize: 13, color: Color(0xFF1F1A15))),
        ),
        TextFormField(
          controller: controller,
          validator: validator,
          keyboardType: keyboardType,
          enabled: enabled,
          obscureText: obscureText,
          inputFormatters: inputFormatters,
          style: const TextStyle(
              fontFamily: 'Inter', fontSize: 14, color: Color(0xFF1F1A15)),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Icon(icon, color: const Color(0xFFC5A052)),
            suffixIcon: suffixIcon,
            filled: true,
            fillColor: const Color(0xFFFAF8F5),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE8DFD8))),
            enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFE8DFD8))),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    const BorderSide(color: Color(0xFFC5A052), width: 1.5)),
            errorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFF9E4B3D))),
            focusedErrorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    const BorderSide(color: Color(0xFF9E4B3D), width: 1.5)),
          ),
        ),
      ],
    );
  }
}
