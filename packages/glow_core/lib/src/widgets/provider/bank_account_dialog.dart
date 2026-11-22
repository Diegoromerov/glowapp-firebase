// lib/widgets/provider/bank_account_dialog.dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/belleza_luxe_theme.dart';
import '../../services/api_service.dart';

class BankAccountFormDialog extends StatefulWidget {
  final VoidCallback? onSuccess;
  final VoidCallback? onOpenSupport;
  final bool isFirstAccount;
  final bool isGoogleOnly;
  final Widget? Function(ValueChanged<String> onToken)? googleReauthBuilder;

  const BankAccountFormDialog({
    super.key,
    this.onSuccess,
    this.onOpenSupport,
    this.isFirstAccount = false,
    this.isGoogleOnly = false,
    this.googleReauthBuilder,
  });

  @override
  State<BankAccountFormDialog> createState() => _BankAccountFormDialogState();
}

class _BankAccountFormDialogState extends State<BankAccountFormDialog> {
  final _formKey = GlobalKey<FormState>();

  String _tipoCuenta = 'NEQUI';
  String _banco = 'Nequi';
  final _numeroCuentaController = TextEditingController();
  final _confirmarNumeroCuentaController = TextEditingController();
  final _titularNombreController = TextEditingController();
  String _titularDocumentoTipo = 'CC';
  final _titularDocumentoNumController = TextEditingController();
  final _passwordController = TextEditingController();
  final _authorizationCodeController = TextEditingController();
  String? _authorizationId;
  String? _googleIdToken;
  String? _maskedEmail;
  DateTime? _otpExpiresAt;
  DateTime? _resendAvailableAt;
  Timer? _otpTimer;
  int _flowStage = 0;
  int _reviewHours = 48;
  DateTime? _reviewAt;
  DateTime? _withdrawalsBlockedUntil;
  int _withdrawalsBlockedHours = 24;

  bool _isLoading = false;
  String? _errorMessage;
  Map? _accountStatus;

  @override
  void initState() {
    super.initState();
    _loadAccountStatus();
  }

  Future<void> _loadAccountStatus() async {
    try {
      final response = await ApiService.get('/api/wallet/bank-account');
      if (!mounted) return;
      setState(() {
        _accountStatus = response is Map ? Map.from(response) : null;
        _withdrawalsBlockedHours = int.tryParse(
              _accountStatus?['retiros_bloqueados_horas']?.toString() ?? '',
            ) ??
            24;
      });
    } catch (_) {
      // La consulta de estado no debe impedir que el prestador registre la cuenta.
    }
  }

  String _formatReviewDate(Object? value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return 'fecha por confirmar';
    return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }

  final List<String> _tiposCuenta = [
    'NEQUI',
    'DAVIPLATA',
    'AHORROS',
    'CORRIENTE',
  ];
  final List<String> _bancos = [
    'Bancolombia',
    'Banco de Bogotá',
    'Davivienda',
    'BBVA Colombia',
    'Lulo Bank',
    'RappiPay',
    'Banco de Occidente',
    'Banco Popular',
    'Scotiabank Colpatria',
  ];

  final List<String> _tiposDoc = ['CC', 'CE', 'NIT'];

  @override
  void dispose() {
    _numeroCuentaController.dispose();
    _confirmarNumeroCuentaController.dispose();
    _titularNombreController.dispose();
    _titularDocumentoNumController.dispose();
    _passwordController.dispose();
    _authorizationCodeController.dispose();
    _otpTimer?.cancel();
    super.dispose();
  }

  void _seleccionarPresetBanco(String nombreBanco, String tipoCuenta) {
    HapticFeedback.lightImpact();
    setState(() {
      _banco = nombreBanco;
      _tipoCuenta = tipoCuenta;
    });
  }

  Future<void> _handleSubmit() async {
    if (_flowStage == 0) {
      setState(() {
        _flowStage = 1;
        _errorMessage = null;
      });
      return;
    }
    if (_flowStage == 1 && !_formKey.currentState!.validate()) return;
    if (_flowStage == 1 &&
        !widget.isFirstAccount &&
        widget.isGoogleOnly &&
        _googleIdToken == null) {
      setState(
        () =>
            _errorMessage = 'Confirma tu identidad con Google para continuar.',
      );
      return;
    }
    if (_authorizationId != null && !_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final datosCuenta = {
      'tipo_cuenta': _tipoCuenta,
      'banco': _banco,
      'numero_cuenta': _numeroCuentaController.text.trim(),
      'tipo_cuenta_bancaria':
          (_tipoCuenta == 'CORRIENTE') ? 'CORRIENTE' : 'AHORROS',
      'titular_nombre': _titularNombreController.text.trim(),
      'titular_documento_tipo': _titularDocumentoTipo,
      'titular_documento_num': _titularDocumentoNumController.text.trim(),
    };

    try {
      if (_authorizationId == null) {
        final response = await ApiService.post(
          '/api/wallet/bank-account/authorization',
          {
            ...datosCuenta,
            if (!widget.isFirstAccount && !widget.isGoogleOnly)
              'current_password': _passwordController.text,
            if (!widget.isFirstAccount &&
                widget.isGoogleOnly &&
                _googleIdToken != null)
              'google_id_token': _googleIdToken,
          },
        );
        if (response is! Map || response['challenge_id'] == null) {
          throw Exception('No se pudo iniciar la autorización de seguridad.');
        }
        if (!mounted) return;
        final otpPrueba = response['modo_prueba'] == true
            ? response['otp_dev']?.toString()
            : null;
        setState(() {
          _authorizationId = response['challenge_id'].toString();
          _maskedEmail = response['correo_enmascarado']?.toString();
          _otpExpiresAt =
              DateTime.tryParse(response['expira_at']?.toString() ?? '');
          _resendAvailableAt = DateTime.now().add(const Duration(seconds: 60));
          _flowStage = 2;
          _passwordController.clear();
          _googleIdToken = null;
          _errorMessage = otpPrueba != null
              ? 'Código de prueba de staging: $otpPrueba. No se envió correo.'
              : 'Enviamos un código a ${_maskedEmail ?? 'tu correo verificado'}. Ingrésalo para confirmar esta cuenta.';
          _isLoading = false;
        });
        _otpTimer?.cancel();
        _otpTimer = Timer.periodic(const Duration(seconds: 1), (_) {
          if (!mounted) return;
          final expired =
              _otpExpiresAt != null && !_otpExpiresAt!.isAfter(DateTime.now());
          setState(() {
            if (expired) {
              _flowStage = 1;
              _authorizationId = null;
              _authorizationCodeController.clear();
              _errorMessage =
                  'El código venció. Solicita uno nuevo para continuar.';
              _otpTimer?.cancel();
            }
          });
        });
        return;
      }

      final saveResponse = await ApiService.post('/api/wallet/bank-account', {
        ...datosCuenta,
        'authorization_id': _authorizationId,
        'authorization_code': _authorizationCodeController.text.trim(),
      });

      final reviewHours = saveResponse is Map
          ? int.tryParse(saveResponse['revision_sla_horas']?.toString() ?? '')
          : null;
      final reviewAtValue = saveResponse is Map
          ? DateTime.tryParse(
              saveResponse['revision_estimada_at']?.toString() ?? '',
            )
          : null;
      final reviewAt = reviewAtValue?.toLocal();
      if (mounted) {
        setState(() {
          _flowStage = 3;
          _reviewHours = reviewHours ?? 48;
          _reviewAt = reviewAt;
          _withdrawalsBlockedUntil = DateTime.tryParse(
            saveResponse is Map
                ? saveResponse['retiros_bloqueados_hasta']?.toString() ?? ''
                : '',
          )?.toLocal();
          _withdrawalsBlockedHours = saveResponse is Map
              ? int.tryParse(
                      saveResponse['retiros_bloqueados_horas']?.toString() ??
                          '') ??
                  24
              : 24;
          _errorMessage = null;
          _isLoading = false;
        });
        _otpTimer?.cancel();
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  String _countdownText(DateTime? deadline) {
    if (deadline == null) return '10:00';
    final remaining = deadline.difference(DateTime.now());
    final seconds = remaining.inSeconds.clamp(0, 600);
    return '${(seconds ~/ 60).toString().padLeft(2, '0')}:${(seconds % 60).toString().padLeft(2, '0')}';
  }

  String _remainingOtpText() => _countdownText(_otpExpiresAt);

  String _remainingResendText() {
    if (_resendAvailableAt == null ||
        !DateTime.now().isBefore(_resendAvailableAt!)) {
      return 'ahora';
    }
    return _countdownText(_resendAvailableAt);
  }

  String _maskedDestination() {
    final number = _numeroCuentaController.text.trim();
    final ending =
        number.length >= 4 ? number.substring(number.length - 4) : '****';
    final method = _tipoCuenta == 'NEQUI'
        ? 'Nequi'
        : _tipoCuenta == 'DAVIPLATA'
            ? 'Daviplata'
            : '$_banco · ${_tipoCuenta == 'CORRIENTE' ? 'Corriente' : 'Ahorros'}';
    return '$method terminado en $ending';
  }

  Widget _buildDestinationConfirmation() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F1E5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE8DFD8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Confirma el destino',
              style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(_maskedDestination()),
          const SizedBox(height: 4),
          Text('Titular: ${_titularNombreController.text.trim()}'),
          const SizedBox(height: 8),
          Text(
            'El código se envió a ${_maskedEmail ?? 'tu correo verificado'}. El código autoriza solo este destino.',
            style: const TextStyle(fontSize: 12, color: LuxeColors.nude600),
          ),
        ],
      ),
    );
  }

  Widget _buildReviewConfirmation() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F5EE),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.hourglass_top, color: Color(0xFF047857)),
              SizedBox(width: 8),
              Text('Cuenta enviada a revisión',
                  style: TextStyle(
                      fontWeight: FontWeight.bold, color: Color(0xFF047857))),
            ],
          ),
          const SizedBox(height: 10),
          Text(_maskedDestination()),
          Text('Titular: ${_titularNombreController.text.trim()}'),
          const SizedBox(height: 8),
          Text(
              'Plazo objetivo: hasta $_reviewHours horas calendario${_reviewAt == null ? '' : ' (aprox. ${_formatReviewDate(_reviewAt!.toIso8601String())})'}.'),
          const SizedBox(height: 6),
          if (_withdrawalsBlockedUntil != null)
            Text(
                'No podrás iniciar retiros nuevos hasta ${_formatReviewDate(_withdrawalsBlockedUntil!.toIso8601String())} y hasta que la cuenta se apruebe.')
          else
            Text(
                'El bloqueo de retiros nuevos durará al menos $_withdrawalsBlockedHours horas y se mantendrá hasta la aprobación.'),
          const SizedBox(height: 8),
          const Text(
              'Te avisaremos cuando se apruebe o si necesitamos que corrijas algún dato.',
              style: TextStyle(fontSize: 12)),
        ],
      ),
    );
  }

  Future<void> _showSupportRoute() async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ayuda con correo o cuenta anterior'),
        content: const Text(
          'Por seguridad, el código solo se envía al correo verificado. Si perdiste acceso a ese correo o a la cuenta anterior, abre Más > Centro PQRSF para que soporte verifique tu identidad y te guíe. No envíes por chat el número completo de tu cuenta ni tu código de seguridad.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Volver')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              widget.onOpenSupport?.call();
            },
            child: const Text('Abrir centro PQRSF'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final awaitingCode = _flowStage == 2;
    return Dialog(
      backgroundColor: LuxeColors.nude50,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Cuenta de retiro',
                      style: TextStyle(
                        fontFamily: 'Didot',
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: LuxeColors.nude900,
                        letterSpacing: 1.0,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.close,
                        color: LuxeColors.nude900,
                        size: 20,
                      ),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Vincula tu cuenta bancaria o billetera digital para recibir transferencias directas de tu saldo acumulado.',
                  style: TextStyle(
                    fontFamily: 'JetBrainsMono',
                    fontSize: 11,
                    color: LuxeColors.nude600,
                  ),
                ),
                const SizedBox(height: 14),

                Row(
                  children: [
                    _buildStepIndicator('1', 'Método', _flowStage == 0),
                    const Expanded(child: Divider(height: 1)),
                    _buildStepIndicator('2', 'Datos', _flowStage == 1),
                    const Expanded(child: Divider(height: 1)),
                    _buildStepIndicator('3', 'Código', awaitingCode),
                    const Expanded(child: Divider(height: 1)),
                    _buildStepIndicator('4', 'Revisión', _flowStage == 3),
                  ],
                ),
                const SizedBox(height: 14),

                if (_flowStage == 0 &&
                    _accountStatus?['configurada'] == true) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF7E6),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Al cambiar tu cuenta, el destino nuevo quedará pendiente de revisión. No podrás iniciar retiros nuevos durante al menos $_withdrawalsBlockedHours horas y hasta que se apruebe. Los retiros ya enviados al procesador conservan el destino registrado al iniciarlos.',
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFF92400E)),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],

                if (_flowStage == 1 && widget.isFirstAccount) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8F5EE),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'Primera cuenta: no necesitas una contraseña de GlowApp. Confirmaremos el registro con un código enviado a tu correo verificado.',
                      style: TextStyle(fontSize: 12, color: Color(0xFF047857)),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],

                if (_accountStatus?['configurada'] == true) ...[
                  Builder(
                    builder: (context) {
                      final pending =
                          _accountStatus?['estado_verificacion'] == 'PENDIENTE';
                      final rejected =
                          _accountStatus?['estado_verificacion'] == 'RECHAZADA';
                      final approved = _accountStatus?['estado_verificacion'] ==
                              'APROBADA' ||
                          _accountStatus?['cuenta_verificada'] == true;
                      final slaHours = int.tryParse(
                            _accountStatus?['revision_sla_horas']?.toString() ??
                                '',
                          ) ??
                          48;
                      final deadline = _accountStatus?['revision_estimada_at'];
                      final masked =
                          _accountStatus?['numero_cuenta_enmascarado']
                              ?.toString();
                      return Container(
                        width: double.infinity,
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: pending
                              ? const Color(0xFFFFF7E6)
                              : rejected
                                  ? const Color(0xFFFEF2F2)
                                  : const Color(0xFFE8F5EE),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          pending
                              ? 'Tu cuenta ${masked ?? ''} está pendiente de revisión. Plazo objetivo: hasta $slaHours horas calendario (aprox. ${_formatReviewDate(deadline)}).'
                              : rejected
                                  ? 'Tu cuenta ${masked ?? ''} fue rechazada. Revisa la notificación que recibiste y registra los datos corregidos.'
                                  : approved
                                      ? 'Tu cuenta actual ${masked ?? ''} está verificada. Si registras un cambio, se revisará antes de habilitar retiros al nuevo destino.'
                                      : 'Tu cuenta ${masked ?? ''} requiere revisión. Consulta la notificación recibida.',
                          style: TextStyle(
                            fontSize: 12,
                            color: pending
                                ? const Color(0xFF92400E)
                                : rejected
                                    ? const Color(0xFFB91C1C)
                                    : const Color(0xFF047857),
                          ),
                        ),
                      );
                    },
                  ),
                ],

                if (_flowStage == 0) ...[
                  // ─── Preset Quick Bank Selector ──────────────────────────────
                  const Text(
                    'Entidad',
                    style: TextStyle(
                      fontFamily: 'JetBrainsMono',
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: LuxeColors.nude800,
                      letterSpacing: 0.6,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _buildPresetChip('Nequi', 'NEQUI'),
                      const SizedBox(width: 6),
                      _buildPresetChip('Daviplata', 'DAVIPLATA'),
                      const SizedBox(width: 6),
                      _buildPresetChip('Bancolombia', 'AHORROS',
                          label: 'Bancos'),
                    ],
                  ),
                  const SizedBox(height: 16),

                  if (_flowStage == 0)
                    TextButton.icon(
                      onPressed: _showSupportRoute,
                      icon: const Icon(Icons.support_agent, size: 16),
                      label: const Text(
                          '¿Necesitas ayuda con tu cuenta anterior?'),
                    ),
                ],

                if (_flowStage == 1 &&
                    !widget.isFirstAccount &&
                    !widget.isGoogleOnly) ...[
                  TextFormField(
                    controller: _passwordController,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(
                      labelText: 'Confirma tu contraseña actual',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    validator: (value) => (value == null || value.isEmpty)
                        ? 'Confirma tu contraseña para continuar'
                        : null,
                  ),
                ] else if (_flowStage == 1 &&
                    !widget.isFirstAccount &&
                    widget.isGoogleOnly) ...[
                  const Text(
                    'Como ingresaste con Google, confirma tu identidad con esa misma cuenta. Después enviaremos un código a tu correo.',
                    style: TextStyle(fontSize: 12, color: LuxeColors.nude600),
                  ),
                  const SizedBox(height: 10),
                  if (_googleIdToken == null)
                    widget.googleReauthBuilder?.call((token) {
                          if (!mounted) return;
                          setState(() {
                            _googleIdToken = token;
                            _errorMessage = null;
                          });
                        }) ??
                        const Text(
                          'No está disponible la confirmación con Google en este dispositivo.',
                        ),
                  if (_googleIdToken != null)
                    const Row(
                      children: [
                        Icon(
                          Icons.verified_user_outlined,
                          color: Color(0xFF047857),
                          size: 18,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Identidad de Google confirmada',
                          style: TextStyle(
                            color: Color(0xFF047857),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 12),
                ],

                if (_flowStage == 2) ...[
                  _buildDestinationConfirmation(),
                  TextFormField(
                    controller: _authorizationCodeController,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      labelText: 'Código enviado al correo verificado',
                      prefixIcon: Icon(Icons.mark_email_read_outlined),
                    ),
                    validator: (value) =>
                        (value == null || !RegExp(r'^\d{6}$').hasMatch(value))
                            ? 'Ingresa el código de 6 dígitos'
                            : null,
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      'El código vence en ${_remainingOtpText()}. Puedes solicitar otro en ${_remainingResendText()}.',
                      style: const TextStyle(
                          fontSize: 12, color: LuxeColors.nude600),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: _resendAvailableAt == null ||
                            DateTime.now().isBefore(_resendAvailableAt!)
                        ? null
                        : () => setState(() {
                              _flowStage = 1;
                              _authorizationId = null;
                              _authorizationCodeController.clear();
                              _errorMessage =
                                  'Confirma los datos y tu identidad para solicitar otro código.';
                            }),
                    icon: const Icon(Icons.refresh, size: 16),
                    label: const Text('Solicitar otro código'),
                  ),
                  TextButton.icon(
                    onPressed: _showSupportRoute,
                    icon: const Icon(Icons.support_agent, size: 16),
                    label: const Text('Perdí acceso a mi correo'),
                  ),
                ],
                const SizedBox(height: 16),

                if (_errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: (_errorMessage!.startsWith('Enviamos') ||
                              _errorMessage!.startsWith('Código de prueba'))
                          ? const Color(0xFFE8F5EE)
                          : const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _errorMessage!,
                      style: TextStyle(
                        fontSize: 12,
                        color: (_errorMessage!.startsWith('Enviamos') ||
                                _errorMessage!.startsWith('Código de prueba'))
                            ? const Color(0xFF047857)
                            : const Color(0xFFDC2626),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],

                if (_flowStage == 1) ...[
                  // TIPO DE CUENTA Y BANCO
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: _tipoCuenta,
                          decoration: const InputDecoration(
                            labelText: 'Tipo de Cuenta',
                            labelStyle: TextStyle(fontSize: 12),
                          ),
                          items: _tiposCuenta
                              .map(
                                (t) => DropdownMenuItem(
                                  value: t,
                                  child: Text(
                                    t,
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: awaitingCode
                              ? null
                              : (val) {
                                  if (val != null) {
                                    setState(() {
                                      _tipoCuenta = val;
                                      if (val == 'NEQUI') _banco = 'Nequi';
                                      if (val == 'DAVIPLATA')
                                        _banco = 'Daviplata';
                                      if ((val == 'AHORROS' ||
                                              val == 'CORRIENTE') &&
                                          !_bancos.contains(_banco)) {
                                        _banco = _bancos.first;
                                      }
                                    });
                                  }
                                },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _tipoCuenta == 'NEQUI' ||
                                _tipoCuenta == 'DAVIPLATA'
                            ? InputDecorator(
                                decoration: const InputDecoration(
                                  labelText: 'Entidad Financiera',
                                  labelStyle: TextStyle(fontSize: 12),
                                ),
                                child: Text(_banco),
                              )
                            : DropdownButtonFormField<String>(
                                value: _bancos.contains(_banco)
                                    ? _banco
                                    : _bancos.first,
                                decoration: const InputDecoration(
                                  labelText: 'Entidad Financiera',
                                  labelStyle: TextStyle(fontSize: 12),
                                ),
                                items: _bancos
                                    .map(
                                      (b) => DropdownMenuItem(
                                        value: b,
                                        child: Text(
                                          b,
                                          style: const TextStyle(fontSize: 12),
                                        ),
                                      ),
                                    )
                                    .toList(),
                                onChanged: awaitingCode
                                    ? null
                                    : (val) {
                                        if (val != null)
                                          setState(() => _banco = val);
                                      },
                              ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // NÚMERO DE CUENTA O CELULAR
                  TextFormField(
                    controller: _numeroCuentaController,
                    enabled: !awaitingCode,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText:
                          (_tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA')
                              ? 'Número de Celular (10 dígitos)'
                              : 'Número de Cuenta Bancaria',
                      hintText:
                          (_tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA')
                              ? '3001234567'
                              : '1234567890',
                    ),
                    validator: (val) {
                      final value = val?.trim() ?? '';
                      if (value.isEmpty)
                        return 'Ingresa el número de cuenta o celular';
                      if (_tipoCuenta == 'NEQUI' ||
                          _tipoCuenta == 'DAVIPLATA') {
                        if (!RegExp(r'^3\d{9}$').hasMatch(value)) {
                          return 'Usa un celular colombiano de 10 dígitos que empiece por 3';
                        }
                      } else if (!RegExp(r'^\d{6,30}$').hasMatch(value)) {
                        return 'La cuenta debe tener entre 6 y 30 dígitos';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),

                  TextFormField(
                    controller: _confirmarNumeroCuentaController,
                    enabled: !awaitingCode,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText:
                          (_tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA')
                              ? 'Confirma el número de celular'
                              : 'Confirma el número de cuenta',
                      hintText:
                          (_tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA')
                              ? 'Repite los 10 dígitos'
                              : 'Repite el número de cuenta',
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Repite el número para confirmar que esté correcto';
                      }
                      return value.trim() != _numeroCuentaController.text.trim()
                          ? 'Los números no coinciden'
                          : null;
                    },
                  ),
                  const SizedBox(height: 12),

                  // NOMBRE DEL TITULAR
                  TextFormField(
                    controller: _titularNombreController,
                    enabled: !awaitingCode,
                    decoration: const InputDecoration(
                      labelText: 'Nombre del Titular de la Cuenta',
                      hintText: 'Ej. Ana Silva',
                    ),
                    validator: (val) {
                      final value = val?.trim() ?? '';
                      if (!RegExp(
                        r"^[\p{L}][\p{L}\p{M} .,'’-]{1,98}[\p{L}.]$",
                        unicode: true,
                      ).hasMatch(value)) {
                        return 'Escribe el nombre legal completo del titular';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),

                  // TIPO Y NÚMERO DE DOCUMENTO DEL TITULAR
                  Row(
                    children: [
                      SizedBox(
                        width: 90,
                        child: DropdownButtonFormField<String>(
                          value: _titularDocumentoTipo,
                          decoration: const InputDecoration(labelText: 'Doc'),
                          items: _tiposDoc
                              .map(
                                (d) => DropdownMenuItem(
                                  value: d,
                                  child: Text(
                                    d,
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: awaitingCode
                              ? null
                              : (val) {
                                  if (val != null)
                                    setState(() => _titularDocumentoTipo = val);
                                },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _titularDocumentoNumController,
                          enabled: !awaitingCode,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          decoration: const InputDecoration(
                            labelText: 'Número de Identificación',
                            hintText: '1018234567',
                          ),
                          validator: (val) {
                            final value = val?.trim() ?? '';
                            final valid = RegExp(r'^\d{5,15}$').hasMatch(value);
                            if (!valid) return 'Revisa el número de documento';
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Información de privacidad y visualización de datos.
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withOpacity(0.08),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: const Color(0xFF10B981).withOpacity(0.2),
                      ),
                    ),
                    child: const Row(
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          color: Color(0xFF10B981),
                          size: 16,
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Los datos completos solo se consultan para validar la cuenta; en la app verás el número enmascarado.',
                            style: TextStyle(
                              fontSize: 10.5,
                              color: Color(0xFF047857),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                ],

                if (_flowStage == 3) ...[
                  _buildReviewConfirmation(),
                  const SizedBox(height: 20),
                ],

                // BOTÓN DE GUARDADO
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: LuxeColors.nude900,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: _isLoading
                        ? null
                        : _flowStage == 3
                            ? () {
                                Navigator.pop(context, true);
                                widget.onSuccess?.call();
                              }
                            : _handleSubmit,
                    child: _isLoading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2,
                            ),
                          )
                        : Text(
                            _flowStage == 3
                                ? 'LISTO'
                                : _flowStage == 2
                                    ? 'CONFIRMAR Y REGISTRAR CUENTA'
                                    : _flowStage == 0
                                        ? 'CONTINUAR A LOS DATOS'
                                        : widget.isFirstAccount
                                            ? 'REVISAR Y ENVIAR CÓDIGO'
                                            : widget.isGoogleOnly
                                                ? 'CONFIRMAR CON GOOGLE Y CONTINUAR'
                                                : 'VERIFICAR IDENTIDAD Y CONTINUAR',
                            style: TextStyle(
                              fontFamily: 'JetBrainsMono',
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                              letterSpacing: 1.0,
                            ),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPresetChip(
    String bancoNombre,
    String tipoCuenta, {
    String? label,
  }) {
    final isSelected = _banco == bancoNombre;
    final enabled = _authorizationId == null;
    return Expanded(
      child: GestureDetector(
        onTap: enabled
            ? () => _seleccionarPresetBanco(bancoNombre, tipoCuenta)
            : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFFC5A052) : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected
                  ? const Color(0xFFC5A052)
                  : const Color(0xFFE8DFD8),
              width: 1.2,
            ),
          ),
          child: Opacity(
            opacity: enabled ? 1 : 0.55,
            child: Text(
              label ?? bancoNombre,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                color:
                    isSelected ? const Color(0xFF1F1A15) : LuxeColors.nude800,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStepIndicator(String number, String label, bool active) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 12,
          backgroundColor:
              active ? const Color(0xFFC5A052) : const Color(0xFFE8DFD8),
          child: Text(
            number,
            style: const TextStyle(fontSize: 11, color: Colors.white),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: active ? LuxeColors.nude900 : LuxeColors.nude600,
          ),
        ),
        const SizedBox(width: 8),
      ],
    );
  }
}
