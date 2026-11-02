CREATE TABLE IF NOT EXISTS user_biometrics (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    subtono FLOAT,
    estacion VARCHAR(50),
    paleta TEXT[], -- Array de colores en formato hex
    hidratacion FLOAT,
    sebo FLOAT,
    mensaje_aura TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
