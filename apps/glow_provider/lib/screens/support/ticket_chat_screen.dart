// frontend/lib/screens/support/ticket_chat_screen.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:glow_core/services/support_service.dart';
import 'package:glow_core/shared/theme.dart';

class TicketChatScreen extends StatefulWidget {
  final String ticketId;
  final String ticketSubject;
  final String ticketStatus;

  const TicketChatScreen({
    super.key,
    required this.ticketId,
    required this.ticketSubject,
    required this.ticketStatus,
  });

  @override
  State<TicketChatScreen> createState() => _TicketChatScreenState();
}

class _TicketChatScreenState extends State<TicketChatScreen> {
  final _msgCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();
  
  bool _isLoading = true;
  List<Map<String, dynamic>> _messages = [];
  String? _error;
  String? _myUserId;
  Timer? _refreshTimer;
  bool _isSending = false;

  @override
  void initState() {
    super.initState();
    _loadMyUserId();
    _loadMessages();
    // Poll for new messages every 6 seconds to keep it dynamic and fast
    _refreshTimer = Timer.periodic(const Duration(seconds: 6), (_) => _loadMessages(silent: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMyUserId() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _myUserId = prefs.getString('userId');
    });
  }

  Future<void> _loadMessages({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _error = null;
      });
    }

    try {
      final res = await SupportService.getTicketMessages(widget.ticketId);
      if (res != null) {
        setState(() {
          _messages = res;
        });
        if (!silent) {
          _scrollToBottom();
        }
      } else {
        if (!silent) {
          setState(() {
            _error = 'No se pudieron cargar los mensajes.';
          });
        }
      }
    } catch (e) {
      if (!silent) {
        setState(() {
          _error = 'Error de conexiÃ³n: $e';
        });
      }
    } finally {
      if (!silent) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage() async {
    final txt = _msgCtrl.text.trim();
    if (txt.isEmpty || _isSending) return;

    setState(() {
      _isSending = true;
    });

    try {
      final res = await SupportService.createTicketMessage(widget.ticketId, txt);
      if (res != null && res['success'] == true) {
        _msgCtrl.clear();
        await _loadMessages(silent: true);
        _scrollToBottom();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Error al enviar el mensaje.'), backgroundColor: Colors.redAccent),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error de red: $e'), backgroundColor: Colors.redAccent),
      );
    } finally {
      setState(() {
        _isSending = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.ticketSubject,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                fontWeight: FontWeight.bold,
                fontSize: 18,
                color: Color(0xFF1F1A15),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              'Estado: ${widget.ticketStatus}',
              style: const TextStyle(
                fontFamily: 'Inter',
                color: Color(0xFF8C7E74),
                fontSize: 11,
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0.5,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
        children: [
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
                : _error != null
                    ? Center(child: Text(_error!, style: const TextStyle(color: Colors.redAccent)))
                    : _messages.isEmpty
                        ? _buildChatIntro()
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
                            itemCount: _messages.length,
                            itemBuilder: (context, index) {
                              final msg = _messages[index];
                              final senderId = msg['remitente_id']?.toString() ?? '';
                              final messageText = msg['mensaje']?.toString() ?? '';
                              final name = msg['remitente_nombre']?.toString() ?? 'Usuario';
                              final rol = msg['remitente_rol']?.toString() ?? 'CLIENTE';

                              final isMe = _myUserId == senderId;
                              final isAdmin = rol == 'ADMIN';

                              return _buildMessageBubble(
                                text: messageText,
                                isMe: isMe,
                                isAdmin: isAdmin,
                                name: name,
                              );
                            },
                          ),
          ),
          _buildInputBar(),
        ],
      ),
    ),
  ),
);
  }

  Widget _buildChatIntro() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.chat_bubble_outline, size: 48, color: AppTheme.primary.withOpacity(0.5)),
            const SizedBox(height: 12),
            const Text(
              'Â¡Chat de Soporte TÃ©cnico!',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Colors.black87),
            ),
            const SizedBox(height: 6),
            const Text(
              'Escribe tu inquietud abajo. Un agente de soporte revisarÃ¡ el caso y responderÃ¡ en este hilo.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMessageBubble({
    required String text,
    required bool isMe,
    required bool isAdmin,
    required String name,
  }) {
    final bubbleColor = isMe
        ? AppTheme.primary.withOpacity(0.9)
        : (isAdmin ? const Color(0xFFF1E4E2) : Colors.grey[100]!);
    final textColor = isMe ? Colors.white : Colors.black87;
    final align = isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    final margin = isMe
        ? const EdgeInsets.only(left: 48.0, bottom: 8.0, top: 4.0)
        : const EdgeInsets.only(right: 48.0, bottom: 8.0, top: 4.0);

    return Column(
      crossAxisAlignment: align,
      children: [
        if (!isMe)
          Padding(
            padding: const EdgeInsets.only(left: 8.0, bottom: 2.0),
            child: Text(
              isAdmin ? 'Soporte Belleza App' : name,
              style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: isAdmin ? AppTheme.primary : Colors.grey),
            ),
          ),
        Container(
          margin: margin,
          padding: const EdgeInsets.symmetric(horizontal: 14.0, vertical: 10.0),
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: isMe ? const Radius.circular(16) : Radius.zero,
              bottomRight: isMe ? Radius.zero : const Radius.circular(16),
            ),
          ),
          child: Text(
            text,
            style: TextStyle(color: textColor, fontSize: 13.5, height: 1.3),
          ),
        ),
      ],
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey[200]!)),
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _msgCtrl,
                maxLines: null,
                style: const TextStyle(fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'Escribe un mensaje...',
                  hintStyle: const TextStyle(color: Colors.grey),
                  filled: true,
                  fillColor: Colors.grey[50],
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _isSending ? null : _sendMessage,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: const BoxDecoration(
                  color: AppTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: _isSending
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Icon(Icons.send, color: Colors.white, size: 20),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
