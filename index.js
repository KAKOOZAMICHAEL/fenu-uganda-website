require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const db = require('./db');
const { initCmsSchema } = require('./cms-schema');

// ── Cloudinary configuration ──────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Express / Socket.IO setup ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// ── Multer / Cloudinary storage engines ──────────────────────────────────────

// Images
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fenu-cms/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    resource_type: 'image',
  },
});
const upload = multer({
  storage: imageStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  },
});

// Videos
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fenu-cms/videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'webm', 'ogg', 'mov', 'avi'],
  },
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^video\/(mp4|webm|ogg|quicktime|x-msvideo)$/i.test(file.mimetype)) {
      return cb(new Error('Only video files are allowed.'));
    }
    cb(null, true);
  },
});

// PDF reports
const reportStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'fenu-cms/reports',
    resource_type: 'raw',
    allowed_formats: ['pdf'],
  },
});
const uploadReportPdf = multer({
  storage: reportStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed.'));
    }
    cb(null, true);
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const emitChange = (event, data) => io.emit(event, data);

// ── Helper: get a Cloudinary URL from a multer-cloudinary file ────────────────
function getFileUrl(file) {
  // multer-storage-cloudinary stores the URL in file.path
  return file.path || file.secure_url || '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARTICLES API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/articles', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM articles ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM articles WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Article not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', async (req, res) => {
  const { title, content, author, image_url } = req.body;
  if (!title || !content || !author)
    return res.status(400).json({ error: 'Title, content, and author are required.' });
  try {
    const { rows } = await db.query(
      'INSERT INTO articles (title, content, author, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, content, author, image_url]
    );
    emitChange('newArticle', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, author, image_url } = req.body;
  try {
    const { rows: existing } = await db.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Article not found.' });
    const e = existing[0];
    const { rows } = await db.query(
      'UPDATE articles SET title=$1, content=$2, author=$3, image_url=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [title || e.title, content || e.content, author || e.author, image_url || e.image_url, id]
    );
    emitChange('updatedArticle', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM articles WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Article not found.' });
    emitChange('deletedArticle', { id: req.params.id });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SITE DATA API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/site-data', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM site_data');
    const data = {};
    rows.forEach((row) => {
      try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/site-data/:key', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT value FROM site_data WHERE key = $1', [req.params.key]);
    if (!rows.length) return res.status(404).json({ error: 'Site data key not found.' });
    try { return res.json(JSON.parse(rows[0].value)); } catch { return res.json(rows[0].value); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/site-data', async (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof value === 'undefined')
    return res.status(400).json({ error: 'Site data key and value are required.' });
  try {
    await db.query(
      'INSERT INTO site_data (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)]
    );
    emitChange('siteDataUpdated', { key, value });
    res.json({ key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CMS SECTIONS API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/cms/sections', async (req, res) => {
  try {
    const { page } = req.query;
    const { rows } = page
      ? await db.query('SELECT * FROM cms_sections WHERE page_path = $1 ORDER BY section_key', [page])
      : await db.query('SELECT * FROM cms_sections ORDER BY page_path, section_key');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cms/sections', async (req, res) => {
  const { page_path, section_key, selector, content_html, is_active = 1 } = req.body;
  if (!page_path || !section_key || !selector || typeof content_html !== 'string')
    return res.status(400).json({ error: 'Missing required fields.' });
  try {
    const { rows: existing } = await db.query(
      'SELECT * FROM cms_sections WHERE page_path = $1 AND section_key = $2',
      [page_path, section_key]
    );

    let row;
    if (existing.length) {
      const { rows } = await db.query(
        `UPDATE cms_sections SET selector=$1, content_html=$2, is_active=$3, updated_at=NOW()
         WHERE page_path=$4 AND section_key=$5 RETURNING *`,
        [selector, content_html, is_active ? 1 : 0, page_path, section_key]
      );
      row = rows[0];
      await db.query(
        `INSERT INTO cms_audit_log (username, action, table_name, record_id, page_path, section_key, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['admin', 'UPDATE', 'cms_sections', row.id, page_path, section_key, existing[0].content_html, content_html]
      );
      emitChange('cmsSectionUpdated', row);
    } else {
      const { rows } = await db.query(
        `INSERT INTO cms_sections (page_path, section_key, selector, content_html, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [page_path, section_key, selector, content_html, is_active ? 1 : 0]
      );
      row = rows[0];
      await db.query(
        `INSERT INTO cms_audit_log (username, action, table_name, record_id, page_path, section_key, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['admin', 'CREATE', 'cms_sections', row.id, page_path, section_key, null, content_html]
      );
      emitChange('cmsSectionCreated', row);
    }
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cms/sections/:id', async (req, res) => {
  const { id } = req.params;
  const { page_path, section_key, selector, content_html, is_active } = req.body;
  try {
    const { rows: existing } = await db.query('SELECT * FROM cms_sections WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Section not found.' });
    const e = existing[0];
    const { rows } = await db.query(
      `UPDATE cms_sections SET page_path=$1, section_key=$2, selector=$3, content_html=$4, is_active=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [
        page_path || e.page_path,
        section_key || e.section_key,
        selector || e.selector,
        typeof content_html === 'string' ? content_html : e.content_html,
        typeof is_active === 'undefined' ? e.is_active : is_active ? 1 : 0,
        id,
      ]
    );
    emitChange('cmsSectionUpdated', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cms/sections/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM cms_sections WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Section not found.' });
    emitChange('cmsSectionDeleted', { id: Number(req.params.id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CMS COLLECTIONS API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/cms/collections', async (req, res) => {
  try {
    const { key } = req.query;
    const { rows } = key
      ? await db.query('SELECT * FROM cms_collections WHERE collection_key = $1 ORDER BY sort_order, id', [key])
      : await db.query('SELECT * FROM cms_collections ORDER BY collection_key, sort_order, id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cms/collections', async (req, res) => {
  const {
    collection_key,
    item_key = null,
    title,
    description = '',
    image_url = '',
    link_url = '',
    extra_json = '',
    sort_order = 0,
    is_active = 1,
  } = req.body;
  if (!collection_key || !title)
    return res.status(400).json({ error: 'Collection key and title are required.' });
  try {
    const { rows } = await db.query(
      `INSERT INTO cms_collections
        (collection_key, item_key, title, description, image_url, link_url, extra_json, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [collection_key, item_key, title, description, image_url, link_url, extra_json, Number(sort_order) || 0, is_active ? 1 : 0]
    );
    emitChange('cmsCollectionItemCreated', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cms/collections/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: existing } = await db.query('SELECT * FROM cms_collections WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Collection item not found.' });
    const next = { ...existing[0], ...req.body };
    const { rows } = await db.query(
      `UPDATE cms_collections
       SET collection_key=$1, item_key=$2, title=$3, description=$4, image_url=$5, link_url=$6,
           extra_json=$7, sort_order=$8, is_active=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        next.collection_key, next.item_key, next.title, next.description,
        next.image_url, next.link_url, next.extra_json,
        Number(next.sort_order) || 0, next.is_active ? 1 : 0, id,
      ]
    );
    emitChange('cmsCollectionItemUpdated', rows[0]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cms/collections/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM cms_collections WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Collection item not found.' });
    emitChange('cmsCollectionItemDeleted', { id: Number(req.params.id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDIA API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/media', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM media_assets ORDER BY uploaded_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const url = getFileUrl(req.file);
    const { rows } = await db.query(
      'INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.file.filename || req.file.public_id, req.file.originalname, req.file.mimetype, req.file.size, url]
    );
    emitChange('mediaUploaded', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Image upload endpoint for CMS
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  try {
    const url = getFileUrl(req.file);
    const { rows } = await db.query(
      'INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.file.filename || req.file.public_id, req.file.originalname, req.file.mimetype, req.file.size, url]
    );
    emitChange('mediaUploaded', rows[0]);
    res.status(201).json({ url, filename: req.file.filename || req.file.public_id, asset: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Video upload endpoint for CMS
app.post('/api/upload-video', uploadVideo.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video uploaded.' });
  try {
    const url = getFileUrl(req.file);
    const { rows } = await db.query(
      'INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.file.filename || req.file.public_id, req.file.originalname, req.file.mimetype, req.file.size, url]
    );
    emitChange('mediaUploaded', rows[0]);
    res.status(201).json({ url, filename: req.file.filename || req.file.public_id, asset: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS API
// ═══════════════════════════════════════════════════════════════════════════════
function formatReportRow(row) {
  let extra = {};
  try { extra = row.extra_json ? JSON.parse(row.extra_json) : {}; } catch { extra = {}; }
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    pdf_url: row.link_url || '',
    original_filename: extra.original_filename || '',
    size_bytes: extra.size_bytes || null,
    sort_order: row.sort_order,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get('/api/reports', async (_req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM cms_collections WHERE collection_key = 'reports' ORDER BY sort_order, id"
    );
    res.json(rows.map(formatReportRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reports', uploadReportPdf.single('pdf'), async (req, res) => {
  const { title, description = '' } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Report title is required.' });
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required.' });
  try {
    const pdfUrl = getFileUrl(req.file);
    const extraJson = JSON.stringify({
      original_filename: req.file.originalname,
      size_bytes: req.file.size,
    });
    const { rows: orderRows } = await db.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM cms_collections WHERE collection_key = 'reports'"
    );
    const nextOrder = orderRows[0].n;
    const { rows } = await db.query(
      `INSERT INTO cms_collections (collection_key, item_key, title, description, image_url, link_url, extra_json, sort_order, is_active)
       VALUES ('reports', NULL, $1, $2, '', $3, $4, $5, 1) RETURNING *`,
      [title.trim(), description, pdfUrl, extraJson, nextOrder]
    );
    const report = formatReportRow(rows[0]);
    emitChange('reportCreated', report);
    emitChange('cmsCollectionItemCreated', rows[0]);
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/reports/:id', uploadReportPdf.single('pdf'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: existing } = await db.query(
      "SELECT * FROM cms_collections WHERE id = $1 AND collection_key = 'reports'", [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Report not found.' });
    const e = existing[0];
    const title = (req.body.title || '').trim() || e.title;
    const description = req.body.description !== undefined ? req.body.description : e.description;
    let linkUrl = e.link_url;
    let extraJson = e.extra_json;

    if (req.file) {
      linkUrl = getFileUrl(req.file);
      extraJson = JSON.stringify({ original_filename: req.file.originalname, size_bytes: req.file.size });
    }

    const { rows } = await db.query(
      `UPDATE cms_collections SET title=$1, description=$2, link_url=$3, extra_json=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [title, description, linkUrl, extraJson, id]
    );
    const report = formatReportRow(rows[0]);
    emitChange('reportUpdated', report);
    emitChange('cmsCollectionItemUpdated', rows[0]);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reports/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      "DELETE FROM cms_collections WHERE id = $1 AND collection_key = 'reports'", [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Report not found.' });
    emitChange('reportDeleted', { id: Number(req.params.id) });
    emitChange('cmsCollectionItemDeleted', { id: Number(req.params.id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DONATIONS API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/donations', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM donations ORDER BY donated_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/donations', async (req, res) => {
  const { donor_name, email, amount, currency, message } = req.body;
  if (!donor_name || !amount)
    return res.status(400).json({ error: 'Donor name and amount are required.' });
  try {
    const { rows } = await db.query(
      'INSERT INTO donations (donor_name, email, amount, currency, message) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [donor_name, email, amount, currency, message]
    );
    emitChange('newDonation', rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/users', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT id, username, email, role FROM users');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/audit-log', async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM cms_audit_log ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN API
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });
  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password.' });
    const user = rows[0];
    res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin dashboard ───────────────────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err) {
    console.error('Request error:', err.message);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('A user connected via WebSocket');
  socket.on('cms-update', (data) => {
    console.log('Broadcasting CMS update to all clients:', data);
    io.emit('cms-update', data);
  });
  socket.on('disconnect', () => {
    console.log('User disconnected from WebSocket');
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initCmsSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database schema. Server not started.', err);
    process.exit(1);
  });
