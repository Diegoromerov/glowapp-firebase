// frontend/lib/widgets/locked_feature_card.dart
// E-04 (D-GL-027) — módulo visible pero bloqueado por plan.
//
// Decisión de producto (D-GL-027, ítem 7): un módulo que el plan no incluye NO
// desaparece: se muestra bloqueado con su CTA. Ocultarlo hace que el dueño no
// sepa que existe y no haya ruta de mejora.
//
// El cuerpo del bloqueo replica el 403 del backend
// (`error: 'Plan no incluye esta función'`, `required`, `currentPlan`), para que
// la UI y la API cuenten la misma historia.

import 'package:flutter/material.dart';

import '../core/theme/tokens.dart';
import '../design/icons/glow_icon.dart';

class LockedFeatureCard extends StatelessWidget {
  /// Nombre del módulo, p. ej. «Equipo».
  final String titulo;

  /// Qué se pierde por no tenerlo, en una frase.
  final String descripcion;

  /// Capacidad que falta (`TEAM_MANAGEMENT`, `CUSTOM_BRANDING`, ...).
  final String capacidadRequerida;

  /// Plan que corre hoy, para no hablar en abstracto.
  final String planActual;

  /// Acción de mejora. Si es null, la tarjeta sólo informa.
  final VoidCallback? onMejorarPlan;

  /// Qué incluye el plan que lo desbloquea (una línea).
  final String? beneficio;

  const LockedFeatureCard({
    super.key,
    required this.titulo,
    required this.descripcion,
    required this.capacidadRequerida,
    required this.planActual,
    this.onMejorarPlan,
    this.beneficio,
  });

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Spacing.xxl),
        child: Container(
          padding: const EdgeInsets.all(Spacing.xxl),
          decoration: BoxDecoration(
            color: t.surfaceLevel1,
            borderRadius: BorderRadius.circular(Radii.lg),
            border: Border.all(color: t.borderSubtle),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(Spacing.md),
                decoration: BoxDecoration(
                  color: t.brandPrimary.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(Radii.round),
                ),
                child: Icon(Icons.lock_outline, size: 26, color: t.brandPrimary),
              ),
              const SizedBox(height: Spacing.lg),
              Text(
                titulo,
                textAlign: TextAlign.center,
                style: TypographyTokens.h3(t).copyWith(fontSize: 17),
              ),
              const SizedBox(height: Spacing.sm),
              Text(
                descripcion,
                textAlign: TextAlign.center,
                style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
              ),
              const SizedBox(height: Spacing.lg),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: Spacing.md, vertical: Spacing.sm),
                decoration: BoxDecoration(
                  color: t.surfaceLevel2,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Text(
                  'Plan actual: $planActual · requiere $capacidadRequerida',
                  style: TypographyTokens.bodySmall(t).copyWith(
                    color: t.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ),
              if (beneficio != null) ...[
                const SizedBox(height: Spacing.md),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    GlowIcon.resolve('star', size: GlowIconSize.xs, color: t.brandPrimary),
                    const SizedBox(width: Spacing.xs),
                    Flexible(
                      child: Text(
                        beneficio!,
                        style: TypographyTokens.bodySmall(t).copyWith(
                          color: t.textPrimary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              if (onMejorarPlan != null) ...[
                const SizedBox(height: Spacing.xl),
                SizedBox(
                  width: double.infinity,
                  height: 46,
                  child: ElevatedButton(
                    onPressed: onMejorarPlan,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: t.brandPrimary,
                      foregroundColor: t.brandPrimaryOn,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.round),
                      ),
                    ),
                    child: const Text(
                      'Ver planes',
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
