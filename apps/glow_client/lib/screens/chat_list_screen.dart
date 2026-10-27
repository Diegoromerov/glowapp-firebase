// frontend/lib/screens/chat_list_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'chat_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<Map<String, dynamic>> _conversations = [];
  bool _isLoading = true;
  String? _error;
  Timer? _pollingTimer;
  String? _currentUserRole;

  @override
  void initState() {
    super.initState();
    _loadCurrentUserRole();
    _fetchConversations(showLoading: true);
    // Poll conversations every 5 seconds to keep unread counts fresh
    _pollingTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _fetchConversations(showLoading: false);
    });
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadCurrentUserRole() async {
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
              _currentUserRole = data['role'];
            });
          }
        }
      } catch (_) {}
    }
  }

  // Fallback base64 decoding helper
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
      if (val == -1) {
        continue;
      }
      buffer = (buffer << 6) | val;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output.add((buffer >> bits) & 0xFF);
      }
    }
    return output;
  }

  String jsonDecodePayload(String payload) {
    try {
      final decodedBytes = base64Decode(
        payload.length % 4 == 0
            ? payload
            : payload.padRight(payload.length + (4 - payload.length % 4), '='),
      );
      return String.fromCharCodes(decodedBytes);
    } catch (_) {
      return '{}';
    }
  }

  Future<void> _fetchConversations({required bool showLoading}) async {
    if (showLoading && mounted) {
      setState(() {
        _isLoading = true;
        _error = null;
      });
    }
    try {
      var conversations = await ApiService.fetchChatConversations();
      final roleLower = (_currentUserRole ?? '').toLowerCase();
      if (roleLower == 'provider' || roleLower == 'salon') {
        conversations = conversations.where((c) {
          final pid = c['conversation_partner_id']?.toString();
          return pid != '0' && pid != '00000000-0000-0000-0000-000000000000';
        }).toList();
      }
      if (mounted) {
        setState(() {
          _conversations = conversations;
          _isLoading = false;
          _error = null;
        });
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

  String _formatTime(String? dateStr) {
    if (dateStr == null) {
      return '';
    }
    try {
      final dateTime = DateTime.parse(dateStr).toLocal();
      final now = DateTime.now();
      if (dateTime.day == now.day &&
          dateTime.month == now.month &&
          dateTime.year == now.year) {
        final hour = dateTime.hour.toString().padLeft(2, '0');
        final minute = dateTime.minute.toString().padLeft(2, '0');
        return '$hour:$minute';
      } else {
        return '${dateTime.day}/${dateTime.month}';
      }
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Mensajes & Concierge',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5,
            fontSize: 24,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
        centerTitle: false,
      ),
      body: Center(
        child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 680),
                  child: _isLoading
                  ? Center(
                      child: CircularProgressIndicator(color: AppTheme.primary))
                  : _error != null
                      ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline,
                          color: Colors.redAccent, size: 48),
                      const SizedBox(height: 16),
                      Text('Error al cargar chats: $_error',
                          textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => _fetchConversations(showLoading: true),
                        style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.primary,
                            foregroundColor: Colors.white),
                        child: const Text('Reintentar'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  color: AppTheme.primary,
                  onRefresh: () => _fetchConversations(showLoading: false),
                  child: Column(
                    children: [
                      if (_currentUserRole?.toLowerCase() != 'provider' && _currentUserRole?.toLowerCase() != 'salon')
                        Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 8),
                          child: Container(
                                                      decoration: BoxDecoration(
                                                        borderRadius: BorderRadius.circular(24),
                                                        gradient: LinearGradient(
                                                          colors: [AppTheme.primary, Color(0xFFE5CECA)],
                                                          begin: Alignment.topLeft,
                                                          end: Alignment.bottomRight,
                                                        ),
                                                        boxShadow: const [
                                                          BoxShadow(
                                                            color: Color(0x0A000000),
                                                            blurRadius: 12,
                                                            offset: Offset(0, 4),
                                                          )
                                                        ],
                                                      ),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 20, vertical: 12),
                              leading: Container(
                                width: 58,
                                height: 58,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(color: const Color(0xFFD4AF37), width: 2.5),
                                  image: const DecorationImage(
                                    image: AssetImage('images/avatar_aura.webp'),
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              ),
                              title: const Text(
                                'Aura - Asistente de IA',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16,
                                  letterSpacing: -0.3,
                                ),
                              ),
                              subtitle: const Text(
                                'Pregúntame sobre estilos de cabello, agendamiento seguro, garantías o activa el botón SOS.',
                                style: TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12.5,
                                  height: 1.3,
                                ),
                              ),
                              trailing: const Icon(
                                Icons.arrow_forward_ios,
                                color: Colors.white,
                                size: 14,
                              ),
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => const ChatScreen(
                                      partnerId: '0',
                                      partnerName: 'Aura - Asistente de IA',
                                      partnerRole: 'admin',
                                      partnerAvatar: 'images/avatar_aura.webp',
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: _conversations
                                .where((c) =>
                                    c['conversation_partner_id'] != '0' &&
                                    c['conversation_partner_id'] !=
                                    '00000000-0000-0000-0000-000000000000')
                                .isEmpty
                            ? ListView(
                                children: [
                                  const SizedBox(height: 60),
                                  const Icon(
                                    Icons.chat_bubble_outline_rounded,
                                    size: 56,
                                    color: Colors.grey,
                                  ),
                                  const SizedBox(height: 16),
                                  const Text(
                                    'No hay otros chats activos',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.black54,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 40),
                                    child: Text(
                                      _currentUserRole == 'provider'
                                          ? 'Cuando los clientes te envíen mensajes, aparecerán aquí.'
                                          : 'Explora prestadores y escribe para comenzar un chat.',
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                          color: Colors.grey, fontSize: 13),
                                    ),
                                  ),
                                ],
                              )
                            : ListView.separated(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 8),
                                itemCount: _conversations
                                    .where((c) =>
                                        c['conversation_partner_id'] != '0' &&
                                        c['conversation_partner_id'] !=
                                        '00000000-0000-0000-0000-000000000000')
                                    .length,
                                separatorBuilder: (context, index) =>
                                    const SizedBox(height: 12),
                                itemBuilder: (context, index) {
                                  final filteredConversations = _conversations
                                      .where((c) =>
                                          c['conversation_partner_id'] != '0' &&
                                          c['conversation_partner_id'] !=
                                          '00000000-0000-0000-0000-000000000000')
                                      .toList();
                                  final chat = filteredConversations[index];
                                  final partnerId =
                                      chat['conversation_partner_id'] as String;
                                  final partnerName =
                                      chat['partner_name'] as String? ??
                                          'Usuario';
                                  final partnerAvatar =
                                      chat['partner_avatar'] as String?;
                                  final partnerRole =
                                      chat['partner_role'] as String? ??
                                          'client';
                                  final lastMessage =
                                      chat['last_message'] as String? ?? '';
                                  final lastMessageTime =
                                      chat['last_message_time'] as String?;
                                  final unreadCount =
                                      chat['unread_count'] as int? ?? 0;

                                  final isProvider = partnerRole == 'provider';

                                  return Container(
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(24),
                                      boxShadow: const [
                                        BoxShadow(
                                          color: Color(0x0A000000),
                                          blurRadius: 16,
                                          offset: Offset(0, 4),
                                        )
                                      ],
                                    ),
                                    child: ListTile(
                                      contentPadding:
                                          const EdgeInsets.symmetric(
                                              horizontal: 16, vertical: 8),
                                      leading: CircleAvatar(
                                        radius: 26,
                                        backgroundColor:
                                            const Color(0xFFF5EBE6),
                                        backgroundImage:
                                            partnerAvatar != null &&
                                                    partnerAvatar.isNotEmpty
                                                ? NetworkImage(partnerAvatar)
                                                : null,
                                        child: partnerAvatar == null ||
                                                partnerAvatar.isEmpty
                                            ? Text(
                                                partnerName.isNotEmpty
                                                    ? partnerName[0]
                                                        .toUpperCase()
                                                                                                            : 'U',
                                                                                                        style: TextStyle(
                                                                                                          fontWeight: FontWeight.bold,
                                                                                                          color: AppTheme.primary,
                                                                                                          fontSize: 18,
                                                                                                        ),
                                                                                                      )
                                            : null,
                                      ),
                                      title: Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              partnerName,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                fontWeight: unreadCount > 0
                                                    ? FontWeight.bold
                                                    : FontWeight.w600,
                                                fontSize: 15,
                                              ),
                                            ),
                                          ),
                                          if (lastMessageTime != null)
                                            Text(
                                              _formatTime(lastMessageTime),
                                              style: TextStyle(
                                                fontSize: 11,
                                                color: unreadCount > 0
                                                    ? AppTheme.primary
                                                    : Colors.grey[600],
                                                fontWeight: unreadCount > 0
                                                    ? FontWeight.bold
                                                    : FontWeight.normal,
                                              ),
                                            ),
                                        ],
                                      ),
                                      subtitle: Padding(
                                        padding: const EdgeInsets.only(top: 4),
                                        child: Row(
                                          children: [
                                            Expanded(
                                              child: Text(
                                                lastMessage,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                  color: unreadCount > 0
                                                      ? Colors.black87
                                                      : Colors.grey[600],
                                                  fontWeight: unreadCount > 0
                                                      ? FontWeight.w500
                                                      : FontWeight.normal,
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ),
                                            if (unreadCount > 0)
                                              Container(
                                                margin: const EdgeInsets.only(
                                                    left: 8),
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                        horizontal: 8,
                                                        vertical: 4),
                                                decoration: BoxDecoration(
                                                  color:
                                                      AppTheme.primary,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                ),
                                                child: Text(
                                                  '$unreadCount',
                                                  style: const TextStyle(
                                                    color: Colors.white,
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.bold,
                                                  ),
                                                ),
                                              )
                                            else ...[
                                              const SizedBox(width: 4),
                                              Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                        horizontal: 8,
                                                        vertical: 4),
                                                decoration: BoxDecoration(
                                                  color: isProvider
                                                      ? const Color(0xFFFEF3C7)
                                                      : const Color(0xFFDCFCE7),
                                                  borderRadius:
                                                      BorderRadius.circular(20),
                                                ),
                                                child: Text(
                                                  isProvider
                                                      ? 'PRESTADOR'
                                                      : 'CLIENTE',
                                                  style: TextStyle(
                                                    fontSize: 9,
                                                    fontWeight: FontWeight.bold,
                                                    color: isProvider
                                                        ? const Color(
                                                            0xFFD97706)
                                                        : const Color(
                                                            0xFF16A34A),
                                                  ),
                                                ),
                                              ),
                                            ]
                                          ],
                                        ),
                                      ),
                                      onTap: () async {
                                        await Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (_) => ChatScreen(
                                              partnerId: partnerId,
                                              partnerName: partnerName,
                                              partnerRole: partnerRole,
                                              partnerAvatar: partnerAvatar,
                                            ),
                                          ),
                                        );
                                        _fetchConversations(showLoading: false);
                                      },
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
          ),
        ),
    );
  }
}
