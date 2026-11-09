'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export interface AdminSessionUser {
  id: number;
  email: string;
  nombre: string;
  rol: 'ADMIN';
  onboarding_completo?: boolean;
  tenant_id?: string | number | null;
}

export interface UseAdminSessionReturn {
  user: AdminSessionUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook unificado para obtener la sesión de administrador vía BFF proxy.
 * Usa cookies HttpOnly (glow_access_token) automáticamente - no requiere localStorage.
 * El middleware ya valida el JWT y el rol ADMIN antes de renderizar la página.
 */
export function useAdminSession(): UseAdminSessionReturn {
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      setError(null);
      const response = await axios.get('/api/admin/auth/session', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      
      if (response.data && response.data.admin) {
        const apiUser = response.data.admin;
        setUser({
          id: typeof apiUser.id === 'number' ? apiUser.id : parseInt(String(apiUser.id), 10) || 0,
          email: apiUser.email || '',
          nombre: apiUser.full_name || apiUser.nombre || 'Administrador',
          rol: 'ADMIN',
          tenant_id: apiUser.tenant_id || null,
          onboarding_completo: apiUser.onboarding_completo,
        });
      } else {
        setUser(null);
        setError('No hay sesión de administrador activa');
      }
    } catch (err) {
      setUser(null);
      const axiosErr = err as { response?: { status?: number }; message?: string };
      if (axiosErr?.response?.status === 401) {
        setError('Sesión expirada o no autorizada');
      } else if (axiosErr?.response?.status === 403) {
        setError('Acceso denegado: se requieren permisos de administrador');
      } else {
        setError('Error al verificar la sesión');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  return { user, loading, error, refetch: fetchSession };
}