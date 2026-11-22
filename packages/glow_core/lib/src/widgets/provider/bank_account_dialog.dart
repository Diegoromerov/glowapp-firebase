// lib/widgets/provider/bank_account_dialog.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/belleza_luxe_theme.dart';
import '../../services/api_service.dart';

class BankAccountFormDialog extends StatefulWidget {
  final VoidCallback? onSuccess;
  final bool isFirstAccount;
  final bool isGoogleOnly;
  final Widget? Function(ValueChanged<String> onToken)? googleReauthBuilder;

  const BankAccountFormDialog({
    super.key,
    this.onSuccess,
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
  final _titularNombreController = TextEditingController();
  String _titularDocumentoTipo = 'CC';
  final _titularDocumentoNumController = TextEditingController();
  final _passwordController = TextEditingController();
  final _authorizationCodeController = TextEditingController();
  String? _authorizationId;
  String? _googleIdToken;
  String? _maskedEmail;

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
    _titularNombreController.dispose();
    _titularDocumentoNumController.dispose();
    _passwordController.dispose();
    _authorizationCodeController.dispose();
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
    if (_authorizationId == null && !_formKey.currentState!.validate()) return;
    if (_authorizationId == null &&
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
      'tipo_cuenta_bancaria': (_tipoCuenta == 'CORRIENTE')
          ? 'CORRIENTE'
          : 'AHORROS',
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
          _passwordController.clear();
          _googleIdToken = null;
          _errorMessage = otpPrueba != null
              ? 'Código de prueba de staging: $otpPrueba. No se envió correo.'
              : 'Enviamos un código a ${_maskedEmail ?? 'tu correo verificado'}. Ingrésalo para confirmar esta cuenta.';
          _isLoading = false;
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
      final reviewEta = reviewAt == null
          ? ''
          : ' (aprox. ${reviewAt.day.toString().padLeft(2, '0')}/${reviewAt.month.toString().padLeft(2, '0')} ${reviewAt.hour.toString().padLeft(2, '0')}:${reviewAt.minute.toString().padLeft(2, '0')})';

      if (mounted) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Cuenta registrada. Plazo objetivo de revisión: hasta ${reviewHours ?? 48} horas calendario$reviewEta.',
            ),
            backgroundColor: Color(0xFF059669),
          ),
        );
        widget.onSuccess?.call();
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
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

                if (widget.isFirstAccount && _authorizationId == null) ...[
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
                      final approved =
                          _accountStatus?['estado_verificacion'] ==
                              'APROBADA' ||
                          _accountStatus?['cuenta_verificada'] == true;
                      final slaHours =
                          int.tryParse(
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
                    _buildPresetChip('Bancolombia', 'AHORROS', label: 'Bancos'),
                  ],
                ),
                const SizedBox(height: 16),

                if (_authorizationId == null &&
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
                ] else if (_authorizationId == null && widget.isGoogleOnly) ...[
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
                ] else ...[
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
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: _isLoading
                          ? null
                          : () => setState(() {
                              _authorizationId = null;
                              _authorizationCodeController.clear();
                              _errorMessage = null;
                              _googleIdToken = null;
                            }),
                      child: const Text(
                        'Cambiar datos o solicitar otro código',
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),

                if (_errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color:
                          (_errorMessage!.startsWith('Enviamos') ||
                              _errorMessage!.startsWith('Código de prueba'))
                          ? const Color(0xFFE8F5EE)
                          : const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _errorMessage!,
                      style: TextStyle(
                        fontSize: 12,
                        color:
                            (_errorMessage!.startsWith('Enviamos') ||
                                _errorMessage!.startsWith('Código de prueba'))
                            ? const Color(0xFF047857)
                            : const Color(0xFFDC2626),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],

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
                        onChanged: (val) {
                          if (val != null) {
                            setState(() {
                              _tipoCuenta = val;
                              if (val == 'NEQUI') _banco = 'Nequi';
                              if (val == 'DAVIPLATA') _banco = 'Daviplata';
                              if ((val == 'AHORROS' || val == 'CORRIENTE') &&
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
                      child:
                          _tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA'
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
                              onChanged: (val) {
                                if (val != null) setState(() => _banco = val);
                              },
                            ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // NÚMERO DE CUENTA O CELULAR
                TextFormField(
                  controller: _numeroCuentaController,
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
                    if (_tipoCuenta == 'NEQUI' || _tipoCuenta == 'DAVIPLATA') {
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

                // NOMBRE DEL TITULAR
                TextFormField(
                  controller: _titularNombreController,
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
                        onChanged: (val) {
                          if (val != null)
                            setState(() => _titularDocumentoTipo = val);
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        controller: _titularDocumentoNumController,
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
                    onPressed: _isLoading ? null : _handleSubmit,
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
                            _authorizationId != null
                                ? 'CONFIRMAR Y REGISTRAR CUENTA'
                                : widget.isFirstAccount
                                ? 'ENVIAR CÓDIGO Y CONTINUAR'
                                : widget.isGoogleOnly
                                ? 'CONFIRMAR CON GOOGLE'
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
    return Expanded(
      child: GestureDetector(
        onTap: () => _seleccionarPresetBanco(bancoNombre, tipoCuenta),
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
          child: Text(
            label ?? bancoNombre,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 10,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
              color: isSelected ? const Color(0xFF1F1A15) : LuxeColors.nude800,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}
