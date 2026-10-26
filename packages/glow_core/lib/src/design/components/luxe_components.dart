import 'package:flutter/material.dart';
import '../../core/theme/belleza_luxe_theme.dart';

/// Tarjeta Luxe con elevación 0 y borde sutil de 1px en LuxeColors.nude200
class LuxeCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? backgroundColor;
  final Border? border;

  const LuxeCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.backgroundColor,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    final cardContent = Container(
      padding: padding ?? const EdgeInsets.all(LuxeSpacing.xl),
      decoration: BoxDecoration(
        color: backgroundColor ?? LuxeColors.nude100,
        borderRadius: BorderRadius.circular(LuxeSpacing.md),
        border: border ?? Border.all(color: LuxeColors.nude200, width: 1.0),
      ),
      child: child,
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: onTap,
        child: cardContent,
      );
    }
    return cardContent;
  }
}

/// Botón Luxe con variantes goldShimmer o tonal
enum LuxeButtonVariant { goldShimmer, tonal, outline }

class LuxeButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final LuxeButtonVariant variant;
  final bool isLoading;

  const LuxeButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.variant = LuxeButtonVariant.goldShimmer,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    BorderSide border = BorderSide.none;

    switch (variant) {
      case LuxeButtonVariant.goldShimmer:
        bg = LuxeColors.gold871;
        fg = LuxeColors.nude900;
        break;
      case LuxeButtonVariant.tonal:
        bg = LuxeColors.nude200;
        fg = LuxeColors.nude900;
        break;
      case LuxeButtonVariant.outline:
        bg = Colors.transparent;
        fg = LuxeColors.gold871;
        border = const BorderSide(color: LuxeColors.gold871, width: 1);
        break;
    }

    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: bg,
        foregroundColor: fg,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(LuxeSpacing.md),
          side: border,
        ),
      ),
      child: isLoading
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: LuxeColors.nude900),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18),
                  const SizedBox(width: 8),
                ],
                Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.5),
                ),
              ],
            ),
    );
  }
}

/// Badge Luxe minimalista
class LuxeBadge extends StatelessWidget {
  final String label;
  final Color? backgroundColor;
  final Color? textColor;

  const LuxeBadge({
    super.key,
    required this.label,
    this.backgroundColor,
    this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor ?? LuxeColors.nude100,
        borderRadius: BorderRadius.circular(LuxeSpacing.sm),
        border: Border.all(color: LuxeColors.nude200, width: 0.5),
      ),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: textColor ?? LuxeColors.nude700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
