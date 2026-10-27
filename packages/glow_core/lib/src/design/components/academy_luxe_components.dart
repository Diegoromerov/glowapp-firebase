import 'package:flutter/material.dart';
import '../../core/theme/belleza_luxe_theme.dart';

/// Barra de progreso Luxe con fondo nude200 y relleno gold871
class LuxeProgressBar extends StatelessWidget {
  final double value; // 0.0 a 1.0
  final double height;

  const LuxeProgressBar({
    super.key,
    required this.value,
    this.height = 6.0,
  });

  @override
  Widget build(BuildContext context) {
    final clampedValue = value.clamp(0.0, 1.0);
    return Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        color: LuxeColors.nude200,
        borderRadius: BorderRadius.circular(LuxeSpacing.sm),
      ),
      child: FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: clampedValue,
        child: Container(
          decoration: BoxDecoration(
            color: LuxeColors.gold871,
            borderRadius: BorderRadius.circular(LuxeSpacing.sm),
          ),
        ),
      ),
    );
  }
}

/// ListTile Luxe para módulos y lecciones de Academia
class LuxeListTile extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool isCompleted;
  final bool isLocked;

  const LuxeListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.isCompleted = false,
    this.isLocked = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8.0),
      decoration: BoxDecoration(
        color: LuxeColors.nude100,
        borderRadius: BorderRadius.circular(LuxeSpacing.md),
        border: Border.all(
          color: isCompleted ? LuxeColors.gold871.withOpacity(0.5) : LuxeColors.nude200,
          width: 1.0,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        onTap: isLocked ? null : onTap,
        leading: leading ??
            Icon(
              isCompleted
                  ? Icons.check_circle
                  : (isLocked ? Icons.lock_outlined : Icons.play_circle_outline),
              color: isCompleted
                  ? LuxeColors.gold871
                  : (isLocked ? LuxeColors.nude300 : LuxeColors.gold871),
            ),
        title: Text(
          title,
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: isLocked ? LuxeColors.nude500 : LuxeColors.nude900,
          ),
        ),
        subtitle: subtitle != null
            ? Text(
                subtitle!,
                style: LuxeTypography.monoSm,
              )
            : null,
        trailing: trailing ??
            (isLocked
                ? null
                : const Icon(Icons.arrow_forward_ios, size: 14, color: LuxeColors.nude500)),
      ),
    );
  }
}
