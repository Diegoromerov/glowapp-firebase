'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Loader2,
  Mail,
  MailX,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Timer,
  User,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Bandeja de PQRSF (peticiones, quejas, reclamos, sugerencias y felicitaciones).
 *
 * QUÉ RESUELVE
 *   Un PQRSF creado en la aplicación no llegaba a ningún lado: el backend ya lo guardaba
 *   en `tickets` y ya sabía devolvérselo a un administrador, pero el panel no tenía
 *   pantalla. Aquí está la línea de gestión completa: bandeja, hilo, cambio de estado y
 *   prioridad, y respuesta del operador. El envío de correo al implicado todavía no existe
 *   (fase siguiente) y la interfaz lo dice en vez de dar por hecho una notificación.
 *
 * CONTRATO (backend/src/controllers/adminTicketController.js)
 *   GET   /api/admin/tickets                 -> { success, page, limit, total, data: Fila[] }
 *   GET   /api/admin/tickets/metricas        -> { success, data: Metricas }
 *   GET   /api/admin/tickets/esquema         -> { success, data: Esquema }
 *   GET   /api/admin/tickets/:id             -> { success, data: Detalle }
 *   PATCH /api/admin/tickets/:id             -> { success, message, data: Fila }
 *   POST  /api/admin/tickets/:id/respuesta   -> 201 { success, message, data: {...} }
 *
 * DOS DECISIONES QUE NO SON DE ESTILO
 *
 * 1. Las opciones de estado y prioridad NO están escritas aquí: se pintan desde
 *    `esquema.valores`, que el backend deriva de las restricciones CHECK reales. En este
 *    repositorio ya se coló una lista duplicada en el código y el CHECK de la tabla no
 *    admitía el valor, así que el botón "Atender" de SOS parecía no hacer nada. Si una
 *    migración añade un estado, aquí aparece solo. Si el backend responde null para una
 *    columna, no se ofrece filtro para ella: antes que inventar opciones, se omite.
 *    Los nombres para mostrar sí viven aquí (ETIQUETAS), pero son presentación: un valor
 *    sin traducción se muestra tal cual, nunca se oculta.
 *
 * 2. El texto escrito por los usuarios NO pasa por `sanitizeText()`. Esa función termina
 *    en `escapeHtml()`, y JSX ya escapa al interpolar: aplicarla daría doble escape y el
 *    usuario leería "&amp;" donde hay un "&" y perdería los "<" de su propio relato.
 *    React es aquí la única capa de escape, que es la correcta.
 */

const LIMITE = 20;
const REFRESCO_MS = 60000;

type EstadoSla = 'respondido' | 'vencido' | 'por_vencer' | 'en_plazo';

interface SlaBloque {
  estado: EstadoSla;
  plazo_minutos: number | null;
  limite: string | null;
  respondido_a_tiempo: boolean | null;
  minutos_primera_respuesta: number | null;
}

interface LegalBloque {
  tipo: string;
  plazo_dias_habiles: number;
  limite: string | null;
  vencido: boolean;
  dias_habiles_restantes: number;
  festivos_incluidos: boolean;
}

/** Fila de la bandeja. `mensajes_total` es un CONTEO (ver Detalle, donde `mensajes` es el hilo). */
interface Fila {
  id: string;
  tipo: string | null;
  categoria: string | null;
  asunto: string | null;
  estado: string;
  prioridad: string;
  fecha_creacion: string;
  fecha_actualizacion?: string | null;
  primera_respuesta_en?: string | null;
  resuelto_en?: string | null;
  cerrado_en?: string | null;
  usuario_nombre?: string | null;
  usuario_email?: string | null;
  mensajes_total: number;
  respuestas_operador?: number | null;
  sla: SlaBloque;
  legal: LegalBloque | null;
}

interface Mensaje {
  id: number;
  remitente_id: number | null;
  mensaje: string;
  autor_tipo: string;
  es_borrador: boolean;
  fecha_envio: string;
  remitente_nombre?: string | null;
}

/**
 * El detalle NO reutiliza Fila: allí `mensajes` es la colección del hilo. Se omite el
 * conteo a propósito para que el tipo no pueda mentir sobre lo que llega.
 */
interface Detalle extends Omit<Fila, 'mensajes_total'> {
  descripcion?: string | null;
  usuario_phone?: string | null;
  mensajes: Mensaje[];
}

interface Metricas {
  total: number;
  abiertos: number;
  vencidos: number;
  sin_respuesta: number;
  por_estado: { estado: string; total: number }[];
  por_prioridad: { prioridad: string; total: number }[];
  arco: { plazo_dias_habiles: number; festivos_incluidos: boolean; abiertas: number };
}

interface Esquema {
  valores: {
    estado: string[] | null;
    prioridad: string[] | null;
    tipo: string[] | null;
    categoria: string[] | null;
  };
  sla: { plazos_minutos: Record<string, number> };
  legal: { plazo_dias_habiles: number; festivos_incluidos: boolean };
}

const FILTROS_VACIOS = {
  estado: '',
  prioridad: '',
  tipo: '',
  vencidos: false,
  sin_respuesta: false,
};

/** Presentación, no validación: un valor sin traducción se muestra tal cual. */
const ETIQUETAS: Record<string, string> = {
  ABIERTO: 'Abierto',
  EN_PROCESO: 'En proceso',
  ESPERANDO_RESPUESTA_USUARIO: 'Esperando al usuario',
  RESUELTO: 'Resuelto',
  CERRADO: 'Cerrado',
  EMERGENCIA: 'Emergencia',
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
  PETICION: 'Petición',
  QUEJA: 'Queja',
  RECLAMO: 'Reclamo',
  SUGERENCIA: 'Sugerencia',
  FELICITACION: 'Felicitación',
  ARCO_SUPRESION: 'ARCO (supresión de datos)',
  USUARIO: 'Usuario',
  OPERADOR: 'Operador',
  AGENTE: 'Agente',
};

const etiqueta = (valor?: string | null): string =>
  valor ? ETIQUETAS[valor] ?? valor.replace(/_/g, ' ') : '—';

/** Un campo de colección que llegue como no-colección degrada a vacío, no rompe el render. */
const asArray = <T,>(valor: unknown): T[] => (Array.isArray(valor) ? (valor as T[]) : []);

function fechaHora(fecha?: string | null): string {
  if (!fecha) return '—';
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function antiguedad(fecha?: string | null): string {
  if (!fecha) return '';
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function duracion(minutos?: number | null): string {
  if (minutos === null || minutos === undefined || Number.isNaN(minutos)) return '—';
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function plazoLegible(minutos?: number | null): string {
  if (minutos === null || minutos === undefined) return 'sin plazo definido';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.round(minutos / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

const CHIP_SLA: Record<EstadoSla, string> = {
  respondido: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-600 text-white',
  en_plazo: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-900 text-emerald-100',
  por_vencer: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-500 text-black',
  vencido: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-600 text-white',
};

const TEXTO_SLA: Record<EstadoSla, string> = {
  respondido: 'Respondido',
  en_plazo: 'En plazo',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
};

export default function AdminPqrsfPage() {
  const { user } = useAuth();

  const [filas, setFilas] = useState<Fila[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [esquema, setEsquema] = useState<Esquema | null>(null);
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  const mensajeDeFallo = (res: Response, quejarse: string) => {
    if (res.status === 401) return 'Sesión expirada. Vuelve a iniciar sesión.';
    if (res.status === 403) return 'Tu usuario no tiene permisos de administrador.';
    return `${quejarse} (HTTP ${res.status})`;
  };

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const query = new URLSearchParams();
      if (filtros.estado) query.set('estado', filtros.estado);
      if (filtros.prioridad) query.set('prioridad', filtros.prioridad);
      if (filtros.tipo) query.set('tipo', filtros.tipo);
      if (filtros.vencidos) query.set('vencidos', 'true');
      if (filtros.sin_respuesta) query.set('sin_respuesta', 'true');
      query.set('page', String(pagina));
      query.set('limit', String(LIMITE));

      const [resBandeja, resMetricas, resEsquema] = await Promise.all([
        fetch(`/api/admin/tickets?${query.toString()}`, { headers: getBffHeaders() }),
        fetch('/api/admin/tickets/metricas', { headers: getBffHeaders() }),
        // El esquema casi nunca cambia, pero pedirlo junto a lo demás mantiene una sola
        // ruta de carga y evita un estado intermedio sin opciones.
        fetch('/api/admin/tickets/esquema', { headers: getBffHeaders() }),
      ]);

      if (!resBandeja.ok) throw new Error(mensajeDeFallo(resBandeja, 'No se pudo cargar la bandeja'));
      const jsonBandeja = await resBandeja.json();
      setFilas(asArray<Fila>(jsonBandeja?.data));
      setTotal(Number(jsonBandeja?.total) || 0);

      if (resMetricas.ok) setMetricas((await resMetricas.json())?.data ?? null);
      if (resEsquema.ok) setEsquema((await resEsquema.json())?.data ?? null);

      setError(null);
    } catch (err) {
      // Vaciar antes de fallar: dejar las filas anteriores haría creer que el filtro
      // devolvió esos tickets.
      setFilas([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const id = setInterval(() => cargar(true), REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  const abrir = async (id: string) => {
    if (abierto === id) {
      setAbierto(null);
      setDetalle(null);
      return;
    }
    setAbierto(id);
    setDetalle(null); // no dejar el hilo del ticket anterior a la vista
    setRespuesta('');
    setAviso(null);
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/admin/tickets/${id}`, { headers: getBffHeaders() });
      if (!res.ok) throw new Error(mensajeDeFallo(res, 'No se pudo cargar el ticket'));
      const json = await res.json();
      setDetalle({ ...(json?.data ?? {}), mensajes: asArray<Mensaje>(json?.data?.mensajes) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el ticket');
    } finally {
      setCargandoDetalle(false);
    }
  };

  const cambiar = async (cambio: { estado?: string; prioridad?: string }) => {
    if (!abierto) return;
    setCambiando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${abierto}`, {
        method: 'PATCH',
        headers: getBffHeaders(),
        // Se envía lo que el usuario eligió de la lista del servidor, nunca un valor
        // escrito en esta pantalla.
        body: JSON.stringify(cambio),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || `No se pudo actualizar (HTTP ${res.status})`);
      setAviso(json?.message || 'Ticket actualizado.');
      await recargarDetalle(abierto); // hilo y tiempos ya recalculados
      await cargar(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el ticket');
    } finally {
      setCambiando(false);
    }
  };

  // `abrir` cierra si ya estaba abierto, así que para refrescar tras un cambio hace falta
  // una variante que SIEMPRE cargue.
  const recargarDetalle = async (id: string) => {
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/admin/tickets/${id}`, { headers: getBffHeaders() });
      if (!res.ok) throw new Error(mensajeDeFallo(res, 'No se pudo recargar el ticket'));
      const json = await res.json();
      setDetalle({ ...(json?.data ?? {}), mensajes: asArray<Mensaje>(json?.data?.mensajes) });
      setAbierto(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al recargar el ticket');
    } finally {
      setCargandoDetalle(false);
    }
  };

  const enviarRespuesta = async () => {
    if (!abierto || respuesta.trim().length === 0) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tickets/${abierto}/respuesta`, {
        method: 'POST',
        headers: getBffHeaders(),
        body: JSON.stringify({ mensaje: respuesta.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || `No se pudo enviar la respuesta (HTTP ${res.status})`);

      // El backend declara si salió correo. Mientras sea falso se dice, para no dar por
      // notificado a alguien que no recibió nada.
      const salioCorreo = json?.data?.correo_enviado === true;
      setAviso(
        salioCorreo
          ? 'Respuesta registrada y notificada al implicado.'
          : 'Respuesta registrada. El correo al implicado todavía no se envía (fase pendiente).'
      );
      setRespuesta('');
      await recargarDetalle(abierto);
      await cargar(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar la respuesta');
    } finally {
      setEnviando(false);
    }
  };

  if (user?.rol !== 'ADMIN') {
    return (
      <div className="card">
        <div className="card-content flex items-center gap-3">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <h2 className="card-title">Acceso denegado</h2>
            <p className="body-sm text-secondary">Solo los administradores pueden ver las PQRSF.</p>
          </div>
        </div>
      </div>
    );
  }

  const valores = esquema?.valores;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));
  const hayFiltro =
    Boolean(filtros.estado || filtros.prioridad || filtros.tipo) || filtros.vencidos || filtros.sin_respuesta;
  const plazoPorDefecto = esquema?.sla?.plazos_minutos?.MEDIA;
  const plazos = esquema?.sla?.plazos_minutos ?? {};

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">PQRSF y soporte</h1>
          <p className="text-secondary mt-1">
            Peticiones, quejas, reclamos, sugerencias y felicitaciones creadas desde la aplicación.
          </p>
        </div>
        <button onClick={() => cargar()} disabled={cargando} className="btn btn-secondary" aria-label="Recargar">
          {cargando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          <span>Recargar</span>
        </button>
      </div>

      {/* Resumen */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Abiertos</span>
            <Inbox size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value">{metricas ? metricas.abiertos : '—'}</div>
          <span className="micro text-subtle">de {metricas ? metricas.total : '—'} en total</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Vencidos (SLA)</span>
            <Timer size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value">{metricas ? metricas.vencidos : '—'}</div>
          <span className="micro text-subtle">
            sin primera respuesta dentro del plazo{plazoPorDefecto ? ` (media: ${plazoLegible(plazoPorDefecto)})` : ''}
          </span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Sin respuesta</span>
            <MessageSquare size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value">{metricas ? metricas.sin_respuesta : '—'}</div>
          <span className="micro text-subtle">nadie del equipo ha contestado todavía</span>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">ARCO abiertas</span>
            <ShieldAlert size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value">{metricas ? metricas.arco.abiertas : '—'}</div>
          <span className="micro text-subtle">
            plazo legal de {metricas ? metricas.arco.plazo_dias_habiles : '—'} días hábiles
          </span>
        </div>
      </div>

      {metricas && metricas.arco.festivos_incluidos === false && (
        <div className="card">
          <div className="card-content flex items-start gap-2">
            <AlertCircle size={18} aria-hidden="true" />
            <span className="body-sm">
              El plazo legal de las solicitudes ARCO se cuenta en días hábiles <strong>sin descontar festivos</strong>:
              la fecha límite que se muestra puede quedar por detrás de la real en semanas con festivo.
            </span>
          </div>
        </div>
      )}

      {aviso && (
        <div className="card">
          <div className="card-content flex items-center gap-2">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span className="body-sm">{aviso}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="card">
          <div className="card-content flex items-center gap-2">
            <AlertCircle size={18} aria-hidden="true" />
            <span className="body-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Filtros: cada desplegable existe solo si el servidor dio valores para él. */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Filtros</h2>
          {hayFiltro ? (
            <button
              onClick={() => {
                setFiltros(FILTROS_VACIOS);
                setPagina(1);
              }}
              className="btn btn-tertiary"
            >
              Limpiar
            </button>
          ) : (
            <span className="chip-sm">sin filtrar</span>
          )}
        </div>
        <div className="card-content">
          <div className="flex flex-wrap items-end gap-4">
            {valores?.estado && (
              <label className="body-sm">
                <span className="micro text-subtle block mb-1">Estado</span>
                <select
                  className="form-input"
                  value={filtros.estado}
                  onChange={(e) => {
                    setFiltros((f) => ({ ...f, estado: e.target.value }));
                    setPagina(1);
                  }}
                >
                  <option value="">Todos</option>
                  {valores.estado.map((v) => (
                    <option key={v} value={v}>
                      {etiqueta(v)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {valores?.prioridad && (
              <label className="body-sm">
                <span className="micro text-subtle block mb-1">Prioridad</span>
                <select
                  className="form-input"
                  value={filtros.prioridad}
                  onChange={(e) => {
                    setFiltros((f) => ({ ...f, prioridad: e.target.value }));
                    setPagina(1);
                  }}
                >
                  <option value="">Todas</option>
                  {valores.prioridad.map((v) => (
                    <option key={v} value={v}>
                      {etiqueta(v)}
                      {plazos[v] ? ` · ${plazoLegible(plazos[v])}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {valores?.tipo && (
              <label className="body-sm">
                <span className="micro text-subtle block mb-1">Tipo</span>
                <select
                  className="form-input"
                  value={filtros.tipo}
                  onChange={(e) => {
                    setFiltros((f) => ({ ...f, tipo: e.target.value }));
                    setPagina(1);
                  }}
                >
                  <option value="">Todos</option>
                  {valores.tipo.map((v) => (
                    <option key={v} value={v}>
                      {etiqueta(v)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="body-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={filtros.vencidos}
                onChange={(e) => {
                  setFiltros((f) => ({ ...f, vencidos: e.target.checked }));
                  setPagina(1);
                }}
              />
              Solo vencidos
            </label>
            <label className="body-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={filtros.sin_respuesta}
                onChange={(e) => {
                  setFiltros((f) => ({ ...f, sin_respuesta: e.target.checked }));
                  setPagina(1);
                }}
              />
              Solo sin respuesta
            </label>
          </div>
        </div>
      </div>

      {/* Bandeja */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Bandeja</h2>
          <span className="chip-sm">
            {total} solicitud(es) · los abiertos primero, los más antiguos arriba
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Solicitud</th>
                <th>Usuario</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th>Plazo</th>
                <th className="col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={6} className="text-center">
                    <Loader2 size={22} className="animate-spin mx-auto mb-2" aria-hidden="true" />
                    Cargando la bandeja...
                  </td>
                </tr>
              ) : filas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center">
                    {hayFiltro
                      ? 'Ninguna solicitud cumple estos filtros.'
                      : 'Todavía no hay PQRSF registradas.'}
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                  <React.Fragment key={f.id}>
                    <tr>
                      <td>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="chip-sm">{etiqueta(f.tipo)}</span>
                            {f.legal && (
                              <span className="chip-sm" title="Solicitud con plazo legal">
                                ARCO
                              </span>
                            )}
                          </div>
                          <span className="body-sm font-medium">{f.asunto || '(sin asunto)'}</span>
                          <span className="micro text-subtle">
                            {antiguedad(f.fecha_creacion) || fechaHora(f.fecha_creacion)} ·{' '}
                            {f.mensajes_total} mensaje(s) · {f.respuestas_operador ?? 0} del equipo
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <User size={15} aria-hidden="true" />
                          {f.usuario_nombre || 'Sin nombre'}
                        </span>
                        {f.usuario_email && <span className="micro text-subtle block">{f.usuario_email}</span>}
                      </td>
                      <td>
                        <span className="chip-sm">{etiqueta(f.prioridad)}</span>
                        <span className="micro text-subtle block">
                          {f.sla?.plazo_minutos ? `plazo ${plazoLegible(f.sla.plazo_minutos)}` : 'sin plazo'}
                        </span>
                      </td>
                      <td>
                        <span className="chip-sm">{etiqueta(f.estado)}</span>
                        {f.sla && (
                          <span className={`${CHIP_SLA[f.sla.estado] ?? CHIP_SLA.en_plazo} block mt-1 w-fit`}>
                            <Clock size={12} aria-hidden="true" />
                            {TEXTO_SLA[f.sla.estado] ?? f.sla.estado}
                          </span>
                        )}
                      </td>
                      <td>
                        {f.legal ? (
                          <div className="flex flex-col gap-1">
                            <span className="body-sm">{fechaHora(f.legal.limite)}</span>
                            <span className="micro text-subtle">
                              {f.legal.vencido
                                ? `vencido hace ${Math.abs(f.legal.dias_habiles_restantes)} día(s) hábil(es)`
                                : `${f.legal.dias_habiles_restantes} día(s) hábil(es) restantes`}
                            </span>
                          </div>
                        ) : f.sla?.limite ? (
                          <div className="flex flex-col gap-1">
                            <span className="body-sm">{fechaHora(f.sla.limite)}</span>
                            <span className="micro text-subtle">
                              {f.sla.minutos_primera_respuesta !== null
                                ? `respondió en ${duracion(f.sla.minutos_primera_respuesta)}${
                                    f.sla.respondido_a_tiempo ? ' (a tiempo)' : ' (tarde)'
                                  }`
                                : 'sin primera respuesta'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <button
                          onClick={() => abrir(f.id)}
                          className="btn btn-primary"
                          aria-expanded={abierto === f.id}
                        >
                          <Mail size={16} aria-hidden="true" />
                          <span>{abierto === f.id ? 'Cerrar' : 'Gestionar'}</span>
                        </button>
                      </td>
                    </tr>

                    {abierto === f.id && (
                      <tr>
                        <td colSpan={6}>
                          {cargandoDetalle && !detalle ? (
                            <div className="flex items-center gap-2 body-sm">
                              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                              Cargando el hilo...
                            </div>
                          ) : !detalle ? (
                            <span className="body-sm text-subtle">No se pudo cargar el ticket.</span>
                          ) : (
                            <div className="space-y-4">
                              {/* Ficha */}
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <span className="micro text-subtle block">Solicitud</span>
                                  <span className="body-sm">{detalle.asunto || '(sin asunto)'}</span>
                                  <span className="micro text-subtle block mt-1">
                                    {etiqueta(detalle.tipo)} · {etiqueta(detalle.categoria)} · creada{' '}
                                    {fechaHora(detalle.fecha_creacion)}
                                  </span>
                                </div>
                                <div>
                                  <span className="micro text-subtle block">Contacto</span>
                                  <span className="body-sm">{detalle.usuario_nombre || 'Sin nombre'}</span>
                                  {detalle.usuario_email && (
                                    <span className="micro text-subtle block">{detalle.usuario_email}</span>
                                  )}
                                  {detalle.usuario_phone && (
                                    <a href={`tel:${detalle.usuario_phone}`} className="micro text-gold block">
                                      {detalle.usuario_phone}
                                    </a>
                                  )}
                                </div>
                              </div>

                              {detalle.descripcion && (
                                <div>
                                  <span className="micro text-subtle block">Descripción</span>
                                  {/* Sin sanitizeText: React ya escapa. Ver la nota del encabezado. */}
                                  <p className="body-sm whitespace-pre-wrap">{detalle.descripcion}</p>
                                </div>
                              )}

                              {/* Plazos */}
                              <div className="flex flex-wrap items-center gap-3">
                                <span className={CHIP_SLA[detalle.sla?.estado] ?? CHIP_SLA.en_plazo}>
                                  <Clock size={12} aria-hidden="true" />
                                  {TEXTO_SLA[detalle.sla?.estado] ?? detalle.sla?.estado}
                                </span>
                                <span className="micro text-subtle">
                                  primera respuesta:{' '}
                                  {detalle.sla?.minutos_primera_respuesta !== null &&
                                  detalle.sla?.minutos_primera_respuesta !== undefined
                                    ? `${duracion(detalle.sla.minutos_primera_respuesta)}${
                                        detalle.sla.respondido_a_tiempo ? ' (dentro del plazo)' : ' (fuera del plazo)'
                                      }`
                                    : 'pendiente'}
                                </span>
                                {detalle.legal && (
                                  <span className="micro text-subtle">
                                    límite legal: {fechaHora(detalle.legal.limite)} ·{' '}
                                    {detalle.legal.vencido
                                      ? `vencido hace ${Math.abs(detalle.legal.dias_habiles_restantes)} día(s) hábil(es)`
                                      : `${detalle.legal.dias_habiles_restantes} día(s) hábil(es)`}{' '}
                                    {detalle.legal.festivos_incluidos === false ? '(sin festivos)' : ''}
                                  </span>
                                )}
                              </div>

                              {/* Acciones de estado y prioridad */}
                              <div className="flex flex-col gap-3">
                                {valores?.estado && (
                                  <div>
                                    <span className="micro text-subtle block mb-1">
                                      Marcar el estado (se guarda al pulsar)
                                    </span>
                                    <div className="flex flex-wrap gap-2">
                                      {valores.estado.map((v) => (
                                        <button
                                          key={v}
                                          onClick={() => cambiar({ estado: v })}
                                          disabled={cambiando || detalle.estado === v}
                                          className={
                                            detalle.estado === v ? 'btn btn-tertiary' : 'btn btn-secondary'
                                          }
                                          aria-pressed={detalle.estado === v}
                                        >
                                          {etiqueta(v)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {valores?.prioridad && (
                                  <div>
                                    <span className="micro text-subtle block mb-1">Cambiar la prioridad</span>
                                    <div className="flex flex-wrap gap-2">
                                      {valores.prioridad.map((v) => (
                                        <button
                                          key={v}
                                          onClick={() => cambiar({ prioridad: v })}
                                          disabled={cambiando || detalle.prioridad === v}
                                          className={
                                            detalle.prioridad === v ? 'btn btn-tertiary' : 'btn btn-secondary'
                                          }
                                          aria-pressed={detalle.prioridad === v}
                                          title={plazos[v] ? `plazo de respuesta: ${plazoLegible(plazos[v])}` : undefined}
                                        >
                                          {etiqueta(v)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {cambiando && (
                                  <span className="micro text-subtle flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                    Guardando...
                                  </span>
                                )}
                              </div>

                              {/* Hilo */}
                              <div>
                                <span className="micro text-subtle block mb-2">
                                  Conversación ({detalle.mensajes.length})
                                </span>
                                {detalle.mensajes.length === 0 ? (
                                  <span className="body-sm text-subtle">Sin mensajes todavía.</span>
                                ) : (
                                  <div className="space-y-2">
                                    {detalle.mensajes.map((m) => {
                                      const delEquipo = m.autor_tipo !== 'USUARIO';
                                      return (
                                        <div
                                          key={m.id}
                                          className={`rounded-lg border p-3 ${
                                            delEquipo ? 'border-emerald-600' : 'border-border'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="micro font-semibold">
                                              {delEquipo
                                                ? `${etiqueta(m.autor_tipo)}${
                                                    m.remitente_nombre ? ` · ${m.remitente_nombre}` : ''
                                                  }`
                                                : detalle.usuario_nombre || 'Usuario'}
                                              {m.es_borrador ? ' (borrador)' : ''}
                                            </span>
                                            <span className="micro text-subtle">{fechaHora(m.fecha_envio)}</span>
                                          </div>
                                          <p className="body-sm whitespace-pre-wrap mt-1">{m.mensaje}</p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Responder */}
                              <div className="space-y-2">
                                <label className="micro text-subtle block" htmlFor={`respuesta-${detalle.id}`}>
                                  Responder al usuario
                                </label>
                                <textarea
                                  id={`respuesta-${detalle.id}`}
                                  value={respuesta}
                                  onChange={(e) => setRespuesta(e.target.value)}
                                  rows={3}
                                  className="form-input"
                                  placeholder="Qué se revisó y qué se resuelve..."
                                />
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={enviarRespuesta}
                                    disabled={respuesta.trim().length === 0 || enviando}
                                    className="btn btn-primary"
                                  >
                                    {enviando ? (
                                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Send size={16} aria-hidden="true" />
                                    )}
                                    <span>Guardar respuesta</span>
                                  </button>
                                  <span className="micro text-subtle flex items-center gap-1">
                                    <MailX size={13} aria-hidden="true" />
                                    Queda en el hilo. El correo al implicado llegará en una fase siguiente.
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {paginas > 1 && (
          <div className="card-content flex items-center justify-between">
            <span className="micro text-subtle">
              Página {pagina} de {paginas} · {total} en total
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina <= 1 || cargando}
                className="btn btn-secondary"
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
                disabled={pagina >= paginas || cargando}
                className="btn btn-secondary"
                aria-label="Página siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
