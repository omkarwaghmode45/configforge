import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { parse } from "csv-parse/sync";
import { requireAuth, hashPassword, signToken, verifyPassword } from "./auth";
import { Database } from "./db";
import { findEntity, getEntityKey, listConfigVariants, loadConfig, resolveText, getFallbackConfig } from "./config";
import { emitEvent } from "./notifications";
import type { AppConfig, EntityConfig, FieldConfig } from "./types";
import { coerceAndValidate } from "./validation";
const app = express();
type RequestWithConfig = express.Request & { appConfig?: AppConfig; configKey?: string };

const DEFAULT_CONFIG_KEY = "app";

// OTP storage (in-memory, with 10-minute expiry)
type OTPEntry = { code: string; expiresAt: number };
const otpStore = new Map<string, OTPEntry>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOTP(email: string, code: string): void {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  otpStore.set(email, { code, expiresAt });
  // Clean up old entries periodically
  if (otpStore.size > 1000) {
    const now = Date.now();
    for (const [key, entry] of otpStore.entries()) {
      if (entry.expiresAt < now) otpStore.delete(key);
    }
  }
}

function verifyOTP(email: string, code: string): boolean {
  const entry = otpStore.get(email);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(email);
    return false;
  }
  // Allow any OTP except in production, or validate stored OTP
  const isDevLike = !process.env.NODE_ENV || process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev";
  const isValid = isDevLike || entry.code === code;
  if (isValid) otpStore.delete(email);
  return isValid;
}

function safeLoadConfig(configKey: string) {
  try {
    return { config: loadConfig(configKey), error: null as string | null };
  } catch (error) {
    return {
      config: getFallbackConfig(),
      error: error instanceof Error ? error.message : "Invalid config"
    };
  }
}

const startupConfig = safeLoadConfig(DEFAULT_CONFIG_KEY);
const db = new Database(startupConfig.config);

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 10000);
app.get("/api/configs", (_req, res) => {
  res.json({ configs: listConfigVariants() });
});

app.use((req, res, next) => {
  if (req.path === "/api/configs") return next();
  const configKey = resolveConfigKey(req.query.config);
  const loaded = safeLoadConfig(configKey);
  const request = req as RequestWithConfig;
  request.configKey = configKey;
  request.appConfig = loaded.config;
  if (loaded.error) {
    return res.status(500).json({ error: "Failed to load config", detail: loaded.error });
  }
  next();
});

app.get("/api/health", (_req, res) => {
  const config = (res.req as RequestWithConfig).appConfig || startupConfig.config;
  res.json({ ok: true, app: config.app?.name, database: process.env.DATABASE_URL ? "postgres" : "file" });
});

app.get("/api/config", (req, res) => {
  const request = req as RequestWithConfig;
  if (!request.appConfig) {
    return res.status(500).json({ error: "Failed to load config", detail: "Config not available" });
  }
  res.json(request.appConfig);
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

app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    
    const otp = generateOTP();
    storeOTP(email, otp);
    
    // In production, send OTP via email here. For now, log it and return in non-production.
    console.log(`OTP for ${email}: ${otp}`);

    const isDevLike = !process.env.NODE_ENV || process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev";
    res.json({ message: "OTP sent to email", email, otp: isDevLike ? otp : undefined });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to send OTP" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    
    if (!email || !code) return res.status(400).json({ error: "Email and OTP code are required" });
    
    if (!verifyOTP(email, code)) {
      return res.status(401).json({ error: "Invalid or expired OTP" });
    }
    
    // Find or create user for OTP login
    let user = await db.findUserByEmail(email);
    if (!user) {
      // Auto-create user for OTP login (no password)
      user = await db.createUser(email, hashPassword(email + Date.now().toString()));
    }
    
    const publicUser = { id: user.id, email: user.email };
    res.json({ user: publicUser, token: signToken(publicUser) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "OTP verification failed" });
  }
});

app.get("/api/entities/:entity", requireAuth, async (req, res) => {
  const entity = getEntity((req as RequestWithConfig).appConfig!, req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  res.json({ items: await db.list(entity, req.user!.id), entity });
});

app.post("/api/entities/:entity", requireAuth, async (req, res) => {
  await createEntityRecord(req, res, req.params.entity);
});

app.put("/api/entities/:entity/:id", requireAuth, async (req, res) => {
  const entity = getEntity((req as RequestWithConfig).appConfig!, req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const result = coerceAndValidate(entity, req.body || {});
  if (!result.ok) return res.status(422).json({ error: "Validation failed", fields: result.errors });
  const item = await db.update(entity, req.user!.id, String(req.params.id), result.data);
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json({ item });
});

app.delete("/api/entities/:entity/:id", requireAuth, async (req, res) => {
  const entity = getEntity((req as RequestWithConfig).appConfig!, req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const deleted = await db.delete(entity, req.user!.id, String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Item not found" });
  res.status(204).send();
});

app.post("/api/entities/:entity/import", requireAuth, upload.single("file"), async (req, res) => {
  const entity = getEntity((req as RequestWithConfig).appConfig!, req.params.entity);
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
  await emitEvent(db, (req as RequestWithConfig).appConfig || startupConfig.config, req.user!.id, req.user!.email, "csv.imported", `Imported ${imported.length} rows`);
  res.json({ imported: imported.length, failures, items: imported });
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  res.json({ items: await db.listNotifications(req.user!.id) });
});

app.get("/api/:entity", requireAuth, async (req, res) => {
  const entity = getEntity((req as RequestWithConfig).appConfig!, req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  res.json({ items: await db.list(entity, req.user!.id), entity });
});

app.post("/api/:entity", requireAuth, async (req, res) => {
  await createEntityRecord(req, res, req.params.entity);
});

const staticDir = path.resolve(process.cwd(), "dist");
app.use(express.static(staticDir));

// Prevent API routes from being overridden by frontend fallback
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
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
  app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
  });
}

function resolveConfigKey(value: unknown) {
  const key = String(value || DEFAULT_CONFIG_KEY).trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(key) ? key : DEFAULT_CONFIG_KEY;
}

function getEntity(config: AppConfig, name: unknown) {
  return findEntity(config, String(name));
}

async function createEntityRecord(req: express.Request, res: express.Response, entityParam: unknown) {
  const request = req as RequestWithConfig;
  const entity = getEntity(request.appConfig || startupConfig.config, entityParam);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const result = coerceAndValidate(entity, req.body || {});
  if (!result.ok) return res.status(422).json({ error: "Validation failed", fields: result.errors });
  const item = await db.create(entity, req.user!.id, result.data);
  const entityName = getEntityKey(entity) || String(entityParam);
  await emitEvent(db, request.appConfig || startupConfig.config, req.user!.id, req.user!.email, `${entityName}.created`, `${resolveText(entity.label, resolveText(entity.name, entityName))} item created`);
  res.status(201).json({ item });
}
