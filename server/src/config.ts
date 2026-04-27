import { readFile } from "fs/promises";
import path from "path";
import type { AppConfig, EntityConfig, FieldConfig } from "./types";

const RESERVED = new Set(["users", "notifications", "emails"]);

export function sanitizeName(value: unknown, fallback = "item") {
  const raw = String(value ?? fallback).trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return safe && !RESERVED.has(safe) ? safe : fallback;
}

export function normalizeField(field: FieldConfig, index: number): Required<FieldConfig> {
  const name = sanitizeName(field?.name, `field_${index + 1}`);
  return {
    name,
    label: field?.label || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: field?.type || "text",
    required: Boolean(field?.required),
    default: field?.default ?? "",
    options: Array.isArray(field?.options) ? field.options.map(String) : []
  };
}

export function normalizeEntity(entity: EntityConfig, index: number): Required<EntityConfig> {
  const name = sanitizeName(entity?.name, `entity_${index + 1}`);
  const fields = Array.isArray(entity?.fields) ? entity.fields.map(normalizeField) : [];
  if (!fields.some((field) => field.name === "title" || field.name === "name")) {
    fields.unshift({ name: "title", label: "Title", type: "text", required: true, default: "", options: [] });
  }
  return {
    name,
    label: entity?.label || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    userScoped: entity?.userScoped !== false,
    fields
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = path.resolve(process.cwd(), "config", "app.config.json");
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as AppConfig;
  const entities = Array.isArray(parsed.entities) ? parsed.entities.map(normalizeEntity) : [];
  return {
    ...parsed,
    app: {
      name: parsed.app?.name || "ConfigForge",
      defaultLocale: parsed.app?.defaultLocale || "en",
      locales: parsed.app?.locales || { en: {} }
    },
    auth: {
      enabled: parsed.auth?.enabled !== false,
      methods: parsed.auth?.methods?.length ? parsed.auth.methods : ["email"],
      fields: parsed.auth?.fields?.length ? parsed.auth.fields.map(normalizeField) : []
    },
    entities,
    notifications: {
      enabled: parsed.notifications?.enabled !== false,
      rules: Array.isArray(parsed.notifications?.rules) ? parsed.notifications.rules : []
    }
  };
}

export function findEntity(config: AppConfig, name: string) {
  return (config.entities || []).find((entity) => entity.name === sanitizeName(name));
}
