'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, Check, CheckCircle2, Clock3, FileImage, Loader2,
  ChevronLeft, ChevronRight, MessageCircle, RefreshCw, Search, Send, ShieldAlert, UserRound, Wallet,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Estado = 'ABIERTA' | 'EN_REVISION' | 'RESUELTA' | 'CERRADA';
type Resolucion = 'FAVOR_PRESTADOR' | 'REEMBOLSO_TOTAL' | 'DIVISION' | 'COMPENSACION_PLATAFORMA';
interface Mensaje {
  id: number;
  remitente_id: number | null;
  remitente_nombre?: string | null;
  audiencia: 'PARTES' | 'INTERNA';
  mensaje: string;
  evidencia_urls?: string[] | null;
  creado_at: string;
}
interface Disputa {
  id: string;
  booking_id: string;
  tipo: string;
  tipo_actor: string;
  descripcion: string;
  evidencia_urls: string[] | null;
  monto_disputado: number | string;
  estado: Estado;
  resolucion?: Resolucion | null;
  nota_resolucion?: string | null;
  reembolso_estado?: 'NO_APLICA' | 'PENDIENTE' | 'PROCESANDO' | 'COMPLETADO' | 'FALLIDO' | null;
  reembolso_monto?: number | string | null;
  creado_at: string;
  sla_limite_at?: string | null;
  booking_fecha?: string | null;
  valor_bruto?: number | string | null;
  pago_neto_prestador?: number | string | null;
  iniciado_por_nombre?: string | null;
  iniciado_por_email?: string | null;
  cliente_nombre?: string | null;
  cliente_email?: string | null;
  prestador_nombre?: string | null;
  prestador_email?: string | null;
  servicio_nombre?: string | null;
  horas_abierta?: number;
  sla_vencido?: boolean;
  mensajes_total?: number;
  mensajes?: Mensaje[];
}
interface Metricas { total: number; abiertas: number; en_revision: number; vencidas: number; cerradas: number }

const API = '/api/admin/disputes';
const ESTADOS: { value: string; label: string }[] = [
  { value: 'TODOS', label: 'Todos los casos' }, { value: 'ABIERTA', label: 'Abiertas' },
  { value: 'EN_REVISION', label: 'En revisión' }, { value: 'RESUELTA', label: 'Resueltas' },
  { value: 'CERRADA', label: 'Cerradas' },
];
const TIPOS: Record<string, string> = {
  CALIDAD_SERVICIO: 'Calidad del servicio', NO_SHOW_PRESTADOR: 'El prestador no asistió',
  NO_SHOW_CLIENTE: 'El cliente no asistió', OTP_BLOQUEADO: 'Código de servicio bloqueado',
  CARGO_NO_RECONOCIDO: 'Cargo no reconocido', FRAUDE: 'Posible fraude', FALLA_TECNICA: 'Falla técnica',
};
const RESOLUCIONES: { value: Resolucion; label: string }[] = [
  { value: 'FAVOR_PRESTADOR', label: 'A favor del prestador' },
  { value: 'REEMBOLSO_TOTAL', label: 'Reembolso total' },
  { value: 'DIVISION', label: 'Dividir el monto' },
  { value: 'COMPENSACION_PLATAFORMA', label: 'Compensación de plataforma' },
];
const headers = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' };
const money = (value?: number | string | null) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(value) || 0);
const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha';
const labelTipo = (value?: string) => value ? (TIPOS[value] || value.replaceAll('_', ' ').toLowerCase()) : 'Disputa';

export default function DisputasPage() {
  const { user } = useAuth();
  const [filas, setFilas] = useState<Disputa[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [total, setTotal] = useState(0);
  const [estado, setEstado] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Disputa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [audiencia, setAudiencia] = useState<'PARTES' | 'INTERNA'>('PARTES');
  const [resolucion, setResolucion] = useState<Resolucion>('FAVOR_PRESTADOR');
  const [porcentaje, setPorcentaje] = useState('50');
  const [nota, setNota] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const params = new URLSearchParams({ estado, q: busqueda.trim(), page: String(pagina), limit: '50' });
      const response = await fetch(`${API}/inbox?${params}`, { headers });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.message || json?.error || `No se pudo cargar la bandeja (${response.status}).`);
      setFilas(Array.isArray(json?.data) ? json.data : []);
      setTotal(Number(json?.total) || 0);
      setMetricas(json?.metricas || null);
    } catch (e) {
      setFilas([]); setMetricas(null); setTotal(0);
      setError(e instanceof Error ? e.message : 'No se pudo cargar la bandeja.');
    } finally { setCargando(false); }
  }, [estado, busqueda, pagina]);

  useEffect(() => { void cargar(); }, [cargar]);

  const abrir = async (id: string) => {
    setSeleccion(id); setDetalle(null); setAviso(''); setError(''); setCargandoDetalle(true);
    setMensaje(''); setNota('');
    try {
      const response = await fetch(`${API}/${id}/review`, { headers });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'No se pudo cargar el expediente.');
      setDetalle({ ...json.data, mensajes: Array.isArray(json?.data?.mensajes) ? json.data.mensajes : [] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al abrir el expediente.'); }
    finally { setCargandoDetalle(false); }
  };

  const actualizarEstado = async () => {
    if (!detalle || detalle.estado !== 'ABIERTA') return;
    setGuardando(true); setError(''); setAviso('');
    try {
      const response = await fetch(`${API}/${detalle.id}/review`, { method: 'PATCH', headers, body: '{}' });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'No se pudo iniciar la revisión.');
      await abrir(detalle.id); setAviso('Caso marcado En revisión.'); await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar el caso.'); }
    finally { setGuardando(false); }
  };

  const enviarMensaje = async () => {
    if (!detalle || !mensaje.trim()) return;
    setGuardando(true); setError(''); setAviso('');
    try {
      const response = await fetch(`${API}/${detalle.id}/messages`, {
        method: 'POST', headers, body: JSON.stringify({ mensaje: mensaje.trim(), audiencia }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'No se pudo guardar la respuesta.');
      setMensaje(''); await abrir(detalle.id); setAviso(json?.aviso || 'Mensaje registrado.'); await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la respuesta.'); }
    finally { setGuardando(false); }
  };

  const resolver = async () => {
    if (!detalle || !nota.trim()) { setError('Escribe una nota de resolución antes de continuar.'); return; }
    if (resolucion === 'DIVISION' && (!Number.isFinite(Number(porcentaje)) || Number(porcentaje) < 0 || Number(porcentaje) > 100)) {
      setError('El porcentaje para el prestador debe estar entre 0 y 100.'); return;
    }
    setGuardando(true); setError(''); setAviso('');
    try {
      const response = await fetch(`${API}/${detalle.id}/resolve`, {
        method: 'PUT', headers,
        body: JSON.stringify({ resolucion, porcentaje_prestador: resolucion === 'DIVISION' ? Number(porcentaje) : null, nota_resolucion: nota.trim() }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || 'No se pudo registrar la resolución.');
      setNota(''); await cargar(); await abrir(detalle.id); setAviso('Decisión registrada. Si corresponde devolución, su estado aparece por separado y no se considera pagada hasta confirmación.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo resolver el caso.'); }
    finally { setGuardando(false); }
  };

  const stats = useMemo(() => [
    { label: 'Casos', value: metricas?.total ?? '—', icon: ShieldAlert, tone: 'text-stone-700', key: 'TODOS' },
    { label: 'Abiertos', value: metricas?.abiertas ?? '—', icon: Clock3, tone: 'text-amber-700', key: 'ABIERTA' },
    { label: 'En revisión', value: metricas?.en_revision ?? '—', icon: Search, tone: 'text-blue-700', key: 'EN_REVISION' },
    { label: 'SLA vencido', value: metricas?.vencidas ?? '—', icon: AlertCircle, tone: 'text-rose-700', key: 'TODOS' },
  ], [metricas]);

  if (user?.rol && user.rol !== 'ADMIN') return <main className="p-8"><p>No tienes acceso a la gestión de disputas.</p></main>;

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[#f8f6f2] px-4 py-6 text-stone-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#b38a43]"><span className="h-2 w-2 rounded-full bg-[#c9a45b]" />Reclamaciones / Disputas</div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Centro de disputas</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-600 sm:text-base">Revisa evidencia, registra respuestas para las partes o notas internas y documenta una resolución.</p>
          </div>
          <button type="button" onClick={() => void cargar()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 font-medium shadow-sm hover:bg-stone-50">
            <RefreshCw size={17} />Actualizar
          </button>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen de disputas">
          {stats.map(({ label, value, icon: Icon, tone, key }) => (
            <button key={label} type="button" onClick={() => setEstado(key)} className="rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-[0_3px_16px_rgba(40,30,15,.04)] transition hover:border-[#d9c59c] sm:p-5">
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7f3ea] ${tone}`}><Icon size={19} /></span>
              <span className="mt-3 block text-2xl font-semibold tabular-nums">{value}</span>
              <span className="text-sm text-stone-500">{label}</span>
            </button>
          ))}
        </section>

        {(error || aviso) && <div role={error ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {error ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}{error || aviso}
        </div>}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(360px,0.92fr)_minmax(560px,1.45fr)]">
          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_4px_24px_rgba(40,30,15,.05)]">
            <div className="border-b border-stone-200 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Bandeja</h2><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">{total} casos</span></div>
              <label className="relative block">
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input value={busqueda} onChange={(e) => { setPagina(1); setBusqueda(e.target.value); }} placeholder="Buscar persona, servicio o ID" className="h-11 w-full rounded-xl border border-stone-300 bg-[#fcfbf9] pl-10 pr-3 text-sm outline-none focus:border-[#bb9550] focus:ring-2 focus:ring-[#bb9550]/15" />
              </label>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {ESTADOS.map((item) => <button key={item.value} type="button" onClick={() => { setPagina(1); setEstado(item.value); }} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${estado === item.value ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{item.label}</button>)}
              </div>
            </div>
            <div className="max-h-[72vh] overflow-y-auto divide-y divide-stone-100">
              {cargando ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-stone-500"><Loader2 size={18} className="animate-spin" />Cargando casos…</div>
                : filas.length === 0 ? <div className="p-10 text-center text-sm text-stone-500">{error ? 'No se pudo confirmar el estado de la bandeja.' : 'No hay disputas que coincidan con estos filtros.'}</div>
                  : filas.map((item) => <button key={item.id} type="button" onClick={() => void abrir(item.id)} className={`block w-full p-4 text-left transition hover:bg-[#fbfaf7] sm:p-5 ${seleccion === item.id ? 'bg-[#f8f4ea] ring-1 ring-inset ring-[#d6bf91]' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f4efe4] px-2.5 py-1 text-xs font-medium text-[#88672f]">{labelTipo(item.tipo)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.estado === 'ABIERTA' ? 'bg-amber-100 text-amber-800' : item.estado === 'EN_REVISION' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>{item.estado.replaceAll('_', ' ')}</span></div>
                        <p className="mt-2 truncate font-semibold">{item.cliente_nombre || item.iniciado_por_nombre || 'Cliente'} <span className="font-normal text-stone-400">vs.</span> {item.prestador_nombre || 'Prestador'}</p>
                        <p className="mt-1 truncate text-sm text-stone-500">{item.servicio_nombre || labelTipo(item.tipo)} · {dateTime(item.creado_at)}</p>
                      </div>
                      <div className="shrink-0 text-right"><span className="font-semibold tabular-nums">{money(item.monto_disputado)}</span>
                        {item.sla_vencido && <span className="mt-2 block text-xs font-semibold text-rose-700">SLA vencido</span>}
                        <span className="mt-2 flex items-center justify-end gap-1 text-xs text-stone-500"><MessageCircle size={13} />{item.mensajes_total || 0}</span>
                      </div>
                    </div>
                  </button>)}
            </div>
            {!cargando && total > 50 && <div className="flex items-center justify-between border-t border-stone-200 px-4 py-3 text-xs text-stone-500">
              <span>Página {pagina} de {Math.ceil(total / 50)}</span>
              <div className="flex gap-2"><button type="button" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))} className="rounded-lg border border-stone-300 p-2 disabled:opacity-40"><ChevronLeft size={16} /></button><button type="button" aria-label="Página siguiente" disabled={pagina >= Math.ceil(total / 50)} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-stone-300 p-2 disabled:opacity-40"><ChevronRight size={16} /></button></div>
            </div>}
          </section>

          <section className="min-h-[420px] rounded-2xl border border-stone-200 bg-white shadow-[0_4px_24px_rgba(40,30,15,.05)]">
            {!seleccion ? <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f7f3ea] text-[#a17b3b]"><MessageCircle size={25} /></span><h2 className="mt-4 text-lg font-semibold">Selecciona un caso</h2><p className="mt-1 max-w-sm text-sm text-stone-500">El detalle, las evidencias y las acciones de revisión aparecerán aquí.</p></div>
              : cargandoDetalle || !detalle ? <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-stone-500"><Loader2 size={18} className="animate-spin" />Cargando expediente…</div>
                : <div className="divide-y divide-stone-200">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#f4efe4] px-2.5 py-1 text-xs font-medium text-[#88672f]">{labelTipo(detalle.tipo)}</span><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">{detalle.estado.replaceAll('_', ' ')}</span></div><h2 className="mt-3 text-xl font-semibold">Expediente de disputa</h2><p className="mt-1 text-sm text-stone-500">Creada {dateTime(detalle.creado_at)} · Reserva {detalle.booking_id.slice(0, 8)}</p></div>
                      {detalle.estado === 'ABIERTA' && <button disabled={guardando} onClick={() => void actualizarEstado()} type="button" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"><Check size={16} />Iniciar revisión</button>}
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-[#faf8f4] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Cliente</p><p className="mt-2 flex items-center gap-2 font-medium"><UserRound size={16} className="text-stone-400" />{detalle.cliente_nombre || detalle.iniciado_por_nombre || 'Sin nombre'}</p><p className="mt-1 break-all text-xs text-stone-500">{detalle.cliente_email || detalle.iniciado_por_email || ''}</p></div>
                      <div className="rounded-xl bg-[#faf8f4] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Prestador</p><p className="mt-2 flex items-center gap-2 font-medium"><UserRound size={16} className="text-stone-400" />{detalle.prestador_nombre || 'Sin nombre'}</p><p className="mt-1 break-all text-xs text-stone-500">{detalle.prestador_email || ''}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600"><span className="inline-flex items-center gap-2"><Wallet size={16} className="text-[#b38a43]" />Monto en disputa: <b className="text-stone-900">{money(detalle.monto_disputado)}</b></span><span>Servicio: <b className="text-stone-900">{detalle.servicio_nombre || '—'}</b></span></div>
                    <div className="mt-5"><h3 className="text-sm font-semibold">Descripción del caso</h3><p className="mt-2 whitespace-pre-wrap rounded-xl border border-stone-200 p-4 text-sm leading-6 text-stone-700">{detalle.descripcion || 'No se adjuntó descripción.'}</p></div>
                    <div className="mt-5"><h3 className="text-sm font-semibold">Evidencias <span className="font-normal text-stone-500">({detalle.evidencia_urls?.length || 0})</span></h3>
                      {detalle.evidencia_urls?.length ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{detalle.evidencia_urls.map((url, index) => {
                        const inlineImage = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url);
                        if (inlineImage) return <div key={`evidencia-${index}`} className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50"><img src={url} alt={`Evidencia ${index + 1}`} className="aspect-[4/3] h-full w-full object-cover" /></div>;
                        if (/^https?:\/\//i.test(url)) return <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="group relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50"><img src={url} alt={`Evidencia ${index + 1}`} className="h-full w-full object-cover transition group-hover:scale-[1.03]" /><span className="absolute bottom-2 right-2 rounded-full bg-white/90 p-1.5 text-stone-700"><ArrowUpRight size={14} /></span></a>;
                        return <div key={`${url}-${index}`} className="flex items-center gap-2 rounded-lg bg-stone-50 p-3 text-xs text-stone-500"><FileImage size={16} />Evidencia {index + 1} no disponible</div>;
                      })}</div> : <p className="mt-2 rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-500">No hay archivos de evidencia adjuntos.</p>}
                    </div>
                  </div>

                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Conversación del caso</h3><span className="text-xs text-stone-500">{detalle.mensajes?.length || 0} mensajes</span></div>
                    <div className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl bg-[#faf8f4] p-3 sm:p-4">
                      {!detalle.mensajes?.length ? <p className="py-8 text-center text-sm text-stone-500">Aún no hay respuestas ni notas.</p> : detalle.mensajes.map((item) => <article key={item.id} className={`max-w-[92%] rounded-xl border p-3 ${item.audiencia === 'INTERNA' ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-white'}`}><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><b>{item.audiencia === 'INTERNA' ? 'Nota interna' : item.remitente_nombre || 'Equipo GlowApp'}</b><time className="text-stone-500">{dateTime(item.creado_at)}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-stone-700">{item.mensaje}</p>{item.audiencia === 'PARTES' && item.evidencia_urls?.length ? <div className="mt-3 flex flex-wrap gap-2">{item.evidencia_urls.map((url, index) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) ? <img key={`${item.id}-${index}`} src={url} alt={`Evidencia de mensaje ${index + 1}`} className="h-24 w-28 rounded-lg border border-stone-200 object-cover" /> : null)}</div> : null}</article>)}
                    </div>
                    {detalle.estado !== 'RESUELTA' && detalle.estado !== 'CERRADA' && <div className="mt-3 space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row"><select value={audiencia} onChange={(e) => setAudiencia(e.target.value as 'PARTES' | 'INTERNA')} className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm"><option value="PARTES">Respuesta para las partes</option><option value="INTERNA">Nota interna</option></select><span className="self-center text-xs text-stone-500">{audiencia === 'PARTES' ? 'Quedará visible para cliente y prestador; se enviará aviso si hay canales configurados.' : 'Solo visible para el equipo administrador.'}</span></div>
                      <textarea value={mensaje} maxLength={4000} onChange={(e) => setMensaje(e.target.value)} rows={3} placeholder={audiencia === 'PARTES' ? 'Escribe una respuesta clara para las partes…' : 'Registra contexto interno para el equipo…'} className="w-full resize-y rounded-xl border border-stone-300 bg-white p-3 text-sm outline-none focus:border-[#bb9550] focus:ring-2 focus:ring-[#bb9550]/15" />
                      <div className="flex items-center justify-between"><span className="text-xs text-stone-500">{mensaje.length}/4000</span><button disabled={guardando || !mensaje.trim()} onClick={() => void enviarMensaje()} type="button" className="inline-flex h-10 items-center gap-2 rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-40"><Send size={15} />Guardar mensaje</button></div>
                    </div>}
                  </div>

                  {detalle.estado !== 'RESUELTA' && detalle.estado !== 'CERRADA' && <div className="p-5 sm:p-6">
                    <h3 className="text-base font-semibold">Resolución del caso</h3><p className="mt-1 text-sm text-stone-500">La decisión puede afectar el desembolso retenido. Registra el criterio aplicado.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
                      <label className="text-sm font-medium">Decisión<select value={resolucion} onChange={(e) => setResolucion(e.target.value as Resolucion)} className="mt-1 block h-11 w-full rounded-xl border border-stone-300 bg-white px-3 font-normal"><option value="FAVOR_PRESTADOR">A favor del prestador</option><option value="REEMBOLSO_TOTAL">Reembolso total</option><option value="DIVISION">Dividir el monto</option><option value="COMPENSACION_PLATAFORMA">Compensación de plataforma</option></select></label>
                      {resolucion === 'DIVISION' && <label className="text-sm font-medium">% prestador<input type="number" min="0" max="100" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} className="mt-1 block h-11 w-full rounded-xl border border-stone-300 px-3 font-normal" /></label>}
                    </div>
                    <label className="mt-3 block text-sm font-medium">Nota de resolución<textarea value={nota} maxLength={2000} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="Explica brevemente el criterio y las evidencias consideradas…" className="mt-1 w-full resize-y rounded-xl border border-stone-300 p-3 font-normal outline-none focus:border-[#bb9550] focus:ring-2 focus:ring-[#bb9550]/15" /></label>
                    <div className="mt-3 flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:flex-row sm:items-center"><span>Al confirmar, la operación registra la decisión y ejecuta el movimiento asociado. Verifica el expediente antes de continuar.</span><button disabled={guardando || detalle.estado === 'ABIERTA'} onClick={() => void resolver()} type="button" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#c19a4b] px-4 text-sm font-semibold text-white hover:bg-[#a98138] disabled:cursor-not-allowed disabled:opacity-45">{guardando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}Registrar resolución</button></div>
                    {detalle.estado === 'ABIERTA' && <p className="mt-2 text-xs text-stone-500">Inicia la revisión antes de habilitar la resolución.</p>}
                  </div>}

                  {(detalle.estado === 'RESUELTA' || detalle.estado === 'CERRADA') && <div className="m-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm sm:m-6"><CheckCircle2 size={18} className="mt-0.5 text-emerald-700" /><div><b>Caso {detalle.estado.toLowerCase()}</b>{detalle.resolucion && <p className="mt-1">{RESOLUCIONES.find((x) => x.value === detalle.resolucion)?.label || detalle.resolucion}</p>}{detalle.nota_resolucion && <p className="mt-2 text-stone-700">{detalle.nota_resolucion}</p>}{detalle.reembolso_estado && detalle.reembolso_estado !== 'NO_APLICA' && <p className="mt-2 font-medium">Reembolso: {detalle.reembolso_estado}{detalle.reembolso_monto ? ` · ${money(detalle.reembolso_monto)}` : ''}</p>}</div></div>}
                </div>}
          </section>
        </div>
        <p className="flex items-center gap-2 text-xs text-stone-500"><ShieldAlert size={14} />Las respuestas quedan en el historial. La notificación externa por correo o push requiere una integración adicional.</p>
      </div>
    </main>
  );
}
