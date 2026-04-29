import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import type { AppConfig, EntityConfig, FieldConfig } from "./types";

const RESERVED = new Set(["users", "notifications", "emails"]);
const KNOWN_FIELD_TYPES = new Set(["text", "email", "password", "number", "date", "select", "textarea"]);

export function resolveText(value: unknown, fallback = "") {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, string>).find(Boolean) || fallback;
  return fallback;
}

export function sanitizeName(value: unknown, fallback = "item") {
  const raw = String(value ?? fallback).trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return safe && !RESERVED.has(safe) ? safe : fallback;
}

export function normalizeField(field: FieldConfig, index: number, configPath?: string): Required<FieldConfig> {
  if (!field || typeof field !== "object") {
    console.warn(`Invalid config detected: field at index ${index} is missing or not an object. Applying fallback.`);
    field = {};
  }

  const name = sanitizeName(field?.name, `field_${index + 1}`);
  const requestedType = String(field?.type || "text");
  const type = KNOWN_FIELD_TYPES.has(requestedType) ? requestedType : "text";
  
  if (!KNOWN_FIELD_TYPES.has(requestedType)) {
    console.warn(`Invalid config detected: field type "${requestedType}" unknown at ${configPath}. Falling back to "text".`);
  }

  return {
    name,
    label: field?.label || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type,
    required: Boolean(field?.required),
    default: field?.default ?? "",
    options: Array.isArray(field?.options)
      ? field.options.map((option) =>
          typeof option === "string"
            ? option
            : {
                value: String(option.value),
                label: option.label || String(option.value)
              }
        )
      : []
  };
}

export function normalizeEntity(entity: EntityConfig, index: number, configPath?: string): Required<EntityConfig> {
  if (!entity || typeof entity !== "object") {
    console.warn(`Invalid config detected: entity at index ${index} is missing or not an object. Applying fallback.`);
    entity = {};
  }

  const key = sanitizeName(entity?.key || (typeof entity?.name === "string" ? entity.name : undefined), `entity_${index + 1}`);
  const fields = Array.isArray(entity?.fields) ? entity.fields.map((f, i) => normalizeField(f, i, configPath)) : [];
  
  if (!fields.length) {
    console.warn(`Invalid config detected: entity "${key}" has no fields at ${configPath}. Adding default field.`);
  }

  if (!fields.some((field) => field.name === "title" || field.name === "name")) {
    fields.unshift({ name: "title", label: "Title", type: "text", required: true, default: "", options: [] });
  }
  return {
    key,
    name: entity?.name || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    label: entity?.label || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    userScoped: entity?.userScoped !== false,
    fields
  };
}

function resolveConfigPath(configKey = "app") {
  const safeKey = sanitizeName(configKey, "app");
  const configDir = path.resolve(process.cwd(), "config");
  const namedPath = path.resolve(configDir, `${safeKey}.config.json`);
  const defaultPath = path.resolve(configDir, "app.config.json");
  return existsSync(namedPath) ? namedPath : defaultPath;
}

export function loadConfig(configKey = "app"): AppConfig {
  const configPath = resolveConfigPath(configKey);
  let parsed: AppConfig;
  
  try {
    const raw = readFileSync(configPath, "utf8");
    parsed = JSON.parse(raw) as AppConfig;
  } catch (error) {
    console.warn(`Invalid config file at ${configPath}: ${error instanceof Error ? error.message : "Unknown error"}. Using fallback config.`);
    return getFallbackConfig();
  }

  const entities = Array.isArray(parsed.entities) ? parsed.entities.map((e, i) => normalizeEntity(e, i, configPath)) : [];
  
  if (!entities.length) {
    console.warn(`Invalid config detected: no entities defined at ${configPath}. Adding fallback entity.`);
  }

  const authFields = parsed.auth?.fields?.length ? parsed.auth.fields.map((f, i) => normalizeField(f, i, configPath)) : [];
  
  if (!authFields.length) {
    console.warn(`Invalid config detected: auth has no fields at ${configPath}. Using default email/password fields.`);
  }

  return {
    ...parsed,
    app: {
      name: parsed.app?.name || "Generated App",
      defaultLocale: parsed.app?.defaultLocale || "en",
      locales: parsed.app?.locales || { en: {} }
    },
    auth: {
      enabled: parsed.auth?.enabled !== false,
      methods: parsed.auth?.methods?.length ? parsed.auth.methods : ["email"],
      fields: authFields.length ? authFields : [
        normalizeField({ name: "email", type: "email", label: "Email", required: true }, 0, configPath),
        normalizeField({ name: "password", type: "password", label: "Password", required: true }, 1, configPath)
      ]
    },
    entities,
    notifications: {
      enabled: parsed.notifications?.enabled !== false,
      rules: Array.isArray(parsed.notifications?.rules) ? parsed.notifications.rules : []
    }
  };
}

export function getFallbackConfig(): AppConfig {
  return {
    app: { name: "Generated App", defaultLocale: "en", locales: { en: {} } },
    auth: {
      enabled: true,
      methods: ["email"],
      fields: [
        normalizeField({ name: "email", type: "email", label: "Email", required: true }, 0),
        normalizeField({ name: "password", type: "password", label: "Password", required: true }, 1)
      ]
    },
    entities: [],
    notifications: { enabled: true, rules: [] }
  };
}

export function listConfigVariants() {
  const configDir = path.resolve(process.cwd(), "config");
  const files = readdirSync(configDir).filter((file) => file.endsWith(".config.json"));
  return files.map((file) => {
    const key = file.replace(/\.config\.json$/, "");
    try {
      const config = loadConfig(key);
      return {
        key,
        name: config.app?.name || key
      };
    } catch {
      return {
        key,
        name: key
      };
    }
  });
}

export function findEntity(config: AppConfig, name: string) {
  const target = sanitizeName(name);
  return (config.entities || []).find((entity) => (entity.key || sanitizeName(typeof entity.name === "string" ? entity.name : undefined)) === target);
}

export function getEntityKey(entity: EntityConfig) {
  return entity.key || sanitizeName(typeof entity.name === "string" ? entity.name : undefined);
}
