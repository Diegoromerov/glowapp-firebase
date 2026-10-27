// frontend/lib/screens/salon/salon_shell.dart
// E-03 (D-GL-027) — shell del SaaS de salón.
//
// POR QUÉ EXISTE
// El salón no tenía contenedor: su dashboard vivía en `/salon` con cuatro tabs
// propias (Resumen, Equipo, Servicios, Ajustes) y cada módulo nuevo inventaba su
// entrada. El plan pedía cinco destinos estables y una sola puerta.
//
// DECISIONES QUE MANDA D-GL-027
//  · Sin GoRouter: se reutiliza el `routes:` de `main.dart`. El shell es un
//    widget, no una migración de router.
//  · Caja, Inventario y Analytics NO se construyen aquí (E-05/E-06 y Aura): se
//    muestran como módulos no disponibles, sin cifras inventadas.
//  · Nada de datos falsos: cada tab pinta lo que devuelve la API o su error.
//
// El dashboard previo (SalonDashboardScreen) se conserva accesible en
// `/salon/resumen` desde la pestaña «Más», para no perder Resumen/Ajustes.

import 'package:flutter/material.dart';

import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/design/icons/glow_icon.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/widgets/provider_services_screen.dart';
import 'package:glow_core/widgets/locked_feature_card.dart';
import 'caja_screen.dart';

class SalonShell extends StatefulWidget {
  /// Pestaña inicial (0 = Agenda). Útil para deep-links internos.
  final int initialIndex;

  /// Cuando es `false` ninguna pestaña pide datos. Es el punto de entrada de
  /// los widget tests: sin esto, montar el shell dispara HTTP real.
  final bool cargarDatos;

  /// Capacidades del plan. Si es null se leen de `/api/salon/my-salon`
  /// (E-04). Se puede inyectar para probar el bloqueo por plan sin red.
  final List<String>? entitlements;

  /// Plan vigente, sólo para el texto de la tarjeta de bloqueo.
  final String plan;

  const SalonShell({
    super.key,
    this.initialIndex = 0,
    this.cargarDatos = true,
    this.entitlements,
    this.plan = 'FREE_TRIAL',
  });

  @override
  State<SalonShell> createState() => _SalonShellState();
}

class _SalonShellState extends State<SalonShell> {
  late int _index;
  late bool _cargarDatos;
  late List<String> _entitlements;
  late String _plan;
  int? _salonId;

  /// Construcción perezosa y recordada: no se instancia una pestaña hasta que
  /// se visita, y una vez construida conserva su estado (no hay `IndexedStack`
  /// global porque eso construiría las cinco —y sus peticiones— de golpe).
  final List<Widget?> _construidas = List<Widget?>.filled(5, null);

  static const _destinos = <_Destino>[
    _Destino('Agenda', Icons.calendar_month_outlined, Icons.calendar_month),
    _Destino('Caja', Icons.point_of_sale_outlined, Icons.point_of_sale),
    _Destino('Equipo', Icons.groups_outlined, Icons.groups),
    _Destino('Servicios', Icons.content_cut_outlined, Icons.content_cut),
    _Destino('Más', Icons.more_horiz, Icons.more_horiz),
  ];

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, _destinos.length - 1);
    _cargarDatos = widget.cargarDatos;
    _entitlements = widget.entitlements ?? const <String>[];
    _plan = widget.plan;
    if (widget.entitlements == null && widget.cargarDatos) {
      _cargarPlan();
    }
  }

  /// E-04 (D-GL-027): las capacidades del plan viajan con el salón. Se leen una
  /// sola vez para todo el shell; si la lectura falla, el módulo queda bloqueado
  /// y el backend sigue siendo la compuerta real.
  Future<void> _cargarPlan() async {
    try {
      final res = await AuthService.getMySalon();
      final salon = res?['salon'];
      if (salon is Map) {
        final caps = (salon['entitlements'] as List<dynamic>?) ?? const <dynamic>[];
        if (!mounted) return;
        setState(() {
          _entitlements = caps.map((c) => c.toString()).toList();
          _plan = (salon['plan_saas'] ?? 'FREE_TRIAL').toString();
          _salonId = (salon['id'] as num?)?.toInt() ?? _salonId;
          // Una pestaña ya construida con el plan anterior no debe quedar cacheada.
          _construidas[2] = null;
        });
      }
    } catch (_) {
      // Sin plan conocido no se desbloquea nada.
    }
  }

  bool _tiene(String capacidad) => _entitlements.contains(capacidad);

  Token get _t => Token.of(context);

  @override
  Widget build(BuildContext context) {
    final t = _t;
    return Scaffold(
      backgroundColor: t.surfaceLevel0,
      appBar: AppBar(
        backgroundColor: t.surfaceLevel1,
        foregroundColor: t.textPrimary,
        elevation: 0,
        titleSpacing: Spacing.lg,
        title: Row(
          children: [
            GlowIcon.resolve('store', size: GlowIconSize.sm, color: t.brandPrimary),
            const SizedBox(width: Spacing.sm),
            Text(
              'Mi salón',
              style: TypographyTokens.h3(t).copyWith(fontSize: 17),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Resumen del salón',
            icon: GlowIcon.resolve('dashboard', size: GlowIconSize.sm, color: t.textSecondary),
            onPressed: () => Navigator.pushNamed(context, '/salon/resumen'),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: t.borderSubtle),
        ),
      ),
      body: SafeArea(child: _tabActual()),
      bottomNavigationBar: _buildNav(t),
    );
  }

  Widget _tabActual() => _construidas[_index] ??= _buildTab(_index);

  Widget _buildTab(int i) {
    switch (i) {
      case 0:
        return _AgendaTab(cargar: _cargarDatos);
      case 1:
        if (_salonId == null) return const _CajaTab();
        return CajaScreen(salonId: _salonId!, cargarDatos: _cargarDatos);
      case 2:
        if (!_tiene('TEAM_MANAGEMENT')) {
          return LockedFeatureCard(
            titulo: 'Equipo',
            descripcion: 'Tu plan no incluye la gestión de colaboradores de este salón.',
            capacidadRequerida: 'TEAM_MANAGEMENT',
            planActual: _plan,
            beneficio: 'Invita, cambia roles y da de baja a tu equipo.',
            onMejorarPlan: () => Navigator.pushNamed(context, '/saas/billing'),
          );
        }
        return _EquipoTab(cargar: _cargarDatos);
      case 3:
        return _cargarDatos ? const ProviderServicesScreen() : const _ServiciosPlaceholder();
      default:
        return const _MasTab();
    }
  }

  Widget _buildNav(Token t) {
    return Container(
      decoration: BoxDecoration(
        color: t.surfaceLevel1,
        border: Border(top: BorderSide(color: t.borderSubtle)),
      ),
      child: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        type: BottomNavigationBarType.fixed,
        backgroundColor: t.surfaceLevel1,
        selectedItemColor: t.brandPrimary,
        unselectedItemColor: t.textSecondary,
        selectedFontSize: 11,
        unselectedFontSize: 11,
        elevation: 0,
        items: [
          for (final d in _destinos)
            BottomNavigationBarItem(
              icon: Icon(d.icono, size: 22),
              activeIcon: Icon(d.iconoActivo, size: 22),
              label: d.etiqueta,
            ),
        ],
      ),
    );
  }
}

class _Destino {
  final String etiqueta;
  final IconData icono;
  final IconData iconoActivo;
  const _Destino(this.etiqueta, this.icono, this.iconoActivo);
}

// ── Agenda ───────────────────────────────────────────────────────────────────

class _AgendaTab extends StatefulWidget {
  final bool cargar;
  const _AgendaTab({required this.cargar});

  @override
  State<_AgendaTab> createState() => _AgendaTabState();
}

class _AgendaTabState extends State<_AgendaTab> {
  bool _cargando = true;
  String? _error;
  List<Map<String, dynamic>> _citas = const [];

  @override
  void initState() {
    super.initState();
    if (widget.cargar) {
      _cargar();
    } else {
      _cargando = false;
    }
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final citas = await ApiService.fetchProviderBookings();
      if (!mounted) return;
      setState(() {
        _citas = citas;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo cargar la agenda: $e';
        _cargando = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    if (_cargando) {
      return Center(child: CircularProgressIndicator(color: t.brandPrimary));
    }
    if (_error != null) {
      return _Estado(
        icono: Icons.cloud_off_outlined,
        titulo: 'Agenda no disponible',
        detalle: _error!,
        accion: TextButton(onPressed: _cargar, child: const Text('Reintentar')),
      );
    }
    if (_citas.isEmpty) {
      return const _Estado(
        icono: Icons.event_available_outlined,
        titulo: 'Sin citas por ahora',
        detalle: 'Cuando un cliente reserve, la cita aparece aquí.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(Spacing.lg),
      itemCount: _citas.length,
      separatorBuilder: (_, __) => const SizedBox(height: Spacing.sm),
      itemBuilder: (context, i) {
        final c = _citas[i];
        final servicio = (c['service_name'] ?? c['servicio'] ?? 'Servicio').toString();
        final estado = (c['estado'] ?? '').toString();
        final fecha = (c['scheduled_at'] ?? c['fecha'] ?? '').toString();
        return Container(
          padding: const EdgeInsets.all(Spacing.lg),
          decoration: BoxDecoration(
            color: t.surfaceLevel1,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: t.borderSubtle),
          ),
          child: Row(
            children: [
              GlowIcon.resolve('calendar', size: GlowIconSize.sm, color: t.brandPrimary),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(servicio, style: TypographyTokens.body(t).copyWith(fontWeight: FontWeight.w600)),
                    if (fecha.isNotEmpty)
                      Text(
                        fecha.replaceFirst('T', ' ').split('.').first,
                        style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
                      ),
                  ],
                ),
              ),
              if (estado.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: Spacing.sm, vertical: 2),
                  decoration: BoxDecoration(
                    color: t.brandPrimary.withOpacity(0.10),
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  child: Text(
                    estado,
                    style: TypographyTokens.bodySmall(t).copyWith(
                      color: t.brandPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 11,
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

// ── Caja (E-05) ──────────────────────────────────────────────────────────────

class _CajaTab extends StatelessWidget {
  const _CajaTab();

  @override
  Widget build(BuildContext context) {
    return const _Estado(
      icono: Icons.point_of_sale_outlined,
      titulo: 'Caja sin salón activo',
      detalle: 'Abre el resumen del salón para entrar a la caja. '
          'Sin salón identificado no se muestran cifras.',
    );
  }
}

// ── Equipo ───────────────────────────────────────────────────────────────────

class _EquipoTab extends StatefulWidget {
  final bool cargar;
  const _EquipoTab({required this.cargar});

  @override
  State<_EquipoTab> createState() => _EquipoTabState();
}

class _EquipoTabState extends State<_EquipoTab> {
  bool _cargando = true;
  String? _error;
  List<Map<String, dynamic>> _miembros = const [];

  @override
  void initState() {
    super.initState();
    if (widget.cargar) {
      _cargar();
    } else {
      _cargando = false;
    }
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final res = await AuthService.getMySalon();
      final raw = (res?['members'] as List<dynamic>?) ?? const [];
      if (!mounted) return;
      setState(() {
        _miembros = raw.map((m) => Map<String, dynamic>.from(m as Map)).toList();
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo cargar el equipo: $e';
        _cargando = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    if (_cargando) {
      return Center(child: CircularProgressIndicator(color: t.brandPrimary));
    }
    if (_error != null) {
      return _Estado(
        icono: Icons.cloud_off_outlined,
        titulo: 'Equipo no disponible',
        detalle: _error!,
        accion: TextButton(onPressed: _cargar, child: const Text('Reintentar')),
      );
    }
    if (_miembros.isEmpty) {
      return const _Estado(
        icono: Icons.groups_outlined,
        titulo: 'Todavía no hay equipo',
        detalle: 'Invita a tu primer colaborador desde el resumen del salón.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(Spacing.lg),
      itemCount: _miembros.length,
      separatorBuilder: (_, __) => const SizedBox(height: Spacing.sm),
      itemBuilder: (context, i) {
        final m = _miembros[i];
        final nombre = (m['nombre'] ?? 'Colaborador').toString();
        final rol = (m['sub_rol'] ?? '').toString();
        final estatus = (m['estatus'] ?? '').toString();
        return Container(
          padding: const EdgeInsets.all(Spacing.lg),
          decoration: BoxDecoration(
            color: t.surfaceLevel1,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: t.borderSubtle),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: t.brandPrimary.withOpacity(0.12),
                child: Text(
                  nombre.trim().isEmpty ? '?' : nombre.trim()[0].toUpperCase(),
                  style: TextStyle(color: t.brandPrimary, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(nombre, style: TypographyTokens.body(t).copyWith(fontWeight: FontWeight.w600)),
                    Text(
                      [rol, estatus].where((s) => s.isNotEmpty).join(' · '),
                      style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ── Servicios (placeholder para el test) ─────────────────────────────────────

class _ServiciosPlaceholder extends StatelessWidget {
  const _ServiciosPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const _Estado(
      icono: Icons.content_cut_outlined,
      titulo: 'Catálogo de servicios',
      detalle: 'Se muestra al abrir la pestaña con datos.',
    );
  }
}

// ── Más ──────────────────────────────────────────────────────────────────────

class _MasTab extends StatelessWidget {
  const _MasTab();

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);

    Widget enlace(String titulo, String ruta, {String? detalle}) => Container(
          margin: const EdgeInsets.only(bottom: Spacing.sm),
          decoration: BoxDecoration(
            color: t.surfaceLevel1,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: t.borderSubtle),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(Radii.md),
              onTap: () => Navigator.pushNamed(context, ruta),
              child: Padding(
                padding: const EdgeInsets.all(Spacing.lg),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            titulo,
                            style: TypographyTokens.body(t).copyWith(fontWeight: FontWeight.w600),
                          ),
                          if (detalle != null)
                            Text(
                              detalle,
                              style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
                            ),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right, color: t.textSecondary),
                  ],
                ),
              ),
            ),
          ),
        );

    Widget bloqueado(String titulo, String motivo) => Container(
          margin: const EdgeInsets.only(bottom: Spacing.sm),
          padding: const EdgeInsets.all(Spacing.lg),
          decoration: BoxDecoration(
            color: t.surfaceLevel1,
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: t.borderSubtle),
          ),
          child: Row(
            children: [
              Icon(Icons.lock_outline, size: 18, color: t.textSecondary),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(titulo, style: TypographyTokens.body(t).copyWith(color: t.textSecondary)),
                    Text(motivo, style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(Spacing.lg),
      children: [
        enlace('Resumen del salón', '/salon/resumen', detalle: 'KPIs, equipo y ajustes'),
        enlace('Facturación del plan', '/saas/billing'),
        enlace('Uso del plan', '/saas/usage'),
        enlace('API keys', '/saas/api-keys'),
        enlace('Configuración', '/settings'),
        enlace('Ayuda y soporte', '/support'),
        const SizedBox(height: Spacing.lg),
        Text(
          'No incluido en esta etapa',
          style: TypographyTokens.bodySmall(t).copyWith(
            color: t.textSecondary,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: Spacing.sm),
        bloqueado('Inventario', 'Llega con E-06'),
        bloqueado('Recursos alquilables', 'Llega con E-06'),
        bloqueado('Analytics', 'Se consulta por Aura'),
      ],
    );
  }
}

// ── Estado vacío / error compartido ──────────────────────────────────────────

class _Estado extends StatelessWidget {
  final IconData icono;
  final String titulo;
  final String detalle;
  final Widget? accion;

  const _Estado({
    required this.icono,
    required this.titulo,
    required this.detalle,
    this.accion,
  });

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Spacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icono, size: 40, color: t.textSecondary),
            const SizedBox(height: Spacing.lg),
            Text(
              titulo,
              textAlign: TextAlign.center,
              style: TypographyTokens.h3(t).copyWith(fontSize: 16),
            ),
            const SizedBox(height: Spacing.sm),
            Text(
              detalle,
              textAlign: TextAlign.center,
              style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
            ),
            if (accion != null) ...[const SizedBox(height: Spacing.md), accion!],
          ],
        ),
      ),
    );
  }
}
