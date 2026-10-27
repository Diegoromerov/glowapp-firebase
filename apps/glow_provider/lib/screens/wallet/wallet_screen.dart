import 'package:glow_core/glow_core.dart';
// frontend/lib/screens/wallet_screen.dart
// Pantalla de Wallet del Prestador: saldo, historial, retiros

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/widgets/provider/bank_account_dialog.dart';

class WalletScreen extends StatefulWidget {
  final bool isEmbedded;
  const WalletScreen({super.key, this.isEmbedded = false});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  Map<String, dynamic>? _wallet;
  List<dynamic> _transacciones = [];
  bool _loading = true;
  bool _loadingTx = false;
  String? _error;

  // Pagination & Filter fields
  String _filtroTipo = 'TODOS';
  int _currentPage = 1;
  bool _hasMore = true;
  bool _loadingMore = false;

  static final _formatCOP = NumberFormat.currency(
    locale: 'es_CO',
    symbol: '\$',
    decimalDigits: 0,
  );

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _cargarWallet();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _cargarWallet() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiService.get('/api/wallet');
      if (!mounted) return;
      setState(() {
        _wallet = res;
        _loading = false;
      });
      _cargarTransacciones(loadMore: false);
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _cargarTransacciones({bool loadMore = false}) async {
    if (loadMore) {
      if (_loadingMore || !_hasMore) return;
      setState(() {
        _loadingMore = true;
      });
    } else {
      setState(() {
        _loadingTx = true;
        _currentPage = 1;
        _hasMore = true;
      });
    }
    try {
      final res = await ApiService.get(
          '/api/wallet/transactions?page=$_currentPage&limit=15');
      final newTxs = res['transacciones'] ?? [];
      final pagination = res['pagination'];
      final total = pagination != null ? (pagination['total'] ?? 0) : 0;

      setState(() {
        if (loadMore) {
          _transacciones.addAll(newTxs);
        } else {
          _transacciones = newTxs;
        }
        _hasMore = _transacciones.length < total && newTxs.isNotEmpty;
        if (_hasMore) {
          _currentPage++;
        }
        _loadingTx = false;
        _loadingMore = false;
      });
    } catch (_) {
      setState(() {
        _loadingTx = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _solicitarRetiro() async {
    final wallet = _wallet!;
    final disponible =
        double.tryParse(wallet['saldo_disponible'].toString()) ?? 0;
    // El ciclo semanal no tiene mÃ­nimo; el mÃ­nimo de 100.000 es solo para el
    // adelanto (D-GL-024), asÃ­ que aquÃ­ no se bloquea por monto.
    const minimo = 0.0;

    final TextEditingController montoCtrl = TextEditingController(
      text: disponible.toStringAsFixed(0),
    );

    final String targetCuenta =
        '${wallet['banco'] ?? ''} ****${(wallet['numero_cuenta'] ?? '').toString().length > 4 ? wallet['numero_cuenta'].toString().substring(wallet['numero_cuenta'].toString().length - 4) : '????'}';

    final resultado = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _RetiroBottomSheet(
        disponible: disponible,
        minimo: minimo,
        montoCtrl: montoCtrl,
        cuenta: targetCuenta,
      ),
    );

    if (resultado == true) {
      if (!mounted) return;
      final textParsed = montoCtrl.text.replaceAll('.', '').replaceAll(',', '').trim();
      if (textParsed.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('âš ï¸ Debes ingresar un monto vÃ¡lido para el retiro.'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
      final double montoFinal = double.tryParse(textParsed) ?? 0.0;
      if (montoFinal <= 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('âš ï¸ El monto a retirar debe ser mayor que \$0 COP.'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
      if (montoFinal < minimo) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('âš ï¸ El monto mÃ­nimo de retiro es de \$${_formatCOP.format(minimo)}.'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
      if (montoFinal > disponible) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('âš ï¸ El monto excede el saldo disponible en tu wallet.'),
            backgroundColor: Colors.redAccent,
          ),
        );
        return;
      }

      final bool? verificado = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: Colors.white,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text(
            'Â¿Confirmar retiro?',
            style: TextStyle(
                color: Color(0xFF4A3E3D), fontWeight: FontWeight.bold),
          ),
          content: Text(
            'EstÃ¡s a punto de retirar ${_formatCOP.format(montoFinal)} a tu cuenta $targetCuenta. Esta acciÃ³n no se puede deshacer.',
            style: const TextStyle(color: Color(0xFF8E7D7A), fontSize: 14),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar',
                  style: TextStyle(color: Color(0xFF8E7D7A))),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Confirmar Retiro'),
            ),
          ],
        ),
      );

      if (verificado == true) {
        if (!mounted) return;
        try {
          await ApiService.post('/api/wallet/withdraw', {
            'monto': montoFinal,
            'tipo_origen': 'SEMANAL',
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content:
                    Text('âœ… Retiro solicitado. LlegarÃ¡ en 1-2 dÃ­as hÃ¡biles.'),
                backgroundColor: Color(0xFF10B981),
              ),
            );
            _cargarWallet();
          }
        } catch (e) {
          if (mounted) {
            // Hasta que la cuenta tenga activo "Pagos a terceros" de Wompi, el
            // backend responde 503 PAYOUTS_NOT_CONFIGURED antes de debitar. Al
            // prestador hay que decirle que su saldo estÃ¡ intacto, no mostrarle
            // el cÃ³digo de error.
            final texto = e.toString();
            final sinDispersion = texto.contains('PAYOUTS_NOT_CONFIGURED') ||
                texto.contains('503');
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(sinDispersion
                    ? 'Los retiros se habilitan pronto. No se descontÃ³ nada de tu saldo.'
                    : 'Error: ${texto.replaceAll('Exception: ', '')}'),
                backgroundColor: Colors.red,
              ),
            );
          }
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: _loading
          ? Center(
              child: CircularProgressIndicator(color: AppTheme.primary))
          : _error != null
              ? _buildError()
              : _buildContent(),
    );
  }

  Widget _buildError() {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: widget.isEmbedded
            ? null
            : IconButton(
                icon:
                    Icon(Icons.arrow_back_ios, color: AppTheme.primary),
                onPressed: () => Navigator.pop(context),
              ),
        title: Text(
          'Error de Wallet',
          style: TextStyle(
            color: AppTheme.primary,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
        centerTitle: true,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 48),
            const SizedBox(height: 16),
            Text(
              _error!,
              style: const TextStyle(color: Color(0xFF4A3E3D), fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _cargarWallet,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() {
    final wallet = _wallet!;
    final disponible =
        double.tryParse(wallet['saldo_disponible'].toString()) ?? 0;
    final pendiente =
        double.tryParse(wallet['saldo_pendiente'].toString()) ?? 0;
    final enDisputa =
        double.tryParse(wallet['saldo_en_disputa'].toString()) ?? 0;
    final puedeRetirar = wallet['puede_retirar'] == true;
    final razonBloqueo = wallet['razon_bloqueo'] as String?;

    return RefreshIndicator(
      onRefresh: _cargarWallet,
      color: const Color(0xFFC5A052),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: CustomScrollView(
            slivers: [
              // â”€â”€â”€ Header con saldo principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              SliverToBoxAdapter(
                child: Container(
                  color: const Color(0xFFFAF8F5),
                  padding: EdgeInsets.fromLTRB(
                    20,
                    MediaQuery.of(context).padding.top + 16,
                    20,
                    20,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (!widget.isEmbedded)
                            InkWell(
                              onTap: () => Navigator.pop(context),
                              borderRadius: BorderRadius.circular(20),
                              child: Container(
                                width: 36,
                                height: 36,
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                  border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(alpha: 0.04),
                                      blurRadius: 6,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: const Icon(Icons.arrow_back_ios_new_rounded, size: 15, color: Color(0xFF1F1A15)),
                              ),
                            ),
                          const Spacer(),
                          const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.account_balance_wallet_outlined, size: 18, color: Color(0xFFC5A052)),
                              SizedBox(width: 8),
                              Text(
                                'Mi Billetera Concierge',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1F1A15),
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ],
                          ),
                          const Spacer(),
                          InkWell(
                            onTap: () => _mostrarConfigRetiro(),
                            borderRadius: BorderRadius.circular(20),
                            child: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
                                border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.04),
                                    blurRadius: 6,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: const Icon(Icons.settings_outlined, size: 18, color: Color(0xFF1F1A15)),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // Tarjeta de Balance VIP Haute Joaillerie
                      Stack(
                        children: [
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(24),
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [Color(0xFF261E17), Color(0xFF15100C)],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(
                                color: Color(0xFFD4AF37).withValues(alpha: 0.5),
                                width: 1.2,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Color(0xFFC5A052).withValues(alpha: 0.18),
                                  blurRadius: 20,
                                  offset: const Offset(0, 8),
                                ),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        gradient: const LinearGradient(
                                          colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                                        ),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: const Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(Icons.account_balance_wallet_outlined, size: 12, color: Color(0xFF1F1A15)),
                                          SizedBox(width: 4),
                                          Text(
                                            'BILLETERA',
                                            style: TextStyle(
                                              fontFamily: 'Inter',
                                              fontSize: 10,
                                              fontWeight: FontWeight.bold,
                                              letterSpacing: 0.8,
                                              color: Color(0xFF1F1A15),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const Icon(Icons.contactless_outlined, color: Color(0xFFC5A052), size: 22),
                                  ],
                                ),
                                const SizedBox(height: 18),
                                const Text(
                                  'Disponible para retirar',
                                  style: TextStyle(
                                    fontFamily: 'Inter',
                                    color: Color(0xFFC5B8A8),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  _formatCOP.format(disponible),
                                  style: const TextStyle(
                                    fontFamily: 'Inter',
                                    color: Color(0xFFFFFDF8),
                                    fontSize: 34,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -0.5,
                                  ),
                                ),
                                const SizedBox(height: 24),
                                // BotÃ³n de retiro premium
                                SizedBox(
                                  width: double.infinity,
                                  child: AnimatedOpacity(
                                    opacity: (puedeRetirar || wallet['cuenta_verificada'] != true) ? 1.0 : 0.7,
                                    duration: const Duration(milliseconds: 300),
                                    child: ElevatedButton.icon(
                                      onPressed: puedeRetirar
                                          ? _solicitarRetiro
                                          : (wallet['cuenta_verificada'] != true)
                                              ? () => showDialog(
                                                    context: context,
                                                    builder: (_) => BankAccountFormDialog(onSuccess: _cargarWallet),
                                                  )
                                              : null,
                                      icon: Icon(
                                        (wallet['cuenta_verificada'] != true)
                                            ? Icons.account_balance_wallet_outlined
                                            : Icons.payments_outlined,
                                        size: 18,
                                        color: const Color(0xFF1F1A15),
                                      ),
                                      label: Text(
                                        puedeRetirar
                                            ? (disponible < (double.tryParse(wallet['minimo_retiro_cop']?.toString() ?? '100000') ?? 100000))
                                                ? 'ADELANTO DISPONIBLE DESDE \$${_formatCOP.format(double.tryParse(wallet['minimo_retiro_cop']?.toString() ?? '100000') ?? 100000)}'
                                                : 'TRANSFERIR A ${wallet['banco']?.toString().toUpperCase() ?? 'MI CUENTA'}'
                                            : (wallet['cuenta_verificada'] != true)
                                                ? 'VINCULAR CUENTA DE RETIRO'
                                                : razonBloqueo ?? 'RETIRO NO DISPONIBLE',
                                        style: const TextStyle(
                                          fontFamily: 'Inter',
                                          fontWeight: FontWeight.bold,
                                          fontSize: 12.5,
                                          letterSpacing: 0.6,
                                          color: Color(0xFF1F1A15),
                                        ),
                                      ),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(0xFFFAF6EE),
                                        side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                                        elevation: 2,
                                        padding: const EdgeInsets.symmetric(vertical: 14),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(16),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // Marca de agua de GlowApp
                          const Positioned(
                            right: -10,
                            bottom: -15,
                            child: Opacity(
                              opacity: 0.05,
                              child: Text(
                                'Glow',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 72,
                                  fontWeight: FontWeight.w900,
                                  fontStyle: FontStyle.italic,
                                  letterSpacing: -2,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                  // Tarjetas de saldos secundarios (Matte Terracotta para retenciones)
                  Row(
                    children: [
                      // Tarjeta en camino (Terracota Mate)
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                          decoration: BoxDecoration(
                            gradient: AppTheme.terracottaMatteGradient,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: AppTheme.softShadow,
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.schedule, color: Colors.white, size: 20),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('En custodia', style: TextStyle(color: Colors.white70, fontSize: 11)),
                                    const SizedBox(height: 2),
                                    Text(
                                      _formatCOP.format(pendiente),
                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Tarjeta en disputa (Matte Terracota desaturado / Crimson)
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                          decoration: BoxDecoration(
                            color: AppTheme.error,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: AppTheme.softShadow,
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.gavel, color: Colors.white, size: 20),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('En disputa', style: TextStyle(color: Colors.white70, fontSize: 11)),
                                    const SizedBox(height: 2),
                                    Text(
                                      _formatCOP.format(enDisputa),
                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (!puedeRetirar && wallet['proxima_fecha_retiro'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Center(
                        child: Text(
                          'PrÃ³ximo retiro automÃ¡tico: ${DateFormat('dd MMM, hh:mm a', 'es').format(DateTime.parse(wallet['proxima_fecha_retiro']))}',
                          style: TextStyle(
                              color: AppTheme.text, fontSize: 12, fontWeight: FontWeight.w500),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // â”€â”€â”€ Tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabDelegate(
              TabBar(
                controller: _tabController,
                labelColor: AppTheme.primary,
                unselectedLabelColor: const Color(0xFF8E7D7A),
                indicatorColor: AppTheme.primary,
                tabs: const [
                  Tab(text: 'Movimientos'),
                  Tab(text: 'Retiros'),
                  Tab(text: 'Resumen'),
                ],
              ),
            ),
          ),

          // â”€â”€â”€ Contenido de tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          SliverFillRemaining(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildMovimientos(),
                _buildRetirosTab(),
                _buildResumen(),
              ],
            ),
          ),
        ],
      ),
    ),
  ),
);
  }

  void _mostrarDetalleTransaccion(BuildContext context, Map<String, dynamic> tx) {
    HapticFeedback.lightImpact();
    final tipo = (tx['tipo'] ?? '').toString();
    final esCredito = tipo.startsWith('CREDITO') ||
        tipo == 'LIBERACION_DISPUTA' ||
        tipo == 'BONO_CANCELACION';
    final monto = double.tryParse(tx['monto'].toString()) ?? 0;
    final fecha = tx['created_at'] != null
        ? DateFormat('dd MMMM yyyy, hh:mm a', 'es')
            .format(DateTime.parse(tx['created_at']))
        : 'Reciente';
    final refId = tx['referencia'] ?? tx['id']?.toString() ?? 'GLOW-TX-${(tx.hashCode % 900000) + 100000}';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        decoration: const BoxDecoration(
          color: Color(0xFF1F1A15),
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: Color(0xFFC5A052).withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: esCredito ? Color(0xFF10B981).withValues(alpha: 0.15) : Color(0xFFC5A052).withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    esCredito ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
                    color: esCredito ? const Color(0xFF10B981) : const Color(0xFFC5A052),
                    size: 24,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        esCredito ? 'Ingreso Acreditado' : 'DÃ©bito / Retiro',
                        style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFFFFDF8),
                        ),
                      ),
                      Text(
                        fecha,
                        style: const TextStyle(
                          color: Color(0xFFC5B8A8),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: const Color(0xFF261E17),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Color(0xFFC5A052).withValues(alpha: 0.3)),
              ),
              child: Column(
                children: [
                  const Text(
                    'Monto Total de OperaciÃ³n',
                    style: TextStyle(color: Color(0xFFC5B8A8), fontSize: 12),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${esCredito ? '+' : '-'}${_formatCOP.format(monto)}',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: esCredito ? const Color(0xFF10B981) : const Color(0xFFFFFDF8),
                    ),
                  ),
                  if (tx['servicio_nombre'] != null) ...[
                    const SizedBox(height: 12),
                    const Divider(color: Color(0xFF382E25)),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Servicio', style: TextStyle(color: Color(0xFFC5B8A8), fontSize: 13)),
                        Text(
                          tx['servicio_nombre'].toString(),
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            InkWell(
              onTap: () {
                HapticFeedback.lightImpact();
                Clipboard.setData(ClipboardData(text: refId.toString()));
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('ðŸ“‹ ID de Referencia copiado al portapapeles'),
                    backgroundColor: Color(0xFFC5A052),
                    duration: Duration(seconds: 2),
                  ),
                );
              },
              borderRadius: BorderRadius.circular(14),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Color(0xFFC5A052).withValues(alpha: 0.2)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.tag, size: 18, color: Color(0xFFC5A052)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('ID DE REFERENCIA', style: TextStyle(color: Color(0xFFC5B8A8), fontSize: 10, letterSpacing: 0.8)),
                          Text(
                            refId.toString(),
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.copy_rounded, size: 18, color: Color(0xFFC5A052)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMovimientos() {
    if (_loadingTx) {
      return Center(
          child: CircularProgressIndicator(color: AppTheme.primary));
    }
    if (_transacciones.isEmpty) {
      return const Center(
        child: Text('Sin movimientos aÃºn',
            style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 14)),
      );
    }

    final filtrados = _transacciones.where((tx) {
      final tipo = (tx['tipo'] ?? '').toString();
      final esCredito = tipo.startsWith('CREDITO') ||
          tipo == 'LIBERACION_DISPUTA' ||
          tipo == 'BONO_CANCELACION';
      if (_filtroTipo == 'INGRESOS') return esCredito;
      if (_filtroTipo == 'DEBITOS') return !esCredito;
      return true;
    }).toList();

    int itemCount = filtrados.length;
    if (_filtroTipo == 'TODOS' && (_hasMore || _loadingMore)) {
      itemCount++;
    }

    return Column(
      children: [
        // â”€â”€â”€ Filter Pills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              _buildFilterChip('TODOS', 'Todos'),
              const SizedBox(width: 8),
              _buildFilterChip('INGRESOS', 'Ingresos (+)'),
              const SizedBox(width: 8),
              _buildFilterChip('DEBITOS', 'Retiros (-)'),
            ],
          ),
        ),
        Expanded(
          child: filtrados.isEmpty
              ? const Center(
                  child: Text('No hay movimientos en esta categorÃ­a',
                      style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 13)),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: itemCount,
                  itemBuilder: (ctx, i) {
                    if (i == filtrados.length) {
                      if (_loadingMore) {
                        return Padding(
                          padding: EdgeInsets.all(16.0),
                          child: Center(
                              child: CircularProgressIndicator(color: AppTheme.primary)),
                        );
                      }
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8.0),
                        child: OutlinedButton(
                          onPressed: () => _cargarTransacciones(loadMore: true),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: AppTheme.primary),
                            foregroundColor: AppTheme.primary,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                          child: const Text('Cargar mÃ¡s movimientos',
                              style: TextStyle(fontSize: 14)),
                        ),
                      );
                    }
                    final tx = filtrados[i];
                    return _TransaccionTile(
                      tx: tx,
                      onTap: () => _mostrarDetalleTransaccion(context, tx),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildFilterChip(String key, String label) {
    final selected = _filtroTipo == key;
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        setState(() {
          _filtroTipo = key;
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFC5A052) : const Color(0xFFFAF6EE),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? const Color(0xFFC5A052) : const Color(0xFFE8DFD8),
            width: 1,
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: Color(0xFFC5A052).withValues(alpha: 0.25),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: 'Inter',
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
            color: selected ? const Color(0xFF1F1A15) : const Color(0xFF8E7D7A),
          ),
        ),
      ),
    );
  }

  Widget _buildRetirosTab() {
    final retiros =
        _transacciones.where((tx) => tx['tipo'] == 'DEBITO_RETIRO').toList();
    if (_loadingTx) {
      return Center(
          child: CircularProgressIndicator(color: AppTheme.primary));
    }
    if (retiros.isEmpty) {
      return const Center(
        child: Text(
          'Sin retiros aÃºn',
          style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 14),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: retiros.length,
      itemBuilder: (ctx, i) {
        final tx = retiros[i];
        final monto = double.tryParse(tx['monto'].toString()) ?? 0;
        final fecha = tx['created_at'] != null
            ? DateFormat('dd MMM, hh:mm a', 'es')
                .format(DateTime.parse(tx['created_at']))
            : '';
        final estadoRaw = (tx['estado'] ?? '').toString().toUpperCase();

        int currentStep = 1; // 1: Solicitado, 2: Procesando, 3: Acreditado
        String estadoTexto = 'Solicitado';
        Color estadoColor = const Color(0xFFC5A052);
        if (estadoRaw == 'COMPLETADO' || estadoRaw == 'ACREDITADO') {
          estadoTexto = 'Acreditado';
          estadoColor = const Color(0xFF10B981);
          currentStep = 3;
        } else if (estadoRaw == 'PENDIENTE' || estadoRaw == 'PROCESANDO') {
          estadoTexto = 'En Proceso Bancario';
          estadoColor = Colors.blue;
          currentStep = 2;
        }

        return Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
            border: Border.all(color: const Color(0xFFF7ECE9)),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: estadoColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(Icons.account_balance_wallet_outlined,
                        color: estadoColor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Solicitud de Retiro',
                          style: TextStyle(
                              color: Color(0xFF1F1A15),
                              fontWeight: FontWeight.bold,
                              fontSize: 14),
                        ),
                        const SizedBox(height: 2),
                        Text(fecha,
                            style: const TextStyle(
                                color: Color(0xFF8E7D7A), fontSize: 12)),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '-${_formatCOP.format(monto)}',
                        style: const TextStyle(
                          color: Color(0xFF1F1A15),
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: estadoColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          estadoTexto,
                          style: TextStyle(
                            color: estadoColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 14),
              // â”€â”€â”€ Visual Mini Stepper (Solicitado -> Procesando -> Acreditado) â”€â”€â”€
              Row(
                children: [
                  _buildStepperNode(1, 'Solicitado', currentStep >= 1),
                  _buildStepperLine(currentStep >= 2),
                  _buildStepperNode(2, 'Procesando', currentStep >= 2),
                  _buildStepperLine(currentStep >= 3),
                  _buildStepperNode(3, 'Acreditado', currentStep >= 3),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStepperNode(int step, String label, bool active) {
    final color = active ? const Color(0xFF10B981) : const Color(0xFFD4C7BC);
    return Expanded(
      child: Column(
        children: [
          Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(
              color: active ? color : Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: color, width: 2),
            ),
            child: active
                ? const Icon(Icons.check, size: 12, color: Colors.white)
                : null,
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: active ? FontWeight.bold : FontWeight.w400,
              color: active ? const Color(0xFF1F1A15) : const Color(0xFF8E7D7A),
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildStepperLine(bool active) {
    return Container(
      width: 24,
      height: 2,
      margin: const EdgeInsets.only(bottom: 16),
      color: active ? const Color(0xFF10B981) : const Color(0xFFE8DFD8),
    );
  }

  Widget _buildResumen() {
    final wallet = _wallet!;
    final totalGanado = double.tryParse(wallet['total_ganado'].toString()) ?? 0;
    final totalRetirado =
        double.tryParse(wallet['total_retirado'].toString()) ?? 0;
    final modelo = wallet['modelo_retiro'] ?? 'SEMANAL';

    final ratioRetiro = totalGanado > 0 ? (totalRetirado / totalGanado).clamp(0.0, 1.0) : 0.0;
    // Sin ganancias no hay ratio: mostrar 0% sugerirÃ­a que retirÃ³ cero de algo
    // que no existe (divisiÃ³n por cero disfrazada).
    final porcentajeRetiroStr =
        totalGanado > 0 ? '${(ratioRetiro * 100).toStringAsFixed(0)}%' : 'Sin retiros';

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        // â”€â”€â”€ Tarjeta Ratio de Liquidez Concierge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF261E17), Color(0xFF15100C)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Color(0xFFC5A052).withValues(alpha: 0.4)),
            boxShadow: [
              BoxShadow(
                color: Color(0xFFC5A052).withValues(alpha: 0.12),
                blurRadius: 14,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.analytics_outlined, color: Color(0xFFC5A052), size: 20),
                  const SizedBox(width: 8),
                  const Text(
                    'Retirado sobre ganado',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      color: Color(0xFFFFFDF8),
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    porcentajeRetiroStr,
                    style: const TextStyle(
                      color: Color(0xFFC5A052),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: ratioRetiro,
                  minHeight: 8,
                  backgroundColor: const Color(0xFF382E25),
                  color: const Color(0xFFC5A052),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Retirado: ${_formatCOP.format(totalRetirado)}',
                    style: const TextStyle(color: Color(0xFFC5B8A8), fontSize: 11),
                  ),
                  Text(
                    'Total: ${_formatCOP.format(totalGanado)}',
                    style: const TextStyle(color: Color(0xFFC5B8A8), fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _ResumenCard(
          titulo: 'Total ganado historico',
          monto: totalGanado,
          icon: Icons.trending_up,
          color: const Color(0xFF10B981),
        ),
        const SizedBox(height: 12),
        _ResumenCard(
          titulo: 'Total retirado',
          monto: totalRetirado,
          icon: Icons.arrow_upward,
          color: AppTheme.primary,
        ),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFF7ECE9)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.03),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Modelo de retiro',
                style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 13),
              ),
              const SizedBox(height: 8),
              Text(
                _nombreModelo(modelo),
                style: const TextStyle(
                  color: Color(0xFF4A3E3D),
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _descripcionModelo(modelo),
                style: const TextStyle(color: Color(0xFF8E7D7A), fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (wallet['cuenta_verificada'] == true)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Color(0xFF10B981).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: Color(0xFF10B981).withValues(alpha: 0.25)),
            ),
            child: Row(
              children: [
                const Icon(Icons.verified, color: Color(0xFF10B981)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Cuenta verificada',
                          style: TextStyle(
                              color: Color(0xFF4A3E3D),
                              fontWeight: FontWeight.bold,
                              fontSize: 13)),
                      Text(
                        '${wallet['banco'] ?? ''} ****${wallet['numero_cuenta'].toString().length > 4 ? wallet['numero_cuenta'].toString().substring(wallet['numero_cuenta'].toString().length - 4) : ''}',
                        style: const TextStyle(
                            color: Color(0xFF8E7D7A), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                TextButton.icon(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (_) => BankAccountFormDialog(onSuccess: _cargarWallet),
                    );
                  },
                  icon: const Icon(Icons.edit_outlined, size: 16, color: Color(0xFF10B981)),
                  label: const Text('Cambiar', style: TextStyle(color: Color(0xFF10B981), fontSize: 12)),
                ),
              ],
            ),
          )
        else
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Color(0xFFF59E0B).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: Color(0xFFF59E0B).withValues(alpha: 0.25)),
            ),
            child: Row(
              children: [
                const Icon(Icons.account_balance_wallet_outlined, color: Color(0xFFF59E0B)),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Cuenta no vinculada',
                          style: TextStyle(
                              color: Color(0xFF4A3E3D),
                              fontWeight: FontWeight.bold,
                              fontSize: 13)),
                      Text(
                        'Vincula tu cuenta bancaria o Nequi para habilitar retiros',
                        style: TextStyle(
                            color: Color(0xFF8E7D7A), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                ElevatedButton(
                  onPressed: () {
                    showDialog(
                      context: context,
                      builder: (_) => BankAccountFormDialog(onSuccess: _cargarWallet),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF59E0B),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  child: const Text('Vincular'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _nombreModelo(String modelo) {
    switch (modelo) {
      case 'SEMANAL':
        return 'Semanal';
      case 'QUINCENA':
        return 'AutomÃ¡tico cada 15 dÃ­as';
      case 'MENSUAL':
        return 'AutomÃ¡tico mensual';
      case 'DEMANDA':
        return 'Adelanto inmediato';
      default:
        return 'Semanal';
    }
  }

  String _descripcionModelo(String modelo) {
    switch (modelo) {
      case 'SEMANAL':
        return 'Retira cada lunes, sin costo';
      case 'QUINCENA':
        return 'Retiro automÃ¡tico los dÃ­as 15 y Ãºltimo del mes';
      case 'MENSUAL':
        return 'Retiro automÃ¡tico el Ãºltimo dÃ­a de cada mes';
      case 'DEMANDA':
        return 'Adelanta tu saldo maduro: cuesta 1.849 + 0,4%';
      default:
        return 'Retira cada lunes, sin costo';
    }
  }

  Future<void> _mostrarConfigRetiro() async {
    final wallet = _wallet;
    if (wallet == null) return;

    String modeloSeleccionado = wallet['modelo_retiro'] ?? 'SEMANAL';

    await showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Modelo de retiro',
                  style: TextStyle(
                      color: Color(0xFF4A3E3D),
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),
              ...[
                ('SEMANAL', 'Semanal', 'Cada lunes, sin costo'),
                (
                  'QUINCENA',
                  'Cada 15 dÃ­as',
                  'AutomÃ¡tico los dÃ­as 15 y Ãºltimo del mes'
                ),
                ('MENSUAL', 'Mensual', 'AutomÃ¡tico el Ãºltimo dÃ­a del mes'),
                ('DEMANDA', 'Adelanto inmediato', 'Desde \$100.000, cuesta 1.849 + 0,4%'),
              ].map((m) => RadioListTile<String>(
                    value: m.$1,
                    groupValue: modeloSeleccionado,
                    activeColor: AppTheme.primary,
                    title: Text(m.$2,
                        style: const TextStyle(color: Color(0xFF4A3E3D))),
                    subtitle: Text(m.$3,
                        style: const TextStyle(
                            color: Color(0xFF8E7D7A), fontSize: 12)),
                    onChanged: (v) =>
                        setModalState(() => modeloSeleccionado = v!),
                  )),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () async {
                    Navigator.pop(ctx);
                    try {
                      await ApiService.put(
                          '/api/wallet/model', {'modelo': modeloSeleccionado});
                      _cargarWallet();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Modelo actualizado'),
                              backgroundColor: Color(0xFF10B981)),
                        );
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red),
                        );
                      }
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Guardar',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 14)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// â”€â”€â”€ WIDGETS AUXILIARES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _TransaccionTile extends StatelessWidget {
  final Map<String, dynamic> tx;
  final VoidCallback? onTap;
  const _TransaccionTile({required this.tx, this.onTap});

  @override
  Widget build(BuildContext context) {
    final tipo = tx['tipo'] as String;
    final esCredito = tipo.startsWith('CREDITO') ||
        tipo == 'LIBERACION_DISPUTA' ||
        tipo == 'BONO_CANCELACION';
    final monto = double.tryParse(tx['monto'].toString()) ?? 0;
    final fecha = tx['created_at'] != null
        ? DateFormat('dd MMM, hh:mm a', 'es')
            .format(DateTime.parse(tx['created_at']))
        : '';

    final (icono, color, titulo) = switch (tipo) {
      'CREDITO_SERVICIO' => (
          Icons.arrow_downward,
          const Color(0xFF10B981),
          'Servicio completado'
        ),
      'DEBITO_RETIRO' => (
          Icons.arrow_upward,
          AppTheme.primary,
          'Retiro'
        ),
      'RETENCION_DISPUTA' => (Icons.gavel, Colors.orange, 'Fondos retenidos'),
      'LIBERACION_DISPUTA' => (
          Icons.check_circle,
          const Color(0xFF10B981),
          'Disputa resuelta'
        ),
      'BONO_CANCELACION' => (Icons.card_giftcard, Colors.blue, 'Bono recibido'),
      'AJUSTE_ADMIN' => (Icons.tune, Colors.grey, 'Ajuste administrativo'),
      _ => (Icons.swap_horiz, Colors.grey, tipo),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
              border: Border.all(color: const Color(0xFFF7ECE9)),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icono, color: color, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(titulo,
                          style: const TextStyle(
                              color: Color(0xFF4A3E3D),
                              fontWeight: FontWeight.w600,
                              fontSize: 14)),
                      if (tx['servicio_nombre'] != null)
                        Text(tx['servicio_nombre'],
                            style: const TextStyle(
                                color: Color(0xFF8E7D7A), fontSize: 12)),
                      Text(fecha,
                          style: const TextStyle(
                              color: Color(0xFF8E7D7A), fontSize: 12)),
                    ],
                  ),
                ),
                Text(
                  '${esCredito ? '+' : '-'}${NumberFormat.currency(locale: 'es_CO', symbol: '\$', decimalDigits: 0).format(monto)}',
                  style: TextStyle(
                    color:
                        esCredito ? Color(0xFF10B981) : AppTheme.primary,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
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

class _ResumenCard extends StatelessWidget {
  final String titulo;
  final double monto;
  final IconData icon;
  final Color color;

  const _ResumenCard(
      {required this.titulo,
      required this.monto,
      required this.icon,
      required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(titulo,
                  style:
                      const TextStyle(color: Color(0xFF8E7D7A), fontSize: 13)),
              Text(
                NumberFormat.currency(
                        locale: 'es_CO', symbol: '\$', decimalDigits: 0)
                    .format(monto),
                style: TextStyle(
                    color: color, fontSize: 22, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// â”€â”€â”€ BOTTOM SHEET RETIRO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class _RetiroBottomSheet extends StatefulWidget {
  final double disponible;
  final double minimo;
  final TextEditingController montoCtrl;
  final String cuenta;

  const _RetiroBottomSheet({
    required this.disponible,
    required this.minimo,
    required this.montoCtrl,
    required this.cuenta,
  });

  @override
  State<_RetiroBottomSheet> createState() => _RetiroBottomSheetState();
}

class _RetiroBottomSheetState extends State<_RetiroBottomSheet> {
  void _setPercent(double percent) {
    HapticFeedback.lightImpact();
    final amount = (widget.disponible * percent).floor();
    setState(() {
      widget.montoCtrl.text = amount.toString();
    });
  }

  Widget _buildPercentButton(double percent, String label) {
    return ElevatedButton(
      onPressed: () => _setPercent(percent),
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFFF7ECE9),
        foregroundColor: AppTheme.primary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFFE8D7D3)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      child: Text(label,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
              child: Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2)),
          )),
          const SizedBox(height: 20),
          const Text('Solicitar retiro',
              style: TextStyle(
                  color: Color(0xFF4A3E3D),
                  fontSize: 20,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(
              'Disponible: ${NumberFormat.currency(locale: 'es_CO', symbol: '\$', decimalDigits: 0).format(widget.disponible)}',
              style: const TextStyle(color: Color(0xFF8E7D7A), fontSize: 14)),
          const SizedBox(height: 16),
          // Quick selector buttons
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildPercentButton(0.25, '25%'),
              _buildPercentButton(0.50, '50%'),
              _buildPercentButton(1.0, '100%'),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: widget.montoCtrl,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: const TextStyle(
                color: Color(0xFF4A3E3D),
                fontSize: 24,
                fontWeight: FontWeight.bold),
            decoration: InputDecoration(
              prefixText: '\$ ',
              prefixStyle: TextStyle(
                  color: AppTheme.primary,
                  fontSize: 24,
                  fontWeight: FontWeight.bold),
              // El ciclo semanal no tiene mÃ­nimo; solo el adelanto lo tiene.
              helperText: widget.minimo > 0
                  ? 'MÃ­nimo: ${NumberFormat.currency(locale: 'es_CO', symbol: '\$', decimalDigits: 0).format(widget.minimo)}'
                  : 'Sin mÃ­nimo. Retiras lo que tengas madurado.',
              helperStyle:
                  const TextStyle(color: Color(0xFF8E7D7A), fontSize: 12),
              filled: true,
              fillColor: const Color(0xFFFAF5F4),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF5F4),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFF7ECE9)),
            ),
            child: Row(
              children: [
                Icon(Icons.account_balance,
                    color: AppTheme.primary, size: 18),
                const SizedBox(width: 10),
                Text(widget.cuenta,
                    style: const TextStyle(
                        color: Color(0xFF4A3E3D), fontSize: 14)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'â± El dinero llegarÃ¡ en 1-2 dÃ­as hÃ¡biles. La plataforma asume el costo de transferencia.',
            style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 12),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Confirmar retiro',
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 16)),
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar',
                  style: TextStyle(color: Color(0xFF8E7D7A), fontSize: 14)),
            ),
          ),
        ],
      ),
    );
  }
}

// â”€â”€â”€ TAB DELEGATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class _TabDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  const _TabDelegate(this.tabBar);

  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  double get maxExtent => tabBar.preferredSize.height;
  @override
  bool shouldRebuild(covariant _TabDelegate oldDelegate) => false;

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: Colors.white,
      child: tabBar,
    );
  }
}
