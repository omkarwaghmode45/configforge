import { createContext, type FormEvent, type ReactElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppConfig, EntityConfig, FieldConfig, Session } from "./types";

type Screen = { kind: "dashboard" } | { kind: "entity"; entity: string } | { kind: "notifications" };
type NavigationItem = { label?: string | Record<string, string>; labelKey?: string; entity?: string; view?: string; path: string };
type ConfigOption = { key: string; name: string };
type TFunction = (key: string, fallback?: string) => string;
type FieldInputProps = { field: FieldConfig; value: unknown; onChange: (value: unknown) => void; label: string; t: TFunction; currentLanguage?: string; passwordVisible?: boolean; onTogglePassword?: () => void };
type LanguageContextValue = { currentLanguage: string; setCurrentLanguage: (value: string) => void };

const LanguageContext = createContext<LanguageContextValue | null>(null);

const languageNames: Record<string, string> = {
  en: "English",
  hi: "हिन्दी"
};

const LOCALE_STORAGE_KEY = "configforge.locale";
const DEFAULT_CONFIG_KEY = "app";

const savedSession = () => {
  try {
    return JSON.parse(localStorage.getItem("session") || "null") as Session | null;
  } catch {
    return null;
  }
};

const getStoredLocale = () => {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const storeLocale = (locale: string) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures and continue with in-memory locale state.
  }
};

const getConfigKeyFromUrl = () => {
  try {
    return new URLSearchParams(window.location.search).get("config") || DEFAULT_CONFIG_KEY;
  } catch {
    return DEFAULT_CONFIG_KEY;
  }
};

const setConfigKeyInUrl = (configKey: string) => {
  try {
    const nextUrl = new URL(window.location.href);
    if (configKey === DEFAULT_CONFIG_KEY) nextUrl.searchParams.delete("config");
    else nextUrl.searchParams.set("config", configKey);
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  } catch {
    // Ignore history updates if the URL cannot be rewritten.
  }
};

function translateText(value: unknown, currentLanguage: string, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const labels = value as Record<string, string>;
    return labels[currentLanguage] || labels.en || Object.values(labels).find(Boolean) || fallback;
  }
  return fallback;
}

function getEntityKey(entity: EntityConfig) {
  const rawKey = entity.key || (typeof entity.name === "string" ? entity.name : translateText(entity.name, "en", "item"));
  return String(rawKey).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function getEntityDisplayName(entity: EntityConfig, currentLanguage: string) {
  return translateText(entity.name, currentLanguage, translateText(entity.label, currentLanguage, getEntityKey(entity)));
}

function getOptionValue(option: string | { value: string; label?: string | Record<string, string> }) {
  return typeof option === "string" ? option : option.value;
}

function getOptionLabel(option: string | { value: string; label?: string | Record<string, string> }, currentLanguage: string) {
  return typeof option === "string" ? option : translateText(option.label, currentLanguage, option.value);
}

function translateFieldValue(field: FieldConfig, value: unknown, currentLanguage: string) {
  if (field.type === "select" && Array.isArray(field.options)) {
    const option = field.options.find((item) => getOptionValue(item) === String(value));
    if (option) return getOptionLabel(option, currentLanguage);
  }
  return String(value ?? "");
}

// Unified translation helper - use this everywhere for consistent translations!
function tt(label: unknown, lang: string): string {
  if (!label) return "";
  if (typeof label === "string") return label;
  if (typeof label === "object") {
    const record = label as Record<string, string>;
    return record[lang] || record.en || Object.values(record).find(Boolean) || "";
  }
  return String(label);
}

function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("LanguageContext is unavailable");
  return context;
}

function useConfig(configKey: string) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<AppConfig>("/api/config")
      .then((loadedConfig) => {
        if (active) {
          // Validate critical config fields
          if (!loadedConfig || typeof loadedConfig !== "object") {
            setError("Invalid config: not an object");
            console.warn("Invalid config detected: config is not an object. Applying fallback");
          } else {
            setConfig(loadedConfig);
          }
        }
      })
      .catch((err) => {
        if (active) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error loading config";
          setError(errorMsg);
          console.warn(`Invalid config detected: ${errorMsg}. Applying fallback.`);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [configKey]);

  return { config, error, loading };
}

function useConfigOptions() {
  const [configs, setConfigs] = useState<ConfigOption[]>([]);

  useEffect(() => {
    api<{ configs: ConfigOption[] }>("/api/configs")
      .then((data) => setConfigs(data.configs || []))
      .catch(() => setConfigs([]));
  }, []);

  return configs;
}

function App() {
  const [configKey, setConfigKey] = useState(() => getConfigKeyFromUrl());
  const configOptions = useConfigOptions();
  const { config, error, loading } = useConfig(configKey);
  const [session, setSession] = useState<Session | null>(() => savedSession());
  const [screen, setScreen] = useState<Screen>({ kind: "dashboard" });
  const [currentLanguage, setCurrentLanguage] = useState(() => getStoredLocale() || "en");

  useEffect(() => {
    const syncConfigKey = () => setConfigKey(getConfigKeyFromUrl());
    window.addEventListener("popstate", syncConfigKey);
    return () => window.removeEventListener("popstate", syncConfigKey);
  }, []);

  const localeKeys = useMemo(() => Object.keys(config?.app?.locales || { en: {} }), [config?.app?.locales]);

  useEffect(() => {
    if (!config || !localeKeys.length) return;

    const storedLocale = getStoredLocale();
    const defaultLocale = config.app?.defaultLocale;

    if (storedLocale && localeKeys.includes(storedLocale)) {
      if (storedLocale !== currentLanguage) setCurrentLanguage(storedLocale);
      return;
    }

    if (localeKeys.includes(currentLanguage)) return;

    const nextLocale = (defaultLocale && localeKeys.includes(defaultLocale)) ? defaultLocale : localeKeys[0];
    if (!nextLocale) return;
    setCurrentLanguage(nextLocale);
    storeLocale(nextLocale);
  }, [config, currentLanguage, localeKeys]);

  const localeStrings = useMemo(() => {
    if (!config?.app?.locales) return {} as Record<string, string>;
    const selected = config.app.locales[currentLanguage];
    if (selected) return selected;

    const defaultLocale = config.app.defaultLocale;
    if (defaultLocale && config.app.locales[defaultLocale]) return config.app.locales[defaultLocale];

    return {} as Record<string, string>;
  }, [config?.app?.defaultLocale, config?.app?.locales, currentLanguage]);

  const t: TFunction = (key, fallback = key) => localeStrings[key] || fallback;
  const fallbackT: TFunction = (_key, fallback = _key) => fallback;
  const uiT = config ? t : fallbackT;
  const entities = config?.entities || [];
  const navigationItems = useMemo(() => buildNavigation(config, entities), [config, entities]);
  const appTitle = config?.app?.name || "Generated App";
  const subtitle = config ? t("app.subtitle", "Generated app from JSON config") : "Switch configs to continue";
  const selectedConfigKey = getConfigKeyFromUrl();

  // Toast system
  const [toasts, setToasts] = useState<Array<{ id: string; type: "success" | "error"; message: string }>>([]);
  const pushToast = (type: "success" | "error", message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((s) => [...s, { id, type, message }]);
    setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 3500);
  };
  const toast = {
    success: (msg: string) => pushToast("success", msg),
    error: (msg: string) => pushToast("error", msg),
  };

  function handleLocaleChange(nextLocale: string) {
    setCurrentLanguage(nextLocale);
    storeLocale(nextLocale);
  }

  function handleConfigChange(nextConfigKey: string) {
    setConfigKey(nextConfigKey);
    setConfigKeyInUrl(nextConfigKey);
    setScreen({ kind: "dashboard" });
  }

  useEffect(() => {
    if (!config) return;
    const applyRoute = () => setScreen(routeToScreen(entities));
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [config, entities]);

  function persist(next: Session | null) {
    setSession(next);
    if (next) localStorage.setItem("session", JSON.stringify(next));
    else localStorage.removeItem("session");
  }

  if (error) {
    return (
      <LanguageContext.Provider value={{ currentLanguage, setCurrentLanguage }}>
      <div className="shell">
        <aside className="sidebar">
          <div>
            <h1>Generated App</h1>
            <p>{fallbackT("ui.switch_configs", "Switch configs to continue")}</p>
          </div>
          <RuntimeConfigPicker configs={configOptions} value={selectedConfigKey} onChange={handleConfigChange} currentLanguage={currentLanguage} />
        </aside>
        <main>
          <State title={fallbackT("error.config", "Configuration failed")} detail={error} />
        </main>
      </div>
      </LanguageContext.Provider>
    );
  }

  if (loading || !config) {
    return (
      <LanguageContext.Provider value={{ currentLanguage, setCurrentLanguage }}>
      <div className="shell">
        <aside className="sidebar">
          <div>
            <h1>Generated App</h1>
            <p>{fallbackT("state.loading_config", "Loading runtime configuration...")}</p>
          </div>
          <RuntimeConfigPicker configs={configOptions} value={selectedConfigKey} onChange={handleConfigChange} currentLanguage={currentLanguage} />
        </aside>
        <main>
          <State title={fallbackT("state.loading_config", "Loading app runtime")} detail={fallbackT("state.reading_config", "Reading JSON configuration...")} />
        </main>
      </div>
      </LanguageContext.Provider>
    );
  }
  // If authentication is enabled, require explicit login/signup.
  if (config.auth?.enabled !== false) {
    if (!session) {
      // Ensure URL shows /login when unauthenticated
      if (window.location.pathname !== "/login") {
        window.history.replaceState(null, "", "/login");
      }
      return <Auth config={config} currentLanguage={currentLanguage} onSession={persist} t={t} />;
    }
    // If the user is authenticated but currently on /login, redirect to root
    if (session && window.location.pathname === "/login") {
      window.history.replaceState(null, "", "/");
    }
  }

  return (
    <LanguageContext.Provider value={{ currentLanguage, setCurrentLanguage }}>
    <div className="shell">
      <Toasts toasts={toasts} />
      <aside className="sidebar">
        <div>
          <h1>{tt(config?.app?.name, currentLanguage) || "Generated App"}</h1>
          <p>{subtitle}</p>
        </div>
        <RuntimeConfigPicker configs={configOptions} value={configKey} onChange={handleConfigChange} currentLanguage={currentLanguage} />
        <nav>
          <h2>{uiT("nav.entities", "Entities")}</h2>
          {navigationItems.map((item, index) => {
            const displayLabel = item.labelKey
              ? uiT(item.labelKey)
              : item.label
              ? tt(item.label, currentLanguage)
              : item.entity
              ? tt(entities.find((entity) => getEntityKey(entity) === item.entity)?.name, currentLanguage) || item.entity
              : item.view || "View";
            return (
              <button key={`${item.path}-${index}`} className={isActive(screen, item) ? "active" : ""} onClick={() => navigateTo(item)}>
                {displayLabel}
              </button>
            );
          })}
        </nav>
        <div className="sidebarFooter">
          {localeKeys.length > 1 && (
            <select value={currentLanguage} onChange={(event) => handleLocaleChange(event.target.value)} aria-label={uiT("label.language", "Language")}>
              {localeKeys.map((item) => (
                <option key={item} value={item}>
                  {languageNames[item] || item}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => persist(null)}>{uiT("auth.signout", "Sign out")}</button>
        </div>
      </aside>
      <main>
        {screen.kind === "dashboard" && <Dashboard config={config} entities={entities} session={session} currentLanguage={currentLanguage} t={uiT} />}
        {screen.kind === "entity" && <DynamicEntityPage entity={entities.find((item) => getEntityKey(item) === screen.entity)} session={session} currentLanguage={currentLanguage} t={uiT} toast={toast} />}
        {screen.kind === "notifications" && <Notifications session={session} t={uiT} currentLanguage={currentLanguage} />}
      </main>
    </div>
    </LanguageContext.Provider>
  );

  function navigateTo(item: NavigationItem) {
    const next: Screen = item.entity ? { kind: "entity", entity: item.entity } : item.view === "notifications" ? { kind: "notifications" } : { kind: "dashboard" };
    setScreen(next);
    window.history.pushState(null, "", item.path);
  }
}

function buildNavigation(config: AppConfig | null, entities: EntityConfig[]): NavigationItem[] {
  const configured = (config?.ui?.navigation || []).map((item) => ({
    ...item,
    path: item.entity ? `/${item.entity}` : item.view === "notifications" ? "/notifications" : "/"
  }));
  const existingEntityItems = new Set(configured.map((item) => item.entity).filter(Boolean));
  const generatedEntityItems = entities
    .filter((entity) => getEntityKey(entity) && !existingEntityItems.has(getEntityKey(entity)))
    .map((entity) => ({ entity: getEntityKey(entity), path: `/${getEntityKey(entity)}` }));
  const hasDashboard = configured.some((item) => item.view === "dashboard");
  const hasNotifications = configured.some((item) => item.view === "notifications");
  return [
    ...(hasDashboard ? [] : [{ labelKey: "nav.entities", view: "dashboard", path: "/" }]),
    ...configured,
    ...generatedEntityItems,
    ...(hasNotifications ? [] : [{ labelKey: "nav.notifications", view: "notifications", path: "/notifications" }])
  ];
}

function RuntimeConfigPicker({ configs, value, onChange, currentLanguage }: { configs: ConfigOption[]; value: string; onChange: (configKey: string) => void; currentLanguage: string }) {
  if (configs.length <= 1) return null;
  return (
    <label className="configPicker">
      <span>Config</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Select configuration">
        {configs.map((config) => (
          <option key={config.key} value={config.key}>
            {tt(config.name, currentLanguage) || config.key}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toasts({ toasts }: { toasts: Array<{ id: string; type: "success" | "error"; message: string }> }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function routeToScreen(entities: EntityConfig[]): Screen {
  const segment = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  if (!segment) return { kind: "dashboard" };
  if (segment === "notifications") return { kind: "notifications" };
  if (entities.some((entity) => getEntityKey(entity) === segment)) return { kind: "entity", entity: segment };
  return { kind: "dashboard" };
}

function isActive(screen: Screen, item: { entity?: string; view?: string }) {
  return (screen.kind === "entity" && item.entity === screen.entity) || (screen.kind === "notifications" && item.view === "notifications") || (screen.kind === "dashboard" && item.view === "dashboard");
}

function Auth({ config, currentLanguage, onSession, t }: { config: AppConfig; currentLanguage: string; onSession: (session: Session) => void; t: TFunction }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [authMethod, setAuthMethod] = useState<string>("password");
  const [form, setForm] = useState<Record<string, string>>({ email: "", password: "", code: "" });
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);

  const availableMethods = config.auth?.methods || ["email"];
  const fields = config.auth?.fields?.length ? config.auth.fields : [{ name: "email", label: "Email", type: "email" }, { name: "password", label: "Password", type: "password" }];

  async function submitPassword() {
    setError("");
    setLoading(true);
    try {
      const session = await api<Session & { token: string; user: Session["user"] }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      onSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.auth"));
    } finally {
      setLoading(false);
    }
  }

  async function sendOTP() {
    setError("");
    setLoading(true);
    try {
      await api<{ message: string }>("/api/auth/send-otp", { method: "POST", body: JSON.stringify({ email: form.email }) });
      setOtpStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOTP() {
    setError("");
    setLoading(true);
    try {
      const session = await api<Session & { token: string; user: Session["user"] }>("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ email: form.email, code: form.code }) });
      onSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  const isPasswordMethod = authMethod === "password";
  const isOTPMethod = authMethod === "otp";

  return (
    <div className="authPage">
      <section className="authPanel">
        <h1>{config.app?.name || "Generated App"}</h1>
        <p>{t("app.subtitle")}</p>

        {/* Auth Method Selector - only show if multiple methods available */}
        {availableMethods.length > 1 && (
          <div className="segmented">
            {availableMethods.includes("password") && (
              <button className={authMethod === "password" ? "active" : ""} onClick={() => { setAuthMethod("password"); setOtpStep("email"); setError(""); }}>
                {t("auth.method_password", "Password")}
              </button>
            )}
            {availableMethods.includes("otp") && (
              <button className={authMethod === "otp" ? "active" : ""} onClick={() => { setAuthMethod("otp"); setOtpStep("email"); setError(""); }}>
                {t("auth.method_otp", "OTP")}
              </button>
            )}
          </div>
        )}

        {/* Mode Selector (Login/Signup) - only for password method or when available */}
        {(isPasswordMethod || !isOTPMethod) && (
          <div className="segmented">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>{t("auth.signin")}</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>{t("auth.signup")}</button>
          </div>
        )}

        {/* Password Login/Signup */}
        {isPasswordMethod && (
          <>
            {fields.map((field) => (
              <DynamicFieldInput
                key={field.name}
                field={field}
                value={form[field.name] || ""}
                currentLanguage={currentLanguage}
                t={t}
                passwordVisible={!!showPasswords[field.name]}
                onTogglePassword={field.type === "password" ? () => setShowPasswords((prev) => ({ ...prev, [field.name]: !prev[field.name] })) : undefined}
                onChange={(value) => setForm((prev) => ({ ...prev, [field.name]: String(value) }))}
              />
            ))}
            {error && <p className="error">{error}</p>}
            <button className="primary" onClick={submitPassword} disabled={loading}>
              {loading ? t("state.saving") : (mode === "login" ? t("btn.continue") : t("auth.signup"))}
            </button>
          </>
        )}

        {/* OTP Login */}
        {isOTPMethod && (
          <>
            {otpStep === "email" && (
              <>
                <DynamicFieldInput
                  field={{ name: "email", type: "email", label: { en: "Email", hi: "ईमेल" }, required: true }}
                  value={form.email}
                  currentLanguage={currentLanguage}
                  t={t}
                  onChange={(value) => setForm((prev) => ({ ...prev, email: String(value) }))}
                />
                {error && <p className="error">{error}</p>}
                <button className="primary" onClick={sendOTP} disabled={!form.email || loading}>
                  {loading ? t("state.saving") : t("auth.send_otp", "Send OTP")}
                </button>
              </>
            )}
            {otpStep === "code" && (
              <>
                <p style={{ fontSize: "0.9em", color: "#666", marginBottom: 8 }}>
                  {t("auth.otp_sent", "OTP sent to")} {form.email}
                </p>
                <DynamicFieldInput
                  field={{ name: "code", type: "text", label: { en: "Enter OTP", hi: "OTP दर्ज करें" }, required: true }}
                  value={form.code}
                  currentLanguage={currentLanguage}
                  t={t}
                  onChange={(value) => setForm((prev) => ({ ...prev, code: String(value) }))}
                />
                {error && <p className="error">{error}</p>}
                <div className="row gap" style={{ gap: 8 }}>
                  <button onClick={() => { setOtpStep("email"); setForm((prev) => ({ ...prev, code: "" })); setError(""); }}>
                    {t("btn.cancel")}
                  </button>
                  <button className="primary" onClick={verifyOTP} disabled={!form.code || loading} style={{ flex: 1 }}>
                    {loading ? t("state.saving") : t("btn.continue")}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Dashboard({ config, entities, session, currentLanguage, t }: { config: AppConfig; entities: EntityConfig[]; session: Session | null; currentLanguage: string; t: TFunction }) {
  const view = config.ui?.views?.find((item) => item.type === "dashboard");
  const widgets = Array.isArray(view?.widgets) ? (view.widgets as Array<Record<string, unknown>>) : [];
  const pageTitle = tt(view?.title, currentLanguage) || t("page.entities") || "Entities";
  return (
    <div className="stack">
      <header><h2>{pageTitle}</h2></header>
      <div className="widgetGrid">
        {widgets.map((widget, index) => (
          <Widget key={index} widget={widget} entity={entities.find((item) => getEntityKey(item) === widget.entity)} session={session} currentLanguage={currentLanguage} t={t} />
        ))}
      </div>
    </div>
  );
}

function Widget({ widget, entity, session, currentLanguage, t }: { widget: Record<string, unknown>; entity?: EntityConfig; session: Session | null; currentLanguage: string; t: TFunction }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!entity) return;
    setLoading(true);
    setError("");
    api<{ items: Record<string, unknown>[] }>(`/api/entities/${getEntityKey(entity)}`, {}, session)
      .then((data) => setItems(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : t("error.load")))
      .finally(() => setLoading(false));
  }, [entity?.name, session?.token]);
  if (!entity) return <section className="panel">{t("entity.unknown")}</section>;
  const rawWidgetLabel = widget.label as unknown;
  const widgetLabel = rawWidgetLabel && typeof rawWidgetLabel === "object" ? tt(rawWidgetLabel, currentLanguage) : "";
  const entityName = tt(entity.name, currentLanguage);
  const title = widgetLabel || entityName;
  if (loading) return <section className="panel"><h3>{title}</h3><State title={t("state.loading_records")} /></section>;
  if (error) return <section className="panel"><h3>{title}</h3><p className="error">{error}</p></section>;
  if (widget.type === "metric") return <section className="panel metric"><span>{title}</span><strong>{items.length}</strong></section>;
  if (widget.type === "table") return <section className="panel wide"><h3>{title}</h3><DataTable entity={entity} items={items} currentLanguage={currentLanguage} t={t} /></section>;
  return <section className="panel">{t("widget.unsupported")}: {String(widget.type || "unknown")}</section>;
}

function DynamicEntityPage({ entity, session, currentLanguage, t, toast }: { entity?: EntityConfig; session: Session | null; currentLanguage: string; t: TFunction; toast?: { success: (msg: string) => void; error: (msg: string) => void } }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string } | null>(null);

  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setError("");
    try {
      const data = await api<{ items: Record<string, unknown>[] }>(`/api/entities/${getEntityKey(entity)}`, {}, session);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.load"));
    } finally {
      setLoading(false);
    }
  }, [entity, session, t]);

  useEffect(() => { void load(); }, [load]);
  if (!entity) return <State title={t("screen.unknown")} detail={t("entity.missing")} />;

  const entityLabel = tt(entity.name, currentLanguage) || tt(entity.label, currentLanguage) || getEntityKey(entity);

  return (
    <div className="stack">
      <header className="row">
        <h2>{entityLabel}</h2>
      </header>
      <section className="panel">
        <h3>{t("btn.create")} {entityLabel}</h3>
        <DynamicForm
          entity={entity}
          currentLanguage={currentLanguage}
          t={t}
          submitKey="btn.create"
          onSubmit={async (values) => {
            const created = await api<{ item: Record<string, unknown> }>(`/api/entities/${getEntityKey(entity)}`, { method: "POST", body: JSON.stringify(values) }, session);
            setItems((prev) => [created.item, ...prev]);
            await load();
          }}
        />
      </section>
      <CsvImport entity={entity} session={session} onDone={load} t={t} />
      {error && <p className="error">{error}</p>}
      {loading ? (
        <State title={t("state.loading_records")} />
      ) : (
        <>
          <DataTable
            entity={entity}
            items={items}
            onEdit={setEditing}
            onDelete={(id: string) => setConfirming({ id })}
            deletingId={deletingId}
            currentLanguage={currentLanguage}
            t={t}
          />

          {confirming && (
            <div className="modalBackdrop">
              <section className="modal">
                <h3>{t("btn.delete")} {entityLabel}</h3>
                <p>{t("confirm.delete", `Are you sure you want to delete this ${entityLabel}?`)}</p>
                <div className="row end">
                  <button onClick={() => setConfirming(null)}>{t("btn.cancel")}</button>
                  <button
                    className="danger"
                    onClick={async () => {
                      const id = confirming.id;
                      setConfirming(null);
                      setDeletingId(id);
                      try {
                        await api(`/api/entities/${getEntityKey(entity)}/${id}`, { method: "DELETE" }, session);
                        setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
                        toast?.success(t("toast.deleted", "Item deleted successfully"));
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : t("toast.delete_failed", "Delete failed");
                        toast?.error(msg);
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                    disabled={deletingId !== null}
                  >
                    {deletingId !== null ? t("state.saving") : t("btn.delete")}
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      {editing && <EntityForm entity={entity} item={editing} session={session} currentLanguage={currentLanguage} t={t} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EntityForm({ entity, item, session, currentLanguage, t, onClose, onSaved }: { entity: EntityConfig; item: Record<string, unknown>; session: Session | null; currentLanguage: string; t: TFunction; onClose: () => void; onSaved: () => void }) {
  return (
    <div className="modalBackdrop">
      <section className="modal">
        <h3>{t("btn.edit")} {getEntityDisplayName(entity, currentLanguage)}</h3>
        <DynamicForm
          entity={entity}
          currentLanguage={currentLanguage}
          t={t}
          initialValues={item}
          submitKey="btn.save"
          onSubmit={async (values) => {
            await api(`/api/entities/${getEntityKey(entity)}/${item.id}`, { method: "PUT", body: JSON.stringify(values) }, session);
            onSaved();
          }}
        />
        <div className="row end"><button onClick={onClose}>{t("btn.cancel")}</button></div>
      </section>
    </div>
  );
}

function DynamicForm({ entity, currentLanguage, t, initialValues = {}, submitKey, onSubmit }: { entity: EntityConfig; currentLanguage: string; t: TFunction; initialValues?: Record<string, unknown>; submitKey: string; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  const fields = useMemo(() => getRenderableFields(entity), [entity]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFormData(buildInitialFormState(fields, initialValues));
    setFieldErrors({});
    setFormError("");
  }, [getEntityKey(entity), initialValues.id, fields]);

  if (!fields.length) {
    return <section className="empty">{t("form.no_fields")}</section>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateFields(fields, formData, currentLanguage, t);
    setFieldErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await onSubmit(formData);
      if (!initialValues.id) setFormData({});
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("error.submit"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="dynamicForm" onSubmit={submit}>
      {fields.map((field) => (
        <DynamicFieldInput
          key={field.name}
          field={field}
          value={formData[field.name] ?? ""}
          currentLanguage={currentLanguage}
          t={t}
          error={fieldErrors[field.name]}
          onChange={(value) => setFormData((prev) => ({ ...prev, [field.name]: value }))}
        />
      ))}
      {formError && <p className="error">{formError}</p>}
      <div className="row end">
        <button className="primary" type="submit" disabled={submitting}>{submitting ? t("state.saving") : t(submitKey)}</button>
      </div>
    </form>
  );
}

function buildInitialFormState(fields: FieldConfig[], initialValues: Record<string, unknown>) {
  return Object.fromEntries(fields.map((field) => [field.name, initialValues[field.name] ?? field.default ?? ""]));
}

function getRenderableFields(entity: EntityConfig) {
  const fields = entity.fields?.length ? entity.fields : [{ name: "title", label: "Title", type: "text", required: true }];
  return fields.map((field) => ({
    ...field,
    type: field.type && componentMap[field.type] ? field.type : "text"
  }));
}

function validateFields(fields: FieldConfig[], values: Record<string, unknown>, currentLanguage: string, t: TFunction) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.required && (value === "" || value === null || value === undefined)) {
      errors[field.name] = `${tt(field.label, currentLanguage) || field.name} ${t("validation.required")}`;
    }
  }
  return errors;
}

const TextInput = ({ field, value, onChange, label, passwordVisible, onTogglePassword }: FieldInputProps) => {
  const inputType = field.type === "password" ? (passwordVisible ? "text" : "password") : field.type === "email" ? "email" : field.type === "number" ? "number" : "text";
  return (
    <label>
      {label}
      <div className="inputWithAction">
        <input required={field.required} type={inputType} value={String(value)} onChange={(event) => onChange(event.target.value)} />
        {field.type === "password" && onTogglePassword && (
          <button type="button" className="inputAction" onClick={onTogglePassword} aria-label={passwordVisible ? "Hide password" : "Show password"}>
            👁
          </button>
        )}
      </div>
    </label>
  );
};
const NumberInput = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<input required={field.required} type="number" value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const SelectInput = ({ field, value, onChange, label, t, currentLanguage }: FieldInputProps) => <label>{label}<select required={field.required} value={String(value)} onChange={(event) => onChange(event.target.value)}><option value="">{t("form.select")}</option>{(field.options || []).map((option) => { const optionValue = getOptionValue(option); return <option key={optionValue} value={optionValue}>{getOptionLabel(option, currentLanguage || "en")}</option>; })}</select></label>;
const TextArea = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<textarea required={field.required} value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const DateInput = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<input required={field.required} type="date" value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;

const componentMap: Record<string, (props: FieldInputProps) => ReactElement> = {
  text: TextInput,
  email: TextInput,
  password: TextInput,
  number: NumberInput,
  select: SelectInput,
  textarea: TextArea,
  date: DateInput
};

function DynamicFieldInput({ field, value, onChange, currentLanguage, t, error, passwordVisible, onTogglePassword }: { field: FieldConfig; value: unknown; onChange: (value: unknown) => void; currentLanguage: string; t: TFunction; error?: string; passwordVisible?: boolean; onTogglePassword?: () => void }) {
  const label = `${tt(field.label, currentLanguage) || field.name}${field.required ? " *" : ""}`;
  const InputComponent = componentMap[field.type] || TextInput;
  return <div className="fieldGroup"><InputComponent field={field} value={value} onChange={onChange} label={label} t={t} currentLanguage={currentLanguage} passwordVisible={passwordVisible} onTogglePassword={onTogglePassword} />{error && <span className="fieldError">{error}</span>}</div>;
}

function DataTable({ entity, items, currentLanguage, t, onEdit, onDelete, deletingId }: { entity: EntityConfig; items: Record<string, unknown>[]; currentLanguage: string; t: TFunction; onEdit?: (item: Record<string, unknown>) => void; onDelete?: (id: string) => void; deletingId?: string | null }) {
  const fields = getRenderableFields(entity);
  if (!fields.length) return <section className="empty">{t("table.no_columns")}</section>;
  if (!items.length) return <section className="empty">{t("table.empty")}</section>;
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field.name}>{tt(field.label, currentLanguage) || field.name}</th>
            ))}
            {(onEdit || onDelete) && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id)}>
              {fields.map((field) => (
                <td key={field.name}>{translateFieldValue(field, item[field.name], currentLanguage)}</td>
              ))}
              {(onEdit || onDelete) && (
                <td>
                  {onEdit && <button onClick={() => onEdit(item)}>{t("btn.edit")}</button>}
                  {onDelete && (
                    <button
                      className="danger"
                      style={{ marginLeft: 8 }}
                      onClick={() => onDelete(String(item.id))}
                      disabled={deletingId !== null && String(deletingId) === String(item.id)}
                    >
                      {deletingId !== null && String(deletingId) === String(item.id) ? t("state.saving") : t("btn.delete")}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CsvImport({ entity, session, onDone, t }: { entity: EntityConfig; session: Session | null; onDone: () => void; t: TFunction }) {
  const [message, setMessage] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    const result = await api<{ imported: number; failures: unknown[] }>(`/api/entities/${getEntityKey(entity)}/import`, { method: "POST", body: data }, session);
    setMessage(`${t("csv.imported")} ${result.imported}${result.failures.length ? `, ${result.failures.length} ${t("csv.failed")}` : ""}`);
    onDone();
  }
  return <div className="importBar"><input type="file" accept=".csv,text/csv" aria-label={t("csv.upload")} onChange={(event) => upload(event.target.files?.[0])} />{message && <span>{message}</span>}</div>;
}

function Notifications({ session, t }: { session: Session | null; t: TFunction }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const { currentLanguage } = useLanguage();
  useEffect(() => { api<{ items: Record<string, unknown>[] }>("/api/notifications", {}, session).then((data) => setItems(data.items)); }, [session?.token]);
  return (
    <div className="stack">
      <h2>{t("nav.notifications")}</h2>
      {items.map((item) => (
        <section className="panel" key={String(item.id)}>
          <strong>{tt(item.message as unknown, currentLanguage)}</strong>
          <p>{String(item.type)} · {String(item.created_at || item.createdAt)}</p>
        </section>
      ))}
      {!items.length && <section className="empty">{t("notifications.empty")}</section>}
    </div>
  );
}

function State({ title, detail }: { title: string; detail?: string }) {
  return <div className="state"><h2>{title}</h2>{detail && <p>{detail}</p>}</div>;
}

export default App;
