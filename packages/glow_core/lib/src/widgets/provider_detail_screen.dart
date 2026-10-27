import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class ProviderDetailScreen extends StatelessWidget {
  final String providerId;

  const ProviderDetailScreen({super.key, required this.providerId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Detalle del Proveedor')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.store, size: 64, color: AppTheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            Text('Detalle del Proveedor', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('En desarrollo - providerId: $providerId'),
          ],
        ),
      ),
    );
  }
}