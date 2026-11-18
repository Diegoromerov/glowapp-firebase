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
  { id: 'sin_enviar', label: 'Sin enviar', icon: <HelpCircle className="w-4 h-4 text-slate-400" /> },
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
        return { clase: 'bg-sky-500/10 border-sky-500/30 text-sky-300', label: 'Override manual', icon: <SlidersHorizontal className="w-3 h-3" /> };
      }
      if (p.estado === 'DECLARADA') {
        return {
          clase: p.responsable_iva
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-slate-500/10 border-slate-500/30 text-slate-300',
          label: p.responsable_iva ? 'Declarado · responsable' : 'Declarado · no responsable',
          icon: p.responsable_iva ? <CheckCircle className="w-3 h-3" /> : <SlidersHorizontal className="w-3 h-3" />,
        };
      }
      return { clase: 'bg-amber-500/10 border-amber-500/30 text-amber-300', label: 'Sin declarar', icon: <HelpCircle className="w-3 h-3" /> };
    };

  const badgeRevision = (estado: string) => {
    switch (estado) {
      case 'PENDIENTE':
        return { clase: 'bg-amber-500/10 border-amber-500/40 text-amber-300', label: 'Pendiente', icon: <AlertCircle className="w-3 h-3" /> };
      case 'APROBADA':
        return { clase: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300', label: 'Aprobada', icon: <CheckCircle2 className="w-3 h-3" /> };
      case 'RECHAZADA':
        return { clase: 'bg-rose-500/10 border-rose-500/40 text-rose-300', label: 'Rechazada', icon: <XCircle className="w-3 h-3" /> };
      default:
        return { clase: 'bg-slate-500/10 border-slate-500/40 text-slate-300', label: 'Sin enviar', icon: <HelpCircle className="w-3 h-3" /> };
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 space-y-8">
      {/* Header con tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
                      {(() => {
                        const tab = TABS.find(t => t.id === pestañaActiva);
                        return tab ? tab.icon : <Receipt className="text-rose-500 w-8 h-8" />;
                      })()}
                      <h1 className="text-3xl font-bold text-white tracking-tight">
              {TABS.find(t => t.id === pestañaActiva)?.label || 'Prestadores'}
            </h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {pestañaActiva === 'iva'
              ? 'Quién acreditó su responsabilidad de IVA desde el RUT, quién no, y qué overrides manuales hay.'
              : 'Cola de revisión de RUT: ver documento, aprobar (activa cuenta) o rechazar (notifica correcciones).'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tabs principales */}
          <div className="flex bg-slate-900/50 rounded-xl p-1 border border-slate-800">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setPestañaActiva(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  pestañaActiva === tab.id
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                    : 'text-slate-400 hover:text-slate-200'
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
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm font-medium transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Tabs de filtro según pestaña */}
      <div className="flex flex-wrap gap-2">
        {pestañaActiva === 'iva' ? (
          FILTROS_ESTADO.map(f => (
            <button
              key={f.id}
              onClick={() => setFiltroEstado(f.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                filtroEstado === f.id
                  ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
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
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                filtroRevision === f.id
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {f.icon}
              {f.label}
              {resumen && f.id !== 'todas' && (
                <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded-full">
                  {resumen.revision[f.id as keyof typeof resumen.revision] ?? 0}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl flex justify-between items-center text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </span>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Censo (solo en pestaña IVA) */}
      {pestañaActiva === 'iva' && resumen && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Prestadores</span>
              <HelpCircle className="w-5 h-5 text-slate-500" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-4">{resumen.total_prestadores ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Total con rol PRESTADOR</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Sin declarar</span>
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-4">{resumen.sin_declarar ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">No se presume responsable (D3)</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Declarados</span>
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-4">{resumen.declarados ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Condición tomada del RUT</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Override manual</span>
              <SlidersHorizontal className="w-5 h-5 text-sky-400" />
            </div>
            <p className="text-3xl font-extrabold text-white mt-4">{resumen.override ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Fijado por un admin, auditado (D1)</p>
          </div>
        </div>
      )}

      {/* Resumen de revisión (solo en pestaña Revisión RUT) */}
      {pestañaActiva === 'revision' && resumen && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Pendientes</span>
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-3xl font-extrabold text-amber-300 mt-4">{resumen.revision.pendiente ?? 0}</p>
            <p className="text-xs text-slate-500 mt-1">Requieren revisión del equipo</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Aprobadas</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-3xl font-extrabold text-emerald-300 mt-4">{resumen.revision.aprobada ?? 0}</p>
            <p className="text-xs text-slate-500 mt-1">Cuenta activada, puede publicar</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Rechazadas</span>
              <XCircle className="w-5 h-5 text-rose-400" />
            </div>
            <p className="text-3xl font-extrabold text-rose-300 mt-4">{resumen.revision.rechazada ?? 0}</p>
            <p className="text-xs text-slate-500 mt-1">Notificado, puede reenviar</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Sin enviar</span>
              <HelpCircle className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-3xl font-extrabold text-slate-300 mt-4">{resumen.revision.sin_enviar ?? 0}</p>
            <p className="text-xs text-slate-500 mt-1">Aún no subieron RUT</p>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
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
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-rose-500 mb-2" />
                    Cargando…
                  </td>
                </tr>
              )}

              {!loading && !fuenteDisponible && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No se pudo consultar la fuente de prestadores.
                  </td>
                </tr>
              )}

              {!loading && fuenteDisponible && prestadores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
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
                  <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-6 py-4">
                      <p className="text-white font-medium">{p.nombre}</p>
                      <p className="text-slate-500 text-xs">{p.email}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">{p.rut_numero || '—'}</td>
                    <td className="px-6 py-4 text-slate-400">{codigoLabel(p.rut_responsabilidad_codigo)}</td>

                    {pestañaActiva === 'iva' ? (
                      <>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className={p.responsable_iva ? 'text-emerald-300' : 'text-slate-400'}>
                              {p.responsable_iva ? 'Sí' : 'No'}
                            </span>
                            <button
                              type="button"
                              onClick={() => abrirCorreccion(p)}
                              className="rounded-lg border border-sky-500/30 px-2.5 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-500/10"
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
                        <td className="px-6 py-4 text-slate-400 text-xs">{fmtFecha(p.actualizada_at)}</td>
                        <td className="px-6 py-4 text-slate-400 text-xs">
                          {p.fuente === 'MANUAL' ? (
                            <>
                              Manual
                              {p.cambiada_por_nombre ? (
                                <span className="text-slate-500"> · {p.cambiada_por_nombre}</span>
                              ) : p.cambiada_por ? (
                                <span className="text-slate-500"> · admin #{p.cambiada_por}</span>
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
                              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-xs font-medium transition-all"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver {detectarTipoDocumento(p.soporte_url) === 'pdf' ? 'PDF' : 'Imagen'}
                            </button>
                          ) : (
                            <span className="text-slate-500 text-xs italic">Sin documento</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${b.clase}`}>
                            {b.icon}
                            {b.label}
                          </span>
                          {p.revision_nota && (
                            <p className="text-slate-500 text-xs mt-1 line-clamp-1" title={p.revision_nota}>
                              Nota: {p.revision_nota}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-xs">{fmtFecha(p.cargado_at)}</td>
                        <td className="px-6 py-4">
                          {puedeAccion(p) ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleAprobar(p)}
                                disabled={enAccion === 'aprobar'}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
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
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
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
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium rounded-lg">
                              <UserCheck className="w-3.5 h-3.5" />
                              Cuenta activada
                            </span>
                          ) : p.revision_estado === 'RECHAZADA' ? (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium rounded-lg">
                              <UserX className="w-3.5 h-3.5" />
                              Rechazado · puede reenviar
                            </span>
                          ) : (
                            <span className="text-slate-500 text-xs italic">Esperando envío</span>
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

      {/* Modal Ver Documento */}
      {docModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cerrarDocModal}>
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h3 className="text-lg font-semibold text-white">{docModal.nombre} · RUT</h3>
              <button onClick={cerrarDocModal} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white">
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
          <div className="relative w-full max-w-md bg-slate-900 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h3 className="text-lg font-semibold text-white">Rechazar RUT</h3>
              <button onClick={cerrarRechazarModal} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-slate-300">
                Motivo del rechazo para <strong className="text-white">{rechazarModal.prestador.nombre}</strong>:
              </p>
              <textarea
                value={rechazarModal.nota}
                onChange={e => setRechazarModal(prev => ({ ...prev, nota: e.target.value }))}
                placeholder="Ej: El RUT está vencido / ilegible / no corresponde al prestador / código incorrecto..."
                className="w-full min-h-[100px] px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 resize-y"
                rows={4}
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={cerrarRechazarModal}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-medium transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRechazarConfirm}
                  disabled={accionLoading[rechazarModal.prestador.id] === 'rechazar'}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-medium rounded-xl transition-all disabled:opacity-50"
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
            className="w-full max-w-xl space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fiscal-correction-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="fiscal-correction-title" className="text-xl font-bold text-white">Corregir responsabilidad de IVA</h2>
                <p className="mt-1 text-sm text-slate-400">{correccion.nombre} · RUT {correccion.rut_numero || 'sin registrar'}</p>
              </div>
              <button
                type="button"
                onClick={() => setCorreccion(null)}
                disabled={guardandoCorreccion}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-slate-300">
              Casilla declarada: <strong className="text-white">{codigoLabel(correccion.rut_responsabilidad_codigo)}</strong>.
              La corrección cambia el valor aplicado y conserva la declaración original del RUT.
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold text-slate-200">Criterio del revisor</legend>
              {[{ value: false, label: 'No es responsable de IVA' }, { value: true, label: 'Sí es responsable de IVA' }].map((opcion) => (
                <label key={String(opcion.value)} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-200 hover:bg-slate-800">
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

            <label className="block space-y-2 text-sm font-semibold text-slate-200">
              Motivo de la corrección
              <textarea
                value={motivoCorreccion}
                onChange={(event) => setMotivoCorreccion(event.target.value)}
                minLength={10}
                maxLength={500}
                required
                rows={3}
                placeholder="Describe qué evidencia revisaste y por qué ajustas el resultado."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-normal text-white outline-none focus:border-sky-500"
              />
              <span className="block text-xs font-normal text-slate-500">El motivo y el cambio quedarán en la bitácora de auditoría.</span>
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setCorreccion(null)}
                disabled={guardandoCorreccion}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardandoCorreccion || valorCorreccion === null || motivoCorreccion.trim().length < 10}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
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
