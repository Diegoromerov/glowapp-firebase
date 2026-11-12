-- 141_referido_compra_puntos.sql
--
-- Regla de negocio (Director, 2026-11-11): el premio por invitar NO se acredita
-- a Wompi ni por la mera recomendación. Se acredita un fondo de puntos —canjeable
-- como descuento en productos— y sólo cuando el invitado hace una COMPRA
-- EFECTIVA de cualquier producto.
--
-- Antes la conversión se registraba al crear la primera RESERVA, que no es una
-- compra: el invitado podía no pagar nunca y el premio igual quedaba atribuido.
-- El monto pasa de $10.000 a $5.000 COP, que con la regla ya vigente
-- (500 XP = $5.000 COP) son 500 puntos.

ALTER TABLE referral_conversions
  ADD COLUMN IF NOT EXISTS order_id UUID;

ALTER TABLE referral_conversions
  ADD COLUMN IF NOT EXISTS points_awarded INTEGER NOT NULL DEFAULT 0;

-- El pedido que originó la conversión no puede aparecer dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS referral_conversions_pedido
  ON referral_conversions (order_id)
  WHERE order_id IS NOT NULL;
