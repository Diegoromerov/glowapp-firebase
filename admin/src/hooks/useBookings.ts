'use client';

import { useState, useEffect } from 'react';
import { apiClient, GetBookingsFilters } from '../lib/api-client';
import { Booking } from '../types/booking';

export type UseBookingsFilters = GetBookingsFilters;

/** Convierte el error del cliente HTTP en un mensaje legible para el usuario. */
export function describeBookingsError(err: unknown): string {
  const axiosErr = err as
    | { response?: { status?: number; data?: { error?: string } }; message?: string }
    | undefined;
  const status = axiosErr?.response?.status;
  if (status === 401) return 'Tu sesión expiró o no tienes permisos para ver estas citas. Vuelve a iniciar sesión.';
  if (status === 403) return 'Tu cuenta no tiene permisos para ver estas citas.';
  if (status === 404) return 'El backend no expone el endpoint de citas consultado (HTTP 404).';
  if (status) return `No se pudieron cargar las citas (HTTP ${status}).`;
  return axiosErr?.message || 'No se pudieron cargar las citas.';
}

export function useBookings(filters?: UseBookingsFilters) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getBookings(filters);
      setBookings(Array.isArray(data) ? (data as Booking[]) : []);
      setError(null);
    } catch (err) {
      // Sin datos: el error debe quedar visible en la UI en lugar de verse como "sin citas".
      setBookings([]);
      setError(describeBookingsError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [JSON.stringify(filters)]);

  const cancelBooking = async (id: number | string) => {
    try {
      await apiClient.cancelBooking(Number(id));
      // Refresh bookings
      await fetchBookings();
      return true;
    } catch (err) {
      setError(describeBookingsError(err));
      throw err;
    }
  };

  return {
    bookings,
    loading,
    error,
    refetch: fetchBookings,
    cancelBooking,
  };
}
