# ConfigForge

ConfigForge is a mini app generator/runtime for the internship demo task. It reads `config/app.config.json` and dynamically creates:

- React UI: auth, dashboard widgets, entity tables, forms, loading/error states
- Node.js APIs: auth, dynamic CRUD, CSV import, notifications
- Database structure: PostgreSQL JSONB tables per configured entity, with a local file fallback for development
- User-scoped data access

## Implemented feature set

- Multi-language UI: configured in `app.locales`, switchable from the sidebar.
- CSV import: upload CSV for any configured entity, validate rows, store valid records, report failures.
- Event notifications and mock transactional email: config rules trigger notifications/email records on entity creation and import.
- Mobile-ready responsive UI and basic PWA manifest.
- Multiple login methods: email/password and config-enabled demo login.

## Run locally

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:4000`

For a production-like local run:

```bash
npm run build
npm start
```

Then open `http://localhost:4000`.

## PostgreSQL

Set `DATABASE_URL` before starting the server:

```bash
DATABASE_URL=postgres://user:password@host:5432/dbname npm start
```

If `DATABASE_URL` is absent, ConfigForge stores data in `.data/configforge.json`. This fallback is useful for demos, but the deployed version should use PostgreSQL.

## Change the generated app

Edit `config/app.config.json`.

Add an entity:

```json
{
  "name": "tasks",
  "label": "Tasks",
  "userScoped": true,
  "fields": [
    { "name": "title", "label": "Title", "type": "text", "required": true },
    { "name": "priority", "label": "Priority", "type": "select", "options": ["Low", "High"] }
  ]
}
```

Add a navigation entry:

```json
{ "label": "Tasks", "entity": "tasks" }
```

Restart the server. The backend creates the table automatically and the frontend renders forms/tables without code changes.

## Edge cases handled

- Missing entity fields get a safe `title` field.
- Invalid names are sanitized before becoming API/table names.
- Unknown entities and unsupported widgets return visible errors instead of crashing.
- Optional fields can be absent.
- Select fields with unexpected values fall back to configured defaults.
- CSV rows are imported partially: bad rows are reported while valid rows are saved.
- All entity reads/writes are scoped to the authenticated user unless `userScoped` is explicitly `false`.

## Deploy

### Render single-service deployment

1. Push this repository to GitHub.
2. Create a PostgreSQL database on Render and copy its internal database URL.
3. Create a Web Service from the GitHub repo.
4. Use these settings:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment:
     - `DATABASE_URL=<your Render PostgreSQL internal URL>`
     - `JWT_SECRET=<long random string>`
     - `PGSSLMODE=require`
5. Open the Render URL and test signup, CRUD, CSV import, language switching, and notifications.

### Suggested Loom outline

1. Show `config/app.config.json`.
2. Explain tolerant config normalization.
3. Show dynamic frontend rendering.
4. Show dynamic backend routes and validation.
5. Show PostgreSQL JSONB entity tables and user scoping.
6. Demo signup/login, CRUD, CSV import, localization, notifications.
7. Mention tradeoff: JSONB keeps schema generation resilient; typed columns could be added later for analytics-heavy apps.
