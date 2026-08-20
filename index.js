const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");
const { initCmsSchema } = require("./cms-schema");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

initCmsSchema();

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

const uploadVideo = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^video\/(mp4|webm|ogg|quicktime|x-msvideo)$/i.test(file.mimetype)) {
      return cb(new Error("Only video files are allowed."));
    }
    cb(null, true);
  },
});

// Reports (PDF) storage — files live under uploads/reports/ and are served
// automatically by the existing "/uploads" static route below.
const reportsUploadDir = path.join(uploadsDir, "reports");
if (!fs.existsSync(reportsUploadDir)) {
  fs.mkdirSync(reportsUploadDir, { recursive: true });
}

const reportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, reportsUploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const uploadReportPdf = multer({
  storage: reportStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed."));
    }
    cb(null, true);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname)));

const emitChange = (event, data) => io.emit(event, data);

// ARTICLES API
app.get("/api/articles", (req, res) => {
  try {
    const articles = db
      .prepare("SELECT * FROM articles ORDER BY created_at DESC")
      .all();
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/articles/:id", (req, res) => {
  const { id } = req.params;
  try {
    const article = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!article) return res.status(404).json({ error: "Article not found." });
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/site-data", (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM site_data").all();
    const data = {};
    rows.forEach((row) => {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch (_e) {
        data[row.key] = row.value;
      }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/site-data/:key", (req, res) => {
  const { key } = req.params;
  try {
    const row = db.prepare("SELECT value FROM site_data WHERE key = ?").get(key);
    if (!row) return res.status(404).json({ error: "Site data key not found." });
    try {
      return res.json(JSON.parse(row.value));
    } catch (_e) {
      return res.json(row.value);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/site-data", (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof value === "undefined") {
    return res.status(400).json({ error: "Site data key and value are required." });
  }
  try {
    db.prepare("INSERT OR REPLACE INTO site_data (key, value) VALUES (?, ?)").run(
      key,
      JSON.stringify(value)
    );
    emitChange("siteDataUpdated", { key, value });
    res.json({ key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CMS Sections API
app.get("/api/cms/sections", (req, res) => {
  const { page } = req.query;
  try {
    const rows = page
      ? db
          .prepare(
            "SELECT * FROM cms_sections WHERE page_path = ? ORDER BY section_key"
          )
          .all(page)
      : db.prepare("SELECT * FROM cms_sections ORDER BY page_path, section_key").all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cms/sections", (req, res) => {
  const { page_path, section_key, selector, content_html, is_active = 1 } = req.body;
  if (!page_path || !section_key || !selector || typeof content_html !== "string") {
    return res.status(400).json({ error: "Missing required fields." });
  }
  try {
    // Check if record exists
    const existing = db.prepare("SELECT * FROM cms_sections WHERE page_path = ? AND section_key = ?").get(page_path, section_key);
    
    let row;
    if (existing) {
      // Update existing
      db.prepare(
        `UPDATE cms_sections SET selector = ?, content_html = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE page_path = ? AND section_key = ?`
      ).run(selector, content_html, is_active ? 1 : 0, page_path, section_key);
      row = db.prepare("SELECT * FROM cms_sections WHERE page_path = ? AND section_key = ?").get(page_path, section_key);
      
      // Log the change
      db.prepare(
        `INSERT INTO cms_audit_log (username, action, table_name, record_id, page_path, section_key, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('admin', 'UPDATE', 'cms_sections', row.id, page_path, section_key, existing.content_html, content_html);
      
      emitChange("cmsSectionUpdated", row);
    } else {
      // Insert new
      const info = db
        .prepare(
          `INSERT INTO cms_sections (page_path, section_key, selector, content_html, is_active)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(page_path, section_key, selector, content_html, is_active ? 1 : 0);
      row = db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(info.lastInsertRowid);
      
      // Log the change
      db.prepare(
        `INSERT INTO cms_audit_log (username, action, table_name, record_id, page_path, section_key, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('admin', 'CREATE', 'cms_sections', row.id, page_path, section_key, null, content_html);
      
      emitChange("cmsSectionCreated", row);
    }
    
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/cms/sections/:id", (req, res) => {
  const { id } = req.params;
  const { page_path, section_key, selector, content_html, is_active } = req.body;
  try {
    const existing = db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "Section not found." });
    db.prepare(
      `UPDATE cms_sections SET page_path = ?, section_key = ?, selector = ?, content_html = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(
      page_path || existing.page_path,
      section_key || existing.section_key,
      selector || existing.selector,
      typeof content_html === "string" ? content_html : existing.content_html,
      typeof is_active === "undefined" ? existing.is_active : is_active ? 1 : 0,
      id
    );
    const updated = db.prepare("SELECT * FROM cms_sections WHERE id = ?").get(id);
    emitChange("cmsSectionUpdated", updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/cms/sections/:id", (req, res) => {
  const { id } = req.params;
  try {
    const info = db.prepare("DELETE FROM cms_sections WHERE id = ?").run(id);
    if (!info.changes) return res.status(404).json({ error: "Section not found." });
    emitChange("cmsSectionDeleted", { id: Number(id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CMS Collections API
app.get("/api/cms/collections", (req, res) => {
  const { key } = req.query;
  try {
    const rows = key
      ? db
          .prepare(
            "SELECT * FROM cms_collections WHERE collection_key = ? ORDER BY sort_order, id"
          )
          .all(key)
      : db.prepare("SELECT * FROM cms_collections ORDER BY collection_key, sort_order, id").all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cms/collections", (req, res) => {
  const {
    collection_key,
    item_key = null,
    title,
    description = "",
    image_url = "",
    link_url = "",
    extra_json = "",
    sort_order = 0,
    is_active = 1,
  } = req.body;
  if (!collection_key || !title) {
    return res.status(400).json({ error: "Collection key and title are required." });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO cms_collections
          (collection_key, item_key, title, description, image_url, link_url, extra_json, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        collection_key,
        item_key,
        title,
        description,
        image_url,
        link_url,
        extra_json,
        Number(sort_order) || 0,
        is_active ? 1 : 0
      );
    const row = db
      .prepare("SELECT * FROM cms_collections WHERE id = ?")
      .get(info.lastInsertRowid);
    emitChange("cmsCollectionItemCreated", row);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/cms/collections/:id", (req, res) => {
  const { id } = req.params;
  try {
    const existing = db.prepare("SELECT * FROM cms_collections WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "Collection item not found." });
    const next = { ...existing, ...req.body };
    db.prepare(
      `UPDATE cms_collections
       SET collection_key = ?, item_key = ?, title = ?, description = ?, image_url = ?, link_url = ?, extra_json = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      next.collection_key,
      next.item_key,
      next.title,
      next.description,
      next.image_url,
      next.link_url,
      next.extra_json,
      Number(next.sort_order) || 0,
      next.is_active ? 1 : 0,
      id
    );
    const updated = db.prepare("SELECT * FROM cms_collections WHERE id = ?").get(id);
    emitChange("cmsCollectionItemUpdated", updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/cms/collections/:id", (req, res) => {
  const { id } = req.params;
  try {
    const info = db.prepare("DELETE FROM cms_collections WHERE id = ?").run(id);
    if (!info.changes) return res.status(404).json({ error: "Collection item not found." });
    emitChange("cmsCollectionItemDeleted", { id: Number(id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Media API
app.get("/api/media", (_req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM media_assets ORDER BY uploaded_at DESC").all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/media/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  try {
    const url = `/uploads/${req.file.filename}`;
    const info = db
      .prepare(
        "INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url
      );
    const asset = db
      .prepare("SELECT * FROM media_assets WHERE id = ?")
      .get(info.lastInsertRowid);
    emitChange("mediaUploaded", asset);
    res.status(201).json(asset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Image upload endpoint for CMS
app.post("/api/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  try {
    const url = `/uploads/${req.file.filename}`;
    const info = db
      .prepare(
        "INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url
      );
    const asset = db
      .prepare("SELECT * FROM media_assets WHERE id = ?")
      .get(info.lastInsertRowid);
    emitChange("mediaUploaded", asset);
    res.status(201).json({ url, filename: req.file.filename, asset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Video upload endpoint for CMS
app.post("/api/upload-video", uploadVideo.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video uploaded." });
  try {
    const url = `/uploads/${req.file.filename}`;
    const info = db
      .prepare(
        "INSERT INTO media_assets (filename, original_name, mime_type, size_bytes, url) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url
      );
    const asset = db
      .prepare("SELECT * FROM media_assets WHERE id = ?")
      .get(info.lastInsertRowid);
    emitChange("mediaUploaded", asset);
    res.status(201).json({ url, filename: req.file.filename, asset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REPORTS API ──
// Reports are stored as rows in the existing cms_collections table
// (collection_key = "reports"), the same generic store already used for
// partners, team members, testimonials, etc. link_url holds the path to the
// uploaded PDF; extra_json holds the original filename + size for display.
function formatReportRow(row) {
  let extra = {};
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {};
  } catch (_e) {
    extra = {};
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    pdf_url: row.link_url || "",
    original_filename: extra.original_filename || "",
    size_bytes: extra.size_bytes || null,
    sort_order: row.sort_order,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get("/api/reports", (_req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT * FROM cms_collections WHERE collection_key = 'reports' ORDER BY sort_order, id"
      )
      .all();
    res.json(rows.map(formatReportRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reports", uploadReportPdf.single("pdf"), (req, res) => {
  const { title, description = "" } = req.body;
  if (!title || !title.trim()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Report title is required." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "A PDF file is required." });
  }
  try {
    const pdfUrl = `/uploads/reports/${req.file.filename}`;
    const extraJson = JSON.stringify({
      original_filename: req.file.originalname,
      size_bytes: req.file.size,
    });
    const nextOrder = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM cms_collections WHERE collection_key = 'reports'"
      )
      .get().n;
    const info = db
      .prepare(
        `INSERT INTO cms_collections
          (collection_key, item_key, title, description, image_url, link_url, extra_json, sort_order, is_active)
         VALUES ('reports', NULL, ?, ?, '', ?, ?, ?, 1)`
      )
      .run(title.trim(), description, pdfUrl, extraJson, nextOrder);
    const row = db
      .prepare("SELECT * FROM cms_collections WHERE id = ?")
      .get(info.lastInsertRowid);
    const report = formatReportRow(row);
    emitChange("reportCreated", report);
    emitChange("cmsCollectionItemCreated", row);
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/reports/:id", uploadReportPdf.single("pdf"), (req, res) => {
  const { id } = req.params;
  try {
    const existing = db
      .prepare("SELECT * FROM cms_collections WHERE id = ? AND collection_key = 'reports'")
      .get(id);
    if (!existing) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Report not found." });
    }

    const title = (req.body.title || "").trim() || existing.title;
    const description =
      req.body.description !== undefined ? req.body.description : existing.description;
    let linkUrl = existing.link_url;
    let extraJson = existing.extra_json;

    if (req.file) {
      // Replace the old PDF on disk if it was one of ours.
      if (existing.link_url && existing.link_url.startsWith("/uploads/reports/")) {
        fs.unlink(path.join(__dirname, existing.link_url), () => {});
      }
      linkUrl = `/uploads/reports/${req.file.filename}`;
      extraJson = JSON.stringify({
        original_filename: req.file.originalname,
        size_bytes: req.file.size,
      });
    }

    db.prepare(
      `UPDATE cms_collections
       SET title = ?, description = ?, link_url = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(title, description, linkUrl, extraJson, id);

    const updated = db.prepare("SELECT * FROM cms_collections WHERE id = ?").get(id);
    const report = formatReportRow(updated);
    emitChange("reportUpdated", report);
    emitChange("cmsCollectionItemUpdated", updated);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/reports/:id", (req, res) => {
  const { id } = req.params;
  try {
    const existing = db
      .prepare("SELECT * FROM cms_collections WHERE id = ? AND collection_key = 'reports'")
      .get(id);
    if (!existing) return res.status(404).json({ error: "Report not found." });

    if (existing.link_url && existing.link_url.startsWith("/uploads/reports/")) {
      fs.unlink(path.join(__dirname, existing.link_url), () => {});
    }

    db.prepare("DELETE FROM cms_collections WHERE id = ?").run(id);
    emitChange("reportDeleted", { id: Number(id) });
    emitChange("cmsCollectionItemDeleted", { id: Number(id) });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/articles", (req, res) => {
  const { title, content, author, image_url } = req.body;
  if (!title || !content || !author) {
    return res.status(400).json({ error: "Title, content, and author are required." });
  }
  try {
    const info = db
      .prepare("INSERT INTO articles (title, content, author, image_url) VALUES (?, ?, ?, ?)")
      .run(title, content, author, image_url);
    const newArticle = db.prepare("SELECT * FROM articles WHERE id = ?").get(info.lastInsertRowid);
    emitChange("newArticle", newArticle);
    res.status(201).json(newArticle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/articles/:id", (req, res) => {
  const { id } = req.params;
  const { title, content, author, image_url } = req.body;
  try {
    const existingArticle = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    if (!existingArticle) return res.status(404).json({ error: "Article not found." });
    db.prepare(
      "UPDATE articles SET title = ?, content = ?, author = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(
      title || existingArticle.title,
      content || existingArticle.content,
      author || existingArticle.author,
      image_url || existingArticle.image_url,
      id
    );
    const updatedArticle = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
    emitChange("updatedArticle", updatedArticle);
    res.json(updatedArticle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/articles/:id", (req, res) => {
  const { id } = req.params;
  try {
    const info = db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    if (!info.changes) return res.status(404).json({ error: "Article not found." });
    emitChange("deletedArticle", { id });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DONATIONS API
app.get("/api/donations", (req, res) => {
  try {
    const donations = db
      .prepare("SELECT * FROM donations ORDER BY donated_at DESC")
      .all();
    res.json(donations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/donations", (req, res) => {
  const { donor_name, email, amount, currency, message } = req.body;
  if (!donor_name || !amount) {
    return res.status(400).json({ error: "Donor name and amount are required." });
  }
  try {
    const info = db
      .prepare(
        "INSERT INTO donations (donor_name, email, amount, currency, message) VALUES (?, ?, ?, ?, ?)"
      )
      .run(donor_name, email, amount, currency, message);
    const newDonation = db.prepare("SELECT * FROM donations WHERE id = ?").get(info.lastInsertRowid);
    emitChange("newDonation", newDonation);
    res.status(201).json(newDonation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USERS API (for demonstration, in a real app, secure this with authentication)
app.get("/api/users", (_req, res) => {
  try {
    const users = db.prepare("SELECT id, username, email, role FROM users").all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Log API
app.get("/api/audit-log", (req, res) => {
  try {
    const logs = db.prepare("SELECT * FROM cms_audit_log ORDER BY created_at DESC LIMIT 100").all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Basic Login Route (FOR DEMONSTRATION PURPOSES ONLY - NOT SECURE)
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  try {
    const user = db
      .prepare("SELECT * FROM users WHERE username = ? AND password = ?")
      .get(username, password);
    if (!user) return res.status(401).json({ error: "Invalid username or password." });
    res.json({
      message: "Login successful",
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Serve the admin dashboard
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "404.html"));
});

// Error handler — turns multer/upload errors (bad file type, too large, etc.)
// into a JSON response instead of an HTML crash page.
app.use((err, _req, res, _next) => {
  if (err) {
    console.error("Request error:", err.message);
    return res.status(400).json({ error: err.message || "Something went wrong." });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A user connected via WebSocket");
  
  // Listen for cms-update from dashboard and broadcast to all clients
  socket.on("cms-update", (data) => {
    console.log("Broadcasting CMS update to all clients:", data);
    io.emit("cms-update", data);
  });
  
  socket.on("disconnect", () => {
    console.log("User disconnected from WebSocket");
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
