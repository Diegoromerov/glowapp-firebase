// frontend/lib/screens/academy/glow_color_screen.dart
// Pantalla de detalle para el curso "Colorimetría Capilar" en GlowAcademy
import 'package:flutter/material.dart';
import 'course_detail_screen.dart';

class GlowColorScreen extends StatelessWidget {
  const GlowColorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Redirigir dinámicamente al detalle oficial del curso de colorimetría insertado en la base de datos
    return const CourseDetailScreen(courseId: 'c0000000-0000-0000-0000-000000000003');
  }
}
