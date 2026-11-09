export interface User {
  id: number;
  email: string;
  nombre: string;
  foto_url?: string;
  auth_provider: 'GOOGLE' | 'OUTLOOK' | 'LOCAL' | 'APPLE';
  provider_id: string;
  phone?: string;
  rol: 'CLIENTE' | 'PRESTADOR' | 'ADMIN';
  onboarding_completo: boolean;
  is_active: boolean;
  creado_en: string;
}

export interface ProviderProfile {
  id: number;
  business_name?: string;
  description?: string;
  is_online: boolean;
  documento_id_url?: string;
  rut_url?: string;
  certificacion_url?: string;
  estatus_verificacion: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  rating_avg: number;
  rating_count: number;
  metodo_retiro: 'NEQUI' | 'BANCARIA';
  numero_cuenta_nequi?: string;
  documento_titular?: string;
}
