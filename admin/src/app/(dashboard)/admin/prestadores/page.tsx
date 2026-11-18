'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import {
  Receipt,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  SlidersHorizontal,
  HelpCircle,
  FileText,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  UserCheck,
  UserX,
  X,
  Save,
} from 'lucide-react';

/**
 * Prestadores · IVA — responsabilidad de tributación de IVA de cada prestador.
 *
 * Fase 4 del plan de captura de la responsabilidad de IVA (hallazgo W13 de
 * .hermes/REVISAR.md). El prestador declara su condición desde la app (el código
 * de responsabilidades de su RUT: 48 = responsable, 49 = no responsable), y esta
 * vista es la del admin: quién declaró, quién no, y quién tiene un override
 * manual auditado (D1).
 *
 * Los contadores de la cabecera son un CENSO (vienen del backend sobre todos los
 * prestadores), no un recuento de lo filtrado: por eso no cambian al filtrar.
 *
 * NUEVA PESTAÑA "Revisión RUT": cola de prestadores con RUT pendiente de revisión.
 * Permite ver el documento, aprobar (activa cuenta) o rechazar (notifica correcciones).
 */

interface PrestadorFiscal {
  id: number;
  nombre: string;
  email: string;
  rut_numero: string | null;
  rut_responsabilidad_codigo: number | null;
  responsable_iva: boolean;
  override: boolean | null;
  fuente: string | null;
  actualizada_at: string | null;
  cambiada_por: number | null;
  cambiada_por_nombre: string | null;
  estado: 'SIN_DECLARAR' | 'DECLARADA' | 'MANUAL';
  // Campos de revisión (D-GL-030)
  revision_estado: 'SIN_ENVIAR' | 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  revision_nota: string | null;
  soporte_url: string | null;
  cargado_at: string | null;
  revisado_por: number | null;
  revisado_por_nombre: string | null;
  revisado_at: string | null;
}

interface Resumen {
  total_prestadores: number;
  declarados: number;
  sin_declarar: number;
  override: number;
  revision: {
    sin_enviar: number;
    pendiente: number;
    aprobada: number;
    rechazada: number;
  };
}

type FiltroEstado = 'todos' | 'sin_declarar' | 'declarado' | 'override';
type FiltroRevision = 'todas' | 'sin_enviar' | 'pendiente' | 'aprobada' | 'rechazada';
type Pestaña = 'iva' | 'revision';

const FILTROS_ESTADO: { id: FiltroEstado; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'sin_declarar', label: 'Sin declarar' },
  { id: 'declarado', label: 'Declarados' },
  { id: 'override', label: 'Override manual' },
];

const FILTROS_REVISION: { id: FiltroRevision; label: string; icon: React.ReactNode }[] = [
  { id: 'todas', label: 'Todas', icon: <FileText className="w-4 h-4" /> },
  { id: 'pendiente', label: 'Pendientes', icon: <AlertCircle className="w-4 h-4 text-amber-400" /> },
  { id: 'aprobada', label: 'Aprobadas', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
  { id: 'rechazada', label: 'Rechazadas', icon: <XCircle className="w-4 h-4 text-rose-400" /> },
  { id: 'sin_enviar', label: 'Sin enviar', icon: <HelpCircle className="w-4 h-4 text-[#6c655b]" /> },
];

const TABS: { id: Pestaña; label: string; icon: React.ReactNode }[] = [
  { id: 'iva', label: 'Responsabilidad IVA', icon: <Receipt className="w-5 h-5" /> },
  { id: 'revision', label: 'Revisión RUT', icon: <FileText className="w-5 h-5" /> },
];

export default function AdminPrestadoresIvaPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [pestañaActiva, setPestañaActiva] = useState<Pestaña>('iva');
  const [prestadores, setPrestadores] = useState<PrestadorFiscal[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');
  const [filtroRevision, setFiltroRevision] = useState<FiltroRevision>('pendiente');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fuenteDisponible, setFuenteDisponible] = useState(false);
  const [correccion, setCorreccion] = useState<PrestadorFiscal | null>(null);
  const [valorCorreccion, setValorCorreccion] = useState<boolean | null>(null);
  const [motivoCorreccion, setMotivoCorreccion] = useState('');
  const [guardandoCorreccion, setGuardandoCorreccion] = useState(false);

  // Modal para ver documento
  const [docModal, setDocModal] = useState<{ url: string; nombre: string; tipo: 'image' | 'pdf' } | null>(null);

  // Modal para rechazar (requiere nota)
  const [rechazarModal, setRechazarModal] = useState<{ prestador: PrestadorFiscal | null; nota: string }>({
    prestador: null,
    nota: '',
  });

  // Estados de acción (loading por prestador)
  const [accionLoading, setAccionLoading] = useState<Record<number, 'aprobar' | 'rechazar' | null>>({});

  // RBAC
  useEffect(() => {
    if (!loading && (!user || user.rol !== 'ADMIN')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (pestañaActiva === 'iva') {
      params.set('estado', filtroEstado);
    } else {
      params.set('revision', filtroRevision);
    }
    return `/api/admin/providers/fiscal?${params.toString()}`;
  }, [pestañaActiva, filtroEstado, filtroRevision]);

  const fetchDatos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || `El backend respondió ${res.status}.`);
        setPrestadores([]);
        setFuenteDisponible(false);
      } else {
        if (!Array.isArray(data.prestadores)) throw new Error('Respuesta inválida del listado de prestadores.');
        setPrestadores(data.prestadores);
        setResumen(data.resumen || null);
        setFuenteDisponible(true);
      }
    } catch {
      setError('No se pudo conectar con el backend.');
      setPrestadores([]);
      setFuenteDisponible(false);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const abrirCorreccion = (prestador: PrestadorFiscal) => {
    setCorreccion(prestador);
    setValorCorreccion(prestador.responsable_iva);
    setMotivoCorreccion('');
  };

  const guardarCorreccion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!correccion || valorCorreccion === null) return;

    setGuardandoCorreccion(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/providers/${correccion.id}/fiscal/correction`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ responsable_iva: valorCorreccion, motivo: motivoCorreccion.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || `El backend respondió ${res.status}.`);
        return;
      }

      setCorreccion(null);
      await fetchDatos();
    } catch {
      setError('No se pudo guardar la corrección.');
    } finally {
      setGuardandoCorreccion(false);
    }
  };

  useEffect(() => {
    fetchDatos();
  }, [fetchDatos]);

  const fmtFecha = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO');
  };

  const codigoLabel = (codigo: number | null) => {
    if (codigo === 48) return '48 · Responsable de IVA';
    if (codigo === 49) return '49 · No responsable';
    return '—';
  };

  const badgeEstado = (p: PrestadorFiscal) => {
      if (p.estado === 'MANUAL') {
        return { clase: 'bg-sky-500/10 border-sky-500/30 text-sky-700', label: 'Override manual', icon: <SlidersHorizontal className="w-3 h-3" /> };
      }
      if (p.estado === 'DECLARADA') {
        return {
          clase: p.responsable_iva
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700'
            : 'bg-slate-500/10 border-slate-500/30 text-[#514b42]',
          label: p.responsable_iva ? 'Declarado · responsable' : 'Declarado · no responsable',
          icon: p.responsable_iva ? <CheckCircle className="w-3 h-3" /> : <SlidersHorizontal className="w-3 h-3" />,
        };
      }
      return { clase: 'bg-amber-500/10 border-amber-500/30 text-amber-700', label: 'Sin declarar', icon: <HelpCircle className="w-3 h-3" /> };
    };

  const badgeRevision = (estado: string) => {
    switch (estado) {
      case 'PENDIENTE':
        return { clase: 'bg-amber-500/10 border-amber-500/40 text-amber-700', label: 'Pendiente', icon: <AlertCircle className="w-3 h-3" /> };
      case 'APROBADA':
        return { clase: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700', label: 'Aprobada', icon: <CheckCircle2 className="w-3 h-3" /> };
      case 'RECHAZADA':
        return { clase: 'bg-rose-500/10 border-rose-500/40 text-rose-700', label: 'Rechazada', icon: <XCircle className="w-3 h-3" /> };
      default:
        return { clase: 'bg-slate-500/10 border-slate-500/40 text-[#514b42]', label: 'Sin enviar', icon: <HelpCircle className="w-3 h-3" /> };
    }
  };

  const detectarTipoDocumento = (url: string | null): 'image' | 'pdf' => {
    if (!url) return 'image';
    if (url.startsWith('data:application/pdf')) return 'pdf';
    if (url.startsWith('data:image/')) return 'image';
    return 'image';
  };

  const abrirDocumento = (p: PrestadorFiscal) => {
    if (!p.soporte_url) return;
    const tipo = detectarTipoDocumento(p.soporte_url);
    setDocModal({ url: p.soporte_url, nombre: p.nombre, tipo });
  };

  const cerrarDocModal = () => setDocModal(null);

  const abrirRechazarModal = (p: PrestadorFiscal) => {
    setRechazarModal({ prestador: p, nota: '' });
  };

  const cerrarRechazarModal = () => setRechazarModal({ prestador: null, nota: '' });

  const ejecutarAccion = async (prestadorId: number, accion: 'APROBAR' | 'RECHAZAR', nota?: string) => {
    setAccionLoading(prev => ({ ...prev, [prestadorId]: accion.toLowerCase() as 'aprobar' | 'rechazar' }));
    try {
      const res = await fetch(`/api/admin/providers/${prestadorId}/fiscal/revision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ accion, nota: accion === 'RECHAZAR' ? nota : undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.detalle || data?.error || `Error ${res.status}`);
      }
      // Refrescar lista
      fetchDatos();
      if (accion === 'RECHAZAR') cerrarRechazarModal();
    } catch (e: any) {
      alert(e.message || 'Error al procesar la acción');
    } finally {
      setAccionLoading(prev => ({ ...prev, [prestadorId]: null }));
    }
  };

  const handleAprobar = (p: PrestadorFiscal) => {
    if (window.confirm(`¿Aprobar el RUT de ${p.nombre}?\n\nEsto activará su cuenta y podrá publicar servicios.`)) {
      ejecutarAccion(p.id, 'APROBAR');
    }
  };

  const handleRechazarConfirm = () => {
    if (!rechazarModal.prestador || !rechazarModal.nota.trim()) {
      alert('Debe ingresar el motivo del rechazo');
      return;
    }
    ejecutarAccion(rechazarModal.prestador.id, 'RECHAZAR', rechazarModal.nota.trim());
  };

  // Determinar si mostrar botones de acción
  const puedeAccion = (p: PrestadorFiscal) => p.revision_estado === 'PENDIENTE';

  const indicadores = pestañaActiva === 'iva'
    ? [
        { etiqueta: 'Prestadores', valor: resumen?.total_prestadores ?? '—', detalle: 'En el sistema', color: 'text-[#27231d]', icono: <Receipt className="h-5 w-5" />, filtro: 'todos' as FiltroEstado },
        { etiqueta: 'Sin declarar', valor: resumen?.sin_declarar ?? '—', detalle: 'Requieren información fiscal', color: 'text-amber-700', icono: <AlertTriangle className="h-5 w-5" />, filtro: 'sin_declarar' as FiltroEstado },
        { etiqueta: 'Declarados', valor: resumen?.declarados ?? '—', detalle: 'Condición registrada desde el RUT', color: 'text-emerald-700', icono: <CheckCircle className="h-5 w-5" />, filtro: 'declarado' as FiltroEstado },
        { etiqueta: 'Correcciones humanas', valor: resumen?.override ?? '—', detalle: 'Revisadas por el equipo', color: 'text-sky-700', icono: <SlidersHorizontal className="h-5 w-5" />, filtro: 'override' as FiltroEstado },
      ]
    : [
        { etiqueta: 'Pendientes', valor: resumen?.revision.pendiente ?? 0, detalle: 'Esperan revisión del equipo', color: 'text-amber-700', icono: <AlertCircle className="h-5 w-5" />, filtro: 'pendiente' as FiltroRevision },
        { etiqueta: 'Aprobadas', valor: resumen?.revision.aprobada ?? 0, detalle: 'Cuenta habilitada', color: 'text-emerald-700', icono: <CheckCircle2 className="h-5 w-5" />, filtro: 'aprobada' as FiltroRevision },
        { etiqueta: 'Rechazadas', valor: resumen?.revision.rechazada ?? 0, detalle: 'Pueden corregir y reenviar', color: 'text-rose-700', icono: <XCircle className="h-5 w-5" />, filtro: 'rechazada' as FiltroRevision },
        { etiqueta: 'Sin enviar', valor: resumen?.revision.sin_enviar ?? 0, detalle: 'Aún no adjuntan su RUT', color: 'text-[#514b42]', icono: <HelpCircle className="h-5 w-5" />, filtro: 'sin_enviar' as FiltroRevision },
      ];

  return (
    <div className="min-h-screen bg-[#f7f5f0] text-[#27231d] p-8 space-y-8">
      {/* Encabezado y navegación del espacio de cumplimiento */}
      <section className="space-y-6">
        <div className="flex flex-col gap-5 border-b border-[#e5dfd3] pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              GlowAdmin <span className="text-[#928b7e]">/</span> Cumplimiento
            </div>
            <div className="flex items-center gap-3">
              {TABS.find(t => t.id === pestañaActiva)?.icon}
              <h1 className="text-3xl font-bold tracking-tight text-[#27231d]">
                {pestañaActiva === 'iva' ? 'Responsabilidad de IVA' : 'Revisión de documentos RUT'}
              </h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c655b]">
              {pestañaActiva === 'iva'
                ? 'Consulta la condición fiscal declarada y registra una corrección cuando la evidencia revisada lo justifique.'
                : 'Organiza los documentos pendientes y registra la decisión del revisor para cada prestador.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-xl border border-[#e5dfd3] bg-white p-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setPestañaActiva(tab.id)}
                  aria-pressed={pestañaActiva === tab.id}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                    pestañaActiva === tab.id
                      ? 'bg-amber-300 text-[#27231d] shadow-sm'
                      : 'text-[#6c655b] hover:bg-[#f1eee7] hover:text-[#27231d]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              onClick={fetchDatos}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-xl border border-[#e5dfd3] bg-white px-4 py-2.5 text-sm font-medium text-[#514b42] transition hover:bg-[#f1eee7] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Indicadores resumidos y accionables */}
        {resumen && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {indicadores.map((indicador, index) => {
              const seleccionado = pestañaActiva === 'iva'
                ? filtroEstado === indicador.filtro
                : filtroRevision === indicador.filtro;
              return (
                <button
                  key={indicador.etiqueta}
                  type="button"
                  onClick={() => pestañaActiva === 'iva'
                    ? setFiltroEstado(indicador.filtro as FiltroEstado)
                    : setFiltroRevision(indicador.filtro as FiltroRevision)}
                  aria-pressed={seleccionado}
                  className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:border-[#cfc6b8] hover:bg-white ${
                    seleccionado ? 'border-amber-300/50 bg-white' : 'border-[#e5dfd3] bg-white'
                  }`}
                >
                  <span className={`absolute inset-y-0 left-0 w-1 ${[
                    'bg-slate-500', 'bg-amber-400', 'bg-emerald-400', 'bg-sky-400',
                  ][index]}`} />
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-[#6c655b]">{indicador.etiqueta}</span>
                    <span className={indicador.color}>{indicador.icono}</span>
                  </span>
                  <span className={`mt-4 block text-3xl font-bold tracking-tight ${indicador.color}`}>
                    {loading ? '—' : indicador.valor}
                  </span>
                  <span className="mt-1 block text-xs text-[#777064]">{indicador.detalle}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </span>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-[#27231d]" aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      {/* Navegación de resultados */}
      <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white">
        <div className="flex flex-col gap-4 border-b border-[#e5dfd3] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-[#27231d]">{pestañaActiva === 'iva' ? 'Listado fiscal' : 'Cola de revisión'}</h2>
            <p className="mt-1 text-xs text-[#777064]">{pestañaActiva === 'iva' ? 'Filtra por el origen de la condición o por correcciones del equipo.' : 'Elige un estado para enfocar la revisión.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pestañaActiva === 'iva' ? (
              FILTROS_ESTADO.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFiltroEstado(f.id)}
                  aria-pressed={filtroEstado === f.id}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    filtroEstado === f.id
                      ? 'border-amber-300/50 bg-amber-300/10 text-amber-800'
                      : 'border-[#e5dfd3] bg-[#f7f5f0] text-[#6c655b] hover:border-[#cfc6b8] hover:text-[#27231d]'
                  }`}
                >
                  {f.label}
                </button>
              ))
            ) : (
              FILTROS_REVISION.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFiltroRevision(f.id)}
                  aria-pressed={filtroRevision === f.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    filtroRevision === f.id
                      ? 'border-amber-300/50 bg-amber-300/10 text-amber-800'
                      : 'border-[#e5dfd3] bg-[#f7f5f0] text-[#6c655b] hover:border-[#cfc6b8] hover:text-[#27231d]'
                  }`}
                >
                  {f.icon}
                  {f.label}
                  {resumen && f.id !== 'todas' && (
                    <span className="rounded-full bg-[#f1eee7] px-1.5 py-0.5 text-[10px] text-[#514b42]">
                      {resumen.revision[f.id as keyof typeof resumen.revision] ?? 0}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      {/* Tabla */}
      <div className="bg-white border border-[#e5dfd3] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f1eee7] text-[#6c655b] text-xs uppercase tracking-wider">
              <tr>
                {pestañaActiva === 'iva' ? (
                  <>
                    <th className="text-left px-6 py-3">Prestador</th>
                    <th className="text-left px-6 py-3">RUT</th>
                    <th className="text-left px-6 py-3">Casilla del RUT</th>
                    <th className="text-left px-6 py-3">Responsable IVA</th>
                    <th className="text-left px-6 py-3">Estado</th>
                    <th className="text-left px-6 py-3">Actualizado</th>
                    <th className="text-left px-6 py-3">Origen</th>
                  </>
                ) : (
                  <>
                    <th className="text-left px-6 py-3">Prestador</th>
                    <th className="text-left px-6 py-3">RUT</th>
                    <th className="text-left px-6 py-3">Casilla</th>
                    <th className="text-left px-6 py-3">Documento</th>
                    <th className="text-left px-6 py-3">Estado revisión</th>
                    <th className="text-left px-6 py-3">Cargado</th>
                    <th className="text-left px-6 py-3 w-48">Acciones</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-[#777064]">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-rose-500 mb-2" />
                    Cargando…
                  </td>
                </tr>
              )}

              {!loading && !fuenteDisponible && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-[#777064]">
                    No se pudo consultar la fuente de prestadores.
                  </td>
                </tr>
              )}

              {!loading && fuenteDisponible && prestadores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-[#777064]">
                    {pestañaActiva === 'revision' && filtroRevision === 'pendiente'
                      ? '¡No hay RUTs pendientes de revisión!'
                      : 'No hay prestadores en este filtro.'}
                  </td>
                </tr>
              )}

              {!loading && prestadores.map(p => {
                const b = pestañaActiva === 'iva' ? badgeEstado(p) : badgeRevision(p.revision_estado || 'SIN_ENVIAR');
                const enAccion = accionLoading[p.id];
                return (
                  <tr key={p.id} className="border-t border-[#e5dfd3] hover:bg-[#f7f5f0]">
                    <td className="px-6 py-4">
                      <p className="text-[#27231d] font-medium">{p.nombre}</p>
                      <p className="text-[#777064] text-xs">{p.email}</p>
                    </td>
                    <td className="px-6 py-4 text-[#514b42] font-mono text-xs">{p.rut_numero || '—'}</td>
                    <td className="px-6 py-4 text-[#6c655b]">{codigoLabel(p.rut_responsabilidad_codigo)}</td>

                    {pestañaActiva === 'iva' ? (
                      <>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className={p.responsable_iva ? 'text-emerald-700' : 'text-[#6c655b]'}>
                              {p.responsable_iva ? 'Sí' : 'No'}
                            </span>
                            <button
                              type="button"
                              onClick={() => abrirCorreccion(p)}
                              className="rounded-lg border border-sky-500/30 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-500/10"
                            >
                              {p.fuente === 'MANUAL' ? 'Editar corrección' : 'Corregir'}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full border text-xs font-medium ${b.clase}`}>
                            {b.icon && <span className="inline-flex items-center">{b.icon}</span>}
                            {b.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#6c655b] text-xs">{fmtFecha(p.actualizada_at)}</td>
                        <td className="px-6 py-4 text-[#6c655b] text-xs">
                          {p.fuente === 'MANUAL' ? (
                            <>
                              Manual
                              {p.cambiada_por_nombre ? (
                                <span className="text-[#777064]"> · {p.cambiada_por_nombre}</span>
                              ) : p.cambiada_por ? (
                                <span className="text-[#777064]"> · admin #{p.cambiada_por}</span>
                              ) : null}
                            </>
                          ) : p.fuente === 'RUT' ? (
                            'RUT'
                          ) : (
                            '—'
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4">
                          {p.soporte_url ? (
                            <button
                              onClick={() => abrirDocumento(p)}
                              className="flex items-center gap-2 px-3 py-1.5 bg-[#f1eee7] hover:bg-[#e9e4da] rounded-lg text-[#514b42] text-xs font-medium transition-all"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver {detectarTipoDocumento(p.soporte_url) === 'pdf' ? 'PDF' : 'Imagen'}
                            </button>
                          ) : (
                            <span className="text-[#777064] text-xs italic">Sin documento</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${b.clase}`}>
                            {b.icon}
                            {b.label}
                          </span>
                          {p.revision_nota && (
                            <p className="text-[#777064] text-xs mt-1 line-clamp-1" title={p.revision_nota}>
                              Nota: {p.revision_nota}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-[#6c655b] text-xs">{fmtFecha(p.cargado_at)}</td>
                        <td className="px-6 py-4">
                          {puedeAccion(p) ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleAprobar(p)}
                                disabled={enAccion === 'aprobar'}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                              >
                                {enAccion === 'aprobar' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <UserCheck className="w-3.5 h-3.5" />
                                )}
                                Aprobar
                              </button>
                              <button
                                onClick={() => abrirRechazarModal(p)}
                                disabled={enAccion === 'rechazar'}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-700 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                              >
                                {enAccion === 'rechazar' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <UserX className="w-3.5 h-3.5" />
                                )}
                                Rechazar
                              </button>
                            </div>
                          ) : p.revision_estado === 'APROBADA' ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 text-xs font-medium rounded-lg">
                              <UserCheck className="w-3.5 h-3.5" />
                              Cuenta activada
                            </span>
                          ) : p.revision_estado === 'RECHAZADA' ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 text-xs font-medium rounded-lg">
                              <UserX className="w-3.5 h-3.5" />
                              Rechazado · puede reenviar
                            </span>
                          ) : (
                            <span className="text-[#777064] text-xs italic">Esperando envío</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </section>

      {/* Modal Ver Documento */}
      {docModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cerrarDocModal}>
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#e5dfd3]">
              <h3 className="text-lg font-semibold text-[#27231d]">{docModal.nombre} · RUT</h3>
              <button onClick={cerrarDocModal} className="p-2 hover:bg-[#f1eee7] rounded-lg text-[#6c655b] hover:text-[#27231d]">
                ✕
              </button>
            </div>
            <div className="p-4 max-h-[calc(90vh-80px)] overflow-auto">
              {docModal.tipo === 'pdf' ? (
                <iframe
                  src={docModal.url}
                  className="w-full h-[70vh] border-0 rounded-lg"
                  title="RUT PDF"
                />
              ) : (
                <img
                  src={docModal.url}
                  alt={`RUT de ${docModal.nombre}`}
                  className="max-w-full max-h-[70vh] mx-auto block rounded-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Rechazar */}
      {rechazarModal.prestador && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cerrarRechazarModal}>
          <div className="relative w-full max-w-md bg-white rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#e5dfd3]">
              <h3 className="text-lg font-semibold text-[#27231d]">Rechazar RUT</h3>
              <button onClick={cerrarRechazarModal} className="p-2 hover:bg-[#f1eee7] rounded-lg text-[#6c655b] hover:text-[#27231d]">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-[#514b42]">
                Motivo del rechazo para <strong className="text-[#27231d]">{rechazarModal.prestador.nombre}</strong>:
              </p>
              <textarea
                value={rechazarModal.nota}
                onChange={e => setRechazarModal(prev => ({ ...prev, nota: e.target.value }))}
                placeholder="Ej: El RUT está vencido / ilegible / no corresponde al prestador / código incorrecto..."
                className="w-full min-h-[100px] px-4 py-3 bg-[#f1eee7] border border-[#e5dfd3] rounded-xl text-[#27231d] placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 resize-y"
                rows={4}
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={cerrarRechazarModal}
                  className="px-4 py-2 bg-[#f1eee7] hover:bg-[#e9e4da] rounded-xl text-[#514b42] font-medium transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRechazarConfirm}
                  disabled={accionLoading[rechazarModal.prestador.id] === 'rechazar'}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-700 font-medium rounded-xl transition-all disabled:opacity-50"
                >
                  {accionLoading[rechazarModal.prestador.id] === 'rechazar' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserX className="w-4 h-4" />
                  )}
                  Rechazar y notificar
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {correccion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={guardarCorreccion}
            className="w-full max-w-xl space-y-5 rounded-2xl border border-[#e5dfd3] bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fiscal-correction-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="fiscal-correction-title" className="text-xl font-bold text-[#27231d]">Corregir responsabilidad de IVA</h2>
                <p className="mt-1 text-sm text-[#6c655b]">{correccion.nombre} · RUT {correccion.rut_numero || 'sin registrar'}</p>
              </div>
              <button
                type="button"
                onClick={() => setCorreccion(null)}
                disabled={guardandoCorreccion}
                className="rounded-lg p-2 text-[#6c655b] hover:bg-[#f1eee7] hover:text-[#27231d]"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-[#514b42]">
              Casilla declarada: <strong className="text-[#27231d]">{codigoLabel(correccion.rut_responsabilidad_codigo)}</strong>.
              La corrección cambia el valor aplicado y conserva la declaración original del RUT.
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-[#514b42]">Criterio del revisor</legend>
              {[{ value: false, label: 'No es responsable de IVA' }, { value: true, label: 'Sí es responsable de IVA' }].map((opcion) => (
                <label key={String(opcion.value)} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e5dfd3] p-3 text-sm text-[#514b42] hover:bg-[#f1eee7]">
                  <input
                    type="radio"
                    name="responsable_iva"
                    checked={valorCorreccion === opcion.value}
                    onChange={() => setValorCorreccion(opcion.value)}
                    className="accent-sky-400"
                  />
                  {opcion.label}
                </label>
              ))}
            </fieldset>

            <label className="block space-y-2 text-sm font-semibold text-[#514b42]">
              Motivo de la corrección
              <textarea
                value={motivoCorreccion}
                onChange={(event) => setMotivoCorreccion(event.target.value)}
                minLength={10}
                maxLength={500}
                required
                rows={3}
                placeholder="Describe qué evidencia revisaste y por qué ajustas el resultado."
                className="w-full rounded-xl border border-[#e5dfd3] bg-[#f7f5f0] p-3 font-normal text-[#27231d] outline-none focus:border-sky-500"
              />
              <span className="block text-xs font-normal text-[#777064]">El motivo y el cambio quedarán en la bitácora de auditoría.</span>
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 border-t border-[#e5dfd3] pt-4">
              <button
                type="button"
                onClick={() => setCorreccion(null)}
                disabled={guardandoCorreccion}
                className="rounded-xl border border-[#e5dfd3] px-4 py-2 text-sm text-[#514b42] hover:bg-[#f1eee7]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardandoCorreccion || valorCorreccion === null || motivoCorreccion.trim().length < 10}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-[#27231d] hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {guardandoCorreccion ? 'Guardando…' : 'Guardar corrección'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
