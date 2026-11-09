'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  ShieldAlert,
  User,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Pantalla de alertas SOS.
 *
 * Consume GET /api/glow-admin/sos/active?estado=TODOS -> { success, count, data: [...] }
 * donde `data` YA es la coleccion (no `data.alerts`: ese campo no existe).
 *
 * Flujo de atención:
 *   "Atender"  -> despliega un cuadro de texto para describir la resolución
 *   "Guardar"  -> PATCH /api/glow-admin/sos/resolve/:id { resolucion }
 *   "Atendido" -> botón verde; al pulsarlo muestra la resolución guardada
 *
 * Se persiste el valor 'RESUELTO' porque el CHECK de sos_alerts solo admite
 * 'ACTIVO' y 'RESUELTO'. El backend escribía ATENDIDO (sin comillas a propósito
 * en este comentario: el test de regresión busca ese literal entrecomillado en el
 * código), que el constraint rechazaba: el UPDATE fallaba con violación de
 * constraint y la alerta nunca se atendía (el botón parecía no hacer nada).
 */

interface SosAlert {
  id: number;
  client_name?: string | null;
  client_phone?: string | null;
  provider_name?: string | null;
  provider_phone?: string | null;
  latitude: string | number;
  longitude: string | number;
  fecha_creacion?: string | null;
  estado?: string | null;
  resolucion?: string | null;
  resuelto_en?: string | null;
}

const REFRESCO_MS = 30000;
const MIN_RESOLUCION = 3;

/** Antiguedad legible de la alerta. Vacia si la fecha no es valida. */
function antiguedad(fecha?: string | null): string {
  if (!fecha) return '';
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h ${min % 60} min`;
  return `hace ${Math.floor(h / 24)} d ${h % 24} h`;
}

function fechaHora(fecha?: string | null): string {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

const tieneCoordenadas = (a: SosAlert) =>
  !Number.isNaN(Number(a.latitude)) && !Number.isNaN(Number(a.longitude));

export default function AdminSosPage() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [atendiendo, setAtendiendo] = useState<number | null>(null);
  const [viendo, setViendo] = useState<number | null>(null);
  const [borrador, setBorrador] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [soloActivas, setSoloActivas] = useState(false);

  const getBffHeaders = (contentType = 'application/json') => ({
    'X-Requested-With': 'XMLHttpRequest',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  });

  const fetchAlerts = useCallback(async (silencioso = false) => {
    try {
      if (!silencioso) setLoading(true);
      const res = await fetch('/api/glow-admin/sos/active?estado=TODOS', {
        headers: getBffHeaders(),
      });

      if (!res.ok) {
        // El BFF reenvia el 401/403 del backend; distinguirlo ayuda a saber si
        // es sesion caducada o permiso.
        if (res.status === 401) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
        if (res.status === 403) throw new Error('Tu usuario no tiene permisos de administrador.');
        throw new Error(`Error al cargar alertas SOS (HTTP ${res.status})`);
      }

      const json = await res.json();
      // `data` es la coleccion. Degradar a lista vacia en vez de romper el render.
      setAlerts(Array.isArray(json?.data) ? json.data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(() => fetchAlerts(true), REFRESCO_MS);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const activas = alerts.filter((a) => (a.estado || 'ACTIVO') === 'ACTIVO');
  const visibles = soloActivas ? activas : alerts;
  const masAntigua = activas.length > 0 ? activas[activas.length - 1] : null;

  const abrirAtencion = (id: number) => {
    setViendo(null);
    setAtendiendo(id);
    setBorrador('');
    setAviso(null);
  };

  const guardarAtencion = async (id: number) => {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/glow-admin/sos/resolve/${id}`, {
        method: 'PATCH',
        headers: getBffHeaders(),
        body: JSON.stringify({ resolucion: borrador.trim() }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error || `No se pudo guardar la atención (HTTP ${res.status})`);
      }

      setAviso(`Alerta #${id} atendida.`);
      setAtendiendo(null);
      setBorrador('');
      await fetchAlerts(true);
      setViendo(id); // deja a la vista la resolución recién guardada
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la atención');
    } finally {
      setGuardando(false);
    }
  };

  if (user?.rol !== 'ADMIN') {
    return (
      <div className="card">
        <div className="card-content flex items-center gap-3">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <h2 className="card-title">Acceso denegado</h2>
            <p className="body-sm text-secondary">Solo los administradores pueden ver las alertas SOS.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Alertas SOS</h1>
          <p className="text-secondary mt-1">
            Alertas de pánico activas y las ya atendidas, con la resolución registrada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoloActivas((v) => !v)}
            className="btn btn-tertiary"
            aria-pressed={soloActivas}
          >
            {soloActivas ? 'Ver todas' : 'Ver solo activas'}
          </button>
          <button
            onClick={() => fetchAlerts()}
            disabled={loading}
            className="btn btn-secondary"
            aria-label="Recargar alertas"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            <span>Recargar</span>
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Alertas activas</span>
            <ShieldAlert size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value">{error ? '—' : activas.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Más antigua sin atender</span>
            <Clock size={18} aria-hidden="true" />
          </div>
          <div className="kpi-value body-sm">
            {masAntigua ? antiguedad(masAntigua.fecha_creacion) || 'Sin fecha' : 'Ninguna'}
          </div>
        </div>
      </div>

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

      {/* Listado */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Alertas</h2>
          <span className="chip-sm">
            {activas.length} activa(s) · se actualiza cada 30 s
          </span>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Alerta</th>
                <th>Cliente</th>
                <th>Prestador</th>
                <th>Ubicación</th>
                <th>Emitida</th>
                <th className="col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center">
                    <Loader2 size={22} className="animate-spin mx-auto mb-2" aria-hidden="true" />
                    Cargando alertas...
                  </td>
                </tr>
              ) : visibles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center">
                    {soloActivas
                      ? 'No hay alertas SOS activas.'
                      : 'Todavía no hay alertas registradas.'}
                  </td>
                </tr>
              ) : (
                visibles.map((a) => {
                  const esActiva = (a.estado || 'ACTIVO') === 'ACTIVO';
                  return (
                    <React.Fragment key={a.id}>
                      <tr>
                        <td>
                          <span className="chip-sm">#{a.id}</span>
                        </td>
                        <td>
                          {a.client_name ? (
                            <span className="flex items-center gap-2">
                              <User size={15} aria-hidden="true" />
                              {a.client_name}
                              {a.client_phone && (
                                <a
                                  href={`tel:${a.client_phone}`}
                                  className="text-gold flex items-center gap-1"
                                >
                                  <Phone size={14} aria-hidden="true" />
                                  {a.client_phone}
                                </a>
                              )}
                            </span>
                          ) : (
                            <span className="text-subtle">Sin datos</span>
                          )}
                        </td>
                        <td>
                          {a.provider_name ? (
                            <span>{a.provider_name}</span>
                          ) : (
                            <span className="text-subtle">Sin cita asociada</span>
                          )}
                        </td>
                        <td>
                          {tieneCoordenadas(a) ? (
                            <a
                              href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gold flex items-center gap-1"
                            >
                              <MapPin size={14} aria-hidden="true" />
                              {Number(a.latitude).toFixed(5)}, {Number(a.longitude).toFixed(5)}
                            </a>
                          ) : (
                            <span className="text-subtle">Sin coordenadas</span>
                          )}
                        </td>
                        <td>
                          <span className="body-sm">{antiguedad(a.fecha_creacion) || 'Sin fecha'}</span>
                        </td>
                        <td className="col-actions">
                          {esActiva ? (
                            <button
                              onClick={() =>
                                atendiendo === a.id ? setAtendiendo(null) : abrirAtencion(a.id)
                              }
                              className="btn btn-primary"
                              aria-expanded={atendiendo === a.id}
                            >
                              <ShieldAlert size={16} aria-hidden="true" />
                              <span>Atender</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => setViendo(viendo === a.id ? null : a.id)}
                              aria-expanded={viendo === a.id}
                              /* Sin la clase .btn a propósito: su `background` es CSS sin capa y
                                 ganaría a la utilidad de Tailwind, así que el botón no saldría
                                 verde. */
                              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-600 transition-colors"
                            >
                              <CheckCircle2 size={16} aria-hidden="true" />
                              <span>Atendido</span>
                            </button>
                          )}
                        </td>
                      </tr>

                      {atendiendo === a.id && (
                        <tr>
                          <td colSpan={6}>
                            <div className="space-y-3">
                              <label className="body-sm" htmlFor={`resolucion-${a.id}`}>
                                Resolución de la alerta #{a.id}
                              </label>
                              <textarea
                                id={`resolucion-${a.id}`}
                                value={borrador}
                                onChange={(e) => setBorrador(e.target.value)}
                                rows={3}
                                autoFocus
                                placeholder="Qué ocurrió, quién atendió y cuál fue el resultado..."
                                className="form-input"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => guardarAtencion(a.id)}
                                  disabled={borrador.trim().length < MIN_RESOLUCION || guardando}
                                  className="btn btn-primary"
                                >
                                  {guardando ? (
                                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                                  ) : (
                                    <CheckCircle2 size={16} aria-hidden="true" />
                                  )}
                                  <span>Guardar atención</span>
                                </button>
                                <button
                                  onClick={() => setAtendiendo(null)}
                                  disabled={guardando}
                                  className="btn btn-secondary"
                                >
                                  Cancelar
                                </button>
                                {borrador.trim().length < MIN_RESOLUCION && (
                                  <span className="micro text-subtle">
                                    Escribe al menos {MIN_RESOLUCION} caracteres.
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {viendo === a.id && (
                        <tr>
                          <td colSpan={6}>
                            {a.resolucion ? (
                              <div className="space-y-2">
                                <span className="micro text-subtle">Resolución registrada</span>
                                <p className="body-sm whitespace-pre-wrap">{a.resolucion}</p>
                                {a.resuelto_en && (
                                  <span className="micro text-subtle">
                                    Atendida el {fechaHora(a.resuelto_en)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="body-sm text-subtle">
                                Figura como atendida pero sin resolución registrada (se atendió antes de
                                que se guardara el detalle).
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
