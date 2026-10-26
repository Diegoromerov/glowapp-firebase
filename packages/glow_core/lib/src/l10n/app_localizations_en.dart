// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get bookingTitle => 'Booking';

  @override
  String get step1Title => '1. Select a Service';

  @override
  String get step2Title => '2. Choose a Date';

  @override
  String get step3Title => '3. Available Times';

  @override
  String get step4Title => '4. Service Address';

  @override
  String get addressButtonLabel => '📍 Use Home Address';

  @override
  String get addressFieldHint =>
      'e.g., 24th St #95-32, Tower 2, Apt 402, Fontibón';

  @override
  String get addressFieldLabel => 'Service Address';

  @override
  String get notesLabel => 'Additional Notes';

  @override
  String get backButton => 'Back';

  @override
  String get continueButton => 'Continue';

  @override
  String get skipAndViewSummary => 'Skip and View Summary';

  @override
  String get confirmAndPay => 'Confirm and Pay';

  @override
  String get registerUserType => 'Account Type';

  @override
  String get registerFullNameLabel => 'Full Name';

  @override
  String get registerFullNameHint => 'Enter your full name';

  @override
  String get registerFullNameError => 'Full name is required';

  @override
  String get registerEmailLabel => 'Email';

  @override
  String get registerEmailHint => 'Enter your email';

  @override
  String get registerEmailError => 'Valid email is required';

  @override
  String get registerPasswordLabel => 'Password';

  @override
  String get registerPasswordHint => 'At least 6 characters';

  @override
  String get registerPasswordError => 'Password must be at least 6 characters';

  @override
  String get registerPhoneLabel => 'Phone Number';

  @override
  String get registerPhoneHint => 'Enter your phone number';

  @override
  String get registerCreateAccount => 'Create Account';
}
