import axios, { AxiosInstance, AxiosError } from 'axios';

export interface GetBookingsFilters {
  rol?: 'cliente' | 'prestador' | 'ADMIN';
  [key: string]: unknown;
}

export interface SendMessagePayload {
  message: string;
  image_path?: string;
}

export interface UpdateProfilePayload {
  full_name?: string;
  phone?: string;
  description?: string;
  active_start_hour?: number | null;
  active_end_hour?: number | null;
  weekly_schedule?: unknown;
  [key: string]: unknown;
}

/** Limpia la sesión del cliente enviando orden de logout al BFF y redirigiendo a login. */
function clearClientSession() {
  if (typeof window === 'undefined') return;
  axios.post('/api/admin/auth/logout', {}, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
}

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: '',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
    });

    // Interceptor para adjuntar encabezado CSRF X-Requested-With
    this.client.interceptors.request.use((config) => {
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
      return config;
    });

    // Interceptor para manejar 401 Unauthorized
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401 && typeof window !== 'undefined') {
          clearClientSession();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Bookings
  // El backend NO expone GET /api/bookings: solo /bookings/provider y /bookings/client
  async getBookings(filters?: GetBookingsFilters) {
    const { rol, ...params } = filters || {};
    const path = rol === 'prestador' ? '/api/bookings/provider' : '/api/bookings/client';
    const response = await this.client.get(path, { params });
    const payload = response.data;
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    return [];
  }

  async cancelBooking(id: number) {
    const response = await this.client.patch(`/api/bookings/${id}/cancel`);
    return response.data;
  }

  // Services
  async getServices() {
    const response = await this.client.get('/api/services');
    return response.data;
  }

  // Chats
  async getChats() {
    const response = await this.client.get('/api/chat/conversations');
    return response.data?.data ?? [];
  }

  async getMessages(partnerId: number | string) {
    const response = await this.client.get(`/api/chat/messages/${partnerId}`);
    return response.data?.data ?? [];
  }

  async sendMessage(partnerId: number | string, data: SendMessagePayload) {
    const response = await this.client.post('/api/chat/messages', {
      receiver_id: partnerId,
      ...data,
    });
    return response.data?.data;
  }

  // Profile
  async updateProfile(data: UpdateProfilePayload) {
    const response = await this.client.patch('/api/users/profile', data);
    return response.data;
  }
}

export const apiClient = new ApiClient();
