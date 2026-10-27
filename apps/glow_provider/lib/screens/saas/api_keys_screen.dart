// lib/screens/saas/api_keys_screen.dart
import 'package:glow_core/models/saas/saas_models.dart';
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// API Keys del tenant: listar, crear (la key se muestra una sola vez) y revocar.
/// Requiere rol ADMIN/OWNER y plan con la capacidad CUSTOM_BRANDING (PRO o superior).
class ApiKeysScreen extends ConsumerStatefulWidget {
  const ApiKeysScreen({super.key});

  @override
  ConsumerState<ApiKeysScreen> createState() => _ApiKeysScreenState();
}

class _ApiKeysScreenState extends ConsumerState<ApiKeysScreen> {
  static const _bg = Color(0xFFFAF8F5);
  static const _ink = Color(0xFF1F1A15);
  static const _muted = Color(0xFF8C7E74);
  static const _gold = Color(0xFFC5A052);
  static const _line = Color(0xFFEFE8DE);

  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _ensureLoaded());
  }

  Future<void> _ensureLoaded() async {
    if (ref.read(businessProfileProvider).profile == null) {
      await ref.read(businessProfileProvider.notifier).load();
    }
    final id = ref.read(currentBusinessProfileIdProvider) ?? '';
    if (ref.read(apiKeysProvider).keys.isEmpty) {
      await ref.read(apiKeysProvider.notifier).load(id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileState = ref.watch(businessProfileProvider);
    final businessProfileId = ref.watch(currentBusinessProfileIdProvider) ?? '';
    final state = ref.watch(apiKeysProvider);

    if (profileState.profile == null) {
      return Scaffold(
        backgroundColor: _bg,
        appBar: AppBar(title: const Text('API Keys'), backgroundColor: _bg, foregroundColor: _ink),
        body: profileState.isLoading
            ? const Center(child: CircularProgressIndicator())
            : const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'Activa tu cuenta SaaS desde Facturación para crear API Keys.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: _muted, height: 1.5),
                  ),
                ),
              ),
      );
    }

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        title: const Text('API Keys'),
        backgroundColor: _bg,
        foregroundColor: _ink,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Crear API Key',
            icon: const Icon(Icons.add_rounded, color: _gold),
            onPressed: _busy ? null : () => _showCreateDialog(businessProfileId),
          ),
        ],
      ),
      body: state.isLoading && state.keys.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () => ref.read(apiKeysProvider.notifier).load(businessProfileId),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _infoBanner(),
                  const SizedBox(height: 16),
                  if (state.error != null) _errorBanner(state.error),
                  if (state.keys.isEmpty)
                    _emptyState(businessProfileId)
                  else
                    ...state.keys.map((k) => _keyTile(businessProfileId, k)),
                ],
              ),
            ),
    );
  }

  Widget _infoBanner() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF0F9FF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFBAE6FD)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          Row(
            children: [
              Icon(Icons.info_outline_rounded, color: Color(0xFF0284C7), size: 18),
              SizedBox(width: 8),
              Text('Sobre las API Keys',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: _ink)),
            ],
          ),
          SizedBox(height: 8),
          Text(
            '• La key completa se muestra una sola vez al crearla: guárdala en un lugar seguro.\n'
            '• Usa el scope mínimo necesario (principio de menor privilegio).\n'
            '• Revoca cualquier key que ya no uses o que sospeches comprometida.\n'
            '• Encabezado de autenticación: Authorization: Bearer <key>',
            style: TextStyle(fontSize: 11, color: Color(0xFF0369A1), height: 1.55),
          ),
        ],
      ),
    );
  }

  Widget _errorBanner(Object? error) {
    if (error == null) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.withOpacity(0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.red.withOpacity(0.3)),
      ),
      child: Text('No se pudieron cargar las API Keys: $error',
          style: const TextStyle(fontSize: 12, color: Colors.red)),
    );
  }

  Widget _emptyState(String businessProfileId) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          children: [
            const Icon(Icons.vpn_key_rounded, size: 42, color: _gold),
            const SizedBox(height: 12),
            const Text('Sin API Keys',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: _ink)),
            const SizedBox(height: 6),
            const Text(
              'Crea tu primera key para integrar GlowApp con tus sistemas '
              '(CRM, punto de venta, automatizaciones).',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: _muted, height: 1.5),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: _gold, foregroundColor: _ink),
              onPressed: _busy ? null : () => _showCreateDialog(businessProfileId),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Crear API Key'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _keyTile(String businessProfileId, ApiKey key) {
    final active = !key.isRevoked && !key.isExpired;
    final color = active ? _greenSafe : _muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.vpn_key_rounded, size: 18, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(key.name,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: _ink)),
                    const SizedBox(height: 2),
                    Text(
                      key.keyPrefix.isEmpty ? key.displayKey : '${key.keyPrefix}…',
                      style: const TextStyle(fontSize: 11, color: _muted, fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: color),
                ),
                child: Text(
                  active ? 'ACTIVA' : (key.isRevoked ? 'REVOCADA' : 'EXPIRADA'),
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: color),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: key.scopes
                .map((s) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: _gold.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(s.code,
                          style: const TextStyle(fontSize: 10, color: _gold, fontFamily: 'monospace')),
                    ))
                .toList(),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _meta('Creada', _formatDate(key.createdAt)),
              const SizedBox(width: 14),
              if (key.lastUsedAt != null) _meta('Último uso', _formatDate(key.lastUsedAt!)),
              if (key.expiresAt != null) ...[
                const SizedBox(width: 14),
                _meta('Expira', _formatDate(key.expiresAt!)),
              ],
              const Spacer(),
              if (active)
                TextButton.icon(
                  onPressed: _busy ? null : () => _confirmRevoke(businessProfileId, key),
                  icon: const Icon(Icons.block_rounded, size: 15, color: Colors.red),
                  label: const Text('Revocar', style: TextStyle(fontSize: 12, color: Colors.red)),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static const _greenSafe = Color(0xFF10B981);

  Widget _meta(String label, String value) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('$label: ', style: const TextStyle(fontSize: 10, color: _muted)),
        Text(value, style: const TextStyle(fontSize: 10, color: _ink, fontWeight: FontWeight.w500)),
      ],
    );
  }

  // ───────────────────────── Crear ─────────────────────────

  Future<void> _showCreateDialog(String businessProfileId) async {
    final nameCtrl = TextEditingController();
    final selected = <ApiKeyScope>{ApiKeyScope.read};
    var expiresInDays = 365;
    var submitting = false;
    String? error;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Crear API Key'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Nombre',
                      hintText: 'Ej. Integración CRM, App móvil',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('Permisos (scopes)',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: _ink)),
                  const SizedBox(height: 4),
                  const Text('Empieza con lectura y agrega solo lo necesario.',
                      style: TextStyle(fontSize: 10, color: _muted)),
                  ...ApiKeyScope.values.map(
                    (scope) => CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: selected.contains(scope),
                      onChanged: (v) => setDialogState(() {
                        if (v == true) {
                          selected.add(scope);
                        } else {
                          selected.remove(scope);
                        }
                      }),
                      title: Text('${scope.label} (${scope.code})',
                          style: const TextStyle(fontSize: 12, color: _ink)),
                      subtitle: Text(scope.description, style: const TextStyle(fontSize: 10, color: _muted)),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text('Vigencia',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: _ink)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: [30, 90, 365]
                        .map((d) => ChoiceChip(
                              label: Text(d == 365 ? '1 año' : '$d días',
                                  style: const TextStyle(fontSize: 11)),
                              selected: expiresInDays == d,
                              onSelected: (_) => setDialogState(() => expiresInDays = d),
                            ))
                        .toList(),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 10),
                    Text(error!, style: const TextStyle(fontSize: 11, color: Colors.red)),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: submitting ? null : () => Navigator.pop(ctx),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: _gold, foregroundColor: _ink),
              onPressed: submitting
                  ? null
                  : () async {
                      final name = nameCtrl.text.trim();
                      if (name.length < 3) {
                        setDialogState(() => error = 'El nombre debe tener al menos 3 caracteres.');
                        return;
                      }
                      if (selected.isEmpty) {
                        setDialogState(() => error = 'Selecciona al menos un scope.');
                        return;
                      }
                      setDialogState(() {
                        submitting = true;
                        error = null;
                      });
                      try {
                        final created = await ref.read(apiKeysProvider.notifier).create(
                              businessProfileId,
                              CreateApiKeyRequest(
                                name: name,
                                scopes: selected.toList(),
                                expiresInDays: expiresInDays,
                              ),
                            );
                        if (!ctx.mounted) return;
                        Navigator.pop(ctx);
                        _showKeyOnce(created);
                      } catch (e) {
                        setDialogState(() {
                          submitting = false;
                          error = 'No se pudo crear: $e';
                        });
                      }
                    },
              child: Text(submitting ? 'Creando…' : 'Crear'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showKeyOnce(ApiKey key) async {
    final raw = key.rawKey;
    if (raw == null) {
      _toast('La key se creó pero el servidor no devolvió el valor completo. '
          'Revócala y crea una nueva.', error: true);
      return;
    }
    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.check_circle_rounded, color: _greenSafe, size: 24),
            SizedBox(width: 8),
            Text('API Key creada'),
          ],
        ),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Copia la key ahora. No se volverá a mostrar.',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.red),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _ink,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SelectableText(
                  raw,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: Colors.white,
                    height: 1.5,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: raw));
                  if (!mounted) return;
                  _toast('Key copiada al portapapeles');
                },
                icon: const Icon(Icons.copy_rounded, size: 16),
                label: const Text('Copiar key'),
              ),
            ],
          ),
        ),
        actions: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _ink, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Ya la guardé'),
          ),
        ],
      ),
    );
  }

  // ───────────────────────── Revocar ─────────────────────────

  Future<void> _confirmRevoke(String businessProfileId, ApiKey key) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Revocar API Key'),
        content: Text(
          '¿Revocar "${key.name}"? Las integraciones que la usen dejarán de funcionar de inmediato. '
          'Esta acción no se puede deshacer.',
          style: const TextStyle(fontSize: 12, height: 1.5),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Volver')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Revocar'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiKeysProvider.notifier).revoke(businessProfileId, key.id);
      if (!mounted) return;
      _toast('API Key revocada');
    } catch (e) {
      if (!mounted) return;
      _toast('No se pudo revocar: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Colors.red.shade700 : null,
    ));
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}
