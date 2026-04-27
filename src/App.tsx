import { type FormEvent, type ReactElement, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppConfig, EntityConfig, FieldConfig, Session } from "./types";

type Screen = { kind: "dashboard" } | { kind: "entity"; entity: string } | { kind: "notifications" };
type NavigationItem = { label?: string | Record<string, string>; labelKey?: string; entity?: string; view?: string; path: string };
type TFunction = (key: string, fallback?: string) => string;
type FieldInputProps = { field: FieldConfig; value: unknown; onChange: (value: unknown) => void; label: string; t: TFunction };

const languageNames: Record<string, string> = {
  en: "English",
  hi: "हिन्दी"
};

const savedSession = () => {
  try {
    return JSON.parse(localStorage.getItem("configforge.session") || "null") as Session | null;
  } catch {
    return null;
  }
};

function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<AppConfig>("/api/config")
      .then((loadedConfig) => {
        console.log("[ConfigForge] loaded config", loadedConfig);
        console.log("[ConfigForge] loaded entities", loadedConfig.entities?.map((entity) => entity.name) || []);
        console.log("[ConfigForge] products entity", loadedConfig.entities?.find((entity) => entity.name === "products") || null);
        setConfig(loadedConfig);
      })
      .catch((err) => setError(err.message));
  }, []);

  return { config, error };
}

function App() {
  const { config, error } = useConfig();
  const [session, setSession] = useState<Session | null>(savedSession);
  const [screen, setScreen] = useState<Screen>({ kind: "dashboard" });
  const [lang, setLang] = useState("en");

  useEffect(() => {
    if (config?.app?.defaultLocale) setLang(config.app.defaultLocale);
  }, [config?.app?.defaultLocale]);

  console.log("Current language:", lang);

  const t: TFunction = (key, fallback = key) => config?.app?.locales?.[lang]?.[key] || fallback;
  const labelFor = (value: unknown, fallback: string) => resolveLabel(value, lang, fallback);
  const entities = config?.entities || [];
  const navigationItems = useMemo(() => buildNavigation(config, entities), [config, entities]);

  useEffect(() => {
    if (!config) return;
    const applyRoute = () => setScreen(routeToScreen(entities));
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [config, entities]);

  function persist(next: Session | null) {
    setSession(next);
    if (next) localStorage.setItem("configforge.session", JSON.stringify(next));
    else localStorage.removeItem("configforge.session");
  }

  if (error) return <State title="Configuration failed" detail={error} />;
  if (!config) return <State title="Loading app runtime" detail="Reading JSON configuration..." />;
  if (!session && config.auth?.enabled !== false) return <Auth config={config} lang={lang} onSession={persist} t={t} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <h1>{config.app?.name || "ConfigForge"}</h1>
          <p>{t("app.subtitle")}</p>
        </div>
        <nav>
          {navigationItems.map((item, index) => (
            <button key={`${item.path}-${index}`} className={isActive(screen, item) ? "active" : ""} onClick={() => navigateTo(item)}>
              {item.labelKey ? t(item.labelKey) : labelFor(item.label || entities.find((entity) => entity.name === item.entity)?.label, item.entity || item.view || "View")}
            </button>
          ))}
        </nav>
        <div className="sidebarFooter">
          <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label={t("label.language")}>
            {Object.keys(config.app?.locales || { en: {} }).map((item) => (
              <option key={item} value={item}>
                {languageNames[item] || item}
              </option>
            ))}
          </select>
          <button onClick={() => persist(null)}>{t("auth.signout")}</button>
        </div>
      </aside>
      <main>
        {screen.kind === "dashboard" && <Dashboard config={config} entities={entities} session={session} lang={lang} t={t} />}
        {screen.kind === "entity" && <DynamicEntityPage entity={entities.find((item) => item.name === screen.entity)} session={session} lang={lang} t={t} />}
        {screen.kind === "notifications" && <Notifications session={session} t={t} />}
      </main>
    </div>
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
    .filter((entity) => entity.name && !existingEntityItems.has(entity.name))
    .map((entity) => ({ entity: entity.name, path: `/${entity.name}` }));
  const hasDashboard = configured.some((item) => item.view === "dashboard");
  const hasNotifications = configured.some((item) => item.view === "notifications");
  return [
    ...(hasDashboard ? [] : [{ labelKey: "nav.dashboard", view: "dashboard", path: "/" }]),
    ...configured,
    ...generatedEntityItems,
    ...(hasNotifications ? [] : [{ labelKey: "nav.notifications", view: "notifications", path: "/notifications" }])
  ];
}

function routeToScreen(entities: EntityConfig[]): Screen {
  const segment = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  if (!segment) return { kind: "dashboard" };
  if (segment === "notifications") return { kind: "notifications" };
  if (entities.some((entity) => entity.name === segment)) return { kind: "entity", entity: segment };
  return { kind: "dashboard" };
}

function resolveLabel(value: unknown, lang: string, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const labels = value as Record<string, string>;
    return labels[lang] || labels.en || Object.values(labels).find(Boolean) || fallback;
  }
  return fallback;
}

function isActive(screen: Screen, item: { entity?: string; view?: string }) {
  return (screen.kind === "entity" && item.entity === screen.entity) || (screen.kind === "notifications" && item.view === "notifications") || (screen.kind === "dashboard" && item.view === "dashboard");
}

function Auth({ config, lang, onSession, t }: { config: AppConfig; lang: string; onSession: (session: Session) => void; t: TFunction }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState<Record<string, string>>({ email: "", password: "" });
  const [error, setError] = useState("");
  const fields = config.auth?.fields?.length ? config.auth.fields : [{ name: "email", label: "Email", type: "email" }, { name: "password", label: "Password", type: "password" }];

  async function submit() {
    setError("");
    try {
      const session = await api<Session & { token: string; user: Session["user"] }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(form) });
      onSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.auth"));
    }
  }

  return (
    <div className="authPage">
      <section className="authPanel">
        <h1>{config.app?.name || "ConfigForge"}</h1>
        <p>{t("app.subtitle")}</p>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>{t("auth.signin")}</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>{t("auth.signup")}</button>
        </div>
        {fields.map((field) => (
          <DynamicFieldInput key={field.name} field={field} value={form[field.name] || ""} lang={lang} t={t} onChange={(value) => setForm((prev) => ({ ...prev, [field.name]: String(value) }))} />
        ))}
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={submit}>{mode === "login" ? t("btn.continue") : t("auth.signup")}</button>
        {config.auth?.methods?.includes("demo") && <button onClick={() => api<Session>("/api/auth/demo", { method: "POST" }).then(onSession)}>{t("auth.demo")}</button>}
      </section>
    </div>
  );
}

function Dashboard({ config, entities, session, lang, t }: { config: AppConfig; entities: EntityConfig[]; session: Session | null; lang: string; t: TFunction }) {
  const view = config.ui?.views?.find((item) => item.type === "dashboard");
  const widgets = Array.isArray(view?.widgets) ? (view.widgets as Array<Record<string, unknown>>) : [];
  return (
    <div className="stack">
      <header><h2>{resolveLabel(view?.title, lang, t("page.dashboard"))}</h2></header>
      <div className="widgetGrid">
        {widgets.map((widget, index) => (
          <Widget key={index} widget={widget} entity={entities.find((item) => item.name === widget.entity)} session={session} lang={lang} t={t} />
        ))}
      </div>
    </div>
  );
}

function Widget({ widget, entity, session, lang, t }: { widget: Record<string, unknown>; entity?: EntityConfig; session: Session | null; lang: string; t: TFunction }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (entity) api<{ items: Record<string, unknown>[] }>(`/api/entities/${entity.name}`, {}, session).then((data) => setItems(data.items)).catch(() => setItems([]));
  }, [entity?.name, session?.token]);
  if (!entity) return <section className="panel">{t("entity.unknown")}</section>;
  const title = resolveLabel(widget.label, lang, resolveLabel(entity.label, lang, entity.name));
  if (widget.type === "metric") return <section className="panel metric"><span>{title}</span><strong>{items.length}</strong></section>;
  if (widget.type === "table") return <section className="panel wide"><h3>{title}</h3><DataTable entity={entity} items={items} lang={lang} t={t} /></section>;
  return <section className="panel">{t("widget.unsupported")}: {String(widget.type || "unknown")}</section>;
}

function DynamicEntityPage({ entity, session, lang, t }: { entity?: EntityConfig; session: Session | null; lang: string; t: TFunction }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!entity) return;
    setLoading(true);
    try {
      const data = await api<{ items: Record<string, unknown>[] }>(`/api/entities/${entity.name}`, {}, session);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.load"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [entity?.name]);
  if (!entity) return <State title={t("screen.unknown")} detail={t("entity.missing")} />;

  const entityLabel = resolveLabel(entity.label, lang, entity.name);

  return (
    <div className="stack">
      <header className="row">
        <h2>{entityLabel}</h2>
      </header>
      <section className="panel">
        <h3>{t("btn.create")} {entityLabel}</h3>
        <DynamicForm
          entity={entity}
          lang={lang}
          t={t}
          submitKey="btn.create"
          onSubmit={async (values) => {
            await api(`/api/${entity.name}`, { method: "POST", body: JSON.stringify(values) }, session);
            await load();
          }}
        />
      </section>
      <CsvImport entity={entity} session={session} onDone={load} t={t} />
      {error && <p className="error">{error}</p>}
      {loading ? <State title={t("state.loading_records")} /> : <DataTable entity={entity} items={items} onEdit={setEditing} lang={lang} t={t} />}
      {editing && <EntityForm entity={entity} item={editing} session={session} lang={lang} t={t} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EntityForm({ entity, item, session, lang, t, onClose, onSaved }: { entity: EntityConfig; item: Record<string, unknown>; session: Session | null; lang: string; t: TFunction; onClose: () => void; onSaved: () => void }) {
  return (
    <div className="modalBackdrop">
      <section className="modal">
        <h3>{t("btn.edit")} {resolveLabel(entity.label, lang, entity.name)}</h3>
        <DynamicForm
          entity={entity}
          lang={lang}
          t={t}
          initialValues={item}
          submitKey="btn.save"
          onSubmit={async (values) => {
            await api(`/api/entities/${entity.name}/${item.id}`, { method: "PUT", body: JSON.stringify(values) }, session);
            onSaved();
          }}
        />
        <div className="row end"><button onClick={onClose}>{t("btn.cancel")}</button></div>
      </section>
    </div>
  );
}

function DynamicForm({ entity, lang, t, initialValues = {}, submitKey, onSubmit }: { entity: EntityConfig; lang: string; t: TFunction; initialValues?: Record<string, unknown>; submitKey: string; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  const fields = entity.fields || [];
  const [values, setValues] = useState<Record<string, unknown>>(() => buildInitialFormState(fields, initialValues));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  console.log(entity.fields);

  useEffect(() => {
    setValues(buildInitialFormState(fields, initialValues));
    setFieldErrors({});
    setFormError("");
  }, [entity.name, fields, initialValues.id]);

  if (!fields.length) {
    return <section className="empty">{t("form.no_fields")}</section>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateFields(fields, values, lang, t);
    setFieldErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
      if (!initialValues.id) setValues(buildInitialFormState(fields, {}));
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
          value={values[field.name] ?? ""}
          lang={lang}
          t={t}
          error={fieldErrors[field.name]}
          onChange={(value) => setValues((prev) => ({ ...prev, [field.name]: value }))}
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

function validateFields(fields: FieldConfig[], values: Record<string, unknown>, lang: string, t: TFunction) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.required && (value === "" || value === null || value === undefined)) {
      errors[field.name] = `${resolveLabel(field.label, lang, field.name)} ${t("validation.required")}`;
    }
  }
  return errors;
}

const TextInput = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<input required={field.required} type={field.type === "email" || field.type === "password" ? field.type : "text"} value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const NumberInput = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<input required={field.required} type="number" value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const SelectInput = ({ field, value, onChange, label, t }: FieldInputProps) => <label>{label}<select required={field.required} value={String(value)} onChange={(event) => onChange(event.target.value)}><option value="">{t("form.select")}</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select></label>;
const TextArea = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<textarea required={field.required} value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const DateInput = ({ field, value, onChange, label }: FieldInputProps) => <label>{label}<input required={field.required} type="date" value={String(value)} onChange={(event) => onChange(event.target.value)} /></label>;
const UnknownInput = ({ field, label, t }: FieldInputProps) => <label>{label}<input disabled value={`${t("field.unsupported_type")}: ${field.type || "unknown"}`} readOnly /><span className="fieldWarning">{t("field.unsupported")}</span></label>;

const componentMap: Record<string, (props: FieldInputProps) => ReactElement> = {
  text: TextInput,
  email: TextInput,
  password: TextInput,
  number: NumberInput,
  select: SelectInput,
  textarea: TextArea,
  date: DateInput
};

function DynamicFieldInput({ field, value, onChange, lang, t, error }: { field: FieldConfig; value: unknown; onChange: (value: unknown) => void; lang: string; t: TFunction; error?: string }) {
  const label = `${resolveLabel(field.label, lang, field.name)}${field.required ? " *" : ""}`;
  const InputComponent = componentMap[field.type] || UnknownInput;
  return <div className="fieldGroup"><InputComponent field={field} value={value} onChange={onChange} label={label} t={t} />{error && <span className="fieldError">{error}</span>}</div>;
}

function DataTable({ entity, items, lang, t, onEdit }: { entity: EntityConfig; items: Record<string, unknown>[]; lang: string; t: TFunction; onEdit?: (item: Record<string, unknown>) => void }) {
  const fields = entity.fields || [];
  console.log("[ConfigForge] table fields", entity.name, fields);
  if (!fields.length) return <section className="empty">{t("table.no_columns")}</section>;
  if (!items.length) return <section className="empty">{t("table.empty")}</section>;
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field.name}>{resolveLabel(field.label, lang, field.name)}</th>
            ))}
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id)}>
              {fields.map((field) => (
                <td key={field.name}>{String(item[field.name] ?? "")}</td>
              ))}
              {onEdit && <td><button onClick={() => onEdit(item)}>{t("btn.edit")}</button></td>}
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
    const result = await api<{ imported: number; failures: unknown[] }>(`/api/entities/${entity.name}/import`, { method: "POST", body: data }, session);
    setMessage(`${t("csv.imported")} ${result.imported}${result.failures.length ? `, ${result.failures.length} ${t("csv.failed")}` : ""}`);
    onDone();
  }
  return <div className="importBar"><input type="file" accept=".csv,text/csv" aria-label={t("csv.upload")} onChange={(event) => upload(event.target.files?.[0])} />{message && <span>{message}</span>}</div>;
}

function Notifications({ session, t }: { session: Session | null; t: TFunction }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api<{ items: Record<string, unknown>[] }>("/api/notifications", {}, session).then((data) => setItems(data.items)); }, [session?.token]);
  return (
    <div className="stack">
      <h2>{t("nav.notifications")}</h2>
      {items.map((item) => (
        <section className="panel" key={String(item.id)}>
          <strong>{String(item.message)}</strong>
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
