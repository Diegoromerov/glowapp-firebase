export interface Message {
  id: string;
  sender_id: number | string;
  receiver_id: number | string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface Chat {
  id: number; // usually maps to the user we are chatting with
  conversation_partner_id?: number | string;
  partner_name?: string;
  other_user_id: number;
  other_user_name: string;
  other_user_foto?: string;
  other_user_rol: 'CLIENTE' | 'PRESTADOR';
  last_message?: string;
  last_message_time?: string;
  unread_count: number;
}
