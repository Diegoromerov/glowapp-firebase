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

  /// Autorizó con un texto anterior al vigente: hay que volver a aceptarlo.
  bool _needsReconsent = false;

  void _showPrivacyPolicyModal(BuildContext context, bool isMen) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: BoxDecoration(
          color: isMen ? MensTheme.obsidianCard : GlowTokens.creamSilk,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border.all(
            color: isMen ? MensTheme.champagneGold.withOpacity(0.3) : GlowTokens.terracota.withOpacity(0.3),
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
                  color: Colors.grey.withOpacity(0.4),
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
                      color: isMen ? MensTheme.textPrimary : GlowTokens.nightAndean,
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
                  'De conformidad con la Ley Estatutaria 1581 de 2012 de Habeas Data de Colombia y el Decreto 1377 de 2013, te informamos que la captura de tu imagen facial y/o manos se considera un DATO SENSIBLE BIOMÉTRICO.\n\n'
                  '1. FINALIDAD DEL PROCESAMIENTO:\n'
                  'Tus fotos serán procesadas mediante algoritmos de Visión Computacional (MLKit/YouCam/ai_worker) y LLMs (DeepSeek/Gemini) con la única finalidad de determinar tu subtono de piel, estación cromática, métricas cutáneas y sugerirte productos de cuidado personal.\n\n'
                  '2. ALMACENAMIENTO:\n'
                  'GlowApp no conserva la imagen original: se envía al encargado del tratamiento para el análisis y solo se guardan las métricas resultantes, cifradas con AES-256-GCM.\n\n'
                  '3. ENCARGADOS DEL TRATAMIENTO Y TRANSFERENCIA INTERNACIONAL (Ley 1581, art. 26):\n'
                  'Tu fotografía facial se procesa con Perfect Corp. (YouCam AI Skin Analysis), con sede en Taiwán. La fotografía de manos se procesa con Google (Gemini, Estados Unidos). El texto de tu consulta se vectoriza con NVIDIA (Nemotron vía NIM, Estados Unidos) y las métricas numéricas, sin imagen, se envían a DeepSeek (China) para redactar la recomendación. Esto implica transferencia internacional de tus datos, amparada en esta autorización expresa.\n\n'
                  '4. REGISTRO AUDITABLE:\n'
                  'Al marcar la casilla de autorización, aceptaste registrar un token auditable con tu ID de usuario, IP de conexión, User-Agent y timestamp en nuestro panel de control B2B / Dashboard Administrativo.\n\n'
                  '5. CANALES DE ATENCIÓN Y REVOCATORIA (DERECHOS ARCO):\n'
                  'Puedes solicitar el acceso, actualización, rectificación o supresión de tus datos en cualquier momento escribiendo al correo oficial: habeasdata@glowapp.com o desde la sección de Ajustes de tu perfil.',
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.6,
                    color: isMen ? MensTheme.textSecondary : GlowTokens.nightAndean.withOpacity(0.85),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: isMen ? MensTheme.champagneGold : GlowTokens.terracota,
                  foregroundColor: isMen ? Colors.black : Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Entendido y Cerrar'),
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
          content: Text('⚠️ Debes autorizar el tratamiento de datos biométricos para continuar.'),
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
      await BiometricService.saveConsent();
    } catch (e) {
      debugPrint('⚠️ No se pudo registrar el consentimiento: $e');
      messenger.showSnackBar(
        const SnackBar(content: Text('No se pudo guardar tu consentimiento. Revisa tu conexión e inténtalo de nuevo.')),
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
          backgroundColor: isMen ? MensTheme.obsidianBg : const Color(0xFFB17A48),
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
                        'images/aura_welcome_poster.webp',
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
                      padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
                      child: Column(
                        children: [
                          // Botón sutil de retroceso si existe historial de navegación
                          Align(
                            alignment: Alignment.topLeft,
                            child: Navigator.canPop(context)
                                ? Container(
                                    decoration: BoxDecoration(
                                      color: Colors.black.withOpacity(0.35),
                                      shape: BoxShape.circle,
                                    ),
                                    child: IconButton(
                                      icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 18),
                                      onPressed: () => Navigator.maybePop(context),
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
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: const Color(0xFFD4AF37).withOpacity(0.14),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: const Color(0xFFD4AF37).withOpacity(0.55),
                                ),
                              ),
                              child: const Row(
                                children: [
                                  Icon(Icons.privacy_tip_outlined, size: 18, color: Color(0xFFE5C158)),
                                  SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Actualizamos el aviso de datos biométricos: ahora dice cuánto tiempo conservamos tus datos y qué se borra, y cuándo. Necesitamos que lo aceptes de nuevo para seguir midiendo.',
                                      style: TextStyle(fontSize: 11.5, color: Colors.white, height: 1.35),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 10),
                          ],
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1F1A15).withOpacity(0.76),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0xFFD4AF37).withOpacity(0.5),
                                width: 1.0,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withOpacity(0.3),
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
                                  side: const BorderSide(color: Color(0xFFD4AF37), width: 1.5),
                                  onChanged: (val) {
                                    setState(() {
                                      _consentAccepted = val ?? false;
                                    });
                                  },
                                ),
                                Expanded(
                                  child: GestureDetector(
                                    onTap: () => _showPrivacyPolicyModal(context, isMen),
                                    child: RichText(
                                      text: const TextSpan(
                                        text: 'Autorizo el uso de mi imagen biométrica según la ',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.white,
                                          height: 1.3,
                                        ),
                                        children: [
                                          TextSpan(
                                            text: 'Política de Tratamiento de Datos (Ley 1581)',
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold,
                                              decoration: TextDecoration.underline,
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
                              onPressed: _isRegisteringConsent ? null : () => _handleStartScan(context),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: _consentAccepted
                                    ? const Color(0xFFC5A052)
                                    : const Color(0xFF7A6B5A).withOpacity(0.55),
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
                                      child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2.5),
                                    )
                                  : Text(
                                      isMen ? 'Iniciar Escaneo de Visagismo' : 'Iniciar Ritual de Belleza Aura',
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
                                      result: BiometricService.getDemoBiometricResult(),
                                    ),
                                  ),
                                );
                              },
                              icon: const Icon(Icons.auto_fix_high, color: Color(0xFFE5C158), size: 18),
                              label: const Text(
                                '🎭 Modo Demostración (Ver Flujo Sin Saldo)',
                                style: TextStyle(
                                  color: Color(0xFFE5C158),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                              ),
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Color(0xFFD4AF37), width: 1.2),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                                backgroundColor: const Color(0xFF1F1A15).withOpacity(0.65),
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

