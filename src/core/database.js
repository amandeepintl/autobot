import sqlite3Package from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger.js';

const sqlite3 = sqlite3Package.verbose();

class Database {
  constructor() {
    this.dbPath = path.resolve("data/platform.db");
    this.db = null;
  }

  async open() {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error("DATABASE", `Failed to open database: ${err.message}`);
          reject(err);
        } else {
          logger.info("DATABASE", `Database opened successfully at ${this.dbPath}`);
          resolve();
        }
      });
    });
  }

  async configure() {
    try {
      await this.run("PRAGMA journal_mode=WAL;");
      await this.run("PRAGMA foreign_keys=ON;");
      logger.info("DATABASE", "Database WAL mode and foreign keys enabled.");
    } catch (err) {
      logger.error("DATABASE", `Failed to configure pragma: ${err.message}`);
      throw err;
    }
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("Database not open"));
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("Database not open"));
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("Database not open"));
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      this.db.close((err) => {
        if (err) {
          logger.error("DATABASE", `Failed to close database: ${err.message}`);
          reject(err);
        } else {
          logger.info("DATABASE", "Database closed successfully.");
          this.db = null;
          resolve();
        }
      });
    });
  }

  async initializeSchema() {
    const schemaQueries = [
      `CREATE TABLE IF NOT EXISTS world_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_type TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER NOT NULL,
        attributes TEXT,
        last_verified INTEGER NOT NULL,
        UNIQUE(x, y, z)
      );`,
      `CREATE TABLE IF NOT EXISTS task_queue_wal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_type TEXT NOT NULL,
        task_name TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        status TEXT NOT NULL,
        checkpoint_data TEXT,
        created_at INTEGER NOT NULL
      );`
    ];

    for (const sql of schemaQueries) {
      await this.run(sql);
    }
    logger.info("DATABASE", "Database schemas verified and initialized.");
  }
}

export const db = new Database();
