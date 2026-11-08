import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Local device unlock for the already authenticated account.
/// The biometric template never leaves the device and no password is stored.
class BiometricLoginService {
  BiometricLoginService._();

  static const _enabledKey = 'biometric_login_enabled';
  static final LocalAuthentication _auth = LocalAuthentication();

  static Future<bool> get isEnabled async {
    if (kIsWeb) return false;
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? false;
  }

  /// Prompts first, and only saves the preference after successful verification.
  static Future<bool> enable() async {
    if (kIsWeb) return false;
    final enrolled = await _auth.getAvailableBiometrics();
    if (enrolled.isEmpty) return false;
    final authenticated = await _auth.authenticate(
      localizedReason:
          'Confirma tu identidad para habilitar el inicio biométrico en GlowApp',
      biometricOnly: true,
    );
    if (!authenticated) return false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, true);
    return true;
  }

  static Future<void> disable() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, false);
  }

  static Future<bool> authenticate() async {
    if (kIsWeb || !await isEnabled) return false;
    final enrolled = await _auth.getAvailableBiometrics();
    if (enrolled.isEmpty) return false;
    return _auth.authenticate(
      localizedReason: 'Confirma tu identidad para iniciar sesión en GlowApp',
      biometricOnly: true,
    );
  }
}
