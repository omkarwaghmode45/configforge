export interface FieldConfig {
  name: string;
  label?: string | Record<string, string>;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

export interface EntityConfig {
  name: string;
  label?: string | Record<string, string>;
  userScoped?: boolean;
  fields: FieldConfig[];
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
  ui?: {
    navigation?: Array<{ label?: string; labelKey?: string; entity?: string; view?: string }>;
    views?: Array<Record<string, unknown>>;
  };
}

export interface Session {
  token: string;
  user: { id: string; email: string };
}
