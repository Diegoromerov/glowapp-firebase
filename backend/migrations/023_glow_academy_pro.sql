-- Migration: 023_glow_academy_pro.sql
-- Nuevas tablas para Glow Academy Pro
-- NOTA: Las FKs a academy_certificates(id) se añaden en migración 034 (después de que 033 cree la columna id)

-- 1. Learning Paths
CREATE TABLE IF NOT EXISTS learning_paths (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    level VARCHAR(20) CHECK (level IN ('beginner', 'intermediate', 'advanced')),
    estimated_hours INTEGER,
    badge_id INTEGER, -- FK añadida en migración 034
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Path Courses (relación muchos a muchos)
-- academy_courses.id is UUID (from 008_academia_glow.sql)
CREATE TABLE IF NOT EXISTS path_courses (
    path_id INTEGER REFERENCES learning_paths(id),
    course_id UUID REFERENCES academy_courses(id),
    position INTEGER NOT NULL,
    prerequisite_course_id UUID REFERENCES academy_courses(id),
    PRIMARY KEY (path_id, course_id)
);

-- 3. Gamification - XP Log
CREATE TABLE IF NOT EXISTS xp_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    xp_amount INTEGER NOT NULL,
    reason VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. User Levels
CREATE TABLE IF NOT EXISTS user_levels (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    level VARCHAR(20) CHECK (level IN ('novice', 'intermediate', 'advanced', 'expert')),
    total_xp INTEGER NOT NULL,
    badge_id INTEGER, -- FK añadida en migración 034
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Badges (para gamificación y certificación)
CREATE TABLE IF NOT EXISTS badges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    criteria JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Community (foros, portfolio, chats)
CREATE TABLE IF NOT EXISTS community_posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(20) CHECK (type IN ('post', 'portfolio', 'question')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES community_posts(id),
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 7. Portfolios (para profesionales de belleza)
CREATE TABLE IF NOT EXISTS portfolios (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    media_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. Mentorship Sessions (integración con Zoom/Meet)
CREATE TABLE IF NOT EXISTS mentorship_sessions (
    id SERIAL PRIMARY KEY,
    mentor_id INTEGER NOT NULL,
    mentee_id INTEGER NOT NULL,
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER NOT NULL,
    meeting_link VARCHAR(500),
    status VARCHAR(20) CHECK (status IN ('scheduled', 'completed', 'canceled')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. QR Certificates (verificables)
CREATE TABLE IF NOT EXISTS qr_certificates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    certificate_id INTEGER, -- FK añadida en migración 034
    qr_code VARCHAR(500) NOT NULL,
    verification_url VARCHAR(500),
    issued_at TIMESTAMP DEFAULT NOW()
);

-- 10. Proximity / Location data for events (optional)
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 11. Event Registrations
CREATE TABLE IF NOT EXISTS event_registrations (
    event_id INTEGER REFERENCES events(id),
    user_id INTEGER NOT NULL,
    registration_time TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);

-- 12. Analytics (simple tracking table)
CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    event_type VARCHAR(100) NOT NULL,
    metadata JSONB,
    occurred_at TIMESTAMP DEFAULT NOW()
);

-- 13. Settings for Multilingual support
CREATE TABLE IF NOT EXISTS app_locales (
    id SERIAL PRIMARY KEY,
    locale_code VARCHAR(10) NOT NULL UNIQUE,
    language_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 14. User consent for GDPR
CREATE TABLE IF NOT EXISTS user_consents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    consent_type VARCHAR(100) NOT NULL,
    granted BOOLEAN NOT NULL,
    granted_at TIMESTAMP DEFAULT NOW()
);

-- Fin de migración 023_glow_academy_pro.sql
