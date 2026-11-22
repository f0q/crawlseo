# Data sources and client billing (agency fork)

UX step 2. One place shows whether data comes in for every project, and the
client's payment decides whether paid collection runs. The code is in
`lib/projects/sources.ts` (the matrix), `lib/projects/home.ts` (the projects
home), `lib/projects/billing-rule.ts` and `lib/projects/billing.ts` (the
billing rule), `lib/projects/collection.ts` (the guard of paid collection and
the schedule filter), the pages `app/(dashboard)/projects/page.tsx` and
`app/(dashboard)/projects/sources/page.tsx`, the components
`components/projects/source-cells.tsx`, `rank-toggle.tsx` and
`billing-section.tsx`; every string in `lib/projects/messages.ts`.

## The sources matrix

`sourcesMatrix(actor, { slug? })` reads the tables that are already there and
returns, for every project the actor sees, a line per project and a sub-line
per site, one cell per source:

| Source | Per | Read from | Paid |
| --- | --- | --- | --- |
| Positions | project: the paid rank checks | `ProjectRankSettings`, `RankCheckRun` | yes, when the provider starts checks from crawlseo (Labrika) |
| Positions | site: the sync of results | `ExternalRankEngine.lastSyncedAt`, the latest `rank-sync` job | no |
| Search Console | site | `Site.gscProperty`, the latest `gsc-sync` job, the newest `Page` day | no |
| Yandex Webmaster | site | `YandexSiteLink` (`webmasterSyncedAt`, `webmasterError`), the owner's `YandexConnection` | no |
| Yandex Metrika | site | `YandexSiteLink` (`metrikaSyncedAt`, `metrikaError`) | no |
| Crawl | site | the latest finished `Crawl`, the owner's crawl interval | no |
| Speed (CWV) | site | the newest `VitalsReport`, the latest `vitals` job, the owner's vitals interval | no |

AI visibility is not a column yet: nothing collects it.

Each cell: `state`, `lastSync` (ISO), `error` (the site owner only), `paid`,
`href` (where it is set up or shown; null for a site the viewer cannot open).

| State | When |
| --- | --- |
| `ok` | fresh |
| `waiting` | connected, the first sync has not finished |
| `stale` | older than the threshold below |
| `error` | the last attempt failed (the text is the error) |
| `off` | turned off by hand (rank checks) or in Settings > Schedule (crawl, vitals) |
| `not-connected` | nothing to collect from yet (no property, no link, no engine) |
| `paused-billing` | paid collection auto-paused by the billing rule (paid cells only) |
| `paused-status` | the project is paused or archived |
| `no-site` | the project has no site |

Thresholds (named constants in `sources.ts`):

| Source | Stale after |
| --- | --- |
| Search Console | `GSC_STALE_DAYS` = 5 days since the last successful sync (owner approved) |
| Yandex Webmaster, Metrika | `YANDEX_STALE_DAYS` = 2 days (owner approved) |
| Positions, site sync | `RANK_SYNC_STALE_DAYS` = 2 days (the sync is daily) |
| Positions, paid checks | the frequency (7, 14, 31 days) + `SCHEDULE_GRACE_DAYS` (2) since the last started check |
| Crawl, Speed | the site owner's interval + `SCHEDULE_GRACE_DAYS` |

The project line shows the worst state of its sites (error, stale, paused,
waiting, ok, off, not connected), with the oldest last sync in that state.
Its Positions cell is the paid checks; a failing or stale sync of results
shows there too.

`GET /api/v1/projects/_sources` (and `/api/projects/_sources`) returns the
matrix as JSON, `?slug=` for one project. Read only.

## The data sources panel

`/projects/sources`, in the sidebar under Projects. Rows are projects by
group; a project with several sites gets a sub-row per site. Cells show the
state, the last sync and the error (on hover, and as text). The Positions
cell has the on/off switch of paid rank checks for editors and owners, the
same `PATCH .../rank-settings` as the Rank tracking tab (over the provider's
limit it asks, then sends `override`). Other sources are set up where their
cell links to: turning Search Console or Yandex off means unlinking, which
stays in Site settings. The footer counts ok sources per column, and the
header ok, stale, errors and paid sources active. A billing warning shows
under the project's name.

The same cells are in the project's Overview (section Data).

## The projects home

`/projects` is a table, not cards:

1. **Needs attention**: any source in error or stale, an alert of one of the
   viewer's own sites fired in the last 7 days, a payment overdue, a contract
   ended, or paid collection paused by the billing rule. The reasons are
   listed under the name. Paused and archived projects never land here.
2. The other projects by `group` (named groups alphabetically, then "Other
   projects").
3. Prospects.
4. Paused and archived, folded.
5. Sites without a project.

Columns: project (domains), status, data (six dots in the panel's order and
"n of m ok", a link to the panel), paid until, open tasks (and in review),
the last journal entry that is not an agent sync line. One summary line
replaces the former budgets panel: this month's spending against the plan,
checks used against each provider's limit, the number of overdue payments;
nothing when there is nothing to say. On a phone each row is a card that shows
only what is not in order.

## Client billing

### Fields

Migration `20261126000000_agency_billing`, on `Project`, all additive:

| Column | |
| --- | --- |
| `paidUntil` | the last paid day (UTC midnight); null: billing is not tracked |
| `contractEnd` | the last day of the contract; optional |
| `billingNeverPause` | default false; true: warnings only |
| `paidPausedAt`, `paidPauseReason` | written by the rule only: when and why (`overdue`, `contract-ended`) paid collection was auto-paused |

Set in the project's **Money** tab (the former Budget tab, same `?tab=budget`
link): Client payment on top, Spending (plan and actual, unchanged) below.
Also `PATCH /api/v1/projects/{slug}` with `paidUntil` and `contractEnd`
(`YYYY-MM-DD`, `null` or `""` clears) and `billingNeverPause` (boolean), and
the MCP tool `update_project` with the same fields. `GET /projects` and
`GET /projects/{slug}` return them (days as `YYYY-MM-DD`, `paidPausedAt` as a
date-time). They are not accepted on create.

### The rule

| paidUntil | What happens |
| --- | --- |
| null | not tracked: no warning, no pause (a contract end alone does nothing) |
| ahead | ok; "due soon" within 7 days (`BILLING_SOON_DAYS`, a hint only) |
| 1 to 14 days ago | warning on the home, the Overview, the panel and the Money tab, with the day the pause starts |
| more than 14 days ago (`BILLING_GRACE_DAYS`), or `contractEnd` in the past | paid collection auto-paused |

- Only paid collection pauses: rank checks a provider bills for. Search
  Console, Yandex, crawls and vitals keep running, so history is complete on
  the day it resumes.
- `billingNeverPause`: the warnings stay, nothing pauses.
- The pause is its own state. It never changes the manual on/off of rank
  checks nor the project status, so resuming never turns on what someone
  turned off by hand.
- Resume: move `paidUntil` or `contractEnd` forward (or turn on never pause).
  The PATCH applies the rule to that project at once.

The rule runs as the scheduler task `billing-rule` (registered by
`registerProjectCollection` from `extensions/index.ts`) on every scheduling
pass; it works by day, so it changes a project once a day at most. It
writes only on a change of state.

## Project status stops all scheduled collection

Owner decision: a project with status `paused` or `archived` gets no scheduled
collection at all, paid or free. `registerProjectCollection` adds a schedule
filter (`registerScheduleFilter`, no upstream change) that takes the sites of
those projects out of every scheduling pass: Search Console and Bing syncs,
crawls, vitals checks, the rank results sync, the Yandex sync. The rank check
task skips those projects through the guard below. Manual buttons (Sync now,
Run a crawl) still work. Sites without a project are scheduled as before.

## One guard for paid collection

`paidCollectionGuard(db, projectId)` in `lib/projects/collection.ts`, called
by `runRankCheck` (the only place that starts a paid check: scheduled and
"Start a check now") and by the due list of the `rank-checks` task:

1. the project is paused or archived: refused (`status`);
2. the billing auto-pause is stored, or the rule says pause now (before the
   task ran): refused (`billing`);
3. rank checks are off by hand: refused (`off`).

A refused run starts nothing and logs nothing. "Start a check now" answers 400
with the reason. A new paid source must call the guard before it spends.
