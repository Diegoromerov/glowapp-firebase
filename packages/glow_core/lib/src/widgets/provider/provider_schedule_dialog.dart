// lib/widgets/provider/provider_schedule_dialog.dart
import 'package:flutter/material.dart';
import '../../core/theme/belleza_luxe_theme.dart';
import '../../services/api_service.dart';

class ProviderScheduleDialog extends StatefulWidget {
  final Map<String, dynamic>? currentSchedule;
  final VoidCallback? onSuccess;

  const ProviderScheduleDialog({
    super.key,
    this.currentSchedule,
    this.onSuccess,
  });

  @override
  State<ProviderScheduleDialog> createState() => _ProviderScheduleDialogState();
}

class _ProviderScheduleDialogState extends State<ProviderScheduleDialog> {
  final int _activeStartHour = 8;
  final int _activeEndHour = 19;

  final Map<String, Map<String, dynamic>> _daysSchedule = {
    'lunes': {'activo': true, 'inicio': 8, 'fin': 19},
    'martes': {'activo': true, 'inicio': 8, 'fin': 19},
    'miercoles': {'activo': true, 'inicio': 8, 'fin': 19},
    'jueves': {'activo': true, 'inicio': 8, 'fin': 19},
    'viernes': {'activo': true, 'inicio': 8, 'fin': 19},
    'sabado': {'activo': true, 'inicio': 8, 'fin': 18},
    'domingo': {'activo': false, 'inicio': 9, 'fin': 14},
  };

  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    if (widget.currentSchedule != null) {
      widget.currentSchedule!.forEach((key, val) {
        if (_daysSchedule.containsKey(key) && val is Map<String, dynamic>) {
          _daysSchedule[key] = {
            'activo': val['activo'] ?? true,
            'inicio': val['inicio'] ?? 8,
            'fin': val['fin'] ?? 19,
          };
        }
      });
    }
  }

  Future<void> _handleSave() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await ApiService.updateProviderSchedule(
        weeklySchedule: _daysSchedule,
        activeStartHour: _activeStartHour,
        activeEndHour: _activeEndHour,
      );

      if (mounted) {
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Horario de atención SaaS actualizado correctamente'),
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
    final dayLabels = {
      'lunes': 'Lunes',
      'martes': 'Martes',
      'miercoles': 'Miércoles',
      'jueves': 'Jueves',
      'viernes': 'Viernes',
      'sabado': 'Sábado',
      'domingo': 'Domingo',
    };

    return Dialog(
      backgroundColor: LuxeColors.nude50,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'GESTIÓN DE AGENDA Y HORARIOS SAAS',
                    style: TextStyle(
                      fontFamily: 'Didot',
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: LuxeColors.nude900,
                      letterSpacing: 1.0,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: LuxeColors.nude900, size: 20),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text(
                'Configura los días de atención y los rangos de apertura/cierre de tu establecimiento o agenda profesional.',
                style: TextStyle(fontFamily: 'JetBrainsMono', fontSize: 11, color: LuxeColors.nude600),
              ),
              const SizedBox(height: 16),

              if (_errorMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEE2E2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_errorMessage!, style: const TextStyle(fontSize: 12, color: Color(0xFFDC2626))),
                ),
                const SizedBox(height: 12),
              ],

              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: dayLabels.keys.length,
                itemBuilder: (context, index) {
                  final dayKey = dayLabels.keys.elementAt(index);
                  final dayName = dayLabels[dayKey]!;
                  final dayConf = _daysSchedule[dayKey]!;

                  final bool isActive = dayConf['activo'] == true;
                  final int inicio = dayConf['inicio'] ?? 8;
                  final int fin = dayConf['fin'] ?? 19;

                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: isActive ? LuxeColors.nude100 : LuxeColors.nude200,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 85,
                          child: Text(
                            dayName,
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              color: isActive ? LuxeColors.nude900 : LuxeColors.nude500,
                            ),
                          ),
                        ),
                        Switch(
                          value: isActive,
                          activeTrackColor: LuxeColors.gold871,
                          onChanged: (val) {
                            setState(() {
                              _daysSchedule[dayKey]!['activo'] = val;
                            });
                          },
                        ),
                        const Spacer(),
                        if (isActive)
                          Row(
                            children: [
                              Text('${inicio.toString().padLeft(2, '0')}:00', style: const TextStyle(fontSize: 11, fontFamily: 'JetBrainsMono')),
                              const Text(' - ', style: TextStyle(fontSize: 11)),
                              Text('${fin.toString().padLeft(2, '0')}:00', style: const TextStyle(fontSize: 11, fontFamily: 'JetBrainsMono')),
                            ],
                          )
                        else
                          const Text('CERRADO', style: TextStyle(fontSize: 10, fontFamily: 'JetBrainsMono', color: LuxeColors.nude500)),
                      ],
                    ),
                  );
                },
              ),

              const SizedBox(height: 20),

              SizedBox(
                width: double.infinity,
                height: 46,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: LuxeColors.nude900,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _isLoading ? null : _handleSave,
                  child: _isLoading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : const Text(
                          'GUARDAR CONFIGURACIÓN DE AGENDA',
                          style: TextStyle(
                            fontFamily: 'JetBrainsMono',
                            fontSize: 11,
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
    );
  }
}
