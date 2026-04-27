import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import pg from "pg";
import type { AppConfig, EntityConfig, User } from "./types";

type Row = Record<string, unknown> & { id: string; user_id?: string; created_at?: string; updated_at?: string };

interface StoreShape {
  users: User[];
  notifications: Row[];
  emails: Row[];
  entities: Record<string, Row[]>;
}

const now = () => new Date().toISOString();

export class Database {
  private pool?: pg.Pool;
  private filePath = path.resolve(process.cwd(), ".data", "configforge.json");
  private store: StoreShape = { users: [], notifications: [], emails: [], entities: {} };

  constructor(private config: AppConfig) {
    if (process.env.DATABASE_URL) {
      this.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
    }
  }

  async init() {
    if (this.pool) {
      await this.initPostgres();
      return;
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.store = JSON.parse(await readFile(this.filePath, "utf8")) as StoreShape;
    } catch {
      await this.flush();
    }
    for (const entity of this.config.entities || []) this.store.entities[entity.name || "items"] ||= [];
  }

  async close() {
    await this.pool?.end();
  }

  private async initPostgres() {
    await this.query(`
      create table if not exists users (
        id text primary key,
        email text unique not null,
        password_hash text not null,
        created_at timestamptz not null
      )`);
    await this.query(`
      create table if not exists notifications (
        id text primary key,
        user_id text not null,
        type text not null,
        message text not null,
        read boolean not null default false,
        created_at timestamptz not null
      )`);
    await this.query(`
      create table if not exists emails (
        id text primary key,
        user_id text not null,
        recipient text not null,
        subject text not null,
        body text not null,
        created_at timestamptz not null
      )`);
    for (const entity of this.config.entities || []) {
      await this.ensureEntityTable(entity);
    }
  }

  private async ensureEntityTable(entity: EntityConfig) {
    const name = entity.name || "items";
    await this.query(`
      create table if not exists app_${name} (
        id text primary key,
        user_id text,
        data jsonb not null default '{}',
        created_at timestamptz not null,
        updated_at timestamptz not null
      )`);
  }

  private async query<T extends pg.QueryResultRow = Row>(sql: string, params: unknown[] = []) {
    if (!this.pool) throw new Error("PostgreSQL is not configured");
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  private async flush() {
    await writeFile(this.filePath, JSON.stringify(this.store, null, 2));
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const user: User = { id: crypto.randomUUID(), email: email.toLowerCase(), passwordHash, createdAt: now() };
    if (this.pool) {
      await this.query("insert into users (id, email, password_hash, created_at) values ($1,$2,$3,$4)", [
        user.id,
        user.email,
        user.passwordHash,
        user.createdAt
      ]);
      return user;
    }
    if (this.store.users.some((item) => item.email === user.email)) throw new Error("Email already exists");
    this.store.users.push(user);
    await this.flush();
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    if (this.pool) {
      const rows = await this.query<{ id: string; email: string; password_hash: string; created_at: string }>(
        "select * from users where email=$1 limit 1",
        [email.toLowerCase()]
      );
      const user = rows[0];
      return user ? { id: user.id, email: user.email, passwordHash: user.password_hash, createdAt: user.created_at } : null;
    }
    return this.store.users.find((user) => user.email === email.toLowerCase()) || null;
  }

  async list(entity: EntityConfig, userId: string) {
    const name = entity.name || "items";
    if (this.pool) {
      const rows = await this.query(`select id, user_id, data, created_at, updated_at from app_${name} where ($1::text is null or user_id=$1) order by created_at desc`, [
        entity.userScoped === false ? null : userId
      ]);
      return rows.map((row) => ({ id: row.id, ...(row.data as object), createdAt: row.created_at, updatedAt: row.updated_at }));
    }
    return (this.store.entities[name] || [])
      .filter((row) => entity.userScoped === false || row.user_id === userId)
      .map(({ user_id, created_at, updated_at, ...row }) => ({ ...row, createdAt: created_at, updatedAt: updated_at }));
  }

  async create(entity: EntityConfig, userId: string, data: Record<string, unknown>) {
    const row: Row = { id: crypto.randomUUID(), user_id: userId, ...data, created_at: now(), updated_at: now() };
    const name = entity.name || "items";
    if (this.pool) {
      await this.query(`insert into app_${name} (id, user_id, data, created_at, updated_at) values ($1,$2,$3,$4,$5)`, [
        row.id,
        entity.userScoped === false ? null : userId,
        data,
        row.created_at,
        row.updated_at
      ]);
      return { id: row.id, ...data, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    this.store.entities[name] ||= [];
    this.store.entities[name].push(row);
    await this.flush();
    return { id: row.id, ...data, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async update(entity: EntityConfig, userId: string, id: string, data: Record<string, unknown>) {
    const name = entity.name || "items";
    if (this.pool) {
      const existing = await this.query(`select data from app_${name} where id=$1 and ($2::text is null or user_id=$2)`, [
        id,
        entity.userScoped === false ? null : userId
      ]);
      if (!existing[0]) return null;
      const merged = { ...(existing[0].data as object), ...data };
      await this.query(`update app_${name} set data=$1, updated_at=$2 where id=$3`, [merged, now(), id]);
      return { id, ...merged };
    }
    const rows = this.store.entities[name] || [];
    const row = rows.find((item) => item.id === id && (entity.userScoped === false || item.user_id === userId));
    if (!row) return null;
    Object.assign(row, data, { updated_at: now() });
    await this.flush();
    return { id: row.id, ...data, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async delete(entity: EntityConfig, userId: string, id: string) {
    const name = entity.name || "items";
    if (this.pool) {
      const rows = await this.query(`delete from app_${name} where id=$1 and ($2::text is null or user_id=$2) returning id`, [
        id,
        entity.userScoped === false ? null : userId
      ]);
      return Boolean(rows[0]);
    }
    const rows = this.store.entities[name] || [];
    const index = rows.findIndex((item) => item.id === id && (entity.userScoped === false || item.user_id === userId));
    if (index === -1) return false;
    rows.splice(index, 1);
    await this.flush();
    return true;
  }

  async addNotification(userId: string, type: string, message: string) {
    const row: Row = { id: crypto.randomUUID(), user_id: userId, type, message, read: false, created_at: now() };
    if (this.pool) {
      await this.query("insert into notifications (id, user_id, type, message, read, created_at) values ($1,$2,$3,$4,$5,$6)", [
        row.id,
        userId,
        type,
        message,
        false,
        row.created_at
      ]);
    } else {
      this.store.notifications.push(row);
      await this.flush();
    }
    return row;
  }

  async addEmail(userId: string, recipient: string, subject: string, body: string) {
    const row: Row = { id: crypto.randomUUID(), user_id: userId, recipient, subject, body, created_at: now() };
    if (this.pool) {
      await this.query("insert into emails (id, user_id, recipient, subject, body, created_at) values ($1,$2,$3,$4,$5,$6)", [
        row.id,
        userId,
        recipient,
        subject,
        body,
        row.created_at
      ]);
    } else {
      this.store.emails.push(row);
      await this.flush();
    }
    return row;
  }

  async listNotifications(userId: string) {
    if (this.pool) return this.query("select * from notifications where user_id=$1 order by created_at desc", [userId]);
    return this.store.notifications.filter((row) => row.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
}
