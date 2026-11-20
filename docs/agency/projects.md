# Client projects (agency fork)

A project is one client: its passport, the brief and materials, its sites,
tasks and a journal of the work. It sits above sites. The code is in
`lib/projects/`, the pages in `app/(dashboard)/projects/`, the components in
`components/projects/`, every UI string in `lib/projects/messages.ts`.

After sign-in, `/` and the login page lead to `/projects`. The All sites view
stays at `/sites` (a button on the projects page, the logo and the workspace
switcher).

## Model

Migration `20261122000000_agency_projects`.

| Table | What it holds |
| --- | --- |
| `Project` | `slug` (unique, a-z 0-9 -), `name`, `status` (`client`, `prospect`, `paused`, `archived`), `testUrl`, `geo`, `language`, `searchEngines[]`, `cms`, `hosting`, `contacts`, `accessNotes`, `ownerId` (the creator) |
| `Membership` | user, project, `role`: `owner`, `editor` or `viewer` |
| `Site.projectId` | nullable. A site without a project works as before |
| `ProjectNote` | `kind` (`brief`, `audience`, `chat`, `strategy`, `other`), `title`, `body` (markdown), `version`, `updatedBy`. Unique per project by kind and title |
| `ProjectNoteVersion` | the versions before the current one, the last 20 (`NOTE_HISTORY`) |
| `ProjectFile` | original name, random storage name, type, size, SHA-256, `category` (`materials` or `chat`), `uploadedBy` |
| `JournalEntry` | `date`, `text`, `link`, `author`, `authorKind` (`human` from the dashboard, `agent` from an access key), optional `siteId` of a project site |
| `ProjectTask` | `title`, `status` (`todo`, `doing`, `review`, `done`), `priority` (`low`, `normal`, `high`), `due`, `assignee`, `notes`, `externalKey` (the caller's own id, unique per project) |

Deleting a project deletes its notes, files (rows and bytes), journal and
tasks. Its sites stay, without a project. Deleting a user deletes the
projects they created (`ownerId`), as it deletes their sites.

### accessNotes

Only where access lives: the name of a variable, a vault entry, a file. The
form and the API refuse text that looks like a secret
(`lib/projects/secrets.ts`): private keys, JWTs, tokens with a known prefix
(`ghp_`, `github_pat_`, `sk-`, `xox?-`, `AKIA`, `glpat-`, `AIza`, Yandex
`y0_`/`AQAAAA`, Telegram bot tokens, `crawlseo_` keys), `password: ...` /
`token=...` / `пароль: ...` with a value that is not a reference, and long
random-looking strings. References pass: `AGENT_FTP_PASS`, `$VAR`, `${VAR}`,
`~/.claude/agent-secrets/.env`, `agent-secrets/.env`, short plain words
("password: in the vault"). It is a guard against a paste by mistake, not a
proof that no secret is there.

## Permissions

`lib/projects/access.ts`. Every project route checks the actor's role first.

| Role | Can |
| --- | --- |
| viewer | read the passport, notes and their history, files (download), sites, tasks, journal |
| editor | also edit the passport, notes, files, tasks and journal; add domains (they become the editor's own sites), link their own sites, take sites out of the project |
| owner | also add members by email, change roles, remove members, delete the project |

- A user who is not a member gets 404, the same as for a missing project.
- A project keeps at least one owner. Any member can leave.
- Instance admins act as owners of every project: `CRAWLSEO_ADMIN_EMAILS`,
  comma-separated emails.
- Sites keep their own owner (`Site.userId`) and their own authorization:
  every site page and route still requires the site's owner. Project members
  see the domains of a project's sites; only the owner opens one. A site can
  be added to a project only by its owner, and only when it is in no other
  project.

## API

The same routes (`lib/projects/http.ts`) serve two callers:

- `/api/v1/projects/...`: an access key (`Authorization: Bearer crawlseo_...`)
  of a user with MCP on. The key acts as its user, with that user's roles.
  `POST` and `PATCH` need a key with the **write** scope (Settings > MCP) and
  count against the write limit (20 a minute per key) as well as the
  shared request limit.
- `/api/projects/...`: the dashboard, as the signed-in user. Also members,
  sites and `DELETE`.

| Method | Path | |
| --- | --- | --- |
| GET | `/projects` | `?updatedSince=`: projects where anything changed since then. Each with `role`, `sites`, `openTasks`, `lastJournal` |
| POST | `/projects` | create: `name`, optional `slug` (else from the name or the first domain), `status`, passport fields, `domains[]`. The caller becomes owner. 409 if the slug is taken |
| GET | `/projects/{slug}` | `project` (with `role`), `sites` (with `yours`), `members`, `counts` |
| PATCH | `/projects/{slug}` | any passport field; `""` or `null` clears one |
| GET | `/projects/{slug}/notes` | `?updatedSince=&kind=`, with bodies |
| POST | `/projects/{slug}/notes` | upsert: by `id`, else by `kind` + `title`. `baseVersion` refuses with 409 when the note changed since. Unchanged content writes no version (`changed: false`) |
| GET | `/projects/{slug}/notes/{id}` | the note with `versions`, newest first, `?history=` (0 to 20) |
| PATCH | `/projects/{slug}/notes/{id}` | `kind`, `title`, `body`, `baseVersion` |
| GET | `/projects/{slug}/files` | `?updatedSince=` |
| POST | `/projects/{slug}/files` | `multipart/form-data`: `file`, optional `category` (`materials` or `chat`) |
| GET | `/projects/{slug}/files/{id}` | the file, as an attachment |
| GET | `/projects/{slug}/journal` | `?updatedSince=&limit=` (default 200, max 1000), newest first |
| POST | `/projects/{slug}/journal` | `text`, `date` (YYYY-MM-DD, default today UTC), `link`, `siteId`, `author`. The same date, text and link again returns the existing entry (`created: false`) |
| PATCH | `/projects/{slug}/journal/{id}` | `date`, `text`, `link`, `siteId` |
| GET | `/projects/{slug}/tasks` | `?updatedSince=&status=` |
| POST | `/projects/{slug}/tasks` | upsert: by `id`, else by `externalKey`, else a new task |
| PATCH | `/projects/{slug}/tasks/{id}` | any task field; `due: null` clears it |

Dashboard only: `POST /api/projects/{slug}/members` (`email`, `role`),
`PATCH|DELETE /api/projects/{slug}/members/{userId}`,
`POST /api/projects/{slug}/sites` (`domains[]` or `siteId`),
`DELETE /api/projects/{slug}/sites/{siteId}`, and `DELETE` of a project, note,
file, journal entry or task.

`updatedSince` takes an ISO date-time (`2026-11-20T10:00:00Z`) or a day
(`2026-11-20`, UTC midnight). Errors are `{ "error": "..." }` with 400
(validation), 403 (role or read-only key), 404, 409 (slug taken, stale
`baseVersion`, last owner), 413 (too large).

Example:

```bash
curl -s -H "Authorization: Bearer $CRAWLSEO_KEY" \
  "https://seo.example.com/api/v1/projects?updatedSince=2026-11-20"
curl -s -X POST -H "Authorization: Bearer $CRAWLSEO_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Published llms.txt","link":"https://example.com/llms.txt","author":"seo-agent"}' \
  https://seo.example.com/api/v1/projects/acme/journal
curl -s -X POST -H "Authorization: Bearer $CRAWLSEO_KEY" \
  -F file=@brief.pdf -F category=materials \
  https://seo.example.com/api/v1/projects/acme/files
```

## MCP

| Tool | |
| --- | --- |
| `list_projects` | read: projects with slug, status, role, sites, open tasks, the latest journal entry; `updatedSince` |
| `get_project` | read: passport, sites, members, every note with its text, open tasks, the latest journal entries, files with their download path |
| `create_project` | write: a project with you as owner, and its domains as your sites |
| `upsert_note` | write: create or update a note, by id or by kind and title, with `baseVersion` |
| `add_journal_entry` | write: a journal line; a repeat is not added twice |
| `upsert_task` | write: create or update a task, by id or `externalKey` |

The write tools need a key with the write scope; a read-only key is refused
and nothing changes. Files are uploaded and downloaded through the API, not
the MCP.

## Uploads

Accepted: `pdf`, `docx`, `xlsx`, `txt`, `md`, `csv`, `png`, `jpg`/`jpeg`,
`gif`, `webp` (`lib/projects/file-types.ts`), at most 20 MB. The extension and
the first bytes must agree (`%PDF-`, the PNG/JPEG/GIF/WEBP signatures, a zip
with `[Content_Types].xml` and `word/` or `xl/`, UTF-8 text without NUL
bytes). HTML, SVG and everything else are refused. The name from the browser
is only shown and sent back; on disk a file is
`UPLOADS_DIR/<projectId>/<32 random hex>.<ext>` (folders 0700, files 0600).
Downloads are for members only, always `Content-Disposition: attachment`,
with the type from the list above, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox` and
`Cache-Control: private, no-store`.

`UPLOADS_DIR` defaults to `/data/uploads`. The image creates that folder owned
by the app user (uid 1001), so a named volume mounted there is writable. Keep
it on a volume, or uploads are lost when the container is replaced. With
docker compose, in `docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  app:
    volumes:
      - uploads:/data/uploads

volumes:
  uploads:
```

Only the `app` service needs it: the worker never reads uploads. For a bind
mount instead of a named volume, make the host folder writable for uid 1001
(`chown 1001:1001 /srv/crawlseo/uploads`). Back the volume up with the
database: a file row without its bytes downloads as 404.

## How the agent syncs

The agent (on its own side, not in this repo) keeps a folder per project,
`~/projects/<slug>/`, in step with crawlseo through `/api/v1` and a
write-scoped key:

1. `GET /api/v1/projects?updatedSince=<last sync>`: the projects that
   changed. Store the time the sync started as the next `updatedSince`.
2. For each, `GET /projects/{slug}` writes `README.md` from the passport;
   `GET /projects/{slug}/notes?updatedSince=` writes the notes (`audience`
   to `audience.md`, `brief` and the rest by title), keeping each note's
   `id` and `version`; `GET /projects/{slug}/files?updatedSince=` and
   `GET .../files/{id}` download new files into `client-chat/` (category
   `chat`) or `materials/`.
3. Back to crawlseo: each new line of `journal.md` as
   `POST /projects/{slug}/journal` (a retry adds nothing twice); each item of
   `tasks.md` as `POST /projects/{slug}/tasks` with a stable `externalKey`;
   a note changed locally as `POST /projects/{slug}/notes` with the
   `baseVersion` it was read at. A 409 means someone changed it in the
   dashboard meanwhile: read it again, merge, retry.
4. A new project from the agent (`/newproject`): `POST /api/v1/projects` or
   the MCP tool `create_project`.
