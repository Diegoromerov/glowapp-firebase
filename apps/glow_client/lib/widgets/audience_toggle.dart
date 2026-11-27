import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class AudienceToggleWidget extends StatelessWidget {
  final bool compact;

  const AudienceToggleWidget({super.key, this.compact = false});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AudienceMode>(
      valueListenable: AudienceService.currentAudience,
      builder: (context, currentMode, child) {
        final isMen = currentMode == AudienceMode.men;
        final surface = isMen ? const Color(0xFF171614) : Colors.white;
        final border = isMen
            ? const Color(0xFF39352F)
            : const Color(0xFFE8E2DC);
        final accent = isMen
            ? const Color(0xFFD5B76A)
            : const Color(0xFF76584A);
        final muted = isMen ? const Color(0xFFB7B1A8) : const Color(0xFF706963);

        return Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: border),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isMen ? 0.18 : 0.07),
                blurRadius: 12,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildItem(
                context,
                AudienceMode.all,
                'Todos',
                Icons.grid_view_rounded,
                currentMode == AudienceMode.all,
                accent,
                muted,
                isMen,
              ),
              _buildItem(
                context,
                AudienceMode.women,
                'Mujeres',
                Icons.woman_rounded,
                currentMode == AudienceMode.women,
                accent,
                muted,
                isMen,
              ),
              _buildItem(
                context,
                AudienceMode.men,
                'Hombres',
                Icons.man_rounded,
                currentMode == AudienceMode.men,
                accent,
                muted,
                isMen,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildItem(
    BuildContext context,
    AudienceMode mode,
    String label,
    IconData icon,
    bool isSelected,
    Color accent,
    Color muted,
    bool isMen,
  ) {
    final foreground = isSelected
        ? (isMen ? const Color(0xFF171614) : Colors.white)
        : muted;
    return Semantics(
      button: true,
      selected: isSelected,
      label: label,
      child: Material(
        color: isSelected ? accent : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => AudienceService.setAudience(mode),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            constraints: const BoxConstraints(minHeight: 44),
            padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 13),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(12)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: compact ? 14 : 15, color: foreground),
                const SizedBox(width: 5),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: compact ? 11 : 12,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    color: foreground,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
