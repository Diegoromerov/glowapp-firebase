-- ============================================================
-- SEED: Proveedor Demo para inspección y testing
-- Ejecutar en: psql -d beauty_db -f backend/seed/prestador-demo.sql
-- O en Railway: railway connect postgresql < backend/seed/prestador-demo.sql
-- ============================================================

-- N-15: resuelto en la integración Fase D — unión de ambos fixes.
--   t_fix_tenant_08 quitó el hash versionado; t_fix_tenant_10 quitó el texto plano.
--   La versión de tenant_10 dejaba un hash bcrypt (mismo defecto N-2) y su verde se debía
--   a que su escáner ciego (`\d`) no podía verlo. Aquí: sin texto plano Y sin hash.
-- Contraseña del usuario demo: NO se versiona; se define con SEED_PASSWORD al sembrar.
-- Hash bcrypt (cost 10): __SEED_PASSWORD_HASH__

DO $$
DECLARE
    v_user_id INTEGER;
    v_provider_id INTEGER := 999;  -- ID fijo para pruebas consistentes
BEGIN
    -- 1. Crear/actualizar usuario base
    INSERT INTO usuarios (
        email,
        nombre,
        auth_provider,
        provider_id,
        rol,
        password_hash,
        onboarding_completo,
        is_active,
        phone,
        habeas_data_accepted_at
    ) VALUES (
        'proveedor.demo@glowapp.com',
        'Proveedor Demo GlowApp',
        'LOCAL',
        'proveedor.demo@glowapp.com',
        'PRESTADOR',
        '__SEED_PASSWORD_HASH__',
        true,
        true,
        '+573001234567',
        NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        nombre = EXCLUDED.nombre,
        rol = EXCLUDED.rol,
        is_active = true,
        onboarding_completo = true,
        habeas_data_accepted_at = NOW()
    RETURNING id INTO v_user_id;

    -- Si ya existía, obtener el ID
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id FROM usuarios WHERE email = 'proveedor.demo@glowapp.com';
    END IF;

    -- Forzar el ID del perfil al valor fijo 999 para consistencia en testing
    -- (Solo si no hay colisión con datos reales)
    IF v_user_id != v_provider_id THEN
        -- Reasignar ID del usuario al fijo 999 (cuidado en prod)
        UPDATE usuarios SET id = v_provider_id WHERE id = v_user_id;
        v_user_id := v_provider_id;
    END IF;

    RAISE NOTICE 'Usuario creado/actualizado con ID: %', v_user_id;

    -- 2. Crear/actualizar perfil de prestador
    INSERT INTO perfiles_prestador (
        id,
        business_name,
        description,
        is_online,
        ubicacion,
        portafolio_servicios,
        documento_id_url,
        rut_url,
        certificacion_url,
        estatus_verificacion,
        rating_avg,
        rating_count,
        is_active,
        metodo_retiro,
        numero_cuenta_nequi,
        documento_titular
    ) VALUES (
        v_user_id,
        'Salón Demo GlowApp',
        'Salón de belleza integral para testing y demo. Ofrecemos manicura, pedicura, corte, barba y tratamientos faciales.',
        true,
        ST_SetSRID(ST_MakePoint(-74.0817, 4.6097), 4326)::geography,  -- Bogotá centro
        '["manicura", "pedicura", "corte", "barba", "facial"]'::jsonb,
        'https://storage.glowapp.co/demo/cedula_proveedor_demo.pdf',
        'https://storage.glowapp.demo/rut_proveedor_demo.pdf',
        'https://storage.glowapp.demo/certificacion_proveedor_demo.pdf',
        'APROBADO',
        4.8,
        25,
        true,
        'NEQUI',
        '3001234567',
        '1234567890'
    )
    ON CONFLICT (id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        description = EXCLUDED.description,
        is_online = true,
        estatus_verificacion = 'APROBADO',
        is_active = true,
        metodo_retiro = 'NEQUI',
        numero_cuenta_nequi = '3001234567',
        documento_titular = '1234567890';

    RAISE NOTICE 'Perfil prestador creado/actualizado para ID: %', v_user_id;

    -- 3. Crear wallet del prestador (trigger automático lo hace, pero aseguramos)
    INSERT INTO provider_wallet (provider_id, saldo_disponible, saldo_pendiente, modelo_retiro)
    VALUES (v_user_id, 150000.00, 50000.00, 'DEMANDA')
    ON CONFLICT (provider_id) DO UPDATE SET
        saldo_disponible = 150000.00,
        saldo_pendiente = 50000.00;

    -- 4. Crear servicios del proveedor demo
    INSERT INTO services (provider_id, name, description, price, duration_minutes, category, is_active) VALUES
        (v_user_id, 'Manicura Spa', 'Manicura completa con exfoliación, hidratación y masaje de manos', 45000.00, 60, 'Uñas', true),
        (v_user_id, 'Pedicura Spa', 'Pedicura completa con exfoliación, hidratación y masaje de pies', 55000.00, 75, 'Uñas', true),
        (v_user_id, 'Corte Caballero', 'Corte de cabello clásico con tijera y máquina, incluye lavado', 35000.00, 45, 'Cabello', true),
        (v_user_id, 'Corte + Barba', 'Corte de cabello + arreglo y perfilado de barba con toalla caliente', 55000.00, 60, 'Cabello', true),
        (v_user_id, 'Limpieza Facial Profunda', 'Limpieza facial con vapor, extracción, mascarilla y alta frecuencia', 80000.00, 60, 'Piel', true),
        (v_user_id, 'Diseño de Cejas', 'Depilación con cera + diseño + tinte henna', 30000.00, 30, 'Cejas', true)
    ON CONFLICT DO NOTHING;

    -- 5. Crear algunos portfolio items
    INSERT INTO portfolio_items (provider_id, image_url, title, category, likes_count) VALUES
        (v_user_id, 'https://images.unsplash.com/photo-1604654167434-09226b8b9489?w=400', 'Manicura Francesa Clásica', 'Uñas', 12),
        (v_user_id, 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400', 'Corte Moderno Caballero', 'Cabello', 25),
        (v_user_id, 'https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400', 'Pedicura Spa Completa', 'Uñas', 8),
        (v_user_id, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400', 'Limpieza Facial Profunda', 'Piel', 15)
    ON CONFLICT DO NOTHING;

    -- 6. Insertar consentimiento biométrico demo (para testing de IA)
    INSERT INTO biometric_consents (user_id, consent_type, granted, granted_at, purpose, version_terms)
    VALUES 
        (v_user_id, 'all_biometric', true, NOW(), 'Permitir análisis facial y de manos para recomendaciones personalizadas de servicios y productos', '1.0'),
        (v_user_id, 'virtual_try_on', true, NOW(), 'Permitir prueba virtual de colores de uñas y maquillaje', '1.0'),
        (v_user_id, 'geolocation_tracking', true, NOW(), 'Permitir ubicación en tiempo real durante servicios a domicilio', '1.0')
    ON CONFLICT (user_id, consent_type, version_terms) DO UPDATE SET
        granted = true,
        granted_at = NOW(),
        revoked_at = NULL;

    RAISE NOTICE '=== SEED PROVEEDOR DEMO COMPLETADO ===';
    RAISE NOTICE 'Email: proveedor.demo@glowapp.com';
    RAISE NOTICE 'Password: REDACTED (definida por SEED_PASSWORD al sembrar)';
    RAISE NOTICE 'Provider ID: %', v_user_id;
    RAISE NOTICE 'Business: Salón Demo GlowApp';
    RAISE NOTICE 'Servicios: 6 creados';
    RAISE NOTICE 'Wallet: $150.000 disponible, $50.000 pendiente';
    RAISE NOTICE 'Consentimientos: all_biometric, virtual_try_on, geolocation_tracking';

END $$;

-- ============================================================
-- VERIFICACIÓN POST-SEED
-- ============================================================
SELECT 
    u.id,
    u.email,
    u.nombre,
    u.rol,
    u.is_active,
    p.business_name,
    p.estatus_verificacion,
    p.is_online,
    p.rating_avg,
    p.rating_count,
    pw.saldo_disponible,
    pw.saldo_pendiente,
    COUNT(s.id) as total_servicios
FROM usuarios u
JOIN perfiles_prestador p ON u.id = p.id
LEFT JOIN provider_wallet pw ON u.id = pw.provider_id
LEFT JOIN services s ON u.id = s.provider_id AND s.is_active = true
WHERE u.email = 'proveedor.demo@glowapp.com'
GROUP BY u.id, u.email, u.nombre, u.rol, u.is_active, p.business_name, p.estatus_verificacion, p.is_online, p.rating_avg, p.rating_count, pw.saldo_disponible, pw.saldo_pendiente;

-- Servicios creados
SELECT name, price, duration_minutes, category 
FROM services 
WHERE provider_id = (SELECT id FROM usuarios WHERE email = 'proveedor.demo@glowapp.com')
AND is_active = true
ORDER BY category, name;