/// GlowIcon Visual Validation Screen
///
/// Internal demo screen to validate all GlowIcon implementations.
/// NOT for production use - only for development/QA.
///
/// Shows all Core (16) and Proprietary (6) icons at multiple sizes
/// and in Women/Men/AURA color contexts.

library glow_icon_demo;

import 'package:flutter/material.dart';
import 'glow_icon.dart';
import 'glow_icon_registry_init.dart';
import 'glow_icon_registry.dart';

/// Demo screen for visual validation of GlowIcon system.
class GlowIconDemoScreen extends StatefulWidget {
  const GlowIconDemoScreen({super.key});

  @override
  State<GlowIconDemoScreen> createState() => _GlowIconDemoScreenState();
}

class _GlowIconDemoScreenState extends State<GlowIconDemoScreen> {
  GlowIconColorRole _selectedRole = GlowIconColorRole.primary;
  double _selectedSize = GlowIconSize.md;
  bool _showMenColors = false;

  @override
  void initState() {
    super.initState();
    // Initialize registry
    GlowIconRegistryInit.initialize();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('GlowIcon Visual Validation'),
        actions: [
          IconButton(
            icon: Icon(_showMenColors ? Icons.man_rounded : Icons.woman_rounded),
            onPressed: () => setState(() => _showMenColors = !_showMenColors),
            tooltip: _showMenColors ? 'Switch to Women' : 'Switch to Men',
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Controls
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Controls', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 16),
                    // Color role selector
                    Text('Color Role', style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: GlowIconColorRole.values.map((role) {
                        final isSelected = role == _selectedRole;
                        return FilterChip(
                          label: Text(role.name),
                          selected: isSelected,
                          onSelected: (_) => setState(() => _selectedRole = role),
                          selectedColor: Theme.of(context).colorScheme.primaryContainer,
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),
                    // Size selector
                    Text('Size', style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        _sizeChip('XS', GlowIconSize.xs),
                        _sizeChip('SM', GlowIconSize.sm),
                        _sizeChip('MD', GlowIconSize.md),
                        _sizeChip('LG', GlowIconSize.lg),
                        _sizeChip('XL', GlowIconSize.xl),
                        _sizeChip('XXL', GlowIconSize.xxl),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // CORE ICONS
            _sectionHeader('CORE ICONS (16 P0)', Icons.widgets_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('home', 'Home'),
              ('search', 'Search'),
              ('menu', 'Menu'),
              ('close', 'Close'),
              ('back', 'Back'),
              ('forward', 'Forward'),
              ('more', 'More'),
              ('profile', 'Profile'),
              ('heart', 'Heart'),
              ('bag', 'Bag'),
              ('cart', 'Cart'),
              ('calendar', 'Calendar'),
              ('clock', 'Clock'),
              ('location', 'Location'),
              ('settings', 'Settings'),
              ('notification', 'Notification'),
            ]),

            const SizedBox(height: 32),

            // PROPRIETARY ICONS
            _sectionHeader('PROPRIETARY ICONS (6 I1)', Icons.auto_awesome_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('glow', 'Glow'),
              ('aura', 'Aura'),
              ('concierge', 'Concierge'),
              ('beauty_ritual', 'Beauty Ritual'),
              ('glow_recommendation', 'Glow Recommendation'),
              ('male_grooming', 'Male Grooming'),
            ]),

            const SizedBox(height: 32),

            // BEAUTY EXTENDED ICONS (I2-A)
            _sectionHeader('BEAUTY EXTENDED ICONS (8 I2-A)', Icons.spa_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('skincare', 'Skincare'),
              ('hair', 'Hair'),
              ('nails', 'Nails'),
              ('makeup', 'Makeup'),
              ('fragrance', 'Fragrance'),
              ('body', 'Body'),
              ('wellness', 'Wellness'),
              ('spa', 'Spa'),
            ]),

            const SizedBox(height: 32),

            // MEN EXTENDED ICONS (I2-B)
            _sectionHeader('MEN EXTENDED ICONS (5 I2-B)', Icons.man_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('beard', 'Beard'),
              ('shave', 'Shave'),
              ('scalp', 'Scalp'),
              ('mens_fragrance', 'Men\'s Fragrance'),
              ('mens_body', 'Men\'s Body'),
            ]),

            const SizedBox(height: 32),

            // CONCIERGE EXTENDED ICONS (I2-C)
            _sectionHeader('CONCIERGE EXTENDED ICONS (4 I2-C)', Icons.support_agent_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('booking', 'Booking'),
              ('chat', 'Chat'),
              ('wishlist', 'Wishlist'),
              ('support', 'Support'),
            ]),

            const SizedBox(height: 32),

            // AURA EXTENDED ICONS (I2-D)
            _sectionHeader('AURA EXTENDED ICONS (6 I2-D)', Icons.auto_awesome_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('scan', 'Scan'),
              ('analyze', 'Analyze'),
              ('learn', 'Learn'),
              ('predict', 'Predict'),
              ('evolve', 'Evolve'),
              ('sync', 'Sync'),
            ]),

            const SizedBox(height: 32),

            // SYSTEM EXTENDED ICONS (I2-E)
            _sectionHeader('SYSTEM EXTENDED ICONS (6 I2-E)', Icons.settings_outlined),
            const SizedBox(height: 12),
            _iconGrid([
              ('share', 'Share'),
              ('download', 'Download'),
              ('upload', 'Upload'),
              ('filter', 'Filter'),
              ('sort', 'Sort'),
              ('qr', 'QR'),
            ]),

            const SizedBox(height: 32),

            // SIZE COMPARISON
            _sectionHeader('SIZE COMPARISON (Home Icon)', Icons.zoom_out_map_outlined),
            const SizedBox(height: 12),
            _sizeComparison(),

            const SizedBox(height: 32),

            // COLOR ROLE COMPARISON
            _sectionHeader('COLOR ROLES (Home Icon)', Icons.palette_outlined),
            const SizedBox(height: 12),
            _colorRoleComparison(),

            const SizedBox(height: 32),

            // REGISTRY STATUS
            _sectionHeader('REGISTRY STATUS', Icons.list_alt_outlined),
            const SizedBox(height: 12),
            _registryStatus(),
          ],
        ),
      ),
    );
  }

  Widget _sizeChip(String label, double size) {
    final isSelected = _selectedSize == size;
    return FilterChip(
      label: Text('$label (${size.toInt()}px)'),
      selected: isSelected,
      onSelected: (_) => setState(() => _selectedSize = size),
      selectedColor: Theme.of(context).colorScheme.primaryContainer,
    );
  }

  Widget _sectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(title, style: Theme.of(context).textTheme.headlineSmall),
      ],
    );
  }

  Widget _iconGrid(List<(String, String)> icons) {
    return Wrap(
      spacing: 24,
      runSpacing: 24,
      alignment: WrapAlignment.center,
      children: icons.map((icon) {
        final (name, label) = icon;
        return _IconCard(
          name: name,
          label: label,
          size: _selectedSize,
          colorRole: _selectedRole,
          showMenColors: _showMenColors,
        );
      }).toList(),
    );
  }

  Widget _sizeComparison() {
    return const Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _SizeDemo(size: GlowIconSize.xs, label: '16px'),
        SizedBox(width: 24),
        _SizeDemo(size: GlowIconSize.sm, label: '20px'),
        SizedBox(width: 24),
        _SizeDemo(size: GlowIconSize.md, label: '24px'),
        SizedBox(width: 24),
        _SizeDemo(size: GlowIconSize.lg, label: '28px'),
        SizedBox(width: 24),
        _SizeDemo(size: GlowIconSize.xl, label: '32px'),
        SizedBox(width: 24),
        _SizeDemo(size: GlowIconSize.xxl, label: '40px'),
      ],
    );
  }

  Widget _colorRoleComparison() {
    return Wrap(
      spacing: 16,
      runSpacing: 16,
      alignment: WrapAlignment.center,
      children: GlowIconColorRole.values.map((role) {
        return Column(
          children: [
            GlowIcon.resolve(
              'home',
              size: GlowIconSize.lg,
              colorRole: role,
            ),
            const SizedBox(height: 4),
            Text(
              role.name,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        );
      }).toList(),
    );
  }

  Widget _registryStatus() {
    final registered = GlowIconRegistry.registeredNames.toList()..sort();
    final missing = GlowIconRegistry.allKnownNames
        .where((name) => !GlowIconRegistry.has(name))
        .toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Registered: ${registered.length}', style: Theme.of(context).textTheme.bodyMedium),
        if (missing.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text('Missing: ${missing.join(', ')}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.red)),
        ],
        const SizedBox(height: 8),
        Wrap(
          spacing: 4,
          runSpacing: 4,
          children: registered.map((name) {
            final isCore = GlowIconRegistry.coreIcons.contains(name);
            return Chip(
              label: Text(name),
              backgroundColor: isCore
                  ? Theme.of(context).colorScheme.primaryContainer
                  : Theme.of(context).colorScheme.secondaryContainer,
              labelStyle: Theme.of(context).textTheme.labelSmall,
            );
          }).toList(),
        ),
      ],
    );
  }
}

/// Individual icon card for the grid.
class _IconCard extends StatelessWidget {
  final String name;
  final String label;
  final double size;
  final GlowIconColorRole colorRole;
  final bool showMenColors;

  const _IconCard({
    required this.name,
    required this.label,
    required this.size,
    required this.colorRole,
    required this.showMenColors,
  });

  @override
  Widget build(BuildContext context) {
    Color iconColor;
    if (showMenColors) {
      // Men color mapping
      switch (colorRole) {
        case GlowIconColorRole.primary:
          iconColor = const Color(0xFFC8B08A); // Men Champagne
          break;
        case GlowIconColorRole.secondary:
          iconColor = const Color(0xFFF2EFEA); // Men Warm White
          break;
        case GlowIconColorRole.accent:
          iconColor = const Color(0xFFB8734A); // Men Copper
          break;
        case GlowIconColorRole.aura:
          iconColor = const Color(0xFF164C46); // Aura Teal
          break;
        default:
          iconColor = Theme.of(context).colorScheme.onSurface;
      }
    } else {
      // Women color mapping
      switch (colorRole) {
        case GlowIconColorRole.primary:
          iconColor = const Color(0xFFD4AF7A); // Women Rose Gold
          break;
        case GlowIconColorRole.secondary:
          iconColor = const Color(0xFF5A3A2A); // Women Warm Brown
          break;
        case GlowIconColorRole.accent:
          iconColor = const Color(0xFFD9A27F); // Women Champagne
          break;
        case GlowIconColorRole.aura:
          iconColor = const Color(0xFF164C46); // Aura Teal
          break;
        default:
          iconColor = Theme.of(context).colorScheme.onSurface;
      }
    }

    return SizedBox(
      width: 100,
      child: Column(
        children: [
          Container(
            width: size + 16,
            height: size + 16,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: GlowIcon.resolve(
                name,
                size: size,
                color: iconColor,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            name,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Size demo widget.
class _SizeDemo extends StatelessWidget {
  final double size;
  final String label;

  const _SizeDemo({required this.size, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: size + 16,
          height: size + 16,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Center(
            child: GlowIcon.resolve(
              'home',
              size: size,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}