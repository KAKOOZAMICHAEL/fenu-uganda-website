const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Determine data directory:
// - On Render WITH a persistent disk: /var/data is mounted and writable → use it
// - On Render free tier (no disk): /var/data is not writable → fall back to ./data
// - Local development: always use ./data
function resolveDataDir() {
  const preferredDir = '/var/data';
  const fallbackDir = path.join(__dirname, 'data');

  if (process.env.RENDER) {
    try {
      // Test if /var/data is accessible and writable
      fs.mkdirSync(preferredDir, { recursive: true });
      fs.accessSync(preferredDir, fs.constants.W_OK);
      return preferredDir;
    } catch (e) {
      // Not writable — fall back to local ./data
      console.warn('[db] /var/data not writable, falling back to ./data (data will not persist across restarts)');
    }
  }

  // Ensure local fallback directory exists
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}

const dataDir = resolveDataDir();

// Initialize the SQLite database
const db = new Database(path.join(dataDir, 'fenu.db'), {
    verbose: console.log
});

/**
 * Enable Write-Ahead Logging (WAL) mode.
 * WAL allows multiple readers and one writer to operate concurrently,
 * preventing read/write blocking which is ideal for a live dashboard.
 */
db.pragma('journal_mode = WAL');

module.exports = db;

