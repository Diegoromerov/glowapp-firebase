export interface Booking {
  id: string;
  client_id: number;
  provider_id: number;
  service_id: string;
  scheduled_at: string;
  valor_bruto: number;
  comision_plataforma: number;
  impuestos_estado: number;
  pago_neto_prestador: number;
  estado: 'PENDIENTE_PAGO' | 'CONFIRMADA' | 'EN_PROGRESO' | 'FINALIZADA_PRESTADOR' | 'COMPLETADA' | 'CANCELADA';
  pin_verificacion?: string;
  payment_status: string;
  service_address?: string;
  notes?: string;
  created_at: string;

  // Joined fields for display
  client_name?: string;
  provider_name?: string;
  service_name?: string;
}
