// frontend/lib/screens/chat_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
class ChatScreen extends StatefulWidget {
  final String partnerId;
  final String partnerName;
  final String partnerRole;
  final String? partnerAvatar;
  final String? initialMessage;
  final String? initialImagePath;

  const ChatScreen({
    super.key,
    required this.partnerId,
    required this.partnerName,
    required this.partnerRole,
    this.partnerAvatar,
    this.initialMessage,
    this.initialImagePath,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Map<String, dynamic>> _messages = [];

  String _cleanDsmlText(String input) {
    if (input.isEmpty) return input;
    var clean = input.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*calls\s*>[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*calls\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*invoke[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*invoke\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\s*\|\s*DSML\s*\|\s*\|\s*parameter[\s\S]*?<\/\s*\|\s*DSML\s*\|\s*\|\s*parameter\s*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<[^>]*DSML[^>]*>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\|im_start\|>[\s\S]*?<\|im_end\|>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'<\|im_start\|>|<\|im_end\|>', caseSensitive: false), '');
    clean = clean.replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
    if (clean.length < 5 && (clean.contains('queryText') || clean.contains('invoke') || clean.contains('parameter') || clean.contains('calls'))) {
      return '';
    }
    return clean;
  }

  Map<String, String> _parseAiRecommendation(String text) {
    final Map<String, String> meta = {};
    final lines = text.split('\n');
    for (var line in lines) {
      final lower = line.toLowerCase();
      if (lower.contains('id prestador:') || lower.contains('id_prestador:')) {
        meta['providerId'] =
            line.split(':').last.trim().replaceAll(RegExp(r'[^\w\-]'), '');
      }
      if (lower.contains('profesional/establecimiento:') ||
          lower.contains('profesional:')) {
        meta['providerName'] =
            line.split(':').last.trim().replaceAll(RegExp(r'[\"*]'), '');
      }
      if (lower.contains('servicio id:') || lower.contains('servicio_id:')) {
        meta['serviceId'] = line
            .split(':')
            .skip(1)
            .join(':')
            .trim()
            .replaceAll(RegExp(r'[\"*]'), '');
      }
      if (lower.contains('tratamiento sugerido:') ||
          lower.contains('servicio:')) {
        meta['serviceName'] =
            line.split(':').last.trim().replaceAll(RegExp(r'[\"*]'), '');
      }
      if (lower.contains('precio de referencia:') ||
          lower.contains('precio:')) {
        meta['price'] =
            line.split(':').last.trim().replaceAll(RegExp(r'[^\d]'), '');
      }
    }
    // Heuristic fallbacks if not structured
    if (meta['serviceName'] == null || meta['serviceName']!.isEmpty) {
      final lowerText = text.toLowerCase();
      if (lowerText.contains('uñas') || lowerText.contains('manicura') || lowerText.contains('pedicura') || lowerText.contains('nails')) {
        meta['serviceName'] = 'Uñas';
      } else if (lowerText.contains('cabello') || lowerText.contains('pelo') || lowerText.contains('capilar') || lowerText.contains('corte') || lowerText.contains('keratina')) {
        meta['serviceName'] = 'Cabello';
      } else if (lowerText.contains('maquillaje') || lowerText.contains('cejas') || lowerText.contains('piel') || lowerText.contains('facial') || lowerText.contains('poros') || lowerText.contains('colorimetría')) {
        meta['serviceName'] = 'Maquillaje';
      }
    }
    return meta;
  }

  bool _isLoading = true;
  String? _error;
  String? _currentUserId;
  Timer? _pollingTimer;
  bool _isSending = false;
  bool _isAuraThinking = false;
  Timer? _auraThinkingTimeout;

  WebSocketChannel? _webSocketChannel;
  bool _isWebSocketConnected = false;
  bool _wsRegistered = false;
  Timer? _reconnectTimer;

  // La entrega de la respuesta de AURA no puede depender de un único push WS:
  // si la conexión queda abierta pero el registro es rechazado (o el token falta),
  // el servidor nunca empuja y la respuesta sólo aparecía al enviar el mensaje
  // siguiente. Estos dos timers garantizan la entrega.
  Timer? _wsAckWatchdog; // vigila el acuse {status:'registered'} del servidor
  final ReplyReconciler _replyReconciler = ReplyReconciler();

  bool get _isAiPartner =>
      widget.partnerId == '0' ||
      widget.partnerId == '00000000-0000-0000-0000-000000000000';

  @override
  void initState() {
    super.initState();
    _loadCurrentUserId();
    _loadMessages(showLoading: true);
    _markAsRead();

    // Connect to WebSocket with reconnect/fallback
    _connectWebSocket();

    if (widget.initialMessage != null || widget.initialImagePath != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _sendInitialMessage();
      });
    }
  }

  void _connectWebSocket() {
    _webSocketChannel?.sink.close();
    _reconnectTimer?.cancel();
    _wsAckWatchdog?.cancel();
    _wsRegistered = false;

    try {
      final wsBase = ApiService.baseUrl.replaceFirst('http', 'ws');
      final wsUrl = '$wsBase/chat';

      _webSocketChannel = WebSocketChannel.connect(Uri.parse(wsUrl));

      _webSocketChannel!.stream.listen(
        (message) {
          if (mounted) {
            setState(() {
              _isWebSocketConnected = true;
            });
            // Parse message and trigger reload
            try {
              final data = jsonDecode(message.toString());
              if (data is Map && data['type'] == 'aura_status') {
                // El servidor envía {type:'aura_status', data:{state:...}}: el estado
                // está anidado. Antes se leía data['state'] (siempre null), así que el
                // indicador de "AURA está pensando" se apagaba al instante.
                final payload = data['data'];
                final state = payload is Map ? payload['state'] : null;
                setState(() {
                  _isAuraThinking = (state == 'thinking');
                });
                if (_isAuraThinking) {
                  _scrollToBottom();
                }
              } else if (data is Map &&
                  (data['status'] == 'registered' || data['type'] == 'registered')) {
                // Acuse del servidor: esta conexión ya está registrada y puede recibir push.
                _wsRegistered = true;
                _wsAckWatchdog?.cancel();
                debugPrint('WS chat: conexión registrada como ${data['userId']}');
              } else if (data is Map && data['type'] == 'chat_message') {
                // Push real: el canal funciona, se puede dejar de reconciliar.
                _wsRegistered = true;
                _wsAckWatchdog?.cancel();
                _stopReconcilePolling();
                if (_pollingTimer != null) {
                  _pollingTimer!.cancel();
                  _pollingTimer = null;
                }
                _loadMessages(showLoading: false);
                _markAsRead();
              } else if (data is Map && data['error'] != null) {
                // El servidor rechazó el registro (token ausente/expirado): sin registro
                // no habrá push, así que la reconciliación por polling queda activa.
                debugPrint('WS chat: el servidor rechazó el registro: ${data['error']}');
                if (_isAuraThinking) _startReconcilePolling();
              } else {
                _loadMessages(showLoading: false);
                _markAsRead();
              }
            } catch (_) {
              _loadMessages(showLoading: false);
              _markAsRead();
            }
          }
        },
        onError: (error) {
          _handleWebSocketFailure();
        },
        onDone: () {
          _handleWebSocketFailure();
        },
      );

      _registerWebSocket();
    } catch (e) {
      _handleWebSocketFailure();
    }
  }

  void _registerWebSocket() async {
    if (_webSocketChannel == null) return;
    // A360-2026-09-22/C-04: el servidor exige un token JWT para registrar la
    // conexión. Sin registro el servidor nunca empuja, así que un fallo aquí se
    // compensa con reconciliación por polling (no basta con no registrarse).
    String? token;
    try {
      token = await AuthService.getToken();
    } catch (e) {
      debugPrint('WS chat: error leyendo el token: $e');
      token = null;
    }
    if (token == null || token.isEmpty) {
      debugPrint('WS chat: sin token, no se registra la conexión');
      if (_isAuraThinking) _startReconcilePolling();
      return;
    }
    _webSocketChannel!.sink.add(jsonEncode({
      'type': 'register',
      'token': token,
    }));

    // Sin acuse no podemos asumir que habrá push: si en 6 s no llegó
    // {status:'registered'}, se activa la reconciliación por polling.
    _wsAckWatchdog?.cancel();
    _wsAckWatchdog = Timer(const Duration(seconds: 6), () {
      if (mounted && !_wsRegistered) {
        debugPrint('WS chat: sin acuse de registro del servidor; reconciliando por polling');
        if (_isAuraThinking) _startReconcilePolling();
      }
    });
  }

  // ── Entrega garantizada de la respuesta de AURA ────────────────────────────
  // Se sondea sólo durante la ventana en que se espera una respuesta (tope 90 s)
  // para no agotar el rate limit por usuario de los endpoints de chat.
  void _startReconcilePolling() {
    _replyReconciler.start(onPoll: () async {
      if (mounted) {
        await _loadMessages(showLoading: false);
      }
    });
  }

  void _stopReconcilePolling() {
    _replyReconciler.stop();
  }

  void _handleWebSocketFailure() {
    if (!mounted) return;
    setState(() {
      _isWebSocketConnected = false;
    });

    // Fallback: sondeo de reconciliación mientras el push WS no esté disponible.
    // 10 s (antes 3 s): el rate limit de chat es de 100 req/15 min por usuario y a
    // 3 s el propio fallback se quedaba sin cuota en pocos minutos.
    _pollingTimer ??= Timer.periodic(const Duration(seconds: 10), (_) {
        _loadMessages(showLoading: false);
      });

    // Schedule reconnect attempt in 5 seconds
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (mounted && !_isWebSocketConnected) {
        _connectWebSocket();
      }
    });
  }

  Future<void> _sendInitialMessage() async {
    final text = widget.initialMessage ?? 'Hola, analicemos esta foto';
    setState(() {
      _isSending = true;
      if (_isAiPartner) _isAuraThinking = true;
    });
    try {
      await ApiService.sendChatMessage(
        widget.partnerId,
        text,
        imagePath: widget.initialImagePath,
      );
      // La respuesta de AURA se entrega por push WS; si el canal no está
      // registrado hay que reconciliar, o el saludo inicial se queda sin respuesta.
      if (_isAiPartner) _startReconcilePolling();
      await _loadMessages(showLoading: false);
      _scrollToBottom();
    } catch (_) {
      // Manejo silencioso en carga inicial para no interrumpir la experiencia
      _stopReconcilePolling();
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    _reconnectTimer?.cancel();
    _auraThinkingTimeout?.cancel();
    _wsAckWatchdog?.cancel();
    _stopReconcilePolling();
    _webSocketChannel?.sink.close();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadCurrentUserId() async {
    final token = await AuthService.getToken();
    if (token != null) {
      try {
        final parts = token.split('.');
        if (parts.length >= 2) {
          final String payload =
              parts[1].replaceAll('-', '+').replaceAll('_', '/');
          final String decoded = String.fromCharCodes(base64Decode(
            payload.length % 4 == 0
                ? payload
                : payload.padRight(
                    payload.length + (4 - payload.length % 4), '='),
          ));
          final data = jsonDecode(decoded);
          if (mounted) {
            setState(() {
              _currentUserId = data['id']?.toString();
            });
            _registerWebSocket();
          }
        }
      } catch (_) {}
    }
  }

  List<int> base64Decode(String source) {
    const base64Chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    final output = <int>[];
    var buffer = 0;
    var bits = 0;
    final cleanSource = source.replaceAll(RegExp(r'\s+|=+$'), '');
    for (var i = 0; i < cleanSource.length; i++) {
      final char = cleanSource[i];
      final val = base64Chars.indexOf(char);
      if (val == -1) continue;
      buffer = (buffer << 6) | val;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output.add((buffer >> bits) & 0xFF);
      }
    }
    return output;
  }

  Future<void> _loadMessages({required bool showLoading}) async {
    if (showLoading && mounted) {
      setState(() {
        _isLoading = true;
        _error = null;
      });
    }
    try {
      final messages = await ApiService.fetchChatMessages(widget.partnerId);
      final wasEmpty = _messages.isEmpty;
      final oldLength = _messages.length;

      if (mounted) {
        // Si el último mensaje es de la IA, apagar el thinking indicator
        bool stillThinking = _isAuraThinking;
        if (messages.isNotEmpty) {
          final lastMsg = messages.last;
          final isLastMsgAi = lastMsg['sender_id'] == '0' ||
              lastMsg['sender_id'] == '00000000-0000-0000-0000-000000000000';
          if (isLastMsgAi) {
            stillThinking = false;
            _auraThinkingTimeout?.cancel();
            // La respuesta ya aterrizó (por push o por este sondeo): se deja de reconciliar.
            _stopReconcilePolling();
          }
        }

        setState(() {
          _messages = messages;
          _isLoading = false;
          _error = null;
          _isAuraThinking = stillThinking;
        });

        // Scroll to bottom if new messages were added
        if (wasEmpty || messages.length > oldLength) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _scrollToBottom();
          });
          // Marcar como leído sólo cuando llegó algo nuevo (no en cada sondeo, para
          // no gastar la cuota del rate limit de chat por usuario).
          if (messages.length > oldLength) _markAsRead();
        }
      }
    } catch (e) {
      if (showLoading && mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _markAsRead() async {
    try {
      await ApiService.markMessagesAsRead(widget.partnerId);
    } catch (_) {}
  }

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  bool _containsContactLeakage(String text) {
    final lower = text.toLowerCase();
    // Excluir etiquetas del sistema
    if (lower.startsWith('[consulta pre-reserva]')) return false;

    final phoneRegex = RegExp(
        r'(?:\+?57\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|\b3\d{9}\b|\b[0-9]{7,10}\b)');
    if (phoneRegex.hasMatch(text)) return true;
    final keywords = [
      'whatsapp',
      'wasap',
      'wpp',
      'whap',
      'wha',
      'celular',
      'mi cel',
      'mi numero',
      'mi número',
      'instagram',
      'ig:',
      'llamame',
      'llámame',
      'por fuera',
      'en efectivo',
      'pago directo',
      'transferencia directa'
    ];
    for (final kw in keywords) {
      if (lower.contains(kw)) return true;
    }
    return false;
  }

  Future<void> _sendMessage([String? customText]) async {
    final text = (customText ?? _messageController.text).trim();
    if (text.isEmpty || _isSending) return;

    if (_containsContactLeakage(text)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                '⚠️ Por seguridad y cobertura de garantía Wompi, no se permite compartir números ni acordar pagos externos.'),
            backgroundColor: Colors.deepOrange,
            duration: Duration(seconds: 4),
          ),
        );
      }
      return;
    }

    setState(() {
      _isSending = true;
      if (_isAiPartner) {
        _isAuraThinking = true;
        _auraThinkingTimeout?.cancel();
        _auraThinkingTimeout = Timer(const Duration(seconds: 18), () {
          if (mounted) setState(() => _isAuraThinking = false);
        });
      }
    });
    _messageController.clear();

    try {
      await ApiService.sendChatMessage(widget.partnerId, text);
      // Garantiza que la respuesta de AURA se vea aunque el push WS no llegue
      // (conexión abierta pero sin registro, p. ej. tras caducar el token).
      if (_isAiPartner) _startReconcilePolling();
      await _loadMessages(showLoading: false);
      _scrollToBottom();
    } catch (e) {
      if (mounted) {
        setState(() => _isAuraThinking = false);
        _stopReconcilePolling();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ No se pudo enviar el mensaje: $e'),
            backgroundColor: Colors.deepOrange,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSending = false);
      }
    }
  }

  String _formatTime(String? dateStr) {
    if (dateStr == null) return '';
    try {
      final dateTime = DateTime.parse(dateStr).toLocal();
      final hour = dateTime.hour.toString().padLeft(2, '0');
      final minute = dateTime.minute.toString().padLeft(2, '0');
      return '$hour:$minute';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isProvider = widget.partnerRole == 'provider';

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0.5,
        titleSpacing: 0,
        title: Row(
          children: [
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: widget.partnerAvatar != null && widget.partnerAvatar!.contains('avatar_aura')
                    ? Border.all(color: const Color(0xFFD4AF37), width: 2.0)
                    : null,
              ),
              child: CircleAvatar(
                radius: widget.partnerAvatar != null && widget.partnerAvatar!.contains('avatar_aura') ? 21 : 18,
                backgroundColor: isProvider ? const Color(0xFFF3D59B) : const Color(0xFFF5EBE6),
                backgroundImage: widget.partnerAvatar != null &&
                        widget.partnerAvatar!.isNotEmpty
                    ? (widget.partnerAvatar!.startsWith('images/')
                        ? AssetImage(widget.partnerAvatar!) as ImageProvider
                        : NetworkImage(widget.partnerAvatar!) as ImageProvider)
                    : null,
                child: widget.partnerAvatar == null ||
                        widget.partnerAvatar!.isEmpty
                    ? Text(
                        widget.partnerName.isNotEmpty
                            ? widget.partnerName[0].toUpperCase()
                            : 'U',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color:
                              isProvider ? const Color(0xFFC5A052) : const Color(0xFF1F1A15),
                          fontSize: 14,
                        ),
                      )
                    : null,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.partnerName,
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                    ),
                  ),
                  Text(
                    isProvider ? 'PRESTADOR DE SERVICIOS' : 'CLIENTE',
                    style: const TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 10,
                      color: Color(0xFFC5A052),
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
        children: [
          // Banner de Garantía y Seguridad Wompi
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: const BoxDecoration(
              color: Color(0xFFFBF5EE),
              border: Border(
                bottom: BorderSide(color: Color(0xFFEADBCE), width: 1),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.shield_outlined,
                    size: 14, color: Color(0xFFC5A052)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Protección GlowApp: Pago seguro con garantía Wompi. Prohibido compartir teléfonos o pagos externos.',
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.brown[900],
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // ─── Innovación 2: Ficha Ejecutiva Pre-Cita (Client Insight Brief) ─────
          if (!_isAiPartner)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFC5A052).withOpacity(0.4)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x08000000),
                    blurRadius: 8,
                    offset: Offset(0, 2),
                  )
                ],
              ),
              child: Row(
                children: [
                  const Icon(Icons.stars_rounded, color: Color(0xFFC5A052), size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Ficha Ejecutiva: ${widget.partnerName}',
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isProvider 
                              ? 'Profesional calificado • Garantía de bioseguridad • Atención puntual'
                              : 'Cliente Verificado • 4 citas agendadas • Preferencia: Tonos fríos & Cuero cabelludo sensible',
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 11,
                            color: Color(0xFF8C7E74),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _isLoading
                ? const Center(
                    child: CircularProgressIndicator(color: Colors.pink))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error_outline,
                                color: Colors.red, size: 48),
                            const SizedBox(height: 16),
                            Text('Error: $_error', textAlign: TextAlign.center),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: () => _loadMessages(showLoading: true),
                              style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.pink),
                              child: const Text('Reintentar'),
                            ),
                          ],
                        ),
                      )
                    : _messages.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.chat_bubble_outline,
                                    size: 64, color: Colors.pink[200]),
                                const SizedBox(height: 16),
                                Text(
                                  '¡Envía un mensaje a ${widget.partnerName}!',
                                  style: const TextStyle(
                                      color: Colors.grey, fontSize: 16),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 20),
                            itemCount: _messages.length + (_isAuraThinking ? 1 : 0),
                            itemBuilder: (context, index) {
                              if (index == _messages.length) {
                                return _buildAuraThinkingIndicator();
                              }
                              final msg = _messages[index];
                              final isMe = msg['sender_id'] == _currentUserId;
                              final isAi = msg['sender_id'] == '0' ||
                                  msg['sender_id'] ==
                                      '00000000-0000-0000-0000-000000000000';
                              final time = _formatTime(msg['created_at']);

                              if (isAi) {
                                final text = _cleanDsmlText(msg['message'] ?? '');
                                final isRec =
                                    text.contains('Estilo Recomendado:') ||
                                        text.contains('[SIMULACIÓN IA]');
                                
                                String cleanText = text;
                                String? redirectToolId;
                                
                                // Case-insensitive regex supporting typos (e.g., 'rediceccioin'), spaces, dots/colons
                                final redirectReg = RegExp(
                                  r'(?:redirecci[oó]n|redicecci[oó]n|rediceccioin)\s+m[oó]dulo\s+ideas[:.\s\-]+([a-zA-Z0-9\-\s]+)',
                                  caseSensitive: false,
                                );
                                final redirectMatch = redirectReg.firstMatch(text);
                                if (redirectMatch != null) {
                                  final extracted = redirectMatch.group(1)?.toLowerCase().trim() ?? '';
                                  
                                  // Normalize tool ID mapping
                                  if (extracted.contains('nails') && (extracted.contains('clas') || extracted.contains('clás'))) {
                                    redirectToolId = 'nails-classic';
                                  } else if (extracted.contains('skin') && extracted.contains('tone')) {
                                    redirectToolId = 'skin-tone';
                                  } else if (extracted.contains('hair') || extracted.contains('capilar')) {
                                    redirectToolId = 'hair-diagnostic';
                                  } else if (extracted.contains('poros') || extracted.contains('texture') || extracted.contains('textura')) {
                                    redirectToolId = 'skin-texture';
                                  } else if (extracted.contains('cejas') || extracted.contains('eyebrow') || extracted.contains('visagism')) {
                                    redirectToolId = 'eyebrow-visagism';
                                  } else if (extracted.contains('nails') && extracted.contains('style')) {
                                    redirectToolId = 'nails-style';
                                  } else {
                                    redirectToolId = extracted.replaceAll(' ', '-');
                                  }
                                  
                                  // Hide the metadata string from the visible message
                                  cleanText = text.replaceRange(redirectMatch.start, redirectMatch.end, '').trim();
                                }

                                return Container(
                                  margin: const EdgeInsets.only(bottom: 16),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        margin: const EdgeInsets.only(
                                            right: 8, top: 4),
                                        width: 36,
                                        height: 36,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          border: Border.all(color: const Color(0xFFD4AF37), width: 1.5),
                                          image: const DecorationImage(
                                            image: AssetImage('images/avatar_aura.webp'),
                                            fit: BoxFit.cover,
                                          ),
                                        ),
                                      ),
                                      Expanded(
                                        child: Align(
                                          alignment: Alignment.centerLeft,
                                          child: Container(
                                            constraints: BoxConstraints(
                                              maxWidth: MediaQuery.of(context)
                                                      .size
                                                      .width *
                                                  0.7,
                                            ),
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 16, vertical: 12),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFFF3ECE6),
                                              borderRadius: const BorderRadius.only(
                                                topLeft: Radius.circular(18),
                                                topRight: Radius.circular(18),
                                                bottomLeft: Radius.circular(4),
                                                bottomRight: Radius.circular(18),
                                              ),
                                              border: Border.all(color: const Color(0xFFE5DDD5)),
                                            ),
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                if (isRec) ...[
                                                  ClipRRect(
                                                    borderRadius:
                                                        BorderRadius.circular(12),
                                                    child: Image.network(
                                                      'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=500',
                                                      height: 110,
                                                      width: double.infinity,
                                                      fit: BoxFit.cover,
                                                      errorBuilder: (context, error, stackTrace) => Container(
                                                        height: 110,
                                                        color: const Color(0xFFF5EBE6),
                                                        child: const Center(
                                                          child: Icon(Icons.spa_outlined, color: Color(0xFFE91E63), size: 36),
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                                                                    const SizedBox(height: 8),
                                                                                                    Text(
                                                                                                      'Asesoría de Belleza IA',
                                                                                                      style: TextStyle(
                                                                                                          fontWeight:
                                                                                                              FontWeight.bold,
                                                                                                          fontSize: 14,
                                                                                                          color:
                                                                                                              AppTheme.primary),
                                                                                                    ),
                                                                                                    const SizedBox(height: 4),
                                                                                                  ],
                                                                                                  Text(
                                                                                                    cleanText,
                                                                                                    style: const TextStyle(
                                                                                                      color: Colors.black87,
                                                                                                      fontSize: 14.5,
                                                                                                      height: 1.35,
                                                                                                    ),
                                                                                                  ),
                                                                                                  if (redirectToolId != null) ...[
                                                                                                                                                    const SizedBox(height: 10),
                                                                                                                                                    SizedBox(
                                                                                                                                                      width: double.infinity,
                                                                                                                                                      child: OutlinedButton.icon(
                                                                                                                                                        style: OutlinedButton.styleFrom(
                                                                                                                                                          side: BorderSide(color: AppTheme.primary, width: 1.5),
                                                                                                                                                          foregroundColor: AppTheme.primary,
                                                                                                                                                          shape: RoundedRectangleBorder(
                                                                                                          borderRadius: BorderRadius.circular(20),
                                                                                                        ),
                                                                                                        padding: const EdgeInsets.symmetric(vertical: 8),
                                                                                                      ),
                                                                                                      icon: const Icon(Icons.auto_awesome, size: 14),
                                                                                                      label: const Text(
                                                                                                        'Abrir herramienta en Ideas IA',
                                                                                                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                                                                                                      ),
                                                                                                      onPressed: () {
                                                        // Navigate to /ideas using arguments to pre-load a tool
                                                        Navigator.pushNamed(
                                                          context,
                                                          '/ideas',
                                                          arguments: {'toolId': redirectToolId},
                                                        );
                                                      },
                                                    ),
                                                  ),
                                                ],
                                                if (isRec) ...[
                                                  const SizedBox(height: 12),
                                                  SizedBox(
                                                    width: double.infinity,
                                                    child: ElevatedButton.icon(
                                                      style: ElevatedButton
                                                          .styleFrom(
                                                        backgroundColor:
                                                            const Color(
                                                                0xFFC89D93),
                                                        foregroundColor:
                                                            Colors.white,
                                                        elevation: 0,
                                                        shape: RoundedRectangleBorder(
                                                            borderRadius:
                                                                BorderRadius
                                                                    .circular(
                                                                        20)),
                                                        padding:
                                                            const EdgeInsets
                                                                .symmetric(
                                                                vertical: 8),
                                                      ),
                                                      onPressed: () {
                                                        final meta =
                                                            _parseAiRecommendation(
                                                                text);
                                                        final providerId =
                                                            meta['providerId'];
                                                        final serviceId =
                                                            meta['serviceId'];

                                                        if (providerId !=
                                                                null &&
                                                            providerId
                                                                .isNotEmpty) {
                                                          if (serviceId !=
                                                                  null &&
                                                              serviceId
                                                                  .isNotEmpty) {
                                                            final serviceItem =
                                                                {
                                                              'id': serviceId,
                                                              'name': meta[
                                                                      'serviceName'] ??
                                                                  'Tratamiento Recomendado',
                                                              'price': double.tryParse(
                                                                      meta['price'] ??
                                                                          '') ??
                                                                  0.0,
                                                              'duration_minutes':
                                                                  60,
                                                            };
                                                                                                                        Navigator.pushNamed(
                                                                                                                          context,
                                                                                                                          '/booking',
                                                                                                                          arguments: {
                                                                                                                            'providerId': providerId,
                                                                                                                            'providerName': meta['providerName'] ?? 'Prestador',
                                                                                                                            'services': [serviceItem],
                                                                                                                            'initialNotes': 'Recomendado por el Asesor de Belleza IA.',
                                                                                                                          },
                                                                                                                        );
                                                                                                                      } else {
                                                                                                                        Navigator.pushNamed(
                                                                                                                          context,
                                                                                                                          '/provider-detail',
                                                                                                                          arguments: {'providerId': providerId},
                                                                                                                        );
                                                                                                                      }
                                                                                                                    } else {
                                                          showDialog(
                                                            context: context,
                                                            builder:
                                                                (context) =>
                                                                    AlertDialog(
                                                              shape: RoundedRectangleBorder(
                                                                  borderRadius:
                                                                      BorderRadius
                                                                          .circular(
                                                                              24)),
                                                              title: const Text(
                                                                  '¡De una parce!',
                                                                  style: TextStyle(
                                                                      fontWeight:
                                                                          FontWeight
                                                                              .bold)),
                                                              content: const Text(
                                                                  'Te redirigiremos con los prestadores de Fontibón para agendar este estilo de inmediato, vecino.'),
                                                              actions: [
                                                                TextButton(
                                                                  onPressed: () {
                                                                    Navigator.pop(
                                                                        context);
                                                                    Navigator.pop(
                                                                        context, {
                                                                      'category': meta['serviceName'] ?? 'all',
                                                                      'serviceName': meta['serviceName'] ?? 'Servicio'
                                                                    });
                                                                  },
                                                                  child: const Text(
                                                                      'Listo',
                                                                      style: TextStyle(
                                                                          color: Color(
                                                                              0xFFC89D93),
                                                                          fontWeight:
                                                                              FontWeight.bold)),
                                                                )
                                                              ],
                                                            ),
                                                          );
                                                        }
                                                      },
                                                      icon: const Icon(
                                                          Icons.calendar_month,
                                                          size: 14),
                                                      label: const Text(
                                                          'Agendar este estilo',
                                                          style: TextStyle(
                                                              fontSize: 11.5,
                                                              fontWeight:
                                                                  FontWeight
                                                                      .bold)),
                                                    ),
                                                  ),
                                                ],
                                                const SizedBox(height: 4),
                                                Align(
                                                  alignment:
                                                      Alignment.bottomRight,
                                                  child: Text(
                                                    time,
                                                    style: TextStyle(
                                                      color: Colors.grey[500],
                                                      fontSize: 10,
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }

                              return Align(
                                alignment: isMe
                                    ? Alignment.centerRight
                                    : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.only(bottom: 12),
                                  constraints: BoxConstraints(
                                    maxWidth:
                                        MediaQuery.of(context).size.width *
                                            0.75,
                                  ),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 16, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: isMe
                                        ? AppTheme.primary
                                        : const Color(0xFFF3ECE6),
                                    borderRadius: BorderRadius.only(
                                      topLeft: const Radius.circular(18),
                                      topRight: const Radius.circular(18),
                                      bottomLeft: isMe
                                          ? const Radius.circular(18)
                                          : const Radius.circular(4),
                                      bottomRight: isMe
                                          ? const Radius.circular(4)
                                          : const Radius.circular(18),
                                    ),
                                    border: isMe
                                        ? null
                                        : Border.all(color: const Color(0xFFE5DDD5)),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        msg['message'] ?? '',
                                        style: TextStyle(
                                          color: isMe
                                              ? Colors.white
                                              : Colors.black87,
                                          fontSize: 15,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        time,
                                        style: TextStyle(
                                          color: isMe
                                              ? Colors.white70
                                              : Colors.grey[500],
                                          fontSize: 10,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          if (_isAiPartner && !_isLoading && _error == null)
            _buildQuickReplyChips(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(
                top: BorderSide(color: Colors.black12, width: 0.5),
              ),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'Escribe un mensaje...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        fillColor: Colors.grey[100],
                        filled: true,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 10),
                      ),
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: _sendMessage,
                    child: CircleAvatar(
                      radius: 22,
                      backgroundColor: AppTheme.primary,
                      child: _isSending
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(
                              Icons.send,
                              color: Colors.white,
                              size: 20,
                            ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  VoiceInput(
                    onTranscript: (transcript) {
                      _messageController.text = transcript;
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  ),
);
  }

  Widget _buildAuraThinkingIndicator() {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(right: 8, top: 4),
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFD4AF37), width: 1.5),
              image: const DecorationImage(
                image: AssetImage('images/avatar_aura.webp'),
                fit: BoxFit.cover,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFFF3ECE6),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(18),
                topRight: Radius.circular(18),
                bottomLeft: Radius.circular(4),
                bottomRight: Radius.circular(18),
              ),
              border: Border.fromBorderSide(BorderSide(color: Color(0xFFE5DDD5))),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Aura está redactando su consejo',
                                style: TextStyle(
                                  color: Color(0xFF6E5D53),
                                  fontSize: 13.5,
                                  fontStyle: FontStyle.italic,
                                ),
                              ),
                              SizedBox(width: 8),
                              SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
        ],
      ),
    );
  }

  Widget _buildQuickReplyChips() {
    final suggestions = [
      '✨ ¿Qué estilo me recomiendas?',
      '💅 Tendencias en uñas',
      '🌿 Rutina para el cabello',
      '💆‍♀️ Salones recomendados',
    ];

    return Container(
      height: 42,
      margin: const EdgeInsets.only(bottom: 4),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: suggestions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final suggestion = suggestions[i];
          return ActionChip(
            backgroundColor: const Color(0xFFFBF6F0),
            surfaceTintColor: Colors.transparent,
            side: const BorderSide(color: Color(0xFFE5DDD5)),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
            ),
            label: Text(
              suggestion,
              style: const TextStyle(
                fontSize: 12,
                color: Color(0xFF5A4A42),
                fontWeight: FontWeight.w500,
              ),
            ),
            onPressed: () => _sendMessage(suggestion),
          );
        },
      ),
    );
  }
}
