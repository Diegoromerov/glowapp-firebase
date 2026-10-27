import 'package:glow_core/glow_core.dart';
// frontend/lib/screens/academy/course_detail_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/analytics_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'quiz_screen.dart';
import 'glow_consent_widget.dart';

class CourseDetailScreen extends StatefulWidget {
  final String courseId;
  const CourseDetailScreen({super.key, required this.courseId});

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _courseData;
  String? _error;
  
  // LecciÃ³n activa seleccionada para reproducciÃ³n/lectura
  Map<String, dynamic>? _activeLesson;

  @override
  void initState() {
    super.initState();
    _loadCourseDetail();
  }

  Future<void> _loadCourseDetail() async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });
      final data = await ApiService.get('/api/academy/courses/${widget.courseId}');
      if (!mounted) return;
      setState(() {
        _courseData = data;
        _isLoading = false;
        
        // Seleccionar por defecto la primera lecciÃ³n no completada si existe
        if (_activeLesson == null) {
          _selectFirstIncompleteLesson(data);
        } else {
          // Refrescar el estado de la lecciÃ³n activa
          _refreshActiveLessonState(data);
        }
      });
    } catch (e) {
      setState(() {
        _error = 'Error al cargar detalle del curso: $e';
        _isLoading = false;
      });
    }
  }

  void _selectFirstIncompleteLesson(Map<String, dynamic> data) {
    final List<dynamic> modules = data['modules'] ?? [];
    if (modules.isEmpty) {
      _activeLesson = null;
      return;
    }
    for (var m in modules) {
      final List<dynamic> lessons = m['lessons'] ?? [];
      for (var l in lessons) {
        if (l['lesson_completed'] != true) {
          _activeLesson = l;
          return;
        }
      }
    }
    // Si estÃ¡n todas completas, mostrar la primera lecciÃ³n si existe
    if (modules.isNotEmpty) {
      final List<dynamic> firstLessons = modules[0]['lessons'] ?? [];
      if (firstLessons.isNotEmpty) {
        _activeLesson = firstLessons[0];
      }
    }
  }

  void _refreshActiveLessonState(Map<String, dynamic> data) {
    if (_activeLesson == null) return;
    final List<dynamic> modules = data['modules'] ?? [];
    for (var m in modules) {
      final List<dynamic> lessons = m['lessons'] ?? [];
      for (var l in lessons) {
        if (l['lesson_id'] == _activeLesson!['lesson_id']) {
          _activeLesson = l;
          return;
        }
      }
    }
  }

  Future<void> _completeLesson(String lessonId) async {
    try {
      await ApiService.post('/api/academy/lessons/$lessonId/complete', {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('ðŸŽ‰ Â¡LecciÃ³n completada con Ã©xito!'),
          backgroundColor: Colors.green,
        ),
      );
      // Recargar datos para actualizar la UI y porcentajes
      await _loadCourseDetail();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al completar lecciÃ³n: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  bool _areAllLessonsCompleted() {
    if (_courseData == null) return false;
    final List<dynamic> modules = _courseData!['modules'] ?? [];
    for (var m in modules) {
      final List<dynamic> lessons = m['lessons'] ?? [];
      for (var l in lessons) {
        if (l['lesson_completed'] != true) return false;
      }
    }
    return true;
  }

  @override
    Widget build(BuildContext context) {
      final themeColor = AppTheme.primary;

      if (_isLoading) {
        return Scaffold(
          appBar: AppBar(title: const Text('Cargando Curso...', style: TextStyle(color: Colors.white))),
          body: Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(AppTheme.primary))),
        );
      }

    if (_error != null || _courseData == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Error', style: TextStyle(color: Colors.white))),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(_error ?? 'OcurriÃ³ un error inesperado'),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _loadCourseDetail, child: const Text('Reintentar'))
            ],
          ),
        ),
      );
    }

    final course = _courseData!['course'];
    final List<dynamic> modules = _courseData!['modules'] ?? [];
    final bool hasCertificate = _courseData!['hasCertificate'] == true;

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: Text(
          course['title'] ?? 'Detalle del Curso',
          style: const TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
        iconTheme: const IconThemeData(color: Color(0xFF1F1A15)),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
        children: [
          // ðŸ“½ï¸ Panel de la lecciÃ³n activa. Antes mostraba una imagen de Unsplash y el
          // texto "Streaming HD de lecciÃ³n disponible" aunque el video no existiera
          // (o estuviera vacÃ­o): prometÃ­a reproducciÃ³n que nunca ocurrÃ­a.
          if (_activeLesson != null && _activeLesson!['locked'] == true)
            Container(
              width: double.infinity,
              color: const Color(0xFF1F1A15),
              padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
              child: const Column(
                children: [
                  Icon(Icons.lock_outline, color: Colors.white70, size: 40),
                  SizedBox(height: 10),
                  Text(
                    'LecciÃ³n bloqueada',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Completa la lecciÃ³n anterior para desbloquear este contenido.',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          else if (_activeLesson != null)
            Semantics(
              label: 'LecciÃ³n ${_activeLesson!['lesson_title'] ?? ''}',
              child: Container(
                width: double.infinity,
                color: const Color(0xFF1F1A15),
                padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                child: Column(
                  children: [
                    if ((_activeLesson!['video_url']?.toString().trim().isEmpty ?? true)) ...[
                      const Icon(Icons.ondemand_video_outlined, color: Colors.white54, size: 40),
                      const SizedBox(height: 10),
                      const Text(
                        'Esta lecciÃ³n no tiene video asociado',
                        style: TextStyle(color: Colors.white70, fontSize: 13),
                        textAlign: TextAlign.center,
                      ),
                    ] else ...[
                      Semantics(
                        button: true,
                        label: 'Copiar enlace del video de la lecciÃ³n',
                        child: IconButton(
                          icon: const Icon(Icons.play_circle_fill, size: 64, color: Colors.white),
                          onPressed: () async {
                            HapticFeedback.mediumImpact();
                            await Clipboard.setData(
                              ClipboardData(text: _activeLesson!['video_url'].toString()),
                            );
                            if (!mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Enlace del video copiado al portapapeles.'),
                                duration: Duration(seconds: 2),
                              ),
                            );
                          },
                        ),
                      ),
                      const Text(
                        'Toca para copiar el enlace del video',
                        style: TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                    ],
                    const SizedBox(height: 10),
                    Text(
                      _activeLesson!['lesson_title'] ?? '',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),

          // ðŸ“– Contenido de texto y botones de acciÃ³n rÃ¡pida
          if (_activeLesson != null)
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _activeLesson!['lesson_title'] ?? '',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                  ),
                  const SizedBox(height: 8),
                  
                  // Inyectar el consentimiento interactivo de la Ley 1581 si es la lecciÃ³n de bienvenida del MÃ³dulo 0
                  if (_activeLesson!['lesson_id'] == 'a0000000-0000-0000-0000-000000000000') ...[
                    const SizedBox(height: 10),
                    GlowConsentWidget(
                      onConsentGranted: () {
                        // Callback cuando el consentimiento es otorgado
                        print("Consentimiento biomÃ©trico otorgado por el usuario.");
                      },
                    ),
                    const SizedBox(height: 15),
                  ],

                  if (_activeLesson!['locked'] == true)
                    const Text(
                      'El contenido de esta lecciÃ³n estarÃ¡ disponible cuando completes la anterior.',
                      style: TextStyle(fontSize: 14, color: Colors.grey, height: 1.4, fontStyle: FontStyle.italic),
                    )
                  else
                    Text(
                      _activeLesson!['content_text'] ?? '',
                      style: TextStyle(fontSize: 14, color: Colors.grey[800], height: 1.4),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      if (_activeLesson!['lesson_completed'] == true)
                        const Row(
                           children: [
                             Icon(Icons.check_circle, color: Colors.green),
                             SizedBox(width: 6),
                             Text('Completada', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                           ],
                        )
                      else
                        ElevatedButton.icon(
                          // El servidor rechaza completar una lecciÃ³n bloqueada: la UI
                          // no debe ofrecer un botÃ³n que va a fallar.
                          onPressed: _activeLesson!['locked'] == true
                              ? null
                              : () => _completeLesson(_activeLesson!['lesson_id']),
                          icon: Icon(
                            _activeLesson!['locked'] == true ? Icons.lock_outline : Icons.check,
                            color: Colors.white,
                          ),
                          label: Text(
                            _activeLesson!['locked'] == true
                                ? 'Completa la lecciÃ³n anterior'
                                : 'Marcar como Completada',
                            style: const TextStyle(color: Colors.white),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: themeColor,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                      if (_areAllLessonsCompleted() && !hasCertificate && (((_courseData?['attemptsLeft'] as int?) ?? 1) > 0))
                        ElevatedButton.icon(
                          onPressed: () async {
                            final success = await Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => QuizScreen(courseId: widget.courseId),
                              ),
                            );
                            if (success == true) {
                              _loadCourseDetail();
                            }
                          },
                          icon: const Icon(Icons.quiz, color: Colors.white),
                          label: Text(
                            'Tomar Examen (${_courseData?['attemptsLeft'] ?? ''} intento/s)',
                            style: const TextStyle(color: Colors.white),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.amber[700],
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                          ),
                        ),
                      if (_areAllLessonsCompleted() && !hasCertificate && (((_courseData?['attemptsLeft'] as int?) ?? 1) <= 0))
                        const Text(
                          'Sin intentos de examen disponibles. Contacta a soporte para reiniciarlos.',
                          style: TextStyle(color: Colors.redAccent, fontSize: 12),
                        ),
                    ],
                  ),
                  if (hasCertificate) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.amber.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.amber, width: 1),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.emoji_events, color: Colors.amber, size: 24),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Â¡Felicidades! Completaste este curso y desbloqueaste la insignia: ${course['badge_name']}.',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.amber),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),

          const Divider(height: 1),

          // ðŸ—‚ï¸ Lista de MÃ³dulos y Lecciones
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(8.0),
              itemCount: modules.length,
              itemBuilder: (context, mIndex) {
                final module = modules[mIndex];
                final List<dynamic> lessons = module['lessons'] ?? [];

                return ExpansionTile(
                  initiallyExpanded: true,
                  title: Text(
                    module['title'] ?? 'MÃ³dulo',
                    style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black87),
                  ),
                  children: lessons.map<Widget>((lesson) {
                    final bool isCurrent = _activeLesson != null && _activeLesson!['lesson_id'] == lesson['lesson_id'];
                    final bool isCompleted = lesson['lesson_completed'] == true;
                    final bool isLocked = lesson['locked'] == true;

                    return ListTile(
                      selected: isCurrent,
                      selectedTileColor: themeColor.withOpacity(0.08),
                      enabled: !isLocked,
                      leading: Icon(
                        isCompleted
                            ? Icons.check_circle
                            : (isLocked ? Icons.lock_outline : Icons.play_arrow_outlined),
                        color: isCompleted ? Colors.green : (isLocked ? Colors.grey : (isCurrent ? themeColor : Colors.grey)),
                      ),
                      title: Text(
                        lesson['lesson_title'] ?? 'LecciÃ³n',
                        style: TextStyle(
                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                          color: isCurrent ? themeColor : (isLocked ? Colors.grey : Colors.black87),
                        ),
                      ),
                      trailing: Icon(isLocked ? Icons.lock : Icons.arrow_forward_ios, size: 12),
                      onTap: isLocked
                          ? () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('LecciÃ³n bloqueada: completa la lecciÃ³n anterior.'),
                                backgroundColor: Colors.amber,
                                duration: Duration(seconds: 2),
                              ),
                            );
                          }
                          : () {
                            setState(() {
                              _activeLesson = lesson;
                            });
                            AnalyticsService().logCourseLessonView(
                              courseId: widget.courseId,
                              lessonId: lesson['lesson_id']?.toString() ?? '',
                              lessonTitle: lesson['lesson_title'] ?? 'LecciÃ³n',
                            );
                          },
                    );
                  }).toList(),
                );
              },
            ),
          ),
        ],
      ),
    ),
  ),
);
  }
}
