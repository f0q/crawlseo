# Rank tracking settings and client budget (agency fork)

Two tabs of a project page: **Rank tracking** decides whether crawlseo starts
position checks for the project, and **Budget** holds the client's monthly
plan against what was actually spent. The code is in `lib/projects/rank.ts`,
`lib/projects/rank-usage.ts` (the arithmetic, shared with the browser),
`lib/projects/rank-jobs.ts` (the schedule) and `lib/projects/budget.ts`; the
tabs in `components/projects/rank-settings-section.tsx` and
`components/projects/budget-section.tsx`; every string in
`lib/projects/messages.ts`.

## Model

Migration `20261123000000_agency_rank_settings_budget`.

| Table | What it holds |
| --- | --- |
| `ProjectRankSettings` | per project: `enabled` (default false), `source` (a rank provider id or `none`), `frequency` (`weekly`, `biweekly`, `monthly`, `manual`), `engineIds` (ExternalRankEngine ids of the project's sites), `updatedBy` |
| `RankCheckRun` | the usage log: one row per attempt to start a check. `provider`, `trigger` (`schedule` or `manual`), `status` (`started`, `partial`, `skipped`, `failed`), `reason`, `engineIds`, `details` (per engine: label, keywords, started, error), `estimatedChecks` (keywords of the engines that were started), `createdAt` |
| `RankProviderPlan` | per provider, for the whole instance: `monthlyLimit`, `planName`, `planPrice`, `planChecks`, `currency`. No row: the defaults below |
| `ProjectBudget` | per project: `currency` (`RUB` default, or `USD`), `categories` (default `work, services, ads, content, links, other`) |
| `BudgetPlanLine` | the plan of one category: `month` `""` is every month, `"YYYY-MM"` is that month only, over the default |
| `BudgetEntry` | an actual cost: `date`, `category`, `amount`, `note`, `externalKey` (unique per project), `author`, `authorKind` |

The migration gives every existing project a `ProjectRankSettings` row with
`enabled = false`. A project created later has no row until someone saves the
tab, which reads the same as off.

## Rank tracking

### Usage

A check is one keyword in one engine (search engine, region, device) on one
run. For each included engine the number of keywords is the count on its
latest synced check (`ExternalRank`); an engine that never synced counts 0
until its first sync.

```
checks per run   = sum of keywords of the included engines
checks per month = ceil(checks per run x runs a month)
runs a month     = weekly 4.35 (365/12/7), every 2 weeks 2.17, monthly 1, manual 0
```

The tab shows this for the project and, for each provider, the planned
checks of every enabled project against the provider's monthly limit, and
the checks started this month.

### Limits and prices

Defaults per provider come from the adapter's `billing`: Labrika Business,
360 RUB for 5000 checks (0.072 RUB per check), a limit of 5000 checks a
month. Environment variables change the defaults, and the tab's
"Edit limit and price" stores a `RankProviderPlan` row over them. A limit of
0 means no limit. Who may edit: instance admins (`CRAWLSEO_ADMIN_EMAILS`); any
signed-in user when no admin is configured. The API cannot change plans.

A save (dashboard or API) that raises the project's planned checks and takes
the total of all enabled projects over the limit is refused with 409. The tab
asks for a confirmation and sends `"override": true`; the API caller does the
same. Lowering the plan, or saving unchanged settings that are over because
the keyword lists grew, is never refused.

### Starting checks

A provider can start checks when its adapter has the optional
`startCheck(login, targets)` and `cabinet` (see
[rank-providers.md](rank-providers.md)). Otherwise the tab says "Manual": the
provider runs on its own schedule or is started in its own interface, and
crawlseo only syncs the results.

Labrika's Public API cannot start a check. `lib/rank-providers/labrika/cabinet.ts`
signs in to the cabinet with a stored login (GET and POST
`https://labrika.ru/login`, form fields `email` and `password`, plus the form
token when the page has one), then calls
`POST https://labrika.ru/api/v1/sites/<site_uuid>/reports/search_positions/start`
with `{"useAvailableLimits":false,"tagIds":[],"siteEngineId":<engine>,"useBalance":false}`,
one call per selected engine, so engines of the Labrika project that are not
selected are not checked. The login and password are stored per user in
`ApiKey` as `labrika-cabinet`, encrypted like every key (Settings > Rank
tracking > Labrika cabinet login). The login of the owner of each engine's
site is used. This flow is written from the cabinet's own requests and was
not run against Labrika during development (the tests fake every request);
check the first runs in the usage log.

### The schedule

`registerRankChecks` (from `extensions/index.ts`) adds the scheduler task
`rank-checks`, which runs once per scheduling pass (every 10 minutes, one
process at a time). It looks only at projects with `enabled` true, a source
other than `none` and a frequency other than `manual`. A project is due when:

- it never had a started run, or its last started run (scheduled or by hand)
  is one interval old (7 days, 14 days, one calendar month; 2 hours of slack);
- and its last scheduled attempt, if it was skipped or failed after that, is
  at least a day old, so a missing login is logged once a day, not every pass.

At most 3 projects start per pass; the others wait for the next pass. Each
run reads the settings again and does nothing, logging nothing, when they are
off. Otherwise it logs one `RankCheckRun`:

| status | reason | when |
| --- | --- | --- |
| `skipped` | `no-engines` | no selected engine is still linked to a site of the project |
| `skipped` | `not-supported` | the provider cannot start checks |
| `skipped` | `over-limit` | checks started this month plus this run would pass the monthly limit (a scheduled run never overrides; "Start a check now" asks) |
| `skipped` | `no-cabinet-login` | no site owner of the selected engines has a cabinet login stored |
| `started` / `partial` | | every / some engine was started; `estimatedChecks` counts the started ones |
| `failed` | the provider's answer | the login or every start was refused |

"Start a check now" (dashboard, editors and owners) runs the same code as a
`manual` run and needs checks turned on.

Every start, scheduled or by hand, first goes through `paidCollectionGuard`
(`lib/projects/collection.ts`): a paused or archived project, or one whose paid
collection the billing rule paused, starts nothing and logs nothing. See
[sources-and-billing.md](sources-and-billing.md). The Budget tab is now the
Money tab (same link), with the client's payment above the spending.

`SCHEDULE_RANK_CHECKS=false` turns the task off for the whole instance; the
settings, usage and budget keep working.

## Budget

- Plan: a default amount per category for every month, and optional amounts
  for one month over the default (an empty field keeps the default).
- Actual of a month: the manual entries of that month by category, plus the
  automatic service costs: the checks the project started that month
  (`RankCheckRun.estimatedChecks` of `started` and `partial` runs) times the
  provider's current price per check, under `services`. A provider priced in
  another currency than the project's is shown but not added (no conversion).
- The tab shows plan vs actual per category with bars, the entries, the
  automatic costs and the last 6 months. The projects list shows this month
  of every project: plan, actual and % used, totals per currency, and the
  planned and started checks of each provider.

## API

The routes are part of the projects API (`lib/projects/http.ts`), so
`/api/v1/projects/...` with an access key and `/api/projects/...` for the
dashboard. Writes need the editor role, and through `/api/v1` a key with the
write scope.

| Method | Path | |
| --- | --- | --- |
| GET | `/projects/_summary` | `?month=YYYY-MM`: `budget` (every visible project's plan, actual, % and totals per currency) and `rank` (per provider: plan, planned, used, cost, the limit) |
| GET | `/projects/{slug}/rank-settings` | settings, engines with keywords, usage, the limit, how checks start (`starting.mode`: `auto`, `manual`, `none`; `missingCabinetFor`), every provider's usage, the last 20 runs |
| PATCH | `/projects/{slug}/rank-settings` | `enabled`, `source`, `frequency`, `engineIds`, `override`. 400: unknown source, engines of another source or project, turning on without a source. 409: over the limit |
| GET | `/projects/{slug}/rank-usage` | `?month=`: the runs of the month, the checks started and their cost per provider |
| GET | `/projects/{slug}/budget` | `?month=`: currency, categories, plan (`defaults`, `month`), entries, `autoCosts`, `summary` (rows per category), `history` (6 months) |
| PATCH | `/projects/{slug}/budget` | `currency`, `categories`, `plan: { month: null or "YYYY-MM", lines: { category: amount or null } }` (null removes the line) |
| POST | `/projects/{slug}/budget-entries` | `category`, `amount`, `date` (default today UTC), `note`, `externalKey` (the same key again updates that entry: 200 with `created: false`) |
| PATCH | `/projects/{slug}/budget-entries/{id}` | `date`, `category`, `amount`, `note` |

Dashboard only: `POST /api/projects/{slug}/rank-checks` (start now,
`override`), `PATCH /api/projects/_rank-plans` (`provider`, `monthlyLimit`,
`planName`, `planPrice`, `planChecks`, `currency`),
`DELETE /api/projects/{slug}/budget-entries/{id}`.

```bash
curl -s -X PATCH -H "Authorization: Bearer $CRAWLSEO_KEY" -H "Content-Type: application/json" \
  -d '{"enabled":true,"source":"labrika","frequency":"weekly","engineIds":["<engine id>"]}' \
  https://seo.example.com/api/v1/projects/acme/rank-settings
curl -s -X POST -H "Authorization: Bearer $CRAWLSEO_KEY" -H "Content-Type: application/json" \
  -d '{"category":"links","amount":1500,"note":"Two guest posts","externalKey":"inv-7"}' \
  https://seo.example.com/api/v1/projects/acme/budget-entries
```

## MCP

| Tool | |
| --- | --- |
| `get_project_budget` | read: a month's plan vs actual by category, automatic costs, entries, the last 6 months |
| `get_rank_usage` | read: with `slug`, the project's settings, planned checks and the month's runs; without, every provider's usage against its limit |
| `add_budget_entry` | write: an actual cost; `externalKey` makes a retry safe |

## Environment

| Variable | Default | |
| --- | --- | --- |
| `SCHEDULE_RANK_CHECKS` | `true` | `false` turns the scheduled starts off for the instance |
| `RANK_CHECK_LIMIT_LABRIKA` | `5000` | default monthly check limit of the provider (`RANK_CHECK_LIMIT_<ID>`), 0 for none |
| `RANK_CHECK_PRICE_LABRIKA` | `360/5000` | default plan price / checks in the plan (`RANK_CHECK_PRICE_<ID>`) |

## Known gaps

- The Labrika cabinet login and start were never run against Labrika (no
  live calls during development). A changed login form, a captcha or two-step
  sign-in makes runs fail with "Labrika refused the cabinet login"; the usage
  log shows it and nothing is spent.
- `estimatedChecks` is keywords x engines at the time of the start, not what
  Labrika billed; the cost uses today's price per check for past months.
- No currency conversion between RUB and USD.
