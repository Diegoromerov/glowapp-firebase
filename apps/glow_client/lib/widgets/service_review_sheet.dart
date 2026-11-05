// Hoja de reseña del servicio: estrellas + aspectos + comentario.
//
// Reemplaza al bottom sheet anterior, que mezclaba tres decisiones en un solo
// formulario: calificar, escribir y dejar propina. Pedir dinero en la misma
// pantalla que pide una opinión sesga la nota y hunde la tasa de respuesta, así
// que la propina se movió a su propio botón.
//
// Orden deliberado: la nota primero y en un toque; el resto es opcional y
// saltable. Cada campo extra que se exige cuesta reseñas.
import 'package:flutter/material.dart';
import 'package:glow_core/services.dart';

/// Aspectos que se pueden marcar. Debe coincidir con la lista del backend
/// (`ASPECTOS_RESENIA` en bookingController): lo que no está allí se descarta.
const List<String> kAspectosResenia = <String>[
  'Puntualidad',
  'Resultado',
  'Trato',
  'Higiene',
  'Precio-calidad',
];

/// Firma del envío. Es la costura para probar la hoja sin red: `ApiService` es
/// estático y no se puede inyectar.
typedef ReviewSubmit = Future<void> Function(
    int rating, String comment, List<String> aspectos);

/// Abre la hoja y devuelve `true` si la reseña se publicó.
Future<bool?> showServiceReviewSheet(
  BuildContext context, {
  required String bookingId,
  required String providerName,
  int initialRating = 0,
  ReviewSubmit? onSubmit,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _ServiceReviewSheet(
      bookingId: bookingId,
      providerName: providerName,
      initialRating: initialRating,
      onSubmit: onSubmit,
    ),
  );
}

class _ServiceReviewSheet extends StatefulWidget {
  final String bookingId;
  final String providerName;
  final int initialRating;
  final ReviewSubmit? onSubmit;

  const _ServiceReviewSheet({
    required this.bookingId,
    required this.providerName,
    required this.initialRating,
    this.onSubmit,
  });

  @override
  State<_ServiceReviewSheet> createState() => _ServiceReviewSheetState();
}

class _ServiceReviewSheetState extends State<_ServiceReviewSheet> {
  late int _rating = widget.initialRating;
  final Set<String> _aspectos = <String>{};
  final TextEditingController _comment = TextEditingController();
  bool _enviando = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _publicar() async {
    if (_enviando) return;
    if (_rating < 1) {
      _avisar('Toca las estrellas para calificar');
      return;
    }

    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _enviando = true);
    try {
      final enviar = widget.onSubmit ??
          (int rating, String comment, List<String> aspectos) =>
              ApiService.submitReview(widget.bookingId, rating, comment,
                  aspectos: aspectos);

      await enviar(_rating, _comment.text.trim(), _aspectos.toList());
      if (!mounted) return;
      navigator.pop(true);
      messenger.showSnackBar(const SnackBar(
        content: Text('¡Gracias! Tu reseña ya está publicada.'),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _enviando = false);
      _avisar(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  void _avisar(String mensaje) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 20),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0D8CE),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '¿Cómo te fue con ${widget.providerName}?',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15)),
              ),
              const SizedBox(height: 6),
              const Text(
                'Tu calificación ayuda a otras clientas a elegir.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Color(0xFF8A7F72)),
              ),
              const SizedBox(height: 18),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  final valor = i + 1;
                  final activa = valor <= _rating;
                  return IconButton(
                tooltip: 'Acción',
                    onPressed: _enviando
                        ? null
                        : () => setState(() => _rating = valor),
                    iconSize: 40,
                    icon: Icon(
                      activa ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: activa
                          ? const Color(0xFFC5A052)
                          : const Color(0xFFD9CFC2),
                    ),
                    tooltip: '$valor de 5',
                  );
                }),
              ),
              const SizedBox(height: 8),
              const Text(
                '¿Qué destacarías?',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1F1A15)),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: kAspectosResenia.map((aspecto) {
                  final activo = _aspectos.contains(aspecto);
                  return FilterChip(
                    label: Text(aspecto,
                        style: TextStyle(
                            fontSize: 12,
                            color: activo
                                ? Colors.white
                                : const Color(0xFF1F1A15))),
                    selected: activo,
                    onSelected: _enviando
                        ? null
                        : (v) => setState(() {
                              if (v) {
                                _aspectos.add(aspecto);
                              } else {
                                _aspectos.remove(aspecto);
                              }
                            }),
                    backgroundColor: const Color(0xFFF4EFEA),
                    selectedColor: const Color(0xFFC5A052),
                    checkmarkColor: Colors.white,
                    side: BorderSide(
                        color: activo
                            ? const Color(0xFFC5A052)
                            : const Color(0xFFE0D8CE)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20)),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _comment,
                enabled: !_enviando,
                maxLines: 3,
                maxLength: 400,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText:
                      '¿Qué deberían saber otras clientas? (opcional)',
                  hintStyle: const TextStyle(
                      fontSize: 13, color: Color(0xFF8A7F72)),
                  filled: true,
                  fillColor: const Color(0xFFFAF8F5),
                  counterText: '',
                  contentPadding: const EdgeInsets.all(14),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: Color(0xFFE0D8CE)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: Color(0xFFE0D8CE)),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                height: 50,
                child: ElevatedButton(
                  onPressed: _enviando ? null : _publicar,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFC5A052),
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: const Color(0xFFE0D8CE),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    elevation: 0,
                  ),
                  child: _enviando
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Publicar reseña',
                          style: TextStyle(
                              fontSize: 15, fontWeight: FontWeight.bold)),
                ),
              ),
              TextButton(
                onPressed: _enviando
                    ? null
                    : () => Navigator.of(context).pop(false),
                child: const Text('Ahora no',
                    style: TextStyle(color: Color(0xFF8A7F72))),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
