// lib/design/components/s4_text_field.dart
import 'package:flutter/material.dart';
import '../../core/theme/tokens.dart';

/// S4 TextField — canonical input component for GlowApp.
/// Uses Token, Spacing, Radii from the design system.
class S4TextField extends StatelessWidget {
  final String? label;
  final String? hint;
  final TextEditingController? controller;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool enabled;
  final bool obscureText;
  final TextInputType keyboardType;
  final int? maxLines;
  final Widget? prefixIcon;
  final Widget? suffixIcon;
  final String? helperText; // error or helper message
  final InputDecoration? decoration; // Optional custom decoration
  final TextCapitalization textCapitalization;
  final TextStyle? style; // Optional text style to merge with default

  const S4TextField({
    super.key,
    this.label,
    this.hint,
    this.controller,
    this.validator,
    this.onChanged,
    this.onSubmitted,
    this.enabled = true,
    this.obscureText = false,
    this.keyboardType = TextInputType.text,
    this.maxLines = 1,
    this.prefixIcon,
    this.suffixIcon,
    this.helperText,
    this.decoration,
    this.textCapitalization = TextCapitalization.none,
    this.style,
  });

  InputDecoration _buildDefaultDecoration(Token token) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(
        fontSize: 13,
        color: token.textSecondary,
      ),
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: token.surfaceLevel0,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.sm,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.radiusControl),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.radiusControl),
        borderSide: BorderSide(color: token.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.radiusControl),
        borderSide: BorderSide(color: token.interactionFocus, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.radiusControl),
        borderSide: BorderSide(color: token.status['error']!),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.radiusControl),
        borderSide: BorderSide(color: token.status['error']!, width: 1.5),
      ),
      errorText: helperText, // If helperText is provided and not an error, it will show as helper.
      errorStyle: TextStyle(
        fontSize: 11,
        color: token.status['error']!,
        height: 0.8,
      ),
      helperText: helperText,
      helperStyle: TextStyle(
        fontSize: 11,
        color: token.textSecondary,
        height: 0.8,
      ),
      isDense: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    // Determine colors based on state and enabled
      const Token token = Token.light; // TODO: make this responsive to brightness

    // If we have a validator and there's an error, we need to override the decoration to show error state.
    bool showError = false;
    String? errorText;

    if (!enabled) {
      // Disabled state
    } else {
      // Default enabled state
      // If we have a validator and there's an error, show error state
      if (validator != null) {
        final String? error = validator!(controller?.text ?? '');
        if (error != null && error.isNotEmpty) {
          showError = true;
          errorText = error;
        }
      }
    }

    // Build the decoration: use custom if provided, otherwise build default and then override for error/disabled states.
    InputDecoration effectiveDecoration;
    if (decoration != null) {
      effectiveDecoration = decoration!;
    } else {
      effectiveDecoration = _buildDefaultDecoration(token);
    }

    // Override decoration for disabled and error states if we are using the default decoration.
    // If a custom decoration is provided, we assume the caller handles states.
    if (decoration == null) {
      if (!enabled) {
        effectiveDecoration = effectiveDecoration.copyWith(
          fillColor: token.surfaceLevel0.withOpacity(0.08),
          disabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(Radii.radiusControl),
            borderSide: BorderSide(color: token.borderSubtle.withOpacity(0.2)),
          ),
        );
      } else if (showError) {
        effectiveDecoration = effectiveDecoration.copyWith(
          // Note: errorText and helperText are handled by the decoration's errorText and helperText properties.
        );
      }
    }

    final List<Widget> children = [];
    if (label != null && label!.isNotEmpty) {
      children.add(
        Padding(
          padding: const EdgeInsets.only(bottom: Spacing.xs),
          child: Text(
            label!,
            style: (TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: showError ? token.status['error']! : token.textPrimary,
            )).merge(style ?? const TextStyle()).copyWith(
              color: showError ? token.status['error']! : token.textPrimary,
            ),
          ),
        ),
      );
    }

    children.add(
      TextField(
        controller: controller,
        obscureText: obscureText,
        keyboardType: keyboardType,
        maxLines: maxLines,
        enabled: enabled,
        textCapitalization: textCapitalization,
        style: (TextStyle(
          fontSize: 14,
          color: showError ? token.status['error']! : token.textPrimary,
        )).merge(style ?? const TextStyle()).copyWith(
          color: showError ? token.status['error']! : token.textPrimary,
        ),
        decoration: effectiveDecoration.copyWith(
          errorText: showError ? errorText : null,
          helperText: !showError ? helperText : null, // Only show helperText if no error
        ),
        onChanged: onChanged,
        onSubmitted: onSubmitted,
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    );
  }
}