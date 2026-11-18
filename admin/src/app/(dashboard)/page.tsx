'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { 
  TrendingUp, 
  Users, 
  ShieldAlert, 
  DollarSign, 
  Activity, 
  Percent,
  Bell,
  FileText,
  ExternalLink,
  Clock,
  Calendar,
  RefreshCw,
  ShoppingBag,
  GraduationCap,
  Receipt,
  Wallet,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { useAdminSession } from '@/hooks/useAdminSession';
import { formatMinutos, prioridadesPorRiesgo, type PqrsfMetricas } from '@/lib/metricasPqrsf';

interface FinancialMetrics {
  gmv: number;
  total_commission: number;
  total_taxes: number;
  platform_gross_income: number;
  total_provider_payouts: number;
  total_bookings: number;
}

interface DailyHistoryPoint {
  date: string;
  gmv: number;
  income: number;
}

interface CategoryPoint {
  category: string;
  booking_count: number;
  total_revenue: number;
  color: string;
}

interface SosAlert {
  id: number;
  client_name?: string | null;
  client_phone?: string | null;
  provider_name?: string | null;
  provider_phone?: string | null;
  latitude: string | number;
  longitude: string | number;
  fecha_creacion?: string | null;
}

interface PendingProvider {
  id: number;
  nombre: string;
  email: string;
  business_name?: string | null;
  description?: string | null;
  documento_id_url?: string | null;
  rut_url?: string | null;
  certificacion_url?: string | null;
  estatus_verificacion?: string | null;
}

const CATEGORY_COLORS = ['#f43f5e', '#ec4899', '#a855f7', '#6366f1', '#0ea5e9', '#f59e0b'];

function formatCOPSafe(val: number | null | undefined) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return 'Sin datos';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0
  }).format(Number(val));
}

type AdminJsonResult = { ok: true; body: unknown } | { ok: false };

async function fetchAdminJson(path: string, signal: AbortSignal): Promise<AdminJsonResult> {
  try {
    const response = await fetch(path, {
      signal,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return { ok: false };
    return { ok: true, body: await response.json() as unknown };
  } catch {
    return { ok: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFinancialMetrics(value: unknown): FinancialMetrics | null {
  const record = asRecord(value);
  if (!record) return null;
  const fields = [
    'gmv',
    'total_commission',
    'total_taxes',
    'platform_gross_income',
    'total_provider_payouts',
    'total_bookings',
  ] as const;
  const values = fields.map((field) => asFiniteNumber(record[field]));
  if (values.some((metric) => metric === null)) return null;
  return Object.fromEntries(fields.map((field, index) => [field, values[index]])) as unknown as FinancialMetrics;
}

function parseDailyHistory(value: unknown): DailyHistoryPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: DailyHistoryPoint[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const gmv = asFiniteNumber(row?.gmv);
    const income = asFiniteNumber(row?.income);
    if (!row || typeof row.date !== 'string' || gmv === null || income === null) return null;
    points.push({ date: row.date, gmv, income });
  }
  return points;
}

function parseCategoryData(value: unknown): Array<Omit<CategoryPoint, 'color'>> | null {
  if (!Array.isArray(value)) return null;
  const points: Array<Omit<CategoryPoint, 'color'>> = [];
  for (const item of value) {
    const row = asRecord(item);
    const count = asFiniteNumber(row?.booking_count);
    const revenue = asFiniteNumber(row?.total_revenue);
    if (!row || typeof row.category !== 'string' || count === null || revenue === null) return null;
    points.push({ category: row.category, booking_count: count, total_revenue: revenue });
  }
  return points;
}

function isPqrsfMetricas(value: unknown): value is PqrsfMetricas {
  const record = asRecord(value);
  const arco = asRecord(record?.arco);
  return Boolean(
    record &&
    asFiniteNumber(record.total) !== null &&
    asFiniteNumber(record.abiertos) !== null &&
    asFiniteNumber(record.vencidos) !== null &&
    asFiniteNumber(record.sin_respuesta) !== null &&
    Array.isArray(record.por_estado) &&
    Array.isArray(record.por_prioridad) &&
    arco &&
    asFiniteNumber(arco.plazo_dias_habiles) !== null &&
    typeof arco.festivos_incluidos === 'boolean' &&
    Array.isArray(arco.abiertas)
  );
}

export default function DashboardPage() {
  const { user, loading: sessionLoading, refetch: refetchSession } = useAdminSession();
  const [loading, setLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState('Comprobando conexión...');
  const [metrics, setMetrics] = useState<FinancialMetrics | null>(null);
  const [dailyHistory, setDailyHistory] = useState<DailyHistoryPoint[]>([]);
  const [categoryData, setCategoryData] = useState<CategoryPoint[]>([]);
  const [sosAlerts, setSosAlerts] = useState<SosAlert[] | null>(null);
  const [pendingProviders, setPendingProviders] = useState<PendingProvider[] | null>(null);
  const [pqrsfMetricas, setPqrsfMetricas] = useState<PqrsfMetricas | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [failedSections, setFailedSections] = useState<string[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDashboardData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (!user) {
      setBackendStatus('Sin sesión de administrador');
      setDataError('No hay sesión de administrador activa. Inicia sesión con una cuenta ADMIN para ver datos reales.');
      setMetrics(null);
      setDailyHistory([]);
      setCategoryData([]);
      setSosAlerts(null);
      setPendingProviders(null);
      setPqrsfMetricas(null);
      setFailedSections(['financial', 'sos', 'kyc', 'pqrsf']);
      setLoading(false);
      return;
    }

    setLoading(true);
    setDataError(null);
    try {
      // Cada fuente queda aislada: una falla no borra los resultados de las demás.
      const [summary, sos, providers, pqrsf] = await Promise.all([
        fetchAdminJson('/api/glow-admin/dashboard/financial-summary', signal),
        fetchAdminJson('/api/glow-admin/sos/active', signal),
        fetchAdminJson('/api/glow-admin/provider/pending', signal),
        fetchAdminJson('/api/admin/tickets/metricas', signal),
      ]);

      // Check if aborted
      if (signal.aborted) return;

      const failures: string[] = [];

      if (summary.ok) {
        const payload = asRecord(summary.body);
        const data = asRecord(payload?.data);
        const consolidated = parseFinancialMetrics(data?.consolidated);
        const history = parseDailyHistory(data?.dailyHistory);
        const categories = parseCategoryData(data?.categoryPopularity);
        if (consolidated && history && categories) {
          setMetrics(consolidated);
          setDailyHistory(history);
          setCategoryData(categories.map((category, i) => ({
            ...category,
            color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          })));
        } else {
          setMetrics(null);
          setDailyHistory([]);
          setCategoryData([]);
          failures.push('financial');
        }
      } else {
        setMetrics(null);
        setDailyHistory([]);
        setCategoryData([]);
        failures.push('financial');
      }

      if (signal.aborted) return;

      if (sos.ok) {
        const alerts = asRecord(sos.body)?.data;
        setSosAlerts(Array.isArray(alerts) ? alerts : null);
        if (!Array.isArray(alerts)) failures.push('sos');
      } else {
        setSosAlerts(null);
        failures.push('sos');
      }

      if (signal.aborted) return;

      if (providers.ok) {
        const pending = asRecord(providers.body)?.data;
        setPendingProviders(Array.isArray(pending) ? pending : null);
        if (!Array.isArray(pending)) failures.push('kyc');
      } else {
        setPendingProviders(null);
        failures.push('kyc');
      }

      if (signal.aborted) return;

      if (pqrsf.ok) {
        const metricas = asRecord(pqrsf.body)?.data;
        setPqrsfMetricas(isPqrsfMetricas(metricas) ? metricas : null);
        if (!isPqrsfMetricas(metricas)) failures.push('pqrsf');
      } else {
        setPqrsfMetricas(null);
        failures.push('pqrsf');
      }

      if (signal.aborted) return;

      setFailedSections(failures);
      setBackendStatus(failures.length ? `Parcial: ${failures.join(', ')} fallaron` : 'Conectado');
    } catch (err) {
      if (signal.aborted) return;
      console.error('[Dashboard] error inesperado:', err);
      setDataError('No fue posible completar la consulta de algunas fuentes.');
      setBackendStatus('Consulta parcial');
    } finally {
      if (!signal.aborted) {
        setLastCheckedAt(new Date());
        setLoading(false);
      }
    }
  }, [user]);

  // Retry handler for session errors
  const handleRetry = useCallback(async () => {
    await refetchSession();
    if (!sessionLoading) {
      fetchDashboardData();
    }
  }, [refetchSession, sessionLoading, fetchDashboardData]);

  useEffect(() => {
    if (!sessionLoading && user) {
      fetchDashboardData();
    }
    
    if (!sessionLoading && !user) {
      // Session check complete, no user - don't start polling
      setLoading(false);
      return;
    }

    // Start polling only when we have a valid session
    if (user) {
      intervalRef.current = setInterval(fetchDashboardData, 60000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [user, sessionLoading, fetchDashboardData]);

  // KPI cards
  const kpis = [
    { title: 'Valor bruto reportado', value: loading ? 'Cargando...' : formatCOPSafe(metrics?.gmv), sub: 'Reservas completadas en el modelo histórico', icon: DollarSign, color: 'gold' },
    { title: 'Comisión histórica', value: loading ? 'Cargando...' : formatCOPSafe(metrics?.total_commission), sub: 'Cálculo legacy; no es ingreso conciliado', icon: Percent, color: 'rose' },
    { title: 'Impuestos reportados', value: loading ? 'Cargando...' : formatCOPSafe(metrics?.total_taxes), sub: 'Clasificación y valor pendientes de validación', icon: Activity, color: 'warning' },
    { title: 'Dispersión reportada', value: loading ? 'Cargando...' : formatCOPSafe(metrics?.total_provider_payouts), sub: 'El agregado no confirma transferencias realizadas', icon: Users, color: 'info' },
  ];

  // PQRSF (F5): las cifras del módulo de atención al usuario.
  const pqrsfKpis = [
    { title: 'PQRSF Totales', value: loading ? 'Cargando...' : String(pqrsfMetricas?.total ?? 'No disponible'), sub: 'Solicitudes históricas', icon: FileText, color: 'gold' },
    { title: 'PQRSF Abiertos', value: loading ? 'Cargando...' : String(pqrsfMetricas?.abiertos ?? 'No disponible'), sub: 'Sin resolver ni cerrar', icon: Activity, color: 'info' },
    { title: 'Fuera de plazo', value: loading ? 'Cargando...' : String(pqrsfMetricas?.vencidos ?? 'No disponible'), sub: 'Sin primera respuesta a tiempo', icon: Clock, color: 'warning' },
    { title: 'Sin primera respuesta', value: loading ? 'Cargando...' : String(pqrsfMetricas?.sin_respuesta ?? 'No disponible'), sub: 'Nadie los ha contestado', icon: Bell, color: 'rose' },
  ];
  const pqrsfSinLectura = failedSections.includes('pqrsf') || pqrsfMetricas === null;
  const mensajeSinPQRSF = pqrsfSinLectura
    ? 'Métricas de PQRSF no disponibles.'
    : 'La fuente no reportó registros para esta vista.';

  const estadoFuente = (section: string, hasPayload = true) => {
    if (loading) return 'Consultando';
    if (!user || failedSections.includes(section) || !hasPayload) return 'No disponible';
    return 'Fuente consultada';
  };

  const cobertura360 = [
    {
      title: 'Servicios y reservas',
      icon: Calendar,
      status: estadoFuente('financial', metrics !== null),
      detail: metrics
        ? `${metrics.total_bookings} reservas en el agregado histórico; no muestra el ciclo operativo completo ni una conciliación de pagos.`
        : 'No hay una respuesta utilizable del resumen histórico de reservas.',
      source: 'Resumen financiero legacy',
      href: null,
    },
    {
      title: 'Alertas SOS',
      icon: ShieldAlert,
      status: estadoFuente('sos', sosAlerts !== null),
      detail: sosAlerts === null ? 'No hay una lectura válida de la fuente SOS.' : sosAlerts.length === 0 ? '0 alertas activas en la consulta recibida.' : `${sosAlerts.length} alertas activas requieren seguimiento.`,
      source: 'Bandeja SOS',
      href: '/admin/sos',
    },
    {
      title: 'PQRSF',
      icon: FileText,
      status: estadoFuente('pqrsf', pqrsfMetricas !== null),
      detail: pqrsfMetricas === null ? 'No hay una lectura válida de métricas de soporte.' : `${pqrsfMetricas.abiertos} solicitudes abiertas; ${pqrsfMetricas.vencidos} fuera de plazo.`,
      source: 'Métricas y bandeja PQRSF',
      href: '/admin/pqrsf',
    },
    {
      title: 'Revisión de prestadores',
      icon: Users,
      status: estadoFuente('kyc', pendingProviders !== null),
      detail: pendingProviders === null ? 'No hay una lectura válida de la cola de revisión.' : pendingProviders.length === 0 ? '0 prestadores pendientes en la consulta recibida.' : `${pendingProviders.length} prestadores pendientes de revisión.`,
      source: 'Cola de verificación',
      href: '/admin/prestadores',
    },
    {
      title: 'Pagos, comisión y retiros',
      icon: Wallet,
      status: 'Pendiente de conciliación',
      detail: 'El panel aún no separa cobro confirmado, comisión, costos de pasarela, saldo y dispersión conciliada.',
      source: 'Wompi + ledger por integrar',
      href: null,
    },
    {
      title: 'Tienda e inventario',
      icon: ShoppingBag,
      status: 'Módulo existente; resumen pendiente',
      detail: 'Pedidos y catálogo tienen pantallas propias; su estado y stock aún no se consolidan en esta portada.',
      source: 'Pedidos y productos',
      href: '/admin/store/orders',
    },
    {
      title: 'Suscripciones y SaaS',
      icon: Activity,
      status: 'Sin resumen 360°',
      detail: 'Glow IA+ y SaaS de salones deben aparecer como productos y ciclos de cobro separados.',
      source: 'Facturación y entitlements por integrar',
      href: null,
    },
    {
      title: 'Academia y convenios',
      icon: GraduationCap,
      status: 'Módulo existente; resumen pendiente',
      detail: 'La portada no consolida cupos, cierres de inscripción ni giros según convenio.',
      source: 'Academia Glow',
      href: '/admin/academia',
    },
    {
      title: 'Clasificación tributaria',
      icon: Receipt,
      status: 'Pendiente de consolidación',
      detail: 'La aprobación tributaria por categoría y el estado pendiente del perfil aún no se muestran aquí.',
      source: 'Prestadores · IVA',
      href: '/admin/prestadores',
    },
  ];

  const esFuenteDisponible = (status: string) => status === 'Fuente consultada' || status === 'Fuentes parciales';

  return (
    <div className="space-y-8">
      <section className="card" aria-labelledby="dashboard-overview-title">
        <div className="card-content flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="caption uppercase tracking-wider">Control administrativo · GlowApp</p>
            <h1 id="dashboard-overview-title" className="text-2xl font-semibold text-primary">Vista general 360°</h1>
            <p className="body-sm text-muted mt-1">Cobertura actual de las líneas de negocio y disponibilidad de las fuentes conectadas.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="caption text-muted" aria-live="polite">
              {lastCheckedAt
                ? `Última consulta: ${lastCheckedAt.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })} · Colombia`
                : 'Consulta aún no realizada'}
            </span>
            <button type="button" onClick={fetchDashboardData} disabled={loading || sessionLoading || !user} className="btn btn-secondary btn-sm" aria-label="Actualizar vista general">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              Actualizar
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="coverage-title" className="space-y-3">
        <div>
          <h2 id="coverage-title" className="text-lg font-semibold text-primary">Cobertura de operación</h2>
          <p className="body-sm text-muted">“No disponible” significa que la consulta no tiene una fuente o respuesta válida; no equivale a cero actividad.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cobertura360.map((item) => {
            const Icon = item.icon;
            const content = (
              <div className="card h-full transition-fast hover:border-brand-gold-border">
                <div className="card-content space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="kpi-icon gold"><Icon size={20} aria-hidden="true" /></span>
                      <h3 className="body-sm font-semibold text-primary">{item.title}</h3>
                    </div>
                    {item.href && <ExternalLink size={16} className="text-muted shrink-0" aria-hidden="true" />}
                  </div>
                  <p className={`caption font-semibold ${esFuenteDisponible(item.status) ? 'text-success' : item.status === 'No disponible' ? 'text-danger' : 'text-warning'}`}>
                    {item.status}
                  </p>
                  <p className="body-sm text-muted">{item.detail}</p>
                  <p className="micro text-muted">Fuente: {item.source}</p>
                </div>
              </div>
            );
            return item.href ? (
              <Link key={item.title} href={item.href} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-gold-border" aria-label={`Abrir módulo: ${item.title}`}>
                {content}
              </Link>
            ) : <div key={item.title}>{content}</div>;
          })}
        </div>
      </section>

      {/* Status Bar */}
      {(dataError || backendStatus === 'Sin sesión de administrador') && (
        <div className="card border-danger bg-danger-bg/50">
          <div className="card-content flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="icon text-danger shrink-0" size={20} />
              <span className="body-sm text-danger">{dataError || backendStatus}</span>
            </div>
            <button
                          onClick={handleRetry}
                          className="btn btn-secondary btn-sm shrink-0"
                        >
                          Reintentar
                        </button>
          </div>
        </div>
      )}

      {/* Estas cifras heredadas no son KPI financieros autorizados para cierre. */}
      <div className="card border-warning bg-warning-bg/40" role="note" aria-label="Advertencia sobre cifras financieras">
        <div className="card-content flex items-start gap-3">
          <ShieldAlert className="icon text-warning shrink-0" size={20} />
          <div>
            <p className="body-sm font-semibold text-warning">Indicadores financieros heredados — no conciliados</p>
            <p className="body-sm text-muted">
              Estas cifras provienen del cálculo actual por reservas y no tienen todavía periodo ni conciliación financiera aprobados. Son referencias operativas; no representan ingreso contable, impuestos definitivos ni pagos confirmados.
            </p>
          </div>
        </div>
      </div>

      {/* Financial KPI Cards */}
      <section className="kpi-grid">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div key={idx} className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">{kpi.title}</span>
                <div className={`kpi-icon ${kpi.color}`}>
                  <Icon size={22} />
                </div>
              </div>
              <p className="kpi-value">{kpi.value}</p>
              <span className="kpi-label">{kpi.sub}</span>
            </div>
          );
        })}
      </section>

      {/* Graphic Charts Analysis */}
      <section className="card-grid">
        {/* 30-Day Area Chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Actividad histórica de reservas</h3>
              <p className="card-subtitle">Serie heredada sin periodo contable ni conciliación; no equivale a facturación o ingreso reconocido</p>
            </div>
          </div>
          <div className="card-content" style={{ height: '320px' }}>
            {dailyHistory.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted">
                {failedSections.includes('financial') ? 'Fuente histórica no disponible.' : 'La fuente no reportó registros para esta serie.'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyHistory}>
                  <defs>
                    <linearGradient id="colorGmv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ec4899" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-modal)', borderColor: 'var(--border-standard)', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="gmv" stroke="#ec4899" strokeWidth={2.5} fillOpacity={1} fill="url(#colorGmv)" name="Valor bruto legacy" />
                  <Area type="monotone" dataKey="income" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#colorIncome)" name="Comisión + impuestos legacy" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bar Category Popularity */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Reservas completadas por categoría</h3>
              <p className="card-subtitle">Conteo y valor bruto histórico; cifras no conciliadas</p>
            </div>
          </div>
          <div className="card-content" style={{ height: '320px' }}>
            {categoryData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted">
                {failedSections.includes('financial') ? 'Fuente de categorías no disponible.' : 'La fuente no reportó registros de categorías.'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis dataKey="category" type="category" stroke="var(--text-muted)" fontSize={11} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-modal)', borderColor: 'var(--border-standard)', borderRadius: '12px' }} />
                  <Bar dataKey="total_revenue" radius={[0, 8, 8, 0]} barSize={20} name="Valor bruto legacy">
                    {categoryData.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* PQRSF (F5): métricas del módulo de atención al usuario */}
      <section className="kpi-grid">
        {pqrsfKpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div key={idx} className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">{kpi.title}</span>
                <div className={`kpi-icon ${kpi.color}`}>
                  <Icon size={22} />
                </div>
              </div>
              <p className="kpi-value">{kpi.value}</p>
              <span className="kpi-label">{kpi.sub}</span>
            </div>
          );
        })}
      </section>

      <section className="card-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">PQRSF por prioridad</h3>
              <p className="card-subtitle">Lo que reporta el backend, ordenado por riesgo real</p>
            </div>
          </div>
          <div className="card-content">
            {!pqrsfMetricas || pqrsfMetricas.por_prioridad.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted">{mensajeSinPQRSF}</div>
            ) : (
              <table className="w-full body-sm">
                <thead>
                  <tr className="text-muted text-left">
                    <th className="py-2">Prioridad</th>
                    <th className="py-2 text-right">Abiertos</th>
                    <th className="py-2 text-right">Sin 1ª respuesta</th>
                    <th className="py-2 text-right">Fuera de plazo</th>
                    <th className="py-2 text-right">1ª respuesta media</th>
                  </tr>
                </thead>
                <tbody>
                  {prioridadesPorRiesgo(pqrsfMetricas.por_prioridad).map((fila) => (
                    <tr key={fila.prioridad} className="border-t border-border-subtle">
                      <td className="py-2 text-primary">{fila.prioridad}</td>
                      <td className="py-2 text-right">{fila.abiertos}</td>
                      <td className="py-2 text-right">{fila.sin_respuesta}</td>
                      <td className={`py-2 text-right ${fila.vencidos > 0 ? 'text-danger' : ''}`}>{fila.vencidos}</td>
                      <td className="py-2 text-right">{formatMinutos(fila.minutos_medio_respuesta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Solicitudes ARCO (plazo legal)</h3>
              <p className="card-subtitle">
                {pqrsfMetricas
                  ? `Plazo de ${pqrsfMetricas.arco.plazo_dias_habiles} días hábiles` +
                    (pqrsfMetricas.arco.festivos_incluidos ? '' : ' — sin festivos en el cálculo')
                  : 'Plazo legal de respuesta'}
              </p>
            </div>
          </div>
          <div className="card-content space-y-3">
            {!pqrsfMetricas || pqrsfMetricas.arco.abiertas.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted">{pqrsfSinLectura ? mensajeSinPQRSF : 'No hay solicitudes ARCO abiertas.'}</div>
            ) : (
              pqrsfMetricas.arco.abiertas.map((solicitud) => (
                <div key={solicitud.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="body-sm text-primary truncate">#{solicitud.id} · {solicitud.asunto || 'Sin asunto'}</p>
                    <p className="micro text-muted">
                      {solicitud.estado} · límite {new Date(solicitud.limite_legal).toLocaleDateString('es-CO')}
                    </p>
                  </div>
                  <span className={`chip chip-sm ${solicitud.vencido_legal ? 'danger' : 'info'} shrink-0`}>
                    {solicitud.vencido_legal ? 'Plazo vencido' : `${solicitud.dias_habiles_restantes} días hábiles`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">PQRSF por estado</h3>
              <p className="card-subtitle">Reparto real de la bandeja</p>
            </div>
          </div>
          <div className="card-content space-y-3">
            {!pqrsfMetricas || pqrsfMetricas.por_estado.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted">{mensajeSinPQRSF}</div>
            ) : (
              pqrsfMetricas.por_estado.map((fila) => (
                <div key={fila.estado} className="flex items-center justify-between">
                  <span className="body-sm text-secondary">{fila.estado}</span>
                  <span className="chip chip-sm info">{fila.total}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="card-grid">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Estado del Sistema</h3>
          </div>
          <div className="card-content space-y-3">
            <div className="flex items-center justify-between">
              <span className="body-sm text-secondary">Backend API</span>
              <span className={`chip chip-sm ${failedSections.includes('financial') ? 'danger' : 'success'}`}>
                {failedSections.includes('financial') || !metrics ? 'No disponible' : backendStatus}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="body-sm text-secondary">Alertas SOS</span>
              <span className={`chip chip-sm ${failedSections.includes('sos') || sosAlerts === null ? 'danger' : 'success'}`}>
                {failedSections.includes('sos') || sosAlerts === null ? 'No disponible' : `${sosAlerts.length} activas`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="body-sm text-secondary">KYC Pendientes</span>
              <span className={`chip chip-sm ${failedSections.includes('kyc') || pendingProviders === null ? 'danger' : 'success'}`}>
                {failedSections.includes('kyc') || pendingProviders === null ? 'No disponible' : `${pendingProviders.length} pendientes`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="body-sm text-secondary">PQRSF</span>
              <span className={`chip chip-sm ${failedSections.includes('pqrsf') || !pqrsfMetricas ? 'danger' : 'success'}`}>
                {failedSections.includes('pqrsf') || !pqrsfMetricas ? 'No disponible' : `${pqrsfMetricas.abiertos} abiertos`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="body-sm text-secondary">Última actualización</span>
              <span className="chip chip-sm info">
                {lastCheckedAt
                  ? lastCheckedAt.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })
                  : 'Sin consulta'}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Accesos Rápidos</h3>
          </div>
          <div className="card-content space-y-2">
            <a href="/admin/business" className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-brand-gold-border hover:bg-bg-surface transition-fast">
              <Bell className="icon text-gold" size={20} />
              <div>
                <p className="body-sm font-medium text-primary">Cumplimiento Business</p>
                <p className="micro text-muted">Verificar estado de negocio</p>
              </div>
            </a>
            <a href="/admin/precios" className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-brand-gold-border hover:bg-bg-surface transition-fast">
              <DollarSign className="icon text-gold" size={20} />
              <div>
                <p className="body-sm font-medium text-primary">Gestión de Precios</p>
                <p className="micro text-muted">Configurar tarifas y comisiones</p>
              </div>
            </a>
            <a href="/admin/productos" className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-brand-gold-border hover:bg-bg-surface transition-fast">
              <TrendingUp className="icon text-gold" size={20} />
              <div>
                <p className="body-sm font-medium text-primary">Catálogo Productos</p>
                <p className="micro text-muted">Gestionar inventario</p>
              </div>
            </a>
            <Link href="/admin/academia" className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-brand-gold-border hover:bg-bg-surface transition-fast">
              <ShieldAlert className="icon text-gold" size={20} />
              <div>
                <p className="body-sm font-medium text-primary">Academia Glow</p>
                <p className="micro text-muted">Contenido educativo</p>
              </div>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
