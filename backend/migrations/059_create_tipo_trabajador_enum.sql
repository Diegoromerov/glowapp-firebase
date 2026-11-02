DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_trabajador') THEN
        CREATE TYPE tipo_trabajador AS ENUM ('EMPLEADO', 'PRESTADOR_SERVICIO', 'ADMIN_SALON', 'OTRO');
    END IF;
END $$;
