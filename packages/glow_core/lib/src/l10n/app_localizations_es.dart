// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get bookingTitle => 'Reserva';

  @override
  String get step1Title => '1. Selecciona un Servicio';

  @override
  String get step2Title => '2. Elige una Fecha';

  @override
  String get step3Title => '3. Horarios Disponibles';

  @override
  String get step4Title => '4. Dirección del Servicio';

  @override
  String get addressButtonLabel => '📍 Usar dirección habitual (Casa)';

  @override
  String get addressFieldHint =>
      'Ej: Calle 24 # 95-32, Torre 2, Apto 402, Fontibón';

  @override
  String get addressFieldLabel => 'Dirección del servicio';

  @override
  String get notesLabel => 'Notas adicionales (opcional)';

  @override
  String get backButton => 'Atrás';

  @override
  String get continueButton => 'Continuar';

  @override
  String get skipAndViewSummary => 'Omitir y Ver Resumen';

  @override
  String get confirmAndPay => 'Confirmar y Pagar';

  @override
  String get registerUserType => 'Tipo de cuenta';

  @override
  String get registerFullNameLabel => 'Nombre completo';

  @override
  String get registerFullNameHint => 'Ingresa tu nombre completo';

  @override
  String get registerFullNameError => 'El nombre completo es obligatorio';

  @override
  String get registerEmailLabel => 'Correo electrónico';

  @override
  String get registerEmailHint => 'Ingresa tu correo';

  @override
  String get registerEmailError => 'Correo válido requerido';

  @override
  String get registerPasswordLabel => 'Contraseña';

  @override
  String get registerPasswordHint => 'Mínimo 6 caracteres';

  @override
  String get registerPasswordError =>
      'La contraseña debe tener al menos 6 caracteres';

  @override
  String get registerPhoneLabel => 'Número de teléfono';

  @override
  String get registerPhoneHint => 'Ingresa tu número de teléfono';

  @override
  String get registerCreateAccount => 'Crear cuenta';
}
