'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Send, Sparkles } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { Chat, Message } from '@/types/chat';

export default function ChatPage() {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [partnerId, setPartnerId] = useState<string>('0');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    try {
      setError(null);
      const result = await apiClient.getChats();
      const rows = Array.isArray(result) ? result : result?.data;
      const available: Chat[] = Array.isArray(rows) ? rows : [];
      setChats(available);
      if (available.length > 0 && partnerId === '0') setPartnerId(String(available[0].conversation_partner_id ?? available[0].other_user_id ?? available[0].id));
    } catch {
      setError('No se pudieron cargar las conversaciones.');
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => { void loadChats(); }, [loadChats]);

  useEffect(() => {
    if (chats.length > 0 && partnerId === '0') {
      const first = chats[0];
      const id = first.conversation_partner_id ?? first.other_user_id ?? first.id;
      if (id != null) setPartnerId(String(id));
    }
  }, [chats, partnerId]);

  const selectChat = (chat: Chat) => {
    const id = chat.conversation_partner_id ?? chat.other_user_id ?? chat.id;
    setPartnerId(String(id));
  };

  const loadMessages = useCallback(async () => {
    try {
      setError(null);
      const result = await apiClient.getMessages(partnerId);
      const rows = Array.isArray(result) ? result : result?.data;
      setMessages(Array.isArray(rows) ? rows : []);
    } catch {
      setMessages([]);
      setError('No se pudieron cargar los mensajes.');
    }
  }, [partnerId]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = inputText.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.sendMessage(partnerId, { message });
      setInputText('');
      await Promise.all([loadMessages(), loadChats()]);
    } catch {
      setError('No se pudo enviar el mensaje. Inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const activeChat = chats.find((chat) => String(chat.conversation_partner_id ?? chat.other_user_id ?? chat.id) === partnerId);

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-140px)] flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Centro de Mensajes</h2>
          <p className="text-gray-500 mt-1">Mensajes reales de tus conversaciones.</p>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200/80 flex flex-col overflow-hidden">
        {chats.length > 0 && <nav aria-label="Conversaciones" className="flex gap-2 overflow-x-auto border-b border-gray-100 p-3">
          {chats.map((chat) => {
            const id = String(chat.conversation_partner_id ?? chat.other_user_id ?? chat.id);
            return <button key={id} type="button" onClick={() => selectChat(chat)} aria-pressed={partnerId === id} className={`rounded-full px-3 py-2 text-sm ${partnerId === id ? 'bg-rose-100 text-rose-900' : 'bg-gray-100 text-gray-700'}`}>
              {chat.partner_name ?? chat.other_user_name}
            </button>;
          })}
        </nav>}
        {/* Header Chat */}
        <div className="p-4 bg-gray-50 border-b border-gray-200/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-sm">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Soporte Concierge & Aura IA</h3>
              <p className="text-xs text-gray-500 font-semibold">
                {activeChat?.partner_name ?? activeChat?.other_user_name ?? (partnerId === '0' ? 'Aura IA' : 'Conversación')}
              </p>
            </div>
          </div>
        </div>

        {/* Message Container */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-gray-50/30">
          {loading && <p className="text-sm text-gray-500">Cargando conversaciones…</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!loading && messages.length === 0 && <p className="text-sm text-gray-500">No hay mensajes en esta conversación todavía.</p>}
          {messages.map((m) => {
            const isMe = String(m.sender_id) === String(user?.id);
            return <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="text-[11px] font-semibold text-gray-400 mb-1 px-1">{isMe ? (user?.nombre || 'Tú') : (activeChat?.partner_name ?? activeChat?.other_user_name ?? 'Aura IA')} • {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className={`max-w-md p-4 rounded-2xl text-sm ${
                isMe
                  ? 'bg-rose-500 text-white rounded-tr-none shadow-sm'
                  : 'bg-white text-gray-800 border border-gray-200/80 rounded-tl-none shadow-sm'
              }`}>
                {m.message}
              </div>
            </div>;
          })}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-gray-200/80 flex gap-3">
          <input
            type="text"
            placeholder="Escribe un mensaje para soporte o Aura..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={sending}
            className="flex-1 px-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="px-5 py-3 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold rounded-xl transition-all flex items-center gap-2"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
