export interface Service {
  id: string;
  provider_id: number;
  name: string;
  description?: string;
  price: number;
  duration_minutes: number;
  category?: string;
  is_active: boolean;
  created_at: string;
}
