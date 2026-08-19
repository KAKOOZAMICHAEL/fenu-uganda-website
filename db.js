const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use persistent storage path for Render compatibility
// On Render, use /var/data if available (persistent disk), otherwise use ./data
const dataDir = process.env.RENDER ? '/var/data' : './data';

// Ensure the data directory exists before connecting
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

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
