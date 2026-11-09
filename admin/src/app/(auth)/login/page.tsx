'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { Scissors, Mail, Lock } from 'lucide-react';

type AppRole = 'ADMIN' | 'PRESTADOR' | 'SALON' | 'CLIENTE';

/** Normaliza el rol que devuelve el backend (puede venir como `rol` o `role`, en mayúsculas o minúsculas). */
function normalizeRole(raw: unknown): AppRole | null {
  if (typeof raw !== 'string') return null;
  switch (raw.trim().toUpperCase()) {
    case 'ADMIN':
      return 'ADMIN';
    case 'PRESTADOR':
    case 'PROVIDER':
      return 'PRESTADOR';
    case 'SALON':
      return 'SALON';
    case 'CLIENTE':
    case 'CLIENT':
      return 'CLIENTE';
    default:
      return null;
  }
}

/** Fallback: decodifica el payload del JWT y usa su claim de rol cuando la respuesta de login no la incluye. */
function roleFromToken(token: unknown): AppRole | null {
  if (typeof token !== 'string' || token.split('.').length < 2) return null;
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeRole(payload?.rol ?? payload?.role);
  } catch {
    return null;
  }
}

/** El rol se decide por la respuesta real de login(), nunca por el email. */
function resolveLoginRole(res: unknown): AppRole | null {
  const data = res as
    | { admin?: Record<string, unknown>; user?: Record<string, unknown>; usuario?: Record<string, unknown>; token?: string }
    | null
    | undefined;
  const apiUser = data?.admin ?? data?.user ?? data?.usuario;
  return normalizeRole(apiUser?.rol ?? apiUser?.role) ?? roleFromToken(data?.token);
}

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await login(email, password);

      // La autorización depende del ROL real de la cuenta, no del email introducido.
      const role = resolveLoginRole(res);
      if (role === 'ADMIN') {
        window.location.href = '/';
      } else if (role) {
        setError('Esta cuenta no tiene permisos de administrador para acceder a este panel.');
      } else {
        setError('No se pudo determinar el rol de tu cuenta. Contacta a soporte.');
      }
    } catch (err: unknown) {
      const apiError = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(apiError || 'Error al iniciar sesión. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col items-center mb-8">
        <div className="bg-primary text-primary-foreground p-3 rounded-2xl mb-4 shadow-lg border border-border">
          <Scissors size={28} />
        </div>
        <h2 className="text-3xl font-extrabold text-foreground tracking-tight font-serif">GlowAdmin Portal</h2>
        <p className="text-sm text-muted-foreground mt-1 font-sans">Gestión Directiva &amp; Operaciones de Belleza</p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-xl text-sm border border-destructive/30 mb-6 text-center">
          {error}
        </div>
      )}

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label className="block text-xs font-semibold text-foreground/80 uppercase tracking-wider mb-2">Correo Electrónico</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground">
              <Mail size={18} />
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 pr-4 py-3 w-full border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring text-sm transition-all duration-200 text-foreground bg-muted placeholder:text-muted-foreground"
              placeholder="admin@demo.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground/80 uppercase tracking-wider mb-2">Contraseña</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground">
              <Lock size={18} />
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 pr-4 py-3 w-full border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring text-sm transition-all duration-200 text-foreground bg-muted placeholder:text-muted-foreground"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold shadow-lg hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all duration-200 border border-border"
        >
          {submitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}
        </button>
      </form>

      <div className="mt-8 text-center border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          ¿Acceso no autorizado?{' '}
          <Link href="/" className="font-semibold text-gold hover:underline transition-colors">
            Volver al Inicio
          </Link>
        </p>
      </div>
    </div>
  );
}
