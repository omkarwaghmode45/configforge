export type FieldType = "text" | "email" | "password" | "number" | "date" | "select" | "textarea" | string;

export interface FieldConfig {
  name?: string;
  label?: string | Record<string, string>;
  type?: FieldType;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

export interface EntityConfig {
  name?: string;
  label?: string | Record<string, string>;
  userScoped?: boolean;
  fields?: FieldConfig[];
}

export interface NotificationRule {
  event?: string;
  message?: string;
  email?: boolean;
}

export interface AppConfig {
  app?: {
    name?: string;
    defaultLocale?: string;
    locales?: Record<string, Record<string, string>>;
  };
  auth?: {
    enabled?: boolean;
    methods?: string[];
    fields?: FieldConfig[];
  };
  entities?: EntityConfig[];
  ui?: unknown;
  notifications?: {
    enabled?: boolean;
    rules?: NotificationRule[];
  };
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface RequestUser {
  id: string;
  email: string;
}
