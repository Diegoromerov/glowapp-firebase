import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../core/theme/belleza_luxe_theme.dart';

/// Toggle Luxe personalizado con track nude200/nude900 y thumb gold871 cuando activo
class LuxeToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const LuxeToggle({
    super.key,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return CupertinoSwitch(
          value: value,
          onChanged: onChanged,
          activeColor: LuxeColors.gold871,
          trackColor: LuxeColors.nude200,
        );
  }
}

/// LuxeListTile Concierge para perfil y ajustes
class LuxeProfileTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showDivider;

  const LuxeProfileTile({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.showDivider = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: const Color(0xFFC5A052).withOpacity(0.25),
                        width: 1,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Icon(icon, color: const Color(0xFFC5A052), size: 20),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF1F1A15),
                            letterSpacing: -0.1,
                          ),
                        ),
                        if (subtitle != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle!,
                            style: const TextStyle(
                              fontFamily: 'Inter',
                              fontSize: 12,
                              color: Color(0xFF8C7E74),
                              height: 1.3,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  trailing ??
                      Container(
                        width: 26,
                        height: 26,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF6EE),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: const Color(0xFFC5A052).withOpacity(0.2),
                            width: 0.8,
                          ),
                        ),
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 11,
                          color: Color(0xFFC5A052),
                        ),
                      ),
                ],
              ),
            ),
          ),
        ),
        if (showDivider)
          const Padding(
            padding: EdgeInsets.only(left: 68.0, right: 16.0),
            child: Divider(color: Color(0xFFF3EFE9), height: 1, thickness: 0.8),
          ),
      ],
    );
  }
}
