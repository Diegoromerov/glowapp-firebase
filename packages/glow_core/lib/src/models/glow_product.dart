// frontend/lib/models/glow_product.dart
import 'package:flutter/material.dart';

class GlowProduct {
  final String id;
  final String name;
  final String category;
  final String price;
  final String benefitTag;
  final IconData icon;
  final String? description;

  const GlowProduct({
    required this.id,
    required this.name,
    this.category = 'skincare',
    required this.price,
    required this.benefitTag,
    this.icon = Icons.spa_outlined,
    this.description,
  });

  String get title => name;
}
