const { pool } = require('./src/config/db');

async function createIndexes() {
  try {
    console.log('Creating database performance indexes...');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);');
    console.log('- idx_bookings_client created');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);');
    console.log('- idx_bookings_provider created');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bookings_scheduled ON bookings(scheduled_at DESC);');
    console.log('- idx_bookings_scheduled created');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);');
    console.log('- idx_reviews_provider created');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_id);');
    console.log('- idx_services_provider created');
    
    console.log('✅ DATABASE PERFORMANCE INDEXES APPLIED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Error creating indexes:', err);
  } finally {
    pool.end();
  }
}

createIndexes();
