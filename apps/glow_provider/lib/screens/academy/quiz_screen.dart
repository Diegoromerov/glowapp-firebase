// frontend/lib/screens/academy/quiz_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/glow_core.dart';

class QuizScreen extends StatefulWidget {
  final String courseId;
  const QuizScreen({super.key, required this.courseId});

  @override
  State<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends State<QuizScreen> {
  bool _isLoading = true;
  List<dynamic> _questions = [];
  String? _error;

  // Respuestas del usuario: { questionId: selectedIndex }
  final Map<String, int> _userAnswers = {};

  // Estado del resultado
  bool _isSubmitting = false;
  Map<String, dynamic>? _result;

  // Umbral de aprobación e intentos restantes que informa el backend
  int _passPct = 80;
  int? _attemptsLeft;

  @override
  void initState() {
    super.initState();
    _loadQuiz();
  }

  Future<void> _loadQuiz() async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
        _result = null;
        _userAnswers.clear();
      });
      final data = await ApiService.get('/api/academy/courses/${widget.courseId}/quiz');
      // El backend puede responder la lista de preguntas o el objeto
      // { questions, passPct, attemptsLeft } (formato nuevo con umbral e intentos).
      final List<dynamic> questions = (data is Map && data['questions'] is List)
          ? data['questions'] as List<dynamic>
          : (data is List ? data : <dynamic>[]);
      if (!mounted) return;
      setState(() {
        _questions = questions;
        if (data is Map) {
          if (data['passPct'] is int) _passPct = data['passPct'] as int;
          if (data['attemptsLeft'] is int) _attemptsLeft = data['attemptsLeft'] as int;
        }
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Error al cargar cuestionario: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _submitQuiz() async {
    if (_userAnswers.length < _questions.length) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Por favor responde todas las preguntas del examen.'),
          backgroundColor: Colors.amber,
        ),
      );
      return;
    }

    try {
      setState(() {
        _isSubmitting = true;
      });

      // Mapear respuestas en el formato requerido por la API
      final answersMap = {};
      _userAnswers.forEach((qId, index) {
        answersMap[qId] = index;
      });

      final res = await ApiService.post(
        '/api/academy/courses/${widget.courseId}/submit-quiz',
        {'answers': answersMap},
      );

      if (!mounted) return;
      setState(() {
        _result = res is Map<String, dynamic> ? res : Map<String, dynamic>.from(res as Map);
        if (_result!['attemptsLeft'] is int) _attemptsLeft = _result!['attemptsLeft'] as int;
        _isSubmitting = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al enviar examen: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final themeColor = AppTheme.primary;

    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Examen de Certificación')),
        body: Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(AppTheme.primary))),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Error')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(_error!),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _loadQuiz, child: const Text('Reintentar'))
            ],
          ),
        ),
      );
    }

    // Pantalla de resultados si el examen fue enviado
    if (_result != null) {
      final bool approved = _result!['approved'] == true;
      final int score = _result!['score'] ?? 0;
      final int total = _result!['total'] ?? 0;
      final String badgeName = _result!['badgeName'] ?? '';

      return Scaffold(
        appBar: AppBar(
          title: const Text('Resultados del Examen'),
          automaticallyImplyLeading: false,
          flexibleSpace: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [themeColor, const Color(0xFFE2C4BC)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
        ),
        body: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  approved ? Icons.emoji_events : Icons.sentiment_very_dissatisfied,
                  size: 100,
                  color: approved ? Colors.amber : Colors.redAccent,
                ),
                const SizedBox(height: 24),
                Text(
                  approved ? '¡Felicidades, Aprobaste!' : 'No has aprobado esta vez',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24),
                ),
                const SizedBox(height: 8),
                Text(
                  'Obtuviste una puntuación de $score / $total correctas.',
                  style: const TextStyle(fontSize: 16),
                ),
                const SizedBox(height: 24),
                if (approved) ...[
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.amber, width: 2),
                    ),
                    child: Column(
                      children: [
                        const Icon(Icons.military_tech, color: Colors.amber, size: 48),
                        const SizedBox(height: 8),
                        const Text(
                          'INSIGNIA DESBLOQUEADA',
                          style: TextStyle(fontWeight: FontWeight.bold, color: Colors.amber, fontSize: 12),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          badgeName,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.black87),
                          textAlign: TextAlign.center,
                        ),
                        // Código público verificable del certificado (antes el certificado
                        // se emitía sin ningún identificador consultable).
                        if ((_result!['certificateCode']?.toString() ?? '').isNotEmpty) ...[
                          const SizedBox(height: 16),
                          Text(
                            'Código de verificación: ${_result!['certificateCode']}',
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.black87),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Comparte este código para que cualquiera pueda verificar tu certificado.',
                            style: TextStyle(fontSize: 11, color: Colors.black54),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                if (_attemptsLeft != null && _attemptsLeft! > 0)
                  Text(
                    'Intentos restantes: $_attemptsLeft',
                    style: const TextStyle(fontSize: 13, color: Colors.black54),
                  ),
                if (!approved || (_attemptsLeft ?? 0) > 0) ...[
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    onPressed: _isSubmitting ? null : () {
                      setState(() {
                        _result = null;
                        _userAnswers.clear();
                        _isSubmitting = false;
                      });
                    },
                    icon: const Icon(Icons.refresh),
                    label: Text(_attemptsLeft != null && _attemptsLeft! > 0
                        ? 'Reintentar examen'
                        : 'Volver a intentarlo'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: themeColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ],
                if (approved && (_attemptsLeft ?? 0) == 0) ...[
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.home),
                    label: const Text('Volver a Academy'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: themeColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    // Pantalla de examen
    return Scaffold(
      appBar: AppBar(
        title: const Text('Examen de Certificación'),
        automaticallyImplyLeading: false,
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [themeColor, const Color(0xFFE2C4BC)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          if (_attemptsLeft != null)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: themeColor.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: themeColor.withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, color: Colors.black54),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Intentos restantes: $_attemptsLeft. Se requiere ${_passPct}% para aprobar.',
                      style: const TextStyle(fontSize: 13, color: Colors.black87),
                    ),
                  ),
                ],
              ),
            ),
          ListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _questions.length,
            itemBuilder: (context, qIndex) {
              final quiz = _questions[qIndex];
              final List<dynamic> options = quiz['options'] ?? [];
              final String quizId = quiz['id'];

              return Card(
                margin: const EdgeInsets.only(bottom: 20.0),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.0)),
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Pregunta ${qIndex + 1} de ${_questions.length}',
                        style: TextStyle(color: themeColor, fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        quiz['question'] ?? '',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16.0),
                      ),
                      const SizedBox(height: 16),
                      Column(
                        children: List.generate(options.length, (oIndex) {
                          final optionText = options[oIndex].toString();
                          final isSelected = _userAnswers[quizId] == oIndex;

                          return Container(
                            margin: const EdgeInsets.only(bottom: 8.0),
                            decoration: BoxDecoration(
                              color: isSelected ? themeColor.withValues(alpha: 0.08) : Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected ? themeColor : Colors.grey[300]!,
                                width: isSelected ? 2 : 1,
                              ),
                            ),
                            child: RadioListTile<int>(
                              title: Text(optionText, style: const TextStyle(fontSize: 14)),
                              value: oIndex,
                              groupValue: _userAnswers[quizId],
                              activeColor: themeColor,
                              onChanged: (val) {
                                setState(() {
                                  _userAnswers[quizId] = val!;
                                });
                              },
                            ),
                          );
                        }),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Container(
              height: 52,
              width: double.infinity,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: const LinearGradient(
                  colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submitQuiz,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: _isSubmitting
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Enviar examen', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
