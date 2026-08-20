const db = require('./db');

async function ensureCmsSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cms_sections (
      id SERIAL PRIMARY KEY,
      page_path TEXT NOT NULL,
      section_key TEXT NOT NULL,
      selector TEXT NOT NULL,
      content_html TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_path, section_key)
    );

    CREATE TABLE IF NOT EXISTS cms_collections (
      id SERIAL PRIMARY KEY,
      collection_key TEXT NOT NULL,
      item_key TEXT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      link_url TEXT,
      extra_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      url TEXT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      image_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY,
      donor_name TEXT NOT NULL,
      email TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      message TEXT,
      donated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      page_path TEXT,
      section_key TEXT,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON cms_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON cms_audit_log(username);
    CREATE INDEX IF NOT EXISTS idx_audit_page ON cms_audit_log(page_path);
  `);

  // Seed a default admin if none exists
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM users');
  if (parseInt(rows[0].count, 10) === 0) {
    await db.query(
      'INSERT INTO users (username, password, email) VALUES ($1, $2, $3)',
      ['admin', 'admin123', 'admin@fenu-uganda.org']
    );
  }
}

async function seedCmsData() {
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM cms_sections');
  if (parseInt(rows[0].count, 10) === 0) {
    await db.query(
      `INSERT INTO cms_sections (page_path, section_key, selector, content_html, is_active)
       VALUES ($1, $2, $3, $4, 1)`,
      [
        'index.html',
        'homeHeroIntro',
        '.header-carousel',
        `<div class="hero-slide d-flex align-items-center" style="background-image: url('https://images.unsplash.com/photo-1509099836639-18ba1795216d?w=1600');"><div class="container"><div class="row"><div class="col-lg-9"><h1 class="display-2 text-white mb-4">Sustainable Quality Education for All</h1><p class="fs-5 text-white mb-5">FENU is Uganda's national coalition of civil society organizations united to improve education for every child.</p></div></div></div></div>`,
      ]
    );
  }
}

async function removeLegacyPartnerSeed() {
  await db.query(
    `DELETE FROM cms_collections WHERE collection_key = 'partners' AND item_key IN ('ancefa', 'gpe')`
  );
}

async function initCmsSchema() {
  try {
    await ensureCmsSchema();
    await seedCmsData();
    await removeLegacyPartnerSeed();
    console.log('[cms-schema] PostgreSQL schema initialised successfully.');
  } catch (err) {
    console.error('[cms-schema] Failed to initialise schema:', err.message);
    throw err;
  }
}

module.exports = { initCmsSchema };
