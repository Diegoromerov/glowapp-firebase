// lib/screens/saas/billing_screen.dart
import 'package:glow_core/models/saas/saas_models.dart';
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Facturación: plan actual, cambio de plan (checkout / change-plan),
/// historial de facturas y métodos de pago.
class BillingScreen extends ConsumerStatefulWidget {
  const BillingScreen({super.key});

  @override
  ConsumerState<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends ConsumerState<BillingScreen> {
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
    if (ref.read(billingProvider).subscription == null) {
      await ref.read(billingProvider.notifier).load(id);
    }
    if (ref.read(plansProvider).plans.isEmpty) {
      await ref.read(plansProvider.notifier).load();
    }
  }

  Future<void> _provision() async {
    setState(() => _busy = true);
    try {
      await ref.read(businessProfileProvider.notifier).create(
            const CreateBusinessProfileRequest(
              name: '',
              slug: '',
              timezone: 'America/Bogota',
              currency: 'COP',
              planId: 'FREE_TRIAL',
            ),
          );
      final id = ref.read(currentBusinessProfileIdProvider) ?? '';
      await ref.read(billingProvider.notifier).load(id);
      await ref.read(plansProvider.notifier).load();
      if (!mounted) return;
      _toast('Cuenta SaaS activada');
    } catch (e) {
      if (mounted) _toast('No se pudo activar la cuenta: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileState = ref.watch(businessProfileProvider);
    final businessProfileId = ref.watch(currentBusinessProfileIdProvider) ?? '';
    final billing = ref.watch(billingProvider);
    final plans = ref.watch(plansProvider).plans;

    if (profileState.profile == null) {
      return Scaffold(
        backgroundColor: _bg,
        appBar: AppBar(title: const Text('Facturación'), backgroundColor: _bg, foregroundColor: _ink),
        body: profileState.isLoading
            ? const Center(child: CircularProgressIndicator())
            : _notProvisioned(),
      );
    }

    final subscription = billing.subscription;
    final tier = subscription?.tier ?? profileState.profile!.currentPlan;

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        title: const Text('Facturación y Plan'),
        backgroundColor: _bg,
        foregroundColor: _ink,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Portal de pagos',
            icon: const Icon(Icons.credit_card_rounded, color: _gold),
            onPressed: _busy ? null : _openPortal,
          ),
        ],
      ),
      body: billing.isLoading && subscription == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () async {
                await ref.read(billingProvider.notifier).load(businessProfileId);
                await ref.read(plansProvider.notifier).load();
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _currentPlanCard(subscription, tier, billing.nextPayment),
                  const SizedBox(height: 16),
                  _errorBanner(billing.error),
                  _changePlanSection(plans, tier),
                  const SizedBox(height: 16),
                  _invoicesSection(billing.invoices),
                  const SizedBox(height: 16),
                  _paymentMethodsSection(billing.paymentMethods),
                  if (subscription != null && subscription.isActive) ...[
                    const SizedBox(height: 16),
                    _cancelSection(subscription),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _notProvisioned() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.storefront_rounded, size: 48, color: _gold),
            const SizedBox(height: 12),
            const Text('Cuenta SaaS no activada',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: _ink)),
            const SizedBox(height: 8),
            const Text(
              'Tu salón existe, pero aún no tiene perfil SaaS con plan y facturación. '
              'Actívalo para gestionar equipo, uso y pagos.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: _muted, height: 1.5),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: _gold, foregroundColor: _ink),
              onPressed: _busy ? null : _provision,
              icon: const Icon(Icons.rocket_launch_rounded, size: 18),
              label: const Text('Activar cuenta SaaS'),
            ),
          ],
        ),
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
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, color: Colors.red, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'No se pudo cargar la facturación: $error',
              style: const TextStyle(fontSize: 12, color: Colors.red),
            ),
          ),
        ],
      ),
    );
  }

  // ───────────────────────── Plan actual ─────────────────────────

  Widget _currentPlanCard(
    Subscription? subscription,
    SaasPlanTier tier,
    Map<String, dynamic>? nextPayment,
  ) {
    final statusLabel = subscription?.status.label ?? 'Sin suscripción';
    final statusColor = subscription?.status.color ?? _muted;
    final onTrial = subscription?.isOnTrial ?? false;

    return Card(
      elevation: 0,
      color: tier.color.withOpacity(0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: tier.color.withOpacity(0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: tier.color, borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.workspace_premium_rounded, color: Colors.white, size: 26),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Plan ${tier.label}',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: tier.color),
                      ),
                      const SizedBox(height: 2),
                      Text(tier.formattedPrice, style: const TextStyle(fontSize: 13, color: _muted)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: statusColor),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: statusColor),
                  ),
                ),
              ],
            ),
            if (onTrial) ...[
              const SizedBox(height: 14),
              _infoRow(
                Icons.hourglass_top_rounded,
                'Prueba gratis: ${subscription!.trialDaysLeft} días restantes',
                Colors.amber.shade800,
              ),
            ],
            if (subscription != null) ...[
              const SizedBox(height: 10),
              _infoRow(
                subscription.cancelAtPeriodEnd
                    ? Icons.event_busy_rounded
                    : Icons.event_repeat_rounded,
                subscription.cancelAtPeriodEnd
                    ? 'Se cancela el ${_formatDate(subscription.currentPeriodEnd)}'
                    : 'Renueva el ${_formatDate(subscription.currentPeriodEnd)}'
                        '${_nextPaymentLabel(nextPayment)}',
                _muted,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _nextPaymentLabel(Map<String, dynamic>? nextPayment) {
    final amount = nextPayment?['amount'];
    if (amount is! num || amount <= 0) return '';
    return ' · ${_formatCop(amount, nextPayment?['currency'] as String?)}';
  }

  Widget _infoRow(IconData icon, String text, Color color) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: TextStyle(fontSize: 12, color: color, height: 1.4))),
      ],
    );
  }

  // ───────────────────────── Cambio de plan ─────────────────────────

  Widget _changePlanSection(List<SaasPlan> plans, SaasPlanTier current) {
    final candidates = plans
        .where((p) => p.tier != current && p.tier != SaasPlanTier.freeTrial)
        .toList()
      ..sort((a, b) => a.tier.index.compareTo(b.tier.index));

    return _section(
      title: 'Cambiar Plan',
      subtitle: 'Los upgrades se pagan en línea; los downgrades aplican de inmediato.',
      children: candidates.isEmpty
          ? [const Text('No hay otros planes disponibles.', style: TextStyle(color: _muted, fontSize: 13))]
          : candidates.map((p) => _planRow(p, current)).toList(),
    );
  }

  Widget _planRow(SaasPlan plan, SaasPlanTier current) {
    final isUpgrade = plan.tier.index > current.index;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: plan.tier.color.withOpacity(0.04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: plan.tier.color.withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(plan.name,
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: plan.tier.color)),
                        if (plan.isPopular) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: _gold.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text('Recomendado',
                                style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: _gold)),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(plan.tier.formattedPrice, style: const TextStyle(fontSize: 12, color: _muted)),
                    const SizedBox(height: 4),
                    Text(plan.description, style: const TextStyle(fontSize: 11, color: _muted)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: isUpgrade ? plan.tier.color : _line,
                  foregroundColor: isUpgrade ? Colors.white : _ink,
                ),
                onPressed: _busy ? null : () => _onPlanSelected(plan, isUpgrade),
                child: Text(isUpgrade ? 'Mejorar' : 'Cambiar'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: plan.features
                .map((f) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: plan.tier.color.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(f, style: TextStyle(fontSize: 10, color: plan.tier.color)),
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }

  Future<void> _onPlanSelected(SaasPlan plan, bool isUpgrade) async {
    final id = ref.read(currentBusinessProfileIdProvider);
    if (id == null) return;

    if (!isUpgrade) {
      final ok = await _confirm(
        'Cambiar a ${plan.name}',
        'El cambio a ${plan.name} aplica de inmediato y puede reducir los límites de tu cuenta.',
        'Cambiar',
      );
      if (ok != true) return;
      setState(() => _busy = true);
      try {
        await ref.read(billingProvider.notifier).changePlan(id, plan.tier);
        if (!mounted) return;
        _toast('Plan actualizado a ${plan.name}');
      } catch (e) {
        if (!mounted) return;
        _toast('No se pudo cambiar el plan: $e', error: true);
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      return;
    }

    setState(() => _busy = true);
    try {
      final session = await ref.read(billingProvider.notifier).createCheckout(
            id,
            CreateCheckoutRequest(planId: plan.tier.code, successUrl: '', cancelUrl: ''),
          );
      if (session.url.isEmpty) {
        _toast('El servidor no devolvió una URL de pago', error: true);
        return;
      }
      await launchUrl(Uri.parse(session.url), mode: LaunchMode.externalApplication);
    } catch (e) {
      _toast('No se pudo iniciar el pago: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ───────────────────────── Facturas ─────────────────────────

  Widget _invoicesSection(List<Invoice> invoices) {
    return _section(
      title: 'Historial de Facturas',
      subtitle: invoices.isEmpty ? 'Aún no hay facturas emitidas.' : '${invoices.length} facturas',
      children: invoices.map(_invoiceTile).toList(),
    );
  }

  Widget _invoiceTile(Invoice invoice) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: _bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _line),
      ),
      child: Row(
        children: [
          Icon(Icons.receipt_long_rounded, size: 20, color: invoice.status.color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Factura ${invoice.number.isEmpty ? invoice.id : invoice.number}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _ink),
                ),
                Text(
                  '${_formatDate(invoice.issuedAt)} · ${invoice.status.label}',
                  style: const TextStyle(fontSize: 11, color: _muted),
                ),
              ],
            ),
          ),
          Text(invoice.formattedAmount,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: _ink)),
          IconButton(
            tooltip: 'Ver factura',
            icon: Icon(Icons.open_in_new_rounded,
                size: 18, color: invoice.hostedInvoiceUrl != null ? _gold : _muted),
            onPressed: () => _openInvoice(invoice),
          ),
        ],
      ),
    );
  }

  Future<void> _openInvoice(Invoice invoice) async {
    final url = invoice.hostedInvoiceUrl ?? invoice.pdfUrl;
    if (url == null || url.isEmpty) {
      _toast('Esta factura no tiene enlace público: el PDF se genera en el servidor '
          'y requiere sesión autenticada.');
      return;
    }
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  // ───────────────────────── Métodos de pago ─────────────────────────

  Widget _paymentMethodsSection(List<Map<String, dynamic>> methods) {
    return _section(
      title: 'Métodos de Pago',
      subtitle: methods.isEmpty
          ? 'Sin tarjetas guardadas. Se gestionan en el portal de pagos.'
          : '${methods.length} tarjeta(s) registrada(s)',
      children: [
        ...methods.map((pm) {
          final card = pm['card'] as Map<String, dynamic>?;
          final brand = (card?['brand'] ?? 'tarjeta').toString();
          final last4 = (card?['last4'] ?? '••••').toString();
          final exp = card != null ? '${card['expMonth']}/${card['expYear']}' : '';
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _bg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _line),
            ),
            child: Row(
              children: [
                const Icon(Icons.credit_card_rounded, size: 20, color: _ink),
                const SizedBox(width: 12),
                Expanded(
                  child: Text('${brand.toUpperCase()} •••• $last4',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: _ink)),
                ),
                if (exp.isNotEmpty)
                  Text('Vence $exp', style: const TextStyle(fontSize: 11, color: _muted)),
              ],
            ),
          );
        }),
        const SizedBox(height: 4),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: _busy ? null : _openPortal,
            icon: const Icon(Icons.settings_rounded, size: 18),
            label: const Text('Gestionar en el portal de pagos'),
            style: OutlinedButton.styleFrom(
              foregroundColor: _ink,
              side: const BorderSide(color: _line),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _openPortal() async {
    setState(() => _busy = true);
    try {
      final url = await ref.read(billingProvider.notifier).portalUrl();
      if (url == null || url.isEmpty) {
        _toast('El portal de pagos requiere una cuenta Stripe configurada. '
            'En Colombia el cobro se procesa con Wompi.');
        return;
      }
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (e) {
      _toast('No se pudo abrir el portal: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ───────────────────────── Cancelación ─────────────────────────

  Widget _cancelSection(Subscription subscription) {
    if (subscription.cancelAtPeriodEnd) {
      return _section(
        title: 'Suscripción',
        subtitle: 'Cancelada: mantiene acceso hasta ${_formatDate(subscription.currentPeriodEnd)}.',
        children: const [],
      );
    }
    return _section(
      title: 'Suscripción',
      subtitle: 'Puedes cancelar la renovación automática al final del período.',
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _busy ? null : () => _cancel(subscription),
            icon: const Icon(Icons.cancel_outlined, size: 18, color: Colors.red),
            label: const Text('Cancelar renovación', style: TextStyle(color: Colors.red)),
          ),
        ),
      ],
    );
  }

  Future<void> _cancel(Subscription subscription) async {
    final id = ref.read(currentBusinessProfileIdProvider);
    if (id == null) return;
    final ok = await _confirm(
      'Cancelar renovación',
      'Mantendrás el acceso hasta el ${_formatDate(subscription.currentPeriodEnd)} y luego '
          'la cuenta pasa a Freemium.',
      'Cancelar renovación',
      danger: true,
    );
    if (ok != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(billingProvider.notifier).cancelSubscription(id);
      if (!mounted) return;
      _toast('Renovación cancelada');
    } catch (e) {
      if (!mounted) return;
      _toast('No se pudo cancelar: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ───────────────────────── Helpers UI ─────────────────────────

  Widget _section({
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: _ink)),
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: _muted, height: 1.4)),
            if (children.isNotEmpty) const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }

  Future<bool?> _confirm(String title, String body, String action, {bool danger = false}) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body, style: const TextStyle(fontSize: 13, height: 1.5)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Volver')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: danger ? Colors.red : _ink),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(action),
          ),
        ],
      ),
    );
  }

  void _toast(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Colors.red.shade700 : null,
    ));
  }

  String _formatDate(DateTime date) =>
      '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';

  String _formatCop(num amount, String? currency) {
    final grouped = amount.round().toString().replaceAllMapped(
          RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]}.',
        );
    return '\$$grouped ${currency ?? 'COP'}';
  }
}
