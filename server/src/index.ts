import cors from "cors";
import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { parse } from "csv-parse/sync";
import { requireAuth, hashPassword, signToken, verifyPassword } from "./auth";
import { Database } from "./db";
import { findEntity } from "./config";
import { emitEvent } from "./notifications";
import type { AppConfig, EntityConfig, FieldConfig } from "./types";
import { coerceAndValidate } from "./validation";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const port = Number(process.env.PORT || 4000);

let config = readConfigFile();
const db = new Database(config);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: config.app?.name, database: process.env.DATABASE_URL ? "postgres" : "file" });
});

app.get("/api/config", (_req, res) => {
  try {
    config = readConfigFile();
    console.log("Fresh config loaded:", config.entities?.map((entity) => entity.name));
    res.json(config);
  } catch (error) {
    console.error("Config load error:", error);
    res.status(500).json({ error: "Failed to load config" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    if (await db.findUserByEmail(email)) return res.status(409).json({ error: "Email already exists" });
    const user = await db.createUser(email, hashPassword(password));
    const publicUser = { id: user.id, email: user.email };
    res.status(201).json({ user: publicUser, token: signToken(publicUser) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Signup failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await db.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Invalid credentials" });
  const publicUser = { id: user.id, email: user.email };
  res.json({ user: publicUser, token: signToken(publicUser) });
});

app.post("/api/auth/demo", async (_req, res) => {
  const email = "demo@configforge.dev";
  const existing = await db.findUserByEmail(email);
  const user = existing || (await db.createUser(email, hashPassword("demo-password")));
  const publicUser = { id: user.id, email: user.email };
  res.json({ user: publicUser, token: signToken(publicUser) });
});

app.get("/api/entities/:entity", requireAuth, async (req, res) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  res.json({ items: await db.list(entity, req.user!.id), entity });
});

app.post("/api/entities/:entity", requireAuth, async (req, res) => {
  await createEntityRecord(req, res, req.params.entity);
});

app.put("/api/entities/:entity/:id", requireAuth, async (req, res) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const result = coerceAndValidate(entity, req.body || {});
  if (!result.ok) return res.status(422).json({ error: "Validation failed", fields: result.errors });
  const item = await db.update(entity, req.user!.id, String(req.params.id), result.data);
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json({ item });
});

app.delete("/api/entities/:entity/:id", requireAuth, async (req, res) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const deleted = await db.delete(entity, req.user!.id, String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Item not found" });
  res.status(204).send();
});

app.post("/api/entities/:entity/import", requireAuth, upload.single("file"), async (req, res) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  if (!req.file) return res.status(400).json({ error: "CSV file is required" });
  const records = parse(req.file.buffer.toString("utf8"), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, unknown>[];
  const imported = [];
  const failures = [];
  for (const [index, record] of records.entries()) {
    const result = coerceAndValidate(entity, record);
    if (!result.ok) {
      failures.push({ row: index + 2, errors: result.errors });
      continue;
    }
    imported.push(await db.create(entity, req.user!.id, result.data));
  }
  await emitEvent(db, config, req.user!.id, req.user!.email, "csv.imported", `Imported ${imported.length} rows`);
  res.json({ imported: imported.length, failures, items: imported });
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  res.json({ items: await db.listNotifications(req.user!.id) });
});

app.get("/api/:entity", requireAuth, async (req, res) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  res.json({ items: await db.list(entity, req.user!.id), entity });
});

app.post("/api/:entity", requireAuth, async (req, res) => {
  await createEntityRecord(req, res, req.params.entity);
});

const staticDir = path.resolve(process.cwd(), "dist");
app.use(express.static(staticDir));
app.use((_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

start().catch((error) => {
  console.error("Failed to start ConfigForge", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await db.close();
  process.exit(0);
});

async function start() {
  await db.init();
  app.listen(port, () => {
    console.log(`ConfigForge listening on http://localhost:${port}`);
  });
}

function getEntity(name: unknown) {
  config = readConfigFile();
  return findEntity(config, String(name));
}

async function createEntityRecord(req: express.Request, res: express.Response, entityParam: unknown) {
  const entity = getEntity(entityParam);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const result = coerceAndValidate(entity, req.body || {});
  if (!result.ok) return res.status(422).json({ error: "Validation failed", fields: result.errors });
  const item = await db.create(entity, req.user!.id, result.data);
  const entityName = entity.name || String(entityParam);
  await emitEvent(db, config, req.user!.id, req.user!.email, `${entityName}.created`, `${readLabel(entity.label, entityName)} item created`);
  res.status(201).json({ item });
}

function readConfigFile(): AppConfig {
  const configPath = path.resolve(process.cwd(), "config", "app.config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return normalizeConfig(JSON.parse(raw) as AppConfig);
}

function normalizeConfig(raw: AppConfig): AppConfig {
  return {
    ...raw,
    app: {
      name: raw.app?.name || "ConfigForge",
      defaultLocale: raw.app?.defaultLocale || "en",
      locales: raw.app?.locales || { en: {} }
    },
    auth: {
      enabled: raw.auth?.enabled !== false,
      methods: raw.auth?.methods?.length ? raw.auth.methods : ["email"],
      fields: (raw.auth?.fields || []).map(normalizeField)
    },
    entities: (raw.entities || []).map(normalizeEntity),
    notifications: {
      enabled: raw.notifications?.enabled !== false,
      rules: Array.isArray(raw.notifications?.rules) ? raw.notifications.rules : []
    }
  };
}

function normalizeEntity(entity: EntityConfig, index: number): EntityConfig {
  const name = sanitizeName(entity.name || `entity_${index + 1}`);
  const fields = (entity.fields || []).map(normalizeField);
  return {
    ...entity,
    name,
    label: entity.label || titleize(name),
    userScoped: entity.userScoped !== false,
    fields: fields.length ? fields : [{ name: "title", label: "Title", type: "text", required: true, default: "", options: [] }]
  };
}

function normalizeField(field: FieldConfig, index = 0): FieldConfig {
  const name = sanitizeName(field.name || `field_${index + 1}`);
  return {
    ...field,
    name,
    label: field.label || titleize(name),
    type: field.type || "text",
    required: Boolean(field.required),
    default: field.default ?? "",
    options: Array.isArray(field.options) ? field.options.map(String) : []
  };
}

function readLabel(value: EntityConfig["label"], fallback: string) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.en || Object.values(value)[0] || fallback;
  return fallback;
}

function sanitizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function titleize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
