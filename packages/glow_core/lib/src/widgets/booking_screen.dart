import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class BookingScreen extends StatelessWidget {
  final String providerId;
  final String providerName;
  final List<dynamic> services;
  final String? initialServiceId;

  const BookingScreen({
    super.key,
    required this.providerId,
    required this.providerName,
    required this.services,
    this.initialServiceId,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Reservar con $providerName')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.calendar_today, size: 64, color: AppTheme.primary.withOpacity(0.5)),
            const SizedBox(height: 16),
            Text('Pantalla de Reservas', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('En desarrollo - providerId: $providerId'),
          ],
        ),
      ),
    );
  }
}