// lib/widgets/profile/profile_header.dart
import 'package:flutter/material.dart';

class ProfileHeader extends StatelessWidget {
  final String userName;
  final String userEmail;
  final String membershipLevel;
  final String? avatarUrl;
  final VoidCallback? onEditAvatar;

  const ProfileHeader({
    super.key,
    required this.userName,
    required this.userEmail,
    this.membershipLevel = 'SOCIO CLUB GLOW LUXE',
    this.avatarUrl,
    this.onEditAvatar,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFFC5A052).withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, 8),
            spreadRadius: 2,
          ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 12,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Medallón de Avatar de Alta Joyería
          Stack(
            alignment: Alignment.center,
            children: [
              // Halo exterior dorado satinado
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [Color(0xFFF3D59B), Color(0xFFC5A052), Color(0xFF96732B)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                      blurRadius: 18,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                padding: const EdgeInsets.all(3),
                child: Container(
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFFFDFBF7),
                  ),
                  child: CircleAvatar(
                    radius: 43,
                    backgroundColor: const Color(0xFFFAF6EE),
                    backgroundImage: avatarUrl != null && avatarUrl!.isNotEmpty
                        ? NetworkImage(avatarUrl!)
                        : null,
                    child: avatarUrl == null || avatarUrl!.isEmpty
                        ? const Icon(Icons.person_rounded, size: 48, color: Color(0xFFC5A052))
                        : null,
                  ),
                ),
              ),
              if (onEditAvatar != null)
                Positioned(
                  bottom: 2,
                  right: 2,
                  child: InkWell(
                    onTap: onEditAvatar,
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                        ),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.15),
                            blurRadius: 6,
                          ),
                        ],
                      ),
                      child: const Icon(Icons.camera_alt_rounded, size: 14, color: Color(0xFF1F1A15)),
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 18),

          // Nombre en Tipografía Editorial de Lujo
          Text(
            userName,
            style: const TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 26,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1F1A15),
              letterSpacing: 0.5,
            ),
            textAlign: TextAlign.center,
          ),

          const SizedBox(height: 5),

          // Email
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.verified_rounded, size: 14, color: Color(0xFFC5A052)),
              const SizedBox(width: 5),
              Text(
                userEmail,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 13,
                  color: Color(0xFF8C7E74),
                  fontWeight: FontWeight.w400,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),

          const SizedBox(height: 14),

          // Badge de Membresía Haute Joaillerie
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFF7E6), Color(0xFFF6E7C8)],
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFD4AF37).withValues(alpha: 0.6), width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD4AF37).withValues(alpha: 0.12),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.stars_rounded, size: 15, color: Color(0xFFC5A052)),
                const SizedBox(width: 6),
                Text(
                  membershipLevel.toUpperCase(),
                  style: const TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.1,
                    color: Color(0xFF2C1E18),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 22),
          const Divider(color: Color(0xFFF0EBE4), height: 1),
          const SizedBox(height: 18),

          // Métricas Concierge / Stats Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildStatItem('350 XP', 'Puntos Aura', Icons.diamond_outlined),
              Container(width: 1, height: 32, color: const Color(0xFFF0EBE4)),
              _buildStatItem('Club Gold', 'Nivel Estatus', Icons.workspace_premium_outlined),
              Container(width: 1, height: 32, color: const Color(0xFFF0EBE4)),
              _buildStatItem('100%', 'Verificado', Icons.shield_outlined),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(String value, String label, IconData icon) {
    return Column(
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: const Color(0xFFC5A052)),
            const SizedBox(width: 4),
            Text(
              value,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: Color(0xFF1F1A15),
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'Inter',
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: Color(0xFF8C7E74),
          ),
        ),
      ],
    );
  }
}
