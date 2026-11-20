'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BriefcaseBusiness, CalendarClock, CheckCircle2, ExternalLink, FileText, Loader2, Search, ShieldCheck, Sparkles, Star, UserRound } from 'lucide-react';

interface ProviderProfile {
  id: number;
  nombre: string;
  email: string;
  phone: string | null;
  foto_url: string | null;
  rol: string;
  onboarding_completo: boolean;
  glowai_plan: string | null;
  glowai_diagnosticos_mes: number;
  glowai_ciclo_reset_at: string | null;
  streak_actual: number;
  streak_maximo: number;
  streak_ultimo_registro: string | null;
  is_active: boolean;
  rut_numero: string | null;
  rut_responsabilidad_codigo: number | null;
  responsable_iva: boolean | null;
  rut_revision_estado: string | null;
  business_name: string | null;
  description: string | null;
  rating_avg: number;
  rating_count: number;
  estatus_verificacion: string | null;
  is_verified: boolean;
  documento_id_url: string | null;
  certificacion_url: string | null;
  rut_url: string | null;
  perfil_activo: boolean | null;
  active_start_hour: number | null;
  active_end_hour: number | null;
  weekly_schedule: Record<string, { activo?: boolean; inicio?: number; fin?: number }> | null;
}

const DAYS = [
  ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'],
  ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo'],
] as const;

function display(value: unknown, suffix = ''): string {
  if (value === null || value === undefined || value === '') return 'No registrado';
  return `${String(value)}${suffix}`;
}

function hour(value?: number | null): string {
  return value === null || value === undefined ? '—' : `${String(value).padStart(2, '0')}:00`;
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded-xl bg-[#f8f6f2] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#82796d]">{label}</p><div className="mt-1 break-words text-sm font-semibold text-[#302a24]">{value}</div></div>;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#e5dfd3] bg-white p-5 shadow-sm sm:p-6"><div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-[#fbf2e1] p-2 text-[#92702c]">{icon}</span><h2 className="text-lg font-bold text-[#302a24]">{title}</h2></div>{children}</section>;
}

export default function ProviderProfilesPage() {
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => profiles.find((provider) => provider.id === selectedId) || null, [profiles, selectedId]);

  const searchProviders = async (term: string) => {
    const normalized = term.trim();
    if (normalized.length < 2) {
      setError('Escribe al menos 2 caracteres para buscar.');
      setProfiles([]);
      setSelectedId(null);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const response = await fetch(`/api/admin/providers/profile?q=${encodeURIComponent(normalized)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
        throw new Error(payload?.error || 'No se pudieron cargar los perfiles.');
      }
      setProfiles(payload.data);
      setSelectedId(payload.data[0]?.id ?? null);
    } catch (cause) {
      setProfiles([]);
      setSelectedId(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo conectar con el servicio.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialQuery = new URLSearchParams(window.location.search).get('q') || '';
    if (initialQuery.trim()) {
      setQuery(initialQuery);
      void searchProviders(initialQuery);
    }
    // Initial URL query should be loaded once when entering this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen space-y-6 bg-[#f7f5f0] p-4 text-[#27231d] sm:p-6 lg:p-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">GlowAdmin / Proveedores</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Perfil del proveedor</h1>
        <p className="max-w-3xl text-sm leading-6 text-[#6c655b]">Consulta la hoja de vida y los datos registrados del proveedor. Busca por nombre, número de documento o teléfono.</p>
      </header>

      <form className="flex flex-col gap-3 rounded-2xl border border-[#e5dfd3] bg-white p-4 shadow-sm sm:flex-row" onSubmit={(event) => { event.preventDefault(); void searchProviders(query); }}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Nombre, documento o teléfono</span>
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#82796d]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, documento o teléfono" className="min-h-12 w-full rounded-xl border border-[#ded7cb] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
        </label>
        <button disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#302a24] px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Buscar
        </button>
      </form>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}

      {searched && profiles.length === 0 && !loading && !error && <div className="rounded-2xl border border-[#e5dfd3] bg-white p-10 text-center text-sm text-[#6c655b]">No encontramos proveedores con ese nombre, documento o teléfono.</div>}

      {profiles.length > 0 && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(250px,0.7fr)_minmax(0,1.7fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm">
            <div className="border-b border-[#eee8de] px-5 py-4"><h2 className="font-bold">Resultados</h2><p className="mt-1 text-xs text-[#777064]">{profiles.length} proveedor{profiles.length === 1 ? '' : 'es'} encontrado{profiles.length === 1 ? '' : 's'}</p></div>
            <div className="max-h-[65vh] divide-y divide-[#eee8de] overflow-y-auto">
              {profiles.map((provider) => <button key={provider.id} type="button" onClick={() => setSelectedId(provider.id)} className={`flex w-full items-center gap-3 p-4 text-left transition hover:bg-[#faf8f4] ${selectedId === provider.id ? 'bg-amber-50' : ''}`}>
                {provider.foto_url ? <img src={provider.foto_url} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f1eee7] text-[#776442]"><UserRound className="h-5 w-5" /></span>}
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{provider.nombre}</span><span className="block truncate text-xs text-[#777064]">{provider.rut_numero || provider.phone || provider.email}</span></span>
              </button>)}
            </div>
          </section>

          {selected && <article className="min-w-0 space-y-5">
            <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm">
              <div className="flex flex-col gap-4 bg-gradient-to-r from-[#fffaf0] to-white p-5 sm:flex-row sm:items-center sm:p-7">
                {selected.foto_url ? <img src={selected.foto_url} alt={`Foto de ${selected.nombre}`} className="h-20 w-20 rounded-2xl object-cover" /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#f1eee7] text-[#776442]"><UserRound className="h-9 w-9" /></div>}
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">{selected.nombre}</h2><span className={`rounded-full px-3 py-1 text-xs font-semibold ${selected.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{selected.is_active ? 'Activo' : 'Inactivo'}</span></div><p className="mt-1 text-sm text-[#71685f]">{selected.business_name || 'Proveedor independiente'} · ID {selected.id}</p></div>
                <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-semibold sm:self-center ${selected.is_verified ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}><ShieldCheck className="h-4 w-4" />{selected.estatus_verificacion || 'Pendiente'}</div>
              </div>
            </section>

            <Section title="Datos personales" icon={<UserRound className="h-5 w-5" />}>
              <div className="grid gap-3 sm:grid-cols-2"><Detail label="Nombre completo" value={selected.nombre} /><Detail label="Correo electrónico" value={selected.email} /><Detail label="Teléfono" value={display(selected.phone)} /><Detail label="Documento / RUT" value={display(selected.rut_numero)} /><Detail label="Rol" value={selected.rol} /><Detail label="Onboarding" value={selected.onboarding_completo ? 'Completo' : 'Pendiente'} /></div>
            </Section>

            <Section title="Perfil profesional" icon={<BriefcaseBusiness className="h-5 w-5" />}>
              <div className="grid gap-3 sm:grid-cols-2"><Detail label="Nombre del negocio" value={display(selected.business_name)} /><Detail label="Verificación" value={selected.estatus_verificacion || 'No registrada'} /><Detail label="Calificación promedio" value={<span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-500" />{selected.rating_avg.toFixed(2)} / 5 ({selected.rating_count} reseñas)</span>} /><Detail label="Estado del perfil" value={selected.perfil_activo === null ? 'No registrado' : selected.perfil_activo ? 'Activo' : 'Inactivo'} /></div>
              <div className="mt-3 rounded-xl bg-[#f8f6f2] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#82796d]">Descripción profesional</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#302a24]">{display(selected.description)}</p></div>
            </Section>

            <Section title="Documentos y estado fiscal" icon={<FileText className="h-5 w-5" />}>
              <div className="grid gap-3 sm:grid-cols-2"><Detail label="Número RUT" value={display(selected.rut_numero)} /><Detail label="Responsabilidad RUT" value={display(selected.rut_responsabilidad_codigo)} /><Detail label="Responsable de IVA" value={selected.responsable_iva === null ? 'No registrado' : selected.responsable_iva ? 'Sí' : 'No'} /><Detail label="Revisión del RUT" value={selected.rut_revision_estado || 'No registrada'} /></div>
              <div className="mt-4 flex flex-wrap gap-2">{[['Identidad', selected.documento_id_url], ['Acreditación profesional', selected.certificacion_url], ['RUT', selected.rut_url]].map(([label, url]) => url ? <a key={label as string} href={url as string} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#ded7cb] px-3 py-2 text-sm font-semibold text-[#514b42] hover:bg-[#f8f6f2]">{label as string}<ExternalLink className="h-4 w-4" /></a> : <span key={label as string} className="rounded-lg bg-[#f8f6f2] px-3 py-2 text-sm text-[#777064]">{label as string}: No cargado</span>)}</div>
            </Section>

            <Section title="Disponibilidad" icon={<CalendarClock className="h-5 w-5" />}>
              <div className="mb-3 grid gap-3 sm:grid-cols-2"><Detail label="Horario general de inicio" value={hour(selected.active_start_hour)} /><Detail label="Horario general de cierre" value={hour(selected.active_end_hour)} /></div>
              <div className="grid gap-2 sm:grid-cols-2">{DAYS.map(([key, label]) => { const day = selected.weekly_schedule?.[key]; return <div key={key} className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f6f2] px-4 py-3 text-sm"><span className="font-semibold">{label}</span><span className={day?.activo ? 'text-emerald-700' : 'text-[#777064]'}>{day?.activo ? `${hour(day.inicio)} – ${hour(day.fin)}` : 'No disponible'}</span></div>; })}</div>
            </Section>

            <Section title="GlowAI y actividad" icon={<Sparkles className="h-5 w-5" />}>
              <div className="grid gap-3 sm:grid-cols-2"><Detail label="Plan GlowAI" value={display(selected.glowai_plan)} /><Detail label="Diagnósticos del mes" value={selected.glowai_diagnosticos_mes} /><Detail label="Reinicio del ciclo" value={selected.glowai_ciclo_reset_at ? new Date(selected.glowai_ciclo_reset_at).toLocaleString('es-CO') : 'No registrado'} /><Detail label="Racha actual" value={selected.streak_actual} /><Detail label="Racha máxima" value={selected.streak_maximo} /><Detail label="Último registro de racha" value={display(selected.streak_ultimo_registro)} /></div>
            </Section>
          </article>}
        </div>
      )}

      {!searched && <div className="rounded-2xl border border-dashed border-[#d8cfbf] bg-white/70 p-10 text-center text-sm text-[#6c655b]"><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[#92702c]" />Ingresa nombre, documento o teléfono para consultar la hoja de vida.</div>}
    </main>
  );
}
