// frontend/lib/widgets/provider/fiscal_iva_section.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/api_service.dart';

/// Sección reutilizable para declarar la responsabilidad de IVA del prestador.
///
/// CONTEXTO (por qué existe)
/// Los tratamientos de belleza están GRAVADOS con IVA del 19% (art. 476 num. 1
/// lit. a) del E.T.). Pero quién COBRA ese IVA lo decide el art. 437 par. 3
/// (por ingresos) y consta en el RUT del prestador, casilla de
/// responsabilidades: código 48 = responsable de IVA, 49 = no responsable.
/// Que el servicio sea gravado NO convierte al prestador en responsable.
///
/// DECISIÓN DE NEGOCIO VIGENTE
/// Declarar es OPCIONAL para publicar servicios y OBLIGATORIO para recibir pagos
/// con IVA (con desglose). El precio que paga el cliente NO cambia: el precio
/// publicado ya es el precio final al consumidor y el IVA se DISCRIMINA (se
/// separa), no se suma. Si el prestador no declara, sus reservas no muestran
/// desglose de IVA.
///
/// REGLA DE ORO (no violar)
/// Este widget NO calcula ni muestra montos de IVA. Cualquier monto tiene que
/// venir del servidor (la reserva y el checkout ya envían subtotal_base e
/// iva_valor). Aquí sólo se captura la DECLARACIÓN (RUT + casilla 48/49).
///
/// Se monta tal cual desde el onboarding del negocio y desde el perfil/ajustes
/// del prestador, para que la declaración no diverja entre las dos pantallas.
class FiscalIvaSection extends StatefulWidget {
  /// Si es `true`, carga del servidor el estado ya guardado y lo muestra
  /// (estado, RUT y origen). En el onboarding puede dejarse en `false`.
  final bool showStatus;

  /// Se invoca tras una declaración exitosa (p. ej. para refrescar el perfil).
  final VoidCallback? onDeclared;

  const FiscalIvaSection({
    super.key,
    this.showStatus = true,
    this.onDeclared,
  });

  @override
  State<FiscalIvaSection> createState() => _FiscalIvaSectionState();
}

class _FiscalIvaSectionState extends State<FiscalIvaSection> {
  static const int _codigoResponsable = 48;
  static const int _codigoNoResponsable = 49;

  final TextEditingController _rutCtrl = TextEditingController();

  int _codigo = _codigoResponsable;

  bool _loadingStatus = false;
  bool _saving = false;

  String? _estado;
  String? _rutGuardado;
  String? _fuente;

  String? _error;
  String? _success;

  @override
  void initState() {
    super.initState();
    if (widget.showStatus) {
      _loadStatus();
    }
  }

  @override
  void dispose() {
    _rutCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    setState(() => _loadingStatus = true);
    try {
      final data = await ApiService.fetchProviderFiscal();
      if (!mounted) return;
      setState(() {
        _estado = data['estado']?.toString();
        _rutGuardado = data['rut_numero']?.toString();
        _fuente = data['fuente']?.toString();
        final codigo = data['rut_responsabilidad_codigo'];
        if (codigo is num && (codigo == _codigoResponsable || codigo == _codigoNoResponsable)) {
          _codigo = codigo.toInt();
        }
        if (_rutGuardado != null && _rutGuardado!.isNotEmpty) {
          _rutCtrl.text = _rutGuardado!;
        }
        _loadingStatus = false;
      });
    } catch (e) {
      // No bloquear la captura si la consulta falla: el prestador todavía puede
      // declarar. Sólo se deja constancia discreta.
      if (!mounted) return;
      setState(() {
        _loadingStatus = false;
        _error = 'No se pudo consultar el estado actual. Puedes declararlo igualmente.';
      });
    }
  }

  String? _validarRutLocal(String rut) {
    final limpio = rut.trim().replaceAll('.', '').replaceAll(' ', '');
    if (limpio.isEmpty) {
      return 'El número de RUT es obligatorio para declarar la responsabilidad de IVA.';
    }
    if (!RegExp(r'^\d{8,12}(-\d)?$').hasMatch(limpio)) {
      return 'El número de RUT debe tener entre 8 y 12 dígitos (se admite el guion antes del dígito de verificación).';
    }
    return null;
  }

  Future<void> _declarar() async {
    final localError = _validarRutLocal(_rutCtrl.text);
    if (localError != null) {
      setState(() {
        _error = localError;
        _success = null;
      });
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
      _success = null;
    });

    try {
      final data = await ApiService.updateProviderFiscal(
        rutNumero: _rutCtrl.text.trim(),
        rutResponsabilidadCodigo: _codigo,
      );
      if (!mounted) return;
      final fiscal = (data['fiscal'] as Map?)?.cast<String, dynamic>();
      setState(() {
        _saving = false;
        _success = data['mensaje']?.toString() ??
            'Declaración de IVA actualizada correctamente.';
        if (fiscal != null) {
          _estado = fiscal['estado']?.toString();
          _rutGuardado = fiscal['rut_numero']?.toString();
          _fuente = fiscal['responsabilidad_iva_fuente']?.toString();
        } else {
          _estado = 'DECLARADA';
        }
      });
      widget.onDeclared?.call();
    } on FiscalApiException catch (e) {
      if (!mounted) return;
      // Se muestran los campos de la API tal cual los devuelve: `error` (código)
      // y `detalle` (mensaje legible).
      setState(() {
        _saving = false;
        _error = (e.detalle != null && e.detalle!.isNotEmpty)
            ? '${e.error}: ${e.detalle}'
            : e.error;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'No se pudo declarar la responsabilidad de IVA: $e';
      });
    }
  }

  String _textoOrigen(String fuente) {
    switch (fuente) {
      case 'RUT':
        return 'Tomado de tu RUT';
      case 'MANUAL':
        return 'Ajustado manualmente por un administrador';
      default:
        return fuente;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 16, bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFFC5A052).withOpacity(0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_rounded, color: Color(0xFFC5A052), size: 20),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Responsabilidad de IVA (RUT)',
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontWeight: FontWeight.bold,
                    fontSize: 14.5,
                    color: Color(0xFF1F1A15),
                    letterSpacing: 0.2,
                  ),
                ),
              ),
              if (_loadingStatus)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFC5A052)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Los tratamientos de belleza están gravados con IVA del 19%. Quién lo '
            'cobra depende de tu RUT, en la casilla de responsabilidades: código 48 '
            'si eres responsable de IVA o 49 si no lo eres.',
            style: TextStyle(fontFamily: 'Inter', fontSize: 12.5, color: Color(0xFF8C7E74), height: 1.4),
          ),
          const SizedBox(height: 8),
          const Text(
            'Declararlo es opcional para publicar tus servicios, pero es obligatorio '
            'para recibir pagos con el IVA desglosado. El precio que paga tu cliente '
            'no cambia: el precio publicado es el precio final y el IVA se discrimina '
            '(se separa), no se suma.',
            style: TextStyle(fontFamily: 'Inter', fontSize: 12.5, color: Color(0xFF8C7E74), height: 1.4),
          ),
          if (widget.showStatus && _estado != null) ...[
            const Divider(height: 24, color: Color(0xFFEFE8DE)),
            _buildEstado(),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _rutCtrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: false),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.\-]')),
            ],
            decoration: _inputDecoration(
              'Número de RUT (obligatorio para declarar)',
              Icons.badge_outlined,
            ).copyWith(hintText: 'Ej. 900123456-7 o 1020304050'),
          ),
          const SizedBox(height: 16),
          const Text(
            'Casilla de responsabilidades del RUT',
            style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600, fontSize: 12.5, color: Color(0xFF1F1A15)),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<int>(
            initialValue: _codigo,
            decoration: _inputDecoration('Selecciona el código de tu RUT', Icons.checklist_rounded),
            items: const [
              DropdownMenuItem(
                value: 48,
                child: Text('48 · Responsable de IVA'),
              ),
              DropdownMenuItem(
                value: 49,
                child: Text('49 · No responsable de IVA'),
              ),
            ],
            onChanged: (val) {
              if (val != null) setState(() => _codigo = val);
            },
          ),
          const SizedBox(height: 8),
          const Text(
            '¿Dónde lo encuentro? En tu RUT, casilla "48 - Responsable de IVA" o '
            '"49 - No responsable de IVA", en la sección de responsabilidades. Si '
            'estás por debajo del umbral de ingresos, tu casilla es la 49.',
            style: TextStyle(fontFamily: 'Inter', fontSize: 11.5, color: Color(0xFF8C7E74), height: 1.4),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFFFDF2F4),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFF5D6D0), width: 1),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.error_outline_rounded, color: Color(0xFF9E4B3D), size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _error!,
                      style: const TextStyle(fontFamily: 'Inter', fontSize: 12.5, color: Color(0xFF9E4B3D), height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (_success != null) ...[
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.check_circle_outline_rounded, color: Color(0xFF15803D), size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _success!,
                    style: const TextStyle(fontFamily: 'Inter', fontSize: 12.5, color: Color(0xFF15803D), height: 1.4),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _saving ? null : _declarar,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFC5A052),
                foregroundColor: const Color(0xFF1F1A15),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(color: Color(0xFF1F1A15), strokeWidth: 2),
                    )
                  : const Text(
                      'Guardar declaración de IVA',
                      style: TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.bold),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEstado() {
    final declarada = _estado == 'DECLARADA';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: declarada ? const Color(0xFFF0FDF4) : const Color(0xFFFEFCE8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: declarada ? const Color(0xFFBBF7D0) : const Color(0xFFFEF08A),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                declarada ? Icons.verified_rounded : Icons.pending_actions_rounded,
                size: 18,
                color: declarada ? const Color(0xFF15803D) : const Color(0xFFA16207),
              ),
              const SizedBox(width: 8),
              Text(
                declarada ? 'DECLARADA' : 'SIN_DECLARAR',
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: declarada ? const Color(0xFF15803D) : const Color(0xFFA16207),
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _estadoRow('RUT declarado', (_rutGuardado == null || _rutGuardado!.isEmpty) ? 'Sin registrar' : _rutGuardado!),
          const SizedBox(height: 4),
          _estadoRow(
            'Origen',
            (_fuente == null || _fuente!.isEmpty) ? 'Sin declarar' : _textoOrigen(_fuente!),
          ),
        ],
      ),
    );
  }

  Widget _estadoRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(
            label,
            style: const TextStyle(fontFamily: 'Inter', fontSize: 12, color: Color(0xFF8C7E74)),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1F1A15),
            ),
          ),
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(fontFamily: 'Inter', color: Color(0xFF8C7E74), fontSize: 12.5),
      prefixIcon: Icon(icon, color: const Color(0xFFC5A052), size: 20),
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1.2),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1.2),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
    );
  }
}
