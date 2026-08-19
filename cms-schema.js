const db = require("./db");

function ensureCmsSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cms_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_path TEXT NOT NULL,
      section_key TEXT NOT NULL,
      selector TEXT NOT NULL,
      content_html TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_path, section_key)
    );

    CREATE TABLE IF NOT EXISTS cms_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_key TEXT NOT NULL,
      item_key TEXT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      link_url TEXT,
      extra_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      url TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- The tables below used to only get created if someone manually ran the
    -- old standalone init_db.js / create_audit_log.js scripts. They're
    -- queried by live routes in index.js (login, audit log, articles,
    -- donations), so they're created here automatically on every startup
    -- instead, so the app works immediately on a brand new install.

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donor_name TEXT NOT NULL,
      email TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      message TEXT,
      donated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON cms_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON cms_audit_log(username);
    CREATE INDEX IF NOT EXISTS idx_audit_page ON cms_audit_log(page_path);
  `);

  // A default admin account is required to log in at all on a fresh
  // install. No demo articles/donations/partners are seeded - only what an
  // admin actually adds should ever show up anywhere on the site.
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    db.prepare(
      "INSERT INTO users (username, password, email) VALUES (?, ?, ?)"
    ).run("admin", "admin123", "admin@fenu-uganda.org");
  }
}

function seedCmsData() {
  const sectionCount = db.prepare("SELECT COUNT(*) AS count FROM cms_sections").get()
    .count;
  if (sectionCount === 0) {
    const seedSection = db.prepare(`
      INSERT INTO cms_sections (page_path, section_key, selector, content_html, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);
    seedSection.run(
      "index.html",
      "homeHeroIntro",
      ".header-carousel",
      `<div class="hero-slide d-flex align-items-center" style="background-image: url('https://images.unsplash.com/photo-1509099836639-18ba1795216d?w=1600');"><div class="container"><div class="row"><div class="col-lg-9"><h1 class="display-2 text-white mb-4">Sustainable Quality Education for All</h1><p class="fs-5 text-white mb-5">FENU is Uganda's national coalition of civil society organizations united to improve education for every child.</p></div></div></div></div>`
    );
  }

  // NOTE: Partners are intentionally NOT auto-seeded. The Partners
  // collection should start empty and only ever contain what an admin adds
  // through the dashboard - exactly like Photos, Videos, News and Reports.
}

// One-time cleanup for databases created by earlier versions of this app,
// which auto-seeded two demo partners ("ancefa" / "gpe") on first run. Those
// rows are matched ONLY by their unique seed item_key, so this can never
// touch a real partner an admin has added themselves (admin-added partners
// always have item_key = NULL). Safe to run on every startup: once the rows
// are gone, this is a no-op forever after.
function removeLegacyPartnerSeed() {
  db.prepare(
    `DELETE FROM cms_collections WHERE collection_key = 'partners' AND item_key IN ('ancefa', 'gpe')`
  ).run();
}

function initCmsSchema() {
  ensureCmsSchema();
  seedCmsData();
  removeLegacyPartnerSeed();
}

module.exports = {
  initCmsSchema,
};
