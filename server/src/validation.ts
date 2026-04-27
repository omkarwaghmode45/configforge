import type { EntityConfig } from "./types";

export function coerceAndValidate(entity: EntityConfig, input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of entity.fields || []) {
    if (!field.name) continue;
    const raw = input[field.name] ?? field.default ?? "";
    if (field.required && (raw === "" || raw === null || raw === undefined)) {
      errors[field.name] = `${field.label || field.name} is required`;
      continue;
    }
    if (raw === "" || raw === null || raw === undefined) {
      output[field.name] = "";
      continue;
    }
    if (field.type === "number") {
      const value = Number(raw);
      if (Number.isNaN(value)) {
        errors[field.name] = `${field.label || field.name} must be a number`;
      } else {
        output[field.name] = value;
      }
      continue;
    }
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw))) {
      errors[field.name] = `${field.label || field.name} must be a valid email`;
      continue;
    }
    if (field.type === "select" && field.options?.length && !field.options.includes(String(raw))) {
      output[field.name] = field.default ?? field.options[0] ?? "";
      continue;
    }
    output[field.name] = raw;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!(entity.fields || []).some((field) => field.name === key) && !["id", "createdAt", "updatedAt"].includes(key)) {
      output[key] = value;
    }
  }
  return { ok: Object.keys(errors).length === 0, data: output, errors };
}
