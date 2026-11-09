'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

/** Usuario de sesión tal como lo mantiene el panel en memoria (subconjunto de respuesta del BFF). */
export interface SessionUser {
  id: number;
  email: string;
  nombre: string;
  rol: 'CLIENTE' | 'PRESTADOR' | 'ADMIN' | 'SALON';
  onboarding_completo?: boolean;
  tenant_id?: string | number | null;
}

interface ApiUser {
  id?: string | number;
  email?: string;
  nombre?: string;
  full_name?: string;
  rol?: string;
  role?: string;
  tenant_id?: string | number | null;
  onboarding_completo?: boolean;
}

export interface AuthResponse {
  success?: boolean;
  admin?: ApiUser;
  user?: ApiUser;
  usuario?: ApiUser;
  [key: string]: unknown;
}

interface AuthContextType {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (data: { email: string; nombre: string; phone?: string; rol: 'CLIENTE' | 'PRESTADOR'; password: string }) => Promise<AuthResponse>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeRole(raw?: string, fallbackRole?: string): SessionUser['rol'] {
  const value = (raw || '').toUpperCase();
  if (value === 'ADMIN' || fallbackRole === 'admin') return 'ADMIN';
  if (value === 'PRESTADOR' || value === 'PROVIDER' || fallbackRole === 'provider') return 'PRESTADOR';
  if (value === 'SALON' || fallbackRole === 'salon') return 'SALON';
  return 'CLIENTE';
}

function buildSessionUser(apiUser: ApiUser): SessionUser {
  return {
    id: typeof apiUser.id === 'number' ? apiUser.id : parseInt(String(apiUser.id), 10) || 0,
    email: apiUser.email || '',
    nombre: apiUser.full_name || apiUser.nombre || 'Administrador',
    rol: normalizeRole(apiUser.rol, apiUser.role),
    tenant_id: apiUser.tenant_id || null,
    onboarding_completo: apiUser.onboarding_completo,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Consultar sesión activa contra el proxy BFF
    let isMounted = true;
    async function checkSession() {
      try {
        const response = await axios.get('/api/admin/auth/session', {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (isMounted && response.data && response.data.admin) {
          setUser(buildSessionUser(response.data.admin));
        }
      } catch (_) {
        if (isMounted) setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    checkSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (email: string, password: string): Promise<AuthResponse> => {
    setLoading(true);
    try {
      const response = await axios.post(
        '/api/admin/auth/login',
        { email, password },
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
      );

      const data = response.data as AuthResponse;
      const apiAdmin = data.admin || data.user || data.usuario;
      if (apiAdmin) {
        setUser(buildSessionUser(apiAdmin));
      }
      setLoading(false);
      return data;
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const register = async (data: { email: string; nombre: string; phone?: string; rol: 'CLIENTE' | 'PRESTADOR'; password: string }): Promise<AuthResponse> => {
    setLoading(true);
    try {
      const payload = {
        full_name: data.nombre,
        nombre: data.nombre,
        email: data.email,
        password: data.password,
        phone: data.phone || null,
        role: data.rol,
        rol: data.rol
      };
      const response = await axios.post('/api/auth/register', payload, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const body = response.data as AuthResponse;
      const apiUser = body.user || body.usuario;
      if (apiUser) {
        setUser(buildSessionUser(apiUser));
      }
      setLoading(false);
      return body;
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await axios.post(
        '/api/admin/auth/logout',
        {},
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
      );
    } catch (_) {}
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
