'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Receipt, RefreshCw, AlertTriangle, CheckCircle, SlidersHorizontal, HelpCircle } from 'lucide-react';

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
}

interface Resumen {
  total_prestadores: number;
  declarados: number;
  sin_declarar: number;
  override: number;
}

type Filtro = 'todos' | 'sin_declarar' | 'declarado' | 'override';

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'sin_declarar', label: 'Sin declarar' },
  { id: 'declarado', label: 'Declarados' },
  { id: 'override', label: 'Override manual' },
];

export default function AdminPrestadoresIvaPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [prestadores, setPrestadores] = useState<PrestadorFiscal[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // RBAC: la misma guardia que el resto de páginas de admin.
  useEffect(() => {
    if (!loading && (!user || user.rol !== 'ADMIN')) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const fetchDatos = useCallback(async (estado: Filtro) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/providers/fiscal?estado=${estado}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || `El backend respondió ${res.status}.`);
        setPrestadores([]);
      } else {
        setPrestadores(data.prestadores || []);
        setResumen(data.resumen || null);
      }
    } catch {
      setError('No se pudo conectar con el backend.');
      setPrestadores([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatos(filtro);
  }, [filtro, fetchDatos]);

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

  const badge = (p: PrestadorFiscal) => {
    if (p.estado === 'MANUAL') {
      return { clase: 'bg-sky-500/10 border-sky-500/30 text-sky-300', label: 'Override manual' };
    }
    if (p.estado === 'DECLARADA') {
      return {
        clase: p.responsable_iva
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-slate-500/10 border-slate-500/30 text-slate-300',
        label: p.responsable_iva ? 'Declarado · responsable' : 'Declarado · no responsable',
      };
    }
    return { clase: 'bg-amber-500/10 border-amber-500/30 text-amber-300', label: 'Sin declarar' };
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Receipt className="text-rose-500 w-8 h-8" />
            <h1 className="text-3xl font-bold text-white tracking-tight">Prestadores · IVA</h1>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Quién acreditó su responsabilidad de IVA desde el RUT, quién no, y qué overrides manuales hay.
            Sin declaración no se presume responsable: sus reservas no discriminan IVA.
          </p>
        </div>

        <button
          onClick={() => fetchDatos(filtro)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm font-medium transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar Datos
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl flex justify-between items-center text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </span>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Censo (no depende del filtro) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Prestadores</span>
            <HelpCircle className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{resumen?.total_prestadores ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">Total con rol PRESTADOR</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Sin declarar</span>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{resumen?.sin_declarar ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">No se presume responsable (D3)</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Declarados</span>
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{resumen?.declarados ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">Condición tomada del RUT</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div className="flex justify-between items-start">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Override manual</span>
            <SlidersHorizontal className="w-5 h-5 text-sky-400" />
          </div>
          <p className="text-3xl font-extrabold text-white mt-4">{resumen?.override ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">Fijado por un admin, auditado (D1)</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
              filtro === f.id
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-6 py-3">Prestador</th>
                <th className="text-left px-6 py-3">RUT</th>
                <th className="text-left px-6 py-3">Casilla del RUT</th>
                <th className="text-left px-6 py-3">Responsable IVA</th>
                <th className="text-left px-6 py-3">Estado</th>
                <th className="text-left px-6 py-3">Actualizado</th>
                <th className="text-left px-6 py-3">Origen</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">Cargando…</td>
                </tr>
              )}

              {!loading && prestadores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    {filtro === 'sin_declarar'
                      ? 'Nadie está sin declarar: todos los prestadores acreditaron o tienen override.'
                      : 'No hay prestadores en este filtro.'}
                  </td>
                </tr>
              )}

              {!loading && prestadores.map((p) => {
                const b = badge(p);
                return (
                  <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-6 py-4">
                      <p className="text-white font-medium">{p.nombre}</p>
                      <p className="text-slate-500 text-xs">{p.email}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">{p.rut_numero || '—'}</td>
                    <td className="px-6 py-4 text-slate-400">{codigoLabel(p.rut_responsabilidad_codigo)}</td>
                    <td className="px-6 py-4">
                      <span className={p.responsable_iva ? 'text-emerald-300' : 'text-slate-400'}>
                        {p.responsable_iva ? 'Sí' : 'No'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full border text-xs font-medium ${b.clase}`}>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
