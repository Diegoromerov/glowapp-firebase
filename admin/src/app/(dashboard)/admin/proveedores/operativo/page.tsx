'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';

interface ProviderOperational {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  is_active: boolean;
  estado_operativo: 'EXPLORACION' | 'EN_VERIFICACION' | 'HABILITADO' | 'SUSPENDIDO' | string;
  estado_operativo_desde: string | null;
  estado_operativo_motivo: string | null;
  rut_revision_estado: string | null;
  rut_numero: string | null;
  estatus_verificacion: string | null;
  tiene_documento: boolean;
  tiene_acreditacion: boolean;
  puede_habilitar: boolean;
  requisitos_pendientes: string[];
}

function estadoLabel(estado: string): string {
  switch (estado) {
    case 'HABILITADO': return 'Habilitado';
    case 'EN_VERIFICACION': return 'En verificación';
    case 'SUSPENDIDO': return 'Suspendido';
    default: return 'Exploración';
  }
}

function estadoClass(estado: string): string {
  switch (estado) {
    case 'HABILITADO': return 'bg-emerald-50 text-emerald-800';
    case 'EN_VERIFICACION': return 'bg-sky-50 text-sky-800';
    case 'SUSPENDIDO': return 'bg-rose-50 text-rose-800';
    default: return 'bg-amber-50 text-amber-800';
  }
}

function fecha(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('es-CO');
}

export default function ProviderOperationalPage() {
  const [providers, setProviders] = useState<ProviderOperational[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/glow-admin/provider/operational', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error(payload?.error || 'No se pudo cargar la lista de proveedores.');
      }
      setProviders(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar con el servicio.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  const visibles = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    if (!term) return providers;
    return providers.filter((provider) =>
      `${provider.nombre} ${provider.email} ${provider.id}`.toLocaleLowerCase('es').includes(term),
    );
  }, [providers, query]);

  const habilitar = async (provider: ProviderOperational) => {
    const tipo = provider.rol === 'SALON' ? 'al salón' : 'al prestador';
    if (!window.confirm(`¿Habilitar ${tipo} ${provider.nombre} para recibir reservas y cobrar? Se registrará esta decisión en la auditoría administrativa.`)) return;
    setActionId(provider.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/glow-admin/provider/${provider.id}/enable-operational`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) {
        const pendientes = Array.isArray(payload?.requisitos_pendientes) ? ` ${payload.requisitos_pendientes.join(' ')}` : '';
        throw new Error(`${payload?.error || 'No se pudo habilitar al proveedor.'}${pendientes}`);
      }
      setNotice(`${provider.nombre}: ${payload.message}`);
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo habilitar al proveedor.');
    } finally {
      setActionId(null);
    }
  };

  const habilitados = providers.filter((provider) => provider.estado_operativo === 'HABILITADO').length;
  const exploracion = providers.filter((provider) => provider.estado_operativo === 'EXPLORACION').length;

  return (
    <main className="min-h-screen space-y-6 bg-[#f7f5f0] p-4 text-[#27231d] md:p-8">
      <header className="flex flex-col justify-between gap-4 border-b border-[#e5dfd3] pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold text-[#92702c]">GlowAdmin / Proveedores</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Estado operativo</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6c655b]">
            Consulta el estado de prestadores y salones. Habilita reservas y cobros cuando identidad, acreditación y RUT estén aprobados.
          </p>
        </div>
        <button type="button" onClick={() => void loadProviders()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#d9cfbd] bg-white px-4 py-2 text-sm font-semibold text-[#514b42] hover:bg-[#f1eee7] disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Actualizar
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de estados">
        <div className="rounded-2xl border border-[#e5dfd3] bg-white p-5 shadow-sm"><p className="text-sm text-[#71685f]">Perfiles registrados</p><p className="mt-2 text-3xl font-bold">{loading ? '—' : providers.length}</p></div>
        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"><p className="text-sm text-[#71685f]">Habilitados</p><p className="mt-2 text-3xl font-bold text-emerald-800">{loading ? '—' : habilitados}</p></div>
        <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm"><p className="text-sm text-[#71685f]">En exploración</p><p className="mt-2 text-3xl font-bold text-amber-800">{loading ? '—' : exploracion}</p></div>
      </section>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" />{notice}</div>}

      <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#eee8de] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><h2 className="font-bold">Prestadores y salones</h2><p className="mt-1 text-xs text-[#777064]">Fuente: GET /api/glow-admin/provider/operational</p></div>
          <label className="relative w-full sm:max-w-sm"><span className="sr-only">Buscar por nombre, correo o ID</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#82796d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo o ID" className="min-h-11 w-full rounded-xl border border-[#ded7cb] py-2 pl-9 pr-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /></label>
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-[#71685f]"><Loader2 className="h-5 w-5 animate-spin" />Cargando proveedores…</div>
          : visibles.length === 0 ? <div className="p-12 text-center text-sm text-[#71685f]">{providers.length ? 'No hay resultados para esa búsqueda.' : 'No hay proveedores registrados.'}</div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[#faf8f4] text-xs uppercase tracking-wide text-[#71685f]"><tr><th className="px-5 py-3">Prestador</th><th className="px-4 py-3">Estado operativo</th><th className="px-4 py-3">Identidad / acreditación</th><th className="px-4 py-3">RUT</th><th className="px-4 py-3">Desde</th><th className="px-5 py-3">Acción</th></tr></thead>
              <tbody className="divide-y divide-[#eee8de]">{visibles.map((provider) => <tr key={provider.id} className="align-top hover:bg-[#fdfcf9]">
                <td className="px-5 py-4"><div className="flex items-start gap-3"><span className="mt-0.5 rounded-full bg-[#f1eee7] p-2 text-[#776442]"><UserRound className="h-4 w-4" /></span><span><span className="block font-semibold">{provider.nombre}</span><span className="mt-1 block text-xs text-[#777064]">{provider.rol === 'SALON' ? 'Salón' : 'Prestador'} · {provider.email} · ID {provider.id}</span></span></div></td>
                <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${estadoClass(provider.estado_operativo)}`}>{estadoLabel(provider.estado_operativo)}</span>{provider.estado_operativo_motivo && <p className="mt-2 max-w-56 text-xs text-[#777064]">{provider.estado_operativo_motivo}</p>}</td>
                <td className="px-4 py-4"><p className={provider.estatus_verificacion === 'APROBADO' && provider.tiene_documento && provider.tiene_acreditacion ? 'font-medium text-emerald-800' : 'font-medium text-amber-800'}>{provider.estatus_verificacion || 'Pendiente'}</p><p className="mt-1 text-xs text-[#777064]">Identidad: {provider.tiene_documento ? 'cargada' : 'faltante'} · Acreditación: {provider.tiene_acreditacion ? 'cargada' : 'faltante'}</p></td>
                <td className="px-4 py-4"><p className={provider.rut_revision_estado === 'APROBADA' && provider.rut_numero ? 'font-medium text-emerald-800' : 'font-medium text-amber-800'}>{provider.rut_revision_estado || 'SIN_ENVIAR'}</p><p className="mt-1 text-xs text-[#777064]">{provider.rut_numero ? `RUT ${provider.rut_numero}` : 'Sin número registrado'}</p></td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-1 text-xs text-[#71685f]"><Clock3 className="h-3.5 w-3.5" />{fecha(provider.estado_operativo_desde)}</span></td>
                <td className="px-5 py-4">{provider.estado_operativo === 'HABILITADO' ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><ShieldCheck className="h-4 w-4" />Operativo</span> : provider.estado_operativo === 'SUSPENDIDO' ? <span className="text-xs font-medium text-rose-800">Requiere revisión</span> : <><button type="button" onClick={() => void habilitar(provider)} disabled={!provider.puede_habilitar || actionId !== null} title={provider.requisitos_pendientes.join(' ')} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#302a24] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">{actionId === provider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Habilitar</button>{!provider.puede_habilitar && <p className="mt-2 max-w-52 text-xs text-[#777064]">{provider.requisitos_pendientes.join(' ') || 'No cumple los requisitos.'}</p>}</>}</td>
              </tr>)}</tbody>
            </table></div>}
      </section>
    </main>
  );
}
