'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000';

export function useSocket() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user) return;

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('🔌 Conectado a WebSocket de GlowApp');
      setConnected(true);
      
      // Registrar cliente en el WebSocket
      ws.send(JSON.stringify({
        type: 'register',
        userId: user.id
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📩 Mensaje de WebSocket recibido:', data);
        setMessages((prev) => [...prev, data]);
      } catch (err) {
        console.error('Error parseando mensaje WS:', err);
      }
    };

    ws.onclose = () => {
      console.log('🔌 Desconectado de WebSocket');
      setConnected(false);
    };

    ws.onerror = (error) => {
      console.error('Error en WebSocket:', error);
    };

    return () => {
      ws.close();
    };
  }, [user]);

  const send = useCallback((data: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    } else {
      console.warn('Intento de enviar mensaje WS sin conexión activa');
    }
  }, []);

  const joinBookingRoom = useCallback((bookingId: string, role: 'client' | 'provider') => {
    send({
      type: 'join_booking_room',
      bookingId,
      role
    });
  }, [send]);

  const sendLocationUpdate = useCallback((bookingId: string, latitude: number, longitude: number) => {
    if (!user) return;
    send({
      type: 'location_update',
      bookingId,
      latitude,
      longitude,
      providerId: user.id
    });
  }, [send, user]);

  return {
    connected,
    messages,
    send,
    joinBookingRoom,
    sendLocationUpdate,
    setMessages
  };
}
