import 'package:flutter/material.dart';
import '../../core/theme/tokens.dart';

/// Banner de advertencia para colaboradores compartidos con salones de OTRO propietario (Cross-Tenant).
class CrossTenantWarningBanner extends StatelessWidget {
  final bool isCrossTenant;
  final String? advertencia;
  final List<dynamic>? prestadoresExternos;

  const CrossTenantWarningBanner({
    super.key,
    required this.isCrossTenant,
    this.advertencia,
    this.prestadoresExternos,
  });

  @override
  Widget build(BuildContext context) {
    if (!isCrossTenant) {
      return const SizedBox.shrink();
    }

    final mensaje = advertencia ??
        'Atención: Existen colaboradores asociados a sedes de otros propietarios.';
    final listaExternos = prestadoresExternos ?? [];

    final token = Token.of(context);
    final warningColor = token.status['warning'] ?? const Color(0xFFD97706);
    final warningBgColor = token.status['warning_bg'] ?? const Color(0xFFFEF3C7);
    final warningOnColor = token.status['warning_on'] ?? const Color(0xFF78350F);
    const warningAccentColor = Color(0xFF92400E); // Amber 800 semántico para encabezados de alerta

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 12.0, horizontal: 16.0),
      padding: const EdgeInsets.all(16.0),
      decoration: BoxDecoration(
        color: warningBgColor,
        borderRadius: BorderRadius.circular(12.0),
        border: Border.all(
          color: warningColor,
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                color: warningColor,
                size: 24.0,
              ),
              const SizedBox(width: 8.0),
              const Expanded(
                child: Text(
                  'ADVERTENCIA CROSS-TENANT',
                  style: TextStyle(
                    fontFamily: 'Didot',
                    fontWeight: FontWeight.bold,
                    fontSize: 14.0,
                    color: warningAccentColor,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8.0),
          Text(
            mensaje,
            style: TextStyle(
              fontSize: 13.0,
              color: warningOnColor,
              height: 1.4,
            ),
          ),
          if (listaExternos.isNotEmpty) ...[
            const SizedBox(height: 10.0),
            const Text(
              'Colaboradores vinculados a otros dueños:',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 12.0,
                color: warningAccentColor,
              ),
            ),
            const SizedBox(height: 4.0),
            ...listaExternos.map((p) {
              final nombre = p is Map ? (p['nombre'] ?? p['nombre_prestador'] ?? p.toString()) : p.toString();
              return Padding(
                padding: const EdgeInsets.only(left: 8.0, top: 2.0),
                child: Row(
                  children: [
                    Icon(Icons.circle, size: 5.0, color: warningColor),
                    const SizedBox(width: 6.0),
                    Expanded(
                      child: Text(
                        nombre,
                        style: TextStyle(
                          fontSize: 12.0,
                          color: warningOnColor,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}
