-- 086_add_iva_configuration.sql
--
-- MOTIVO (cumplimiento tributario, no una mejora de producto):
--
-- El artículo 476, numeral 1, del Estatuto Tributario excluye del IVA los
-- "servicios médicos, odontológicos, hospitalarios, clínicos y de laboratorio,
-- para la salud humana", PERO exceptúa expresamente de esa exclusión, en su
-- literal a), "los tratamientos de belleza". Es decir: los tratamientos de
-- belleza que se reservan en esta plataforma están GRAVADOS a la tarifa general
-- del 19% (art. 468 E.T.). No son un servicio excluido.
--
-- Hasta ahora el cliente mostraba un IVA del 19% que el backend nunca cobraba ni
-- registraba: se eliminó de la interfaz para que el precio mostrado fuera verdad
-- (hallazgo W4). Esta migración configura el IVA donde corresponde calcularlo.
--
-- DOS PRECISIONES QUE GOBIERNAN EL DISEÑO:
--
-- 1. No todo prestador es responsable de IVA. El parágrafo 3 del artículo 437
--    del E.T. (modificado por la Ley 2010 de 2019) exceptúa de la
--    responsabilidad a quien no supere 3.500 UVT de ingresos brutos, entre otras
--    condiciones. Ojo: eso es DISTINTO de que el servicio sea gravado — el hecho
--    de que los tratamientos de belleza tributen (art. 476) no convierte por sí
--    solo al prestador en responsable (art. 437). Son dos preguntas separadas.
--
--    La plataforma decidió tratar a TODOS sus prestadores como responsables
--    (todos prestan servicios gravados), y por eso el default es `true`. Como
--    `responsable_iva` es una columna por prestador, un prestador que declare
--    ser no responsable (RUT, responsabilidad 48/49) se corrige con un UPDATE.
--    Si el prestador no es responsable, no hay IVA que discriminar: base =
--    total, IVA = 0.
--
-- 2. El precio que publica el prestador es el precio FINAL al consumidor (el
--    Estatuto del Consumidor exige que el precio exhibido incluya los
--    impuestos), de modo que el IVA se DISCRIMINA del total y no se le suma:
--    la reserva conserva el precio que el cliente vio, y lo que queda separado
--    es la base gravable, que es lo que la factura necesita para desglosarlo.
--
-- Idempotente: el runner aplica este archivo a producción al desplegar y
-- reintenta si algo falla, así que todo va con IF NOT EXISTS.

-- Condición tributaria del prestador (el prestador es una fila de `usuarios`
-- con rol PRESTADOR: `provider_wallet.provider_id` y `bookings.provider_id`
-- referencian `usuarios(id)`).
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS responsable_iva BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tarifa_iva      NUMERIC(5,4) NOT NULL DEFAULT 0.1900;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_tarifa_iva_rango'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_tarifa_iva_rango
      CHECK (tarifa_iva >= 0 AND tarifa_iva <= 1);
  END IF;
END $$;

COMMENT ON COLUMN usuarios.responsable_iva IS
  'Si el prestador es responsable de IVA (art. 437 par. 3 E.T.). La plataforma trata a todos como responsables (default true); un prestador que declare lo contrario se marca en false.';
COMMENT ON COLUMN usuarios.tarifa_iva IS
  'Tarifa de IVA aplicable al prestador. General 19% (art. 468 E.T.); se guarda por si cambia.';

-- Desglose del IVA en la reserva. Se guarda CONGELADO al momento de crear la
-- reserva: la factura debe reproducir la base y el IVA que se causaron ese día,
-- no los que resulten si el prestador cambia de condición después.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS subtotal_base       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS iva_valor           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tarifa_iva_aplicada NUMERIC(5,4);

COMMENT ON COLUMN bookings.subtotal_base IS
  'Base gravable de la reserva (valor_bruto menos iva_valor). Igual a valor_bruto si no hay IVA.';
COMMENT ON COLUMN bookings.iva_valor IS
  'IVA discriminado del valor_bruto. No se suma: el precio al consumidor ya lo incluía.';
COMMENT ON COLUMN bookings.tarifa_iva_aplicada IS
  'Tarifa de IVA vigente al crear la reserva (0 si el prestador no era responsable).';
