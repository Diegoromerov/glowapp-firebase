-- rollback/142_puntos_libro.down.sql
--
-- Reversa de 142. Destruye el libro de puntos: los saldos canjeables se pierden.
-- Los `xp_logs` históricos NO se tocan (la migración nunca los modificó), así que
-- después de bajar 142 el XP de nivel queda igual que antes de subirla.
--
-- `points_movements` primero: la FK con ON DELETE RESTRICT impide borrar lotes
-- que tengan movimientos.

DROP INDEX IF EXISTS points_movements_vencimiento_unico;
DROP TABLE IF EXISTS points_movements;
DROP INDEX IF EXISTS points_lots_saldo;
DROP INDEX IF EXISTS points_lots_origen_referencia;
DROP TABLE IF EXISTS points_lots;
