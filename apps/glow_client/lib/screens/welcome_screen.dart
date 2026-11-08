import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'capture_screen.dart';
import 'results_screen.dart';

class BiometricWelcomeScreen extends StatefulWidget {
  const BiometricWelcomeScreen({super.key});

  @override
  State<BiometricWelcomeScreen> createState() => _BiometricWelcomeScreenState();
}

class _BiometricWelcomeScreenState extends State<BiometricWelcomeScreen> {
  @override
  void initState() {
    super.initState();
    _checkExistingConsent();
  }

  Future<void> _checkExistingConsent() async {
    // Y-F1f: no basta con «tiene permiso». Si autorizó con un texto anterior, el
    // permiso no cubre lo que el sistema guarda hoy (la 2.1 añadió la huella de la
    // foto), así que se le pide aceptar el vigente en vez de pasar de largo.
    final estado = await BiometricService.getConsentState();
    if (!mounted) return;

    if (estado.canScan) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const CaptureScreen()),
      );
      return;
    }

    if (estado.needsReconsent) {
      setState(() {
        _needsReconsent = true;
        _consentAccepted = false;
      });
    }
  }

  bool _consentAccepted = false;
  bool _isRegisteringConsent = false;
  Map<String, dynamic>? _termsForAcceptance;

  /// Autorizó con un texto anterior al vigente: hay que volver a aceptarlo.
  bool _needsReconsent = false;

  Future<Map<String, dynamic>?> _showPrivacyPolicyModal(
      BuildContext context, bool isMen) async {
    final terms = await BiometricService.getConsentTerms();
    if (!mounted) return null;
    final processors = (terms['processors'] as List? ?? const [])
        .whereType<Map>()
        .map((p) =>
            '${p['name']} — ${p['country']}: ${p['purpose']} (datos: ${p['data_shared']})')
        .join('\n');
    final rights = (terms['rights'] as List? ?? const []).join('\n• ');
    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: BoxDecoration(
          color: isMen ? MensTheme.obsidianCard : GlowTokens.creamSilk,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border.all(
            color: isMen
                ? MensTheme.champagneGold.withValues(alpha: 0.3)
                : GlowTokens.terracota.withValues(alpha: 0.3),
          ),
        ),
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 45,
                height: 5,
                decoration: BoxDecoration(
                  color: Colors.grey.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Icon(
                  Icons.verified_user_outlined,
                  color: isMen ? MensTheme.champagneGold : GlowTokens.terracota,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Política de Tratamiento Biométrico (Ley 1581)',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: isMen
                          ? MensTheme.textPrimary
                          : GlowTokens.nightAndean,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                child: Text(
                  '${terms['controller']['name']} es responsable del tratamiento. Contacto: ${terms['controller']['contact']}.\n\n'
                  'VERSIÓN ${terms['version']} · DATOS SENSIBLES\n${terms['sensitive_data']}\n\n'
                  'FINALIDAD\n${terms['purpose']}\n\n'
                  'CARÁCTER FACULTATIVO\n${terms['optional']}\n\n'
                  'ENCARGADOS Y TRANSFERENCIAS\n$processors\n\n'
                  '${terms['international_transfer_notice']}\n\n'
                  'CONSERVACIÓN\n${terms['retention']}\n\n'
                  'HUELLA TÉCNICA\n${terms['photo_fingerprint']}\n\n'
                  'TUS DERECHOS\n• $rights\n\n'
                  '${terms['channel']}\n\n'
                  '${terms['authorization']}',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.6,
                    color: isMen
                        ? MensTheme.textSecondary
                        : GlowTokens.nightAndean.withValues(alpha: 0.85),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context, terms),
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      isMen ? MensTheme.champagneGold : GlowTokens.terracota,
                  foregroundColor: isMen ? Colors.black : Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Volver a la autorización'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleStartScan(BuildContext context) async {
    if (!_consentAccepted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              '⚠️ Debes autorizar el tratamiento de datos biométricos para continuar.'),
          backgroundColor: Colors.amber,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    setState(() {
      _isRegisteringConsent = true;
    });

    // Se capturan antes del await: usar `context` después de una espera asíncrona es
    // lo que marca el analizador, y con razón.
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    try {
      // Registrar consentimiento auditable en el Backend de PostgreSQL/Dashboard B2B
      final terms = _termsForAcceptance;
      if (terms == null) {
        messenger.showSnackBar(const SnackBar(
            content: Text(
                'Lee el aviso vigente y autoriza expresamente para continuar.')));
        if (mounted) setState(() => _isRegisteringConsent = false);
        return;
      }
      await BiometricService.saveConsent(terms: terms);
    } catch (e) {
      debugPrint('⚠️ No se pudo registrar el consentimiento: $e');
      messenger.showSnackBar(
        const SnackBar(
            content: Text(
                'No se pudo guardar tu consentimiento. Revisa tu conexión e inténtalo de nuevo.')),
      );
      if (mounted) setState(() => _isRegisteringConsent = false);
      return;
    }

    if (mounted) {
      setState(() => _isRegisteringConsent = false);
      navigator.pushReplacement(
        MaterialPageRoute(builder: (_) => const CaptureScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AudienceMode>(
      valueListenable: AudienceService.currentAudience,
      builder: (context, currentMode, child) {
        final isMen = currentMode == AudienceMode.men;

        return Scaffold(
          backgroundColor:
              isMen ? MensTheme.obsidianBg : const Color(0xFFB17A48),
          body: Stack(
            children: [
              // 1. Imagen de Fondo de Alta Definición Haute Joaillerie
              Positioned.fill(
                child: isMen
                    ? Container(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              MensTheme.obsidianBg,
                              MensTheme.obsidianCard,
                              MensTheme.obsidianBg,
                            ],
                          ),
                        ),
                      )
                    : Image.asset(
                        'assets/images/aura_welcome_poster.webp',
                        fit: BoxFit.cover,
                        alignment: Alignment.topCenter,
                      ),
              ),

              // 2. Capa de Controles Interactivos (Contrato y Botón de Inicio)
              SafeArea(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 560),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 24.0, vertical: 16.0),
                      child: Column(
                        children: [
                          // Botón sutil de retroceso si existe historial de navegación
                          Align(
                            alignment: Alignment.topLeft,
                            child: Navigator.canPop(context)
                                ? Container(
                                    decoration: BoxDecoration(
                                      color:
                                          Colors.black.withValues(alpha: 0.35),
                                      shape: BoxShape.circle,
                                    ),
                                    child: IconButton(
                                      icon: const Icon(Icons.arrow_back_ios_new,
                                          color: Colors.white, size: 18),
                                      onPressed: () =>
                                          Navigator.maybePop(context),
                                    ),
                                  )
                                : const SizedBox(height: 24),
                          ),

                          const Spacer(),

                          // 🛡️ Contenedor Frosted Glass del Contrato & Habeas Data (Ley 1581)
                          // Y-F1f: aviso de re-consentimiento cuando el permiso es de
                          // una versión anterior del texto.
                          if (_needsReconsent) ...[
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFD4AF37)
                                    .withValues(alpha: 0.14),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: const Color(0xFFD4AF37)
                                      .withValues(alpha: 0.55),
                                ),
                              ),
                              child: const Row(
                                children: [
                                  Icon(Icons.privacy_tip_outlined,
                                      size: 18, color: Color(0xFFE5C158)),
                                  SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Actualizamos el aviso de datos biométricos: ahora dice cuánto tiempo conservamos tus datos y qué se borra, y cuándo. Necesitamos que lo aceptes de nuevo para seguir midiendo.',
                                      style: TextStyle(
                                          fontSize: 11.5,
                                          color: Colors.white,
                                          height: 1.35),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 10),
                          ],
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1F1A15)
                                  .withValues(alpha: 0.76),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0xFFD4AF37)
                                    .withValues(alpha: 0.5),
                                width: 1.0,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.3),
                                  blurRadius: 14,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              children: [
                                Checkbox(
                                  value: _consentAccepted,
                                  activeColor: const Color(0xFFD4AF37),
                                  checkColor: Colors.black,
                                  side: const BorderSide(
                                      color: Color(0xFFD4AF37), width: 1.5),
                                  onChanged: (val) async {
                                    if (val != true) {
                                      setState(() {
                                        _consentAccepted = false;
                                        _termsForAcceptance = null;
                                      });
                                      return;
                                    }
                                    try {
                                      final terms =
                                          await _showPrivacyPolicyModal(
                                              context, isMen);
                                      if (!mounted) return;
                                      setState(() {
                                        _termsForAcceptance = terms;
                                        _consentAccepted = terms != null;
                                      });
                                    } catch (error) {
                                      if (!mounted) return;
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(SnackBar(
                                              content: Text(
                                                  'No se pudo cargar el aviso: $error')));
                                    }
                                  },
                                ),
                                Expanded(
                                  child: GestureDetector(
                                    onTap: () async {
                                      try {
                                        final terms =
                                            await _showPrivacyPolicyModal(
                                                context, isMen);
                                        if (terms != null && mounted)
                                          setState(() =>
                                              _termsForAcceptance = terms);
                                      } catch (error) {
                                        if (mounted)
                                          ScaffoldMessenger.of(context)
                                              .showSnackBar(SnackBar(
                                                  content: Text(
                                                      'No se pudo cargar el aviso: $error')));
                                      }
                                    },
                                    child: RichText(
                                      text: const TextSpan(
                                        text:
                                            'Autorizo expresamente el tratamiento biométrico y, si aplica, su transferencia internacional según la ',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.white,
                                          height: 1.3,
                                        ),
                                        children: [
                                          TextSpan(
                                            text:
                                                'Política de Tratamiento de Datos (Ley 1581)',
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                              decoration:
                                                  TextDecoration.underline,
                                              color: Color(0xFFE5C158),
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
                          const SizedBox(height: 14),

                          // Botón Principal de Inicio del Ritual
                          SizedBox(
                            width: double.infinity,
                            height: 56,
                            child: ElevatedButton(
                              onPressed: _isRegisteringConsent
                                  ? null
                                  : () => _handleStartScan(context),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: _consentAccepted
                                    ? const Color(0xFFC5A052)
                                    : const Color(0xFF7A6B5A)
                                        .withValues(alpha: 0.55),
                                foregroundColor: _consentAccepted
                                    ? const Color(0xFF14100C)
                                    : Colors.white70,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(28),
                                ),
                                elevation: _consentAccepted ? 6 : 0,
                              ),
                              child: _isRegisteringConsent
                                  ? const SizedBox(
                                      height: 22,
                                      width: 22,
                                      child: CircularProgressIndicator(
                                          color: Colors.black,
                                          strokeWidth: 2.5),
                                    )
                                  : Text(
                                      isMen
                                          ? 'Iniciar Escaneo de Visagismo'
                                          : 'Iniciar Ritual de Belleza Aura',
                                      style: const TextStyle(
                                        fontFamily: 'CormorantGaramond',
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold,
                                        letterSpacing: 0.5,
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(height: 12),

                          // 🎭 Botón Modo Demostración (Mock Flujo Completo sin saldo)
                          SizedBox(
                            width: double.infinity,
                            height: 48,
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => ResultsScreen(
                                      result: BiometricService
                                          .getDemoBiometricResult(),
                                    ),
                                  ),
                                );
                              },
                              icon: const Icon(Icons.auto_fix_high,
                                  color: Color(0xFFE5C158), size: 18),
                              label: const Text(
                                '🎭 Modo Demostración (Ver Flujo Sin Saldo)',
                                style: TextStyle(
                                  color: Color(0xFFE5C158),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                              ),
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(
                                    color: Color(0xFFD4AF37), width: 1.2),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(24)),
                                backgroundColor: const Color(0xFF1F1A15)
                                    .withValues(alpha: 0.65),
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
