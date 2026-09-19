# Baguette - Claude Code Notes

## Before committing

Run tests and fix format - both must pass:

```
pnpm test
pnpm run fix
```

## API routes: prefer Feathers services over Express routes

New API endpoints should be implemented as **Feathers services** in `server/services/feathers/`, not as Express routers in `server/routes/`. Feathers services integrate with auth hooks (`requireUser`), the socket.io transport, and the client-side `feathers.js` service registry automatically.

- Add custom actions (beyond CRUD) as **custom methods** on the service class and declare them in `app.use(path, service, { methods: [...] })`.
- Register the service in `server/services/feathers/index.js` via `registerFeathersServices`.
- Export the client-side service from `client/src/feathers.js` and call `.methods(...)` for any custom methods.
- Use `apiFetch` only for non-Feathers endpoints (e.g. `server/routes/settings.js`, auth routes).

**DB writes belong in the Feathers service, not in helper/utility modules.** External service modules (e.g. `server/services/plugins-service.js`) should contain only pure logic and file-system/network operations. The Feathers service method is responsible for reading from and writing to the DB before/after calling those helpers. This keeps the DB boundary clear and ensures auth hooks run around every DB mutation.

## SQLite migrations (Knex + `better-sqlite3`)

Baguette uses SQLite only. Knex’s SQLite dialect does **not** implement most `ALTER TABLE` variants natively: it often **rebuilds** a table by creating a temp table, copying rows, then running **`DROP TABLE "<name>"`**, then renaming the temp table back. If another table has a foreign key **to** that table, `DROP TABLE` fails with `FOREIGN KEY constraint failed` (for example dropping or altering `users` while `sessions`, `usage`, or `user_repos` reference `users`).

### What actually runs `DROP TABLE` (besides obvious drops)

- **Explicit:** `knex.schema.dropTable(...)` / `dropTableIfExists(...)` (including `down` migrations that chain these).

- **Implicit (table rebuild — same failure mode as above):** schema-builder calls that route through Knex’s `SQLite3_DDL` helper, including:
  - `table.dropColumn(...)` / `t.dropColumn(...)`
  - `table.dropForeign(...)` / `t.dropForeign(...)`
  - `table.dropPrimary(...)` / `t.dropPrimary(...)`
  - `table.primary(...)` / `t.primary(...)` when altering an existing table
  - `table.foreign(...)` / `t.foreign(...)` when adding a foreign key to an existing table
  - Changing an existing column’s type, nullability, or default in an `alterTable` (e.g. `.alter()` / nullable flips) when Knex cannot do it with a simple `ADD COLUMN`

Prefer **native SQLite DDL** when the bundled SQLite supports it (e.g. **`ALTER TABLE … DROP COLUMN`** since 3.35.0) so the table is not dropped and FKs to it are not stressed. See `server/migrations/003_encrypt_access_token.js` for an example.

**Usually safe (no full rebuild in Knex’s SQLite compiler):** adding a column with `alterTable` / `table.*` where SQLite can use `ALTER TABLE … ADD COLUMN`, and `renameColumn` (uses `ALTER TABLE … RENAME …` rather than the DDL rebuild path).

## Frontend Error Handling

### Rule: every user-triggered or data-critical failure must surface to the user

Use `toastError(label, err)` from `client/src/utils/toastError.jsx` for all error notifications. Do **not** use `toast.error()` directly for API/service errors — `toastError` renders a collapsible "Show details" section with `err.message` so users and developers can see the underlying error without cluttering the UI.

```js
import { toastError } from '../utils/toastError.jsx';

// Good
.catch((err) => toastError('Failed to delete session', err));

// Bad — swallows the error silently
.catch(() => {});

// Bad — logs to console only, invisible in production
.catch(console.error);

// Bad — use toastError instead, which includes collapsible details
.catch((err) => toast.error(err.message || 'Failed to delete session'));
```

### What to toast vs. what to leave silent

| Category                                                                            | Behavior                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| User-triggered mutations (create, delete, patch, approve…)                          | Always `toastError`                                     |
| Data loads that block a feature (secrets list, repos list, branches)                | `toastError`                                            |
| Background reads that degrade gracefully (usage graph, model list, config commands) | Silent `.catch(() => {})` — UI still works without them |

### Pattern for event handlers

```js
const handleDelete = async (id) => {
  try {
    await service.remove(id);
    reload();
  } catch (err) {
    toastError('Failed to delete item', err);
  }
};
```

### Pattern for promise chains

```js
service
  .find()
  .then((d) => setData(d.data))
  .catch((err) => toastError('Failed to load items', err));
```
