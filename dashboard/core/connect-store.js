/**
 * MayaMind — Connect Store (SQLite via sql.js + localStorage)
 *
 * Stores contacts and message history for the Connect section.
 * Follows the same singleton + sql.js + localStorage pattern as personalization-store.js.
 */

const STORAGE_KEY = 'mayamind_connect_db';

class ConnectStore {
  static instance = null;
  db = null;
  SQL = null;
  initialized = false;

  static getInstance() {
    if (!ConnectStore.instance) {
      ConnectStore.instance = new ConnectStore();
    }
    return ConnectStore.instance;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // sql.js loaded globally via <script src="lib/sql-wasm.js">
      this.SQL = await initSqlJs({
        locateFile: file => `/dashboard/lib/${file}`,
      });

      // Try loading existing database from localStorage
      const savedDb = localStorage.getItem(STORAGE_KEY);
      if (savedDb) {
        try {
          const data = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
          this.db = new this.SQL.Database(data);
          console.log('[ConnectStore] Loaded existing database');
        } catch (e) {
          console.warn('[ConnectStore] Failed to load saved database, creating new:', e);
          this.db = new this.SQL.Database();
          this.createTables();
        }
      } else {
        this.db = new this.SQL.Database();
        this.createTables();
        console.log('[ConnectStore] Created new database');
      }

      this.initialized = true;
    } catch (error) {
      console.error('[ConnectStore] Initialization failed:', error);
      throw error;
    }
  }

  createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        direction TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        body TEXT,
        media_url TEXT,
        timestamp TEXT DEFAULT (datetime('now')),
        read INTEGER DEFAULT 0,
        FOREIGN KEY (contact_id) REFERENCES contacts(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
      CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
    `);
    this.persist();
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  addContact(name, phone) {
    // Normalize phone: ensure + prefix
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    this.db.run(
      'INSERT OR IGNORE INTO contacts (name, phone) VALUES (?, ?)',
      [name.trim(), normalizedPhone]
    );
    this.persist();

    // Return the contact
    return this.findContactByPhone(normalizedPhone);
  }

  getContacts() {
    const result = this.db.exec('SELECT id, name, phone, created_at FROM contacts ORDER BY name');
    return this.resultToObjects(result);
  }

  findContactByName(name) {
    const normalized = name.trim().toLowerCase();
    const contacts = this.getContacts();

    // Exact match first
    const exact = contacts.find(c => c.name.toLowerCase() === normalized);
    if (exact) return exact;

    // Partial match (starts with)
    const partial = contacts.find(c => c.name.toLowerCase().startsWith(normalized));
    if (partial) return partial;

    // Contains match
    return contacts.find(c => c.name.toLowerCase().includes(normalized)) || null;
  }

  findContactByPhone(phone) {
    const normalized = phone.replace(/[^\d+]/g, '');
    const result = this.db.exec(
      'SELECT id, name, phone, created_at FROM contacts WHERE phone = ?',
      [normalized]
    );
    const rows = this.resultToObjects(result);
    return rows.length > 0 ? rows[0] : null;
  }

  deleteContact(id) {
    this.db.run('DELETE FROM messages WHERE contact_id = ?', [id]);
    this.db.run('DELETE FROM contacts WHERE id = ?', [id]);
    this.persist();
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  addMessage(contactId, direction, type, body, mediaUrl) {
    this.db.run(
      `INSERT INTO messages (contact_id, direction, type, body, media_url, read)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [contactId, direction, type, body || null, mediaUrl || null, direction === 'sent' ? 1 : 0]
    );
    this.persist();

    // Return the new message id
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return result[0]?.values[0]?.[0];
  }

  getMessages(contactId, limit = 50) {
    const result = this.db.exec(
      `SELECT id, contact_id, direction, type, body, media_url, timestamp, read
       FROM messages WHERE contact_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [contactId, limit]
    );
    return this.resultToObjects(result).reverse(); // oldest first
  }

  getUnreadCount() {
    const result = this.db.exec(
      "SELECT COUNT(*) FROM messages WHERE read = 0 AND direction = 'received'"
    );
    return result[0]?.values[0]?.[0] || 0;
  }

  getUnreadMessages() {
    const result = this.db.exec(
      `SELECT m.id, m.contact_id, m.direction, m.type, m.body, m.media_url, m.timestamp,
              c.name as contact_name, c.phone as contact_phone
       FROM messages m
       JOIN contacts c ON m.contact_id = c.id
       WHERE m.read = 0 AND m.direction = 'received'
       ORDER BY m.timestamp ASC`
    );
    return this.resultToObjects(result);
  }

  markRead(contactId) {
    this.db.run(
      "UPDATE messages SET read = 1 WHERE contact_id = ? AND direction = 'received'",
      [contactId]
    );
    this.persist();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  persist() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const base64 = btoa(String.fromCharCode(...data));
      localStorage.setItem(STORAGE_KEY, base64);
    } catch (error) {
      console.error('[ConnectStore] Failed to persist:', error);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  resultToObjects(result) {
    if (result.length === 0) return [];
    const columns = result[0].columns;
    const values = result[0].values;
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }
}

export const connectStore = ConnectStore.getInstance();
export { ConnectStore };
