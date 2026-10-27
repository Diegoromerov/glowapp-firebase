// frontend/lib/screens/provider_ai_copilot_screen.dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/services/reply_reconcile.dart';
import 'package:glow_core/widgets/voice_input.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/glow_core.dart';

/// 🤖 GlowPro Co-Pilot Screen
/// Pantalla dedicada exclusivamente a la consultoría de negocio, análisis de agenda/ingresos,
/// estrategias de marketing y asesoría técnica para el Proveedor / Profesional con AURA AI.
class ProviderAiCopilotScreen extends StatefulWidget {
  const ProviderAiCopilotScreen({super.key});

  @override
  State<ProviderAiCopilotScreen> createState() => _ProviderAiCopilotScreenState();
}

class _ProviderAiCopilotScreenState extends State<ProviderAiCopilotScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool _isLoading = true;
  bool _isSending = false;
  bool _isAuraThinking = false;
  String? _error;

  WebSocketChannel? _webSocketChannel;
  final ReplyReconciler _replyReconciler = ReplyReconciler();

  final List<Map<String, dynamic>> _quickPrompts = [
    {
      'icon': Icons.insights_rounded,
      'label': 'Analizar Ingresos',
      'prompt': '📊 ¿Cuál fue mi rendimiento e ingresos proyectados esta semana?',
    },
    {
      'icon': Icons.calendar_today_rounded,
      'label': 'Huecos en Agenda',
      'prompt': '🗓️ Revisa mi agenda de mañana e indica qué espacios libres tengo para promocionar.',
    },
    {
      'icon': Icons.local_offer_rounded,
      'label': 'Oferta Relámpago',
      'prompt': '💡 Sugiere un combo o descuento promocional para atraer clientes en horas de baja demanda.',
    },
    {
      'icon': Icons.auto_awesome_rounded,
      'label': 'Fórmula Capilar',
      'prompt': '✂️ Asesórame en la técnica de Balayage para un cabello tinturado de tono castaño oscuro.',
    },
    {
      'icon': Icons.campaign_rounded,
      'label': 'Mensaje Clientes',
      'prompt': '📣 Redáctame un mensaje cordial de fidelización para clientes que no agendan hace 30 días.',
    },
  ];

  @override
  void initState() {
    super.initState();
    _loadMessages();
    _connectWebSocket();
  }

  @override
  void dispose() {
    _webSocketChannel?.sink.close();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _connectWebSocket() async {
    try {
      final token = await AuthService.getToken();
      final baseUrl = await AuthService.getBaseUrl();
      final wsBase = baseUrl.replaceFirst('http', 'ws');
      final wsUrl = '$wsBase/chat';

      _webSocketChannel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _webSocketChannel!.sink.add(jsonEncode({
        'type': 'register',
        'token': token,
      }));

      _webSocketChannel!.stream.listen((message) {
        try {
          final data = jsonDecode(message);
          if (data['type'] == 'chat_message') {
            final msg = data['data'];
            final senderId = msg['sender_id']?.toString();
            if (senderId == '0' || senderId == '00000000-0000-0000-0000-000000000000') {
              if (mounted) {
                setState(() {
                  _isAuraThinking = false;
                  _messages.add(msg);
                });
                _scrollToBottom();
              }
            }
          } else if (data['type'] == 'aura_status') {
            if (mounted) {
              setState(() {
                _isAuraThinking = data['data']?['state'] == 'thinking';
              });
            }
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  Future<void> _loadMessages() async {
    try {
      final msgs = await ApiService.fetchChatMessages('0');
      if (mounted) {
        setState(() {
          _messages = msgs;
          _isLoading = false;
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'No se pudo cargar el historial con AURA Co-Pilot.';
          _isLoading = false;
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage(String text) async {
    if (text.trim().isEmpty || _isSending) return;

    final userMsgText = text.trim();
    _controller.clear();

    final tempMsg = {
      'id': 'temp_${DateTime.now().millisecondsSinceEpoch}',
      'sender_id': 'user',
      'receiver_id': '0',
      'message': userMsgText,
      'created_at': DateTime.now().toIso8601String(),
    };

    setState(() {
      _messages.add(tempMsg);
      _isSending = true;
      _isAuraThinking = true;
    });
    _scrollToBottom();

    try {
      await ApiService.sendChatMessage('0', userMsgText);
      if (mounted) {
        setState(() => _isSending = false);
      }

      // Reconciliación de respuesta por si el WS tarda
      _replyReconciler.start(
        onPoll: () async {
          final newMsgs = await ApiService.fetchChatMessages('0');
          if (mounted) {
            setState(() {
              _messages = newMsgs;
              _isAuraThinking = false;
            });
            _scrollToBottom();
          }
        },
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSending = false;
          _isAuraThinking = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('⚠️ No se pudo enviar el mensaje: ${e.toString()}'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  String _cleanDsmlText(String input) {
    if (input.isEmpty) return input;
    var clean = input.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*calls\s*>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*calls\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*invoke[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*parameter[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*parameter\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<[^>]*DSML[^>]*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\|im_start\|>[\s\S]*?<\|im_end\|>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
    return clean;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: const Color(0xFFFAF8F5),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF1F1A15), size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFC5A052), width: 1.5),
                image: const DecorationImage(
                  image: AssetImage('images/avatar_aura.webp'),
                  fit: BoxFit.cover,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'GlowPro Co-Pilot',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                      color: Color(0xFF1F1A15),
                    ),
                  ),
                  Row(
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: const BoxDecoration(
                          color: Color(0xFF2E7D32),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 5),
                      const Text(
                        'Conectado a AURA Engine SaaS',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 11,
                          color: Color(0xFF8C7E74),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Banner superior de contexto SaaS
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: const LinearGradient(
                  colors: [Color(0xFF1F1A15), Color(0xFF322820)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x1A000000),
                    blurRadius: 10,
                    offset: Offset(0, 4),
                  )
                ],
              ),
              child: const Row(
                children: [
                  Icon(Icons.auto_awesome_rounded, color: Color(0xFFC5A052), size: 24),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Tu asistente ejecutivo de IA para métricas, agenda, promociones y fórmulas técnicas de belleza.',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        color: Color(0xFFF7F3ED),
                        fontSize: 12.5,
                        height: 1.3,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Accesos Rápidos (Prompts de 1-Tap)
            SizedBox(
              height: 48,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: _quickPrompts.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final promptItem = _quickPrompts[index];
                  return ActionChip(
                    avatar: Icon(promptItem['icon'] as IconData, size: 16, color: const Color(0xFFC5A052)),
                    label: Text(
                      promptItem['label'] as String,
                      style: const TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1F1A15),
                      ),
                    ),
                    backgroundColor: Colors.white,
                    side: BorderSide(color: Color(0xFFC5A052).withValues(alpha: 0.3)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                    onPressed: () => _sendMessage(promptItem['prompt'] as String),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),

            // Hilo de Mensajes
            Expanded(
              child: _isLoading
                  ? Center(child: CircularProgressIndicator(color: AppTheme.primary))
                  : _error != null
                      ? Center(child: Text(_error!))
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: _messages.length + (_isAuraThinking ? 1 : 0),
                          itemBuilder: (context, index) {
                            if (index == _messages.length && _isAuraThinking) {
                              return _buildThinkingBubble();
                            }
                            final msg = _messages[index];
                            final isUser = msg['sender_id'] != '0' &&
                                msg['sender_id'] != '00000000-0000-0000-0000-000000000000';
                            final cleanText = _cleanDsmlText(msg['message'] ?? '');
                            if (cleanText.isEmpty && !isUser) {
                              return const SizedBox.shrink();
                            }
                            return _buildMessageBubble(cleanText, isUser, msg['created_at']);
                          },
                        ),
            ),

            // Barra de entrada de texto
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x0A000000),
                    blurRadius: 10,
                    offset: Offset(0, -2),
                  )
                ],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'Consulta a AURA Co-Pilot...',
                        hintStyle: const TextStyle(
                          fontFamily: 'Inter',
                          color: Color(0xFF8C7E74),
                          fontSize: 14,
                        ),
                        filled: true,
                        fillColor: const Color(0xFFFAF8F5),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                      ),
                      onSubmitted: _sendMessage,
                    ),
                  ),
                  const SizedBox(width: 6),
                  VoiceInput(
                    onTranscript: (text) {
                      if (text.trim().isNotEmpty) {
                        _controller.text = text;
                        _sendMessage(text);
                      }
                    },
                  ),
                  const SizedBox(width: 6),
                  Container(
                    decoration: const BoxDecoration(
                      color: Color(0xFF1F1A15),
                      shape: BoxShape.circle,
                    ),
                    child: IconButton(
                      icon: _isSending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(color: Color(0xFFC5A052), strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded, color: Color(0xFFC5A052), size: 20),
                      onPressed: () => _sendMessage(_controller.text),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildThinkingBubble() {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(20),
            topRight: Radius.circular(20),
            bottomRight: Radius.circular(20),
          ),
          border: Border.all(color: const Color(0xFFE5CECA)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(color: AppTheme.primary, strokeWidth: 2),
            ),
            SizedBox(width: 10),
            Text(
              'AURA Co-Pilot está analizando tu consulta...',
              style: TextStyle(
                fontFamily: 'Inter',
                fontSize: 13,
                color: Color(0xFF8C7E74),
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMessageBubble(String text, bool isUser, String? timestamp) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFF1F1A15) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(isUser ? 20 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 20),
          ),
          border: isUser ? null : Border.all(color: const Color(0xFFE8E2D9)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x08000000),
              blurRadius: 6,
              offset: Offset(0, 2),
            )
          ],
        ),
        child: Column(
          crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(
              text,
              style: TextStyle(
                fontFamily: 'Inter',
                fontSize: 14,
                height: 1.45,
                color: isUser ? const Color(0xFFF7F3ED) : const Color(0xFF1F1A15),
              ),
            ),
            if (!isUser && (text.toLowerCase().contains('oferta') || text.toLowerCase().contains('promoción') || text.toLowerCase().contains('descuento') || text.toLowerCase().contains('horas libres'))) ...[
              const SizedBox(height: 12),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  foregroundColor: const Color(0xFF1F1A15),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  elevation: 0,
                ),
                icon: const Icon(Icons.flash_on_rounded, size: 16),
                label: const Text(
                  '🚀 Publicar Oferta Relámpago (1-Tap)',
                  style: TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.bold),
                ),
                onPressed: () => _publishFlashDealModal(context),
              ),
            ],
            if (!isUser && (text.toLowerCase().contains('foto') || text.toLowerCase().contains('portafolio') || text.toLowerCase().contains('corte') || text.toLowerCase().contains('look'))) ...[
              const SizedBox(height: 12),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF1F1A15),
                  foregroundColor: const Color(0xFFC5A052),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  elevation: 0,
                ),
                icon: const Icon(Icons.photo_library_rounded, size: 16),
                label: const Text(
                  '📸 Publicar en Mi Portafolio (1-Tap)',
                  style: TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.bold),
                ),
                onPressed: () => _publishPortfolioModal(context),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _publishFlashDealModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.flash_on_rounded, color: Color(0xFFC5A052), size: 24),
                  SizedBox(width: 10),
                  Text(
                    'Confirmar Oferta Relámpago',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 20,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'Se publicará un descuento especial del 20% en tu perfil para las horas de baja demanda de mañana (2:00 PM - 5:00 PM).',
                style: TextStyle(fontFamily: 'Inter', fontSize: 13, color: Color(0xFF8C7E74)),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1F1A15),
                    foregroundColor: const Color(0xFFC5A052),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: const Text('⚡ Oferta Relámpago publicada con éxito en tu perfil.'),
                          backgroundColor: const Color(0xFF2E7D32),
                          behavior: SnackBarBehavior.floating,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                      );
                    }
                  },
                  child: const Text('Publicar Oferta Ahora', style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _publishPortfolioModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.photo_library_rounded, color: Color(0xFFC5A052), size: 24),
                  SizedBox(width: 10),
                  Text(
                    'Publicar en Portafolio',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 20,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'La foto procesada por AURA se agregará a tu perfil con la descripción optimizada y sello de calidad profesional.',
                style: TextStyle(fontFamily: 'Inter', fontSize: 13, color: Color(0xFF8C7E74)),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1F1A15),
                    foregroundColor: const Color(0xFFC5A052),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: const Text('📸 Trabajo publicado en tu Portafolio Profesional.'),
                          backgroundColor: const Color(0xFF2E7D32),
                          behavior: SnackBarBehavior.floating,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                      );
                    }
                  },
                  child: const Text('Publicar en Portafolio', style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
