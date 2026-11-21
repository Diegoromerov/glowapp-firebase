'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, BadgeCheck, CalendarDays, CheckCircle2, Eye, EyeOff, Loader2, Search, Shield, Sparkles, UserRound, UsersRound } from 'lucide-react';

type UserProfile = {
  id: number; nombre: string; email: string; phone: string | null; foto_url: string | null;
  ciudad: string | null; bio: string | null; slug: string | null; auth_provider: string | null; provider_id: string | null;
  rol: string | null; worker_type: string | null; onboarding_completo: boolean;
  is_active: boolean; email_verificado: boolean; creado_en: string | null; fecha_alta: string | null;
  habeas_data_accepted_at: string | null; habeas_data_ip: string | null;
  terminos_accepted_at: string | null; terminos_ip: string | null; tenant_id: number | null;
  estado_operativo: string | null; estado_operativo_desde: string | null; estado_operativo_motivo: string | null;
  referral_code: string | null; referred_by_user_id: number | null; referral_converted_at: string | null;
  glowai_plan: string | null; glowai_diagnosticos_mes: number | null; glowai_ciclo_reset_at: string | null;
  streak_actual: number | null; streak_maximo: number | null; streak_ultimo_registro: string | null;
  ultimo_nivel_notificado: string | null; colorimetria_diagnosticos_mes: number | null;
  colorimetria_mes_referencia: string | null; glowstyle_outfits_mes: number | null;
  glowstyle_mes_referencia: string | null; visibilidad_suspendida: boolean;
};

const empty = 'No registrado';
const formatValue = (v: unknown) => v === null || v === undefined || v === '' ? empty : String(v);
const date = (v: string | null) => v ? new Date(v).toLocaleString('es-CO') : empty;

function Field({ label, value: fieldValue }: { label: string; value: unknown }) {
  return <div className="min-w-0 rounded-xl bg-[#f8f6f2] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#82796d]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[#302a24]">{formatValue(fieldValue)}</p></div>;
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#e5dfd3] bg-white p-5 shadow-sm sm:p-6"><div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-[#fbf2e1] p-2 text-[#92702c]">{icon}</span><h2 className="text-lg font-bold text-[#302a24]">{title}</h2></div><div className="grid gap-3 sm:grid-cols-2">{children}</div></section>;
}

export default function UserProfilesPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => users.find((user) => user.id === selectedId) || null, [users, selectedId]);

  async function searchUsers(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) { setError('Escribe al menos 2 caracteres para buscar.'); setUsers([]); setSelectedId(null); return; }
    setLoading(true); setError(null); setSearched(true);
    try {
      const response = await fetch(`/api/admin/users/profile?q=${encodeURIComponent(term)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) throw new Error(payload?.error || 'No se pudieron cargar los perfiles.');
      setUsers(payload.data); setSelectedId(payload.data[0]?.id ?? null);
    } catch (cause) { setUsers([]); setSelectedId(null); setError(cause instanceof Error ? cause.message : 'No se pudo conectar con el servicio.'); }
    finally { setLoading(false); }
  }

  async function changeVisibility(user: UserProfile) {
    const suspended = !user.visibilidad_suspendida;
    const action = suspended ? 'suspender' : 'reactivar';
    if (!window.confirm(`¿Deseas ${action} la visibilidad pública de ${user.nombre}? Su acceso a la cuenta no cambiará.`)) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/visibility`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ suspended }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) throw new Error(payload?.error || 'No se pudo actualizar la visibilidad.');
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, visibilidad_suspendida: suspended } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo conectar con el servicio.'); }
    finally { setSaving(false); }
  }

  return <main className="min-h-screen space-y-6 bg-[#f7f5f0] p-4 text-[#27231d] sm:p-6 lg:p-8">
    <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">GlowAdmin / Usuarios</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Perfil de usuarios</h1><p className="max-w-3xl text-sm leading-6 text-[#6c655b]">Hoja de vida de las cuentas registradas, agrupada por información personal, acceso, actividad y consentimientos. Busca por nombre, correo, teléfono o ID.</p></header>

    <form onSubmit={searchUsers} className="flex flex-col gap-3 rounded-2xl border border-[#e5dfd3] bg-white p-4 shadow-sm sm:flex-row">
      <label className="relative min-w-0 flex-1"><span className="sr-only">Buscar usuario por nombre, correo, teléfono o ID</span><Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#82796d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, correo, teléfono o ID" className="min-h-12 w-full rounded-xl border border-[#ded7cb] bg-white py-3 pl-10 pr-4 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /></label>
      <button disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#302a24] px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Buscar</button>
    </form>

    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
    {searched && users.length === 0 && !loading && !error && <div className="rounded-2xl border border-[#e5dfd3] bg-white p-10 text-center text-sm text-[#6c655b]">No encontramos usuarios con esos datos.</div>}

    {users.length > 0 && <div className="grid items-start gap-5 xl:grid-cols-[minmax(250px,0.7fr)_minmax(0,1.7fr)]">
      <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm"><div className="border-b border-[#eee8de] px-5 py-4"><h2 className="font-bold">Resultados</h2><p className="mt-1 text-xs text-[#777064]">{users.length} usuario{users.length === 1 ? '' : 's'} encontrado{users.length === 1 ? '' : 's'}</p></div><div className="max-h-[70vh] divide-y divide-[#eee8de] overflow-y-auto">{users.map((user) => <button key={user.id} type="button" onClick={() => setSelectedId(user.id)} className={`flex w-full items-center gap-3 p-4 text-left transition hover:bg-[#faf8f4] ${selectedId === user.id ? 'bg-amber-50' : ''}`}>{user.foto_url ? <img src={user.foto_url} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f1eee7] text-[#776442]"><UserRound className="h-5 w-5" /></span>}<span className="min-w-0"><span className="block truncate text-sm font-semibold">{user.nombre}</span><span className="block truncate text-xs text-[#777064]">{user.email} · {user.rol || 'Sin rol'}</span></span></button>)}</div></section>

      {selected && <article className="min-w-0 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-[#e5dfd3] bg-white shadow-sm"><div className="flex flex-col gap-4 bg-gradient-to-r from-[#fffaf0] to-white p-5 sm:flex-row sm:items-center sm:p-7">{selected.foto_url ? <img src={selected.foto_url} alt={`Foto de ${selected.nombre}`} className="h-20 w-20 rounded-2xl object-cover" /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#f1eee7] text-[#776442]"><UserRound className="h-9 w-9" /></div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">{selected.nombre}</h2><span className={`rounded-full px-3 py-1 text-xs font-semibold ${selected.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{selected.is_active ? 'Cuenta activa' : 'Cuenta inactiva'}</span></div><p className="mt-1 text-sm text-[#71685f]">{selected.rol || 'Rol no registrado'} · ID {selected.id}</p></div>
          {['PRESTADOR', 'SALON'].includes(String(selected.rol).toUpperCase()) && <button type="button" disabled={saving} onClick={() => void changeVisibility(selected)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${selected.visibilidad_suspendida ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-700 hover:bg-rose-800'}`}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : selected.visibilidad_suspendida ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{selected.visibilidad_suspendida ? 'Activar visibilidad' : 'Suspender visibilidad'}</button>}
        </div>{selected.visibilidad_suspendida && <div className="border-t border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-900">Perfil público suspendido. La cuenta y su acceso siguen activos.</div>}</section>

        <Group title="Datos personales y contacto" icon={<UserRound className="h-5 w-5" />}><Field label="Nombre" value={selected.nombre} /><Field label="Correo electrónico" value={selected.email} /><Field label="Teléfono" value={selected.phone} /><Field label="Ciudad" value={selected.ciudad} /><Field label="Biografía" value={selected.bio} /><Field label="Slug público" value={selected.slug} /></Group>
        <Group title="Cuenta y acceso" icon={<Shield className="h-5 w-5" />}><Field label="ID de usuario" value={selected.id} /><Field label="Rol" value={selected.rol} /><Field label="Tipo de trabajador" value={selected.worker_type} /><Field label="Proveedor de autenticación" value={selected.auth_provider} /><Field label="ID externo de autenticación" value={selected.provider_id} /><Field label="Cuenta activa" value={selected.is_active ? 'Sí' : 'No'} /><Field label="Correo verificado" value={selected.email_verificado ? 'Sí' : 'No'} /><Field label="Onboarding" value={selected.onboarding_completo ? 'Completo' : 'Pendiente'} /><Field label="Tenant" value={selected.tenant_id} /></Group>
        <Group title="Estado y fechas de la cuenta" icon={<CalendarDays className="h-5 w-5" />}><Field label="Fecha de alta" value={date(selected.fecha_alta || selected.creado_en)} /><Field label="Creado en" value={date(selected.creado_en)} /><Field label="Estado operativo" value={selected.estado_operativo} /><Field label="Estado operativo desde" value={date(selected.estado_operativo_desde)} /><Field label="Motivo del estado" value={selected.estado_operativo_motivo} /><Field label="Visibilidad pública" value={selected.visibilidad_suspendida ? 'Suspendida' : 'Activa'} /></Group>
        <Group title="Privacidad y aceptación" icon={<BadgeCheck className="h-5 w-5" />}><Field label="Habeas Data aceptado" value={date(selected.habeas_data_accepted_at)} /><Field label="IP de aceptación Habeas Data" value={selected.habeas_data_ip} /><Field label="Términos aceptados" value={date(selected.terminos_accepted_at)} /><Field label="IP de aceptación de términos" value={selected.terminos_ip} /></Group>
        <Group title="Referidos" icon={<UsersRound className="h-5 w-5" />}><Field label="Código de referido" value={selected.referral_code} /><Field label="ID de quien refirió" value={selected.referred_by_user_id} /><Field label="Fecha de conversión" value={date(selected.referral_converted_at)} /></Group>
        <Group title="GlowAI y actividad" icon={<Sparkles className="h-5 w-5" />}><Field label="Plan GlowAI" value={selected.glowai_plan} /><Field label="Diagnósticos GlowAI del mes" value={selected.glowai_diagnosticos_mes} /><Field label="Reinicio del ciclo GlowAI" value={date(selected.glowai_ciclo_reset_at)} /><Field label="Racha actual" value={selected.streak_actual} /><Field label="Racha máxima" value={selected.streak_maximo} /><Field label="Último registro de racha" value={date(selected.streak_ultimo_registro)} /><Field label="Último nivel notificado" value={selected.ultimo_nivel_notificado} /><Field label="Diagnósticos de colorimetría del mes" value={selected.colorimetria_diagnosticos_mes} /><Field label="Mes de referencia de colorimetría" value={date(selected.colorimetria_mes_referencia)} /><Field label="Outfits GlowStyle del mes" value={selected.glowstyle_outfits_mes} /><Field label="Mes de referencia GlowStyle" value={date(selected.glowstyle_mes_referencia)} /></Group>
      </article>}
    </div>}
    {!searched && <div className="rounded-2xl border border-dashed border-[#d8cfbf] bg-white/70 p-10 text-center text-sm text-[#6c655b]"><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[#92702c]" />Busca un usuario por nombre, correo, teléfono o ID para consultar su hoja de vida.</div>}
  </main>;
}
