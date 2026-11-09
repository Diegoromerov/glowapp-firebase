'use client';

import React from 'react';
import Link from 'next/link';
import { useBookings } from '@/hooks/useBookings';
import { maskProviderName, maskServiceAddress, toClientVisibleAmount } from '@/lib/security';
import { Calendar, Clock, MapPin, DollarSign, Tag, UserCheck, XCircle } from 'lucide-react';

export default function ClienteDashboard() {
  const { bookings, loading, cancelBooking } = useBookings({ rol: 'cliente' });
  
  const proximasReservas = bookings.filter((b) => 
    ['PENDIENTE_PAGO', 'CONFIRMADA', 'EN_PROGRESO'].includes(b.estado)
  );

  const completedReservas = bookings.filter((b) => 
    ['COMPLETADA'].includes(b.estado)
  );

  const totalSpent = completedReservas.reduce((acc, curr) => acc + toClientVisibleAmount(curr.valor_bruto), 0);

  const handleCancel = async (id: string) => {
    if (confirm('¿Estás seguro de que deseas cancelar esta reserva?')) {
      try {
        await cancelBooking(id);
        alert('Cita cancelada con éxito.');
      } catch (err) {
        alert('No se pudo cancelar la cita.');
      }
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Tu Panel</h2>
        <p className="text-gray-500 mt-1">Resumen de tu actividad y citas de belleza a domicilio</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-rose-50 text-rose-500 p-4 rounded-xl">
            <Calendar size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Reservas Activas</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">{proximasReservas.length}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-emerald-50 text-emerald-500 p-4 rounded-xl">
            <UserCheck size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Servicios Completados</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">{completedReservas.length}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200/80 flex items-center gap-4">
          <div className="bg-amber-50 text-amber-500 p-4 rounded-xl">
            <DollarSign size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Invertido</p>
            <p className="text-2xl font-bold text-gray-950 mt-1">${totalSpent.toLocaleString('es-CO')}</p>
          </div>
        </div>
      </div>

      {/* Booking list */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-hidden">
        <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-lg text-gray-900">Tus Próximas Citas</h3>
          <Link href="/cliente/nueva-cita" className="text-sm font-semibold text-rose-500 hover:text-rose-600">
            Nueva Reserva →
          </Link>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando tus citas...</div>
        ) : proximasReservas.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 text-sm">No tienes citas programadas actualmente.</p>
            <Link href="/cliente/nueva-cita" className="inline-block mt-4 bg-rose-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-rose-600 transition-colors">
              Programar ahora
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {proximasReservas.map((booking) => (
              <div key={booking.id} className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-gray-50/50 transition-all duration-200">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                      booking.estado === 'CONFIRMADA' ? 'bg-emerald-50 text-emerald-600' :
                      booking.estado === 'EN_PROGRESO' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {booking.estado.replace('_', ' ')}
                    </span>
                    <span className="text-sm font-bold text-gray-900">${toClientVisibleAmount(booking.valor_bruto).toLocaleString('es-CO')}</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-base">{booking.service_name || 'Servicio de Belleza'}</h4>
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    <span>Estilista: <strong>{maskProviderName(booking.provider_name)}</strong></span>
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={14} />
                      {new Date(booking.scheduled_at).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} />
                      {new Date(booking.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {maskServiceAddress(booking.service_address) && (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={14} />
                        {maskServiceAddress(booking.service_address)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  {booking.estado === 'PENDIENTE_PAGO' && (
                    <button className="bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all duration-200">
                      Pagar Ahora
                    </button>
                  )}
                  {['PENDIENTE_PAGO', 'CONFIRMADA'].includes(booking.estado) && (
                    <button
                      onClick={() => handleCancel(booking.id)}
                      className="border border-gray-200 hover:border-red-200 hover:bg-red-50 text-gray-600 hover:text-red-500 text-sm font-semibold p-2.5 rounded-xl transition-all duration-200"
                      title="Cancelar Cita"
                    >
                      <XCircle size={20} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
