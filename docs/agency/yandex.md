# Yandex Webmaster and Yandex Metrika (agency fork)

A site can be linked to one Yandex Webmaster host and one Yandex Metrika
counter (with the goals to track). A daily job syncs both into the database;
the site's Yandex page, the project's Data tab, `/api/v1` and the MCP read
from there. Everything is read only: nothing is changed in Webmaster or
Metrika.

The code is in `lib/yandex/` (clients, OAuth, connection, link, sync, reports,
the job), the screens in `components/yandex/` and
`app/(dashboard)/sites/[siteId]/yandex/`, every UI string in
`lib/yandex/messages.ts`.

## Setup (operator)

1. At oauth.yandex.ru create an app of the **API access** type
   ("Доступ к API"). Its redirect URI is fixed by Yandex to
   `https://oauth.yandex.ru/verification_code`. Rights: Yandex Webmaster
   (`webmaster:hostinfo`), Yandex Metrika (`metrika:read`) and, to show which
   account is connected, Yandex ID (`login:info`).
2. Set `YANDEX_CLIENT_ID` and `YANDEX_CLIENT_SECRET` in the environment. Without
   both, Settings > Connections shows Yandex as not configured.
3. Optional: `SCHEDULE_YANDEX_SYNC_HOURS` (default 24, 0 turns the scheduled
   sync off; Sync now keeps working).

## Connecting (user)

Settings > Connections > Yandex > **Connect** opens
`https://oauth.yandex.ru/authorize?response_type=code&client_id=<id>&force_confirm=yes`
in a new tab. The user signs in with the account that has the sites in
Webmaster and Metrika and allows access; Yandex shows a confirmation code
(valid 10 minutes). The user pastes it into crawlseo. The server exchanges it
(`POST https://oauth.yandex.ru/token`, form body `grant_type=authorization_code`,
`code`, `client_id`, `client_secret`), reads the login
(`GET https://login.yandex.ru/info?format=json`; null without `login:info`, then
the row shows "Connected" and the token expiry) and stores the access token,
refresh token and expiry in `YandexConnection`, encrypted like every stored key
(`lib/encryption.ts`). Tokens never go back to the browser.

A token is refreshed (`grant_type=refresh_token`) when it expires within a day.
If Yandex refuses the refresh, the sync fails with "connect Yandex again"; if
Yandex does not answer, the old token is used while it is still valid.

**Disconnect** revokes the token (`POST https://oauth.yandex.ru/revoke_token`,
best effort), deletes the connection, every Yandex link of the user's sites and
all their synced Yandex data. Another account may not see the same hosts and
counters.

## Linking a site

Site settings > Yandex Webmaster and Metrika > **Load from Yandex** reads the
account's hosts and counters live (`GET /api/user/yandex/hosts?domain=`,
`GET /api/user/yandex/counters?domain=`), preselects the host and counter that
match the site's domain (verified https host first; counter by `site2.site`),
then the counter's goals (`?counterId=`). **Save** sends
`PUT /api/sites/{id}/yandex` with `{ webmasterHostId, metrikaCounterId, goalIds }`
(each optional, `null` clears). The server checks every id against the lists it
reads from Yandex again, so a site can only be linked to the account's own
hosts, counters and goals. A new host or counter starts empty (the old one's
rows are deleted); a removed goal's rows are deleted; anything new queues a
sync. **Sync now** is `POST /api/sites/{id}/yandex/sync` (a job, polled like the
other syncs).

## Sync

Job type `yandex-sync`, registered in `extensions/index.ts`
(`lib/yandex/jobs.ts`), due once a day for a site with a link whose owner is
connected. Webmaster and Metrika are synced independently: one failing keeps
the other, and the error is shown on the Yandex page (`webmasterError`,
`metrikaError`). A refused token, host or counter fails the job at once; an
outage is retried (3 attempts).

| | First sync | Later syncs |
| --- | --- | --- |
| Metrika daily visits, sources, search engines | the last 90 days | from 3 days before the newest stored day |
| Metrika goal reaches | 90 days per goal (also for a goal added later) | as above |
| Webmaster indexing, pages in search, SQI history | the last 365 days (Webmaster keeps about a year) | from 7 days before the newest stored day |
| Webmaster summary (SQI, pages, excluded, problem counts) | today's row | today's row |
| Popular queries | 12 complete weeks (Monday to Sunday, a week is taken 3 days after its Sunday), up to 500 queries each | weeks not stored yet plus the newest stored one again |
| Problems (diagnostics), sitemaps | current state on the link | replaced |

Requests are paced per service in each process (Webmaster 250 ms, Metrika
120 ms apart; Metrika allows 30 requests a second per IP, 3 at once per user,
5000 a day per user and 200 Reporting requests per 5 minutes). 429, 420, 5xx
and network errors are retried up to 4 times with backoff and `Retry-After`;
a used-up daily quota (`QUOTA_EXCEEDED`, `quota_requests_by_uid`) is not
retried, the next daily run is the retry. A full first sync is about 20
requests per site.

## Model

Migration `20261124000000_agency_yandex`.

| Table | What it holds |
| --- | --- |
| `YandexConnection` | per user: encrypted access and refresh token, `expiresAt`, `scope`, `login`, the cached Webmaster `user_id` |
| `YandexSiteLink` | per site: `webmasterHostId` and URL, `metrikaCounterId` and name, `metrikaGoalIds` with names, the current `webmasterProblems` and `webmasterSitemaps`, sync times and the last errors |
| `YandexWebmasterDaily` | per site and day: `sqi`, `searchablePages`, `excludedPages`, problem counts by severity (today's summary), pages downloaded by HTTP status (`http2xx` ... `httpOther`) |
| `YandexQueryWeekly` | per site, week (`weekStart`, a Monday) and query: shows, clicks, average show and click position |
| `YandexMetrikaDaily` | per site and day: `kind` `total` (with bounce rate, page depth, average duration), `source` (key = `ym:s:lastTrafficSource` id) or `engine` (key = `ym:s:lastSearchEngineRoot` id, search traffic only); visits and users |
| `YandexGoalDaily` | per site, goal and day: reaches |

Deleting a site or a user deletes its rows (cascade).

## Screens

- **Site > Yandex**: period 7, 28 or 90 days against the same number of days
  before. Metrika cards (visits, users per day, visits from Yandex search, goal
  reaches), a chart of daily visits (total and the four largest sources), the
  sources, search engines and goals with their change; Webmaster cards (SQI,
  pages in search, excluded pages, site problems; latest value against the
  value at the end of the previous period), the top 50 queries of the newest
  week, the problems present and the sitemaps. A previous period that starts
  before the first stored day shows "No earlier data", not a drop.
- **Project > Sites**: the same cards for the viewer's own sites of the
  project (other members see a site's domain, not its data).

## API and MCP

| Method | Path | |
| --- | --- | --- |
| GET | `/api/v1/sites/{id}/yandex/webmaster` | `?days=` (1 to 365, default 28), `&limit=` (queries, 1 to 500, default 50): `host`, `period`, `latestDate`, `cards` (`{ current, previous }` each), `problems`, `sitemaps`, `week`, `totalQueries`, `queries`, `daily` |
| GET | `/api/v1/sites/{id}/yandex/metrika` | `?days=`: `counter` (with goals), `period`, `totals` (`visits`, `usersPerDay`, `yandexSearchVisits`, `searchVisits`, `goalReaches`, `bounceRate`, `pageDepth`, `avgDurationSeconds`), `sources`, `engines`, `goals`, `daily` |

404 when the site is not the key owner's, or has no host or counter linked.
MCP read tools: `get_yandex_webmaster` and `get_yandex_metrika`.

## Endpoints used, and what was checked

Checked against the official documentation (yandex.ru/dev, Yandex ID,
Webmaster and Metrika) on 2026-11-22. No live call was made during
development: there was no user token yet, and the tests fake every request.

| Call | Checked |
| --- | --- |
| `GET oauth.yandex.ru/authorize?response_type=code&client_id&force_confirm=yes` | yes |
| `POST oauth.yandex.ru/token` (authorization_code, refresh_token; form body) | yes |
| `GET login.yandex.ru/info?format=json` | yes; the scope name `login:info` is from the token sample, not stated on the page |
| `POST oauth.yandex.ru/revoke_token` | not checked in this pass (best effort, its failure is ignored) |
| `GET /v4/user`, `/v4/user/{id}/hosts`, `.../hosts/{host}/summary` | yes |
| `.../indexing/history`, `.../search-urls/in-search/history`, `.../sqi-history` (`date_from`, `date_to`) | yes; the input date format is not stated, ISO 8601 date-times are sent |
| `.../search-queries/popular` (`order_by`, repeated `query_indicator`, `date_from`, `date_to`, `offset`, `limit` up to 500) | yes; `count` is parsed from a number or a string, as the docs disagree |
| `.../diagnostics`, `.../sitemaps?limit=100` | yes |
| `GET api-metrika.yandex.net/management/v1/counters` (`per_page`, 1-based `offset`), `.../counter/{id}/goals` | yes |
| `GET /stat/v1/data` (`ids`, `metrics` up to 20, `dimensions`, `date1`, `date2`, `filters`, `accuracy=full`, `limit`, 1-based `offset`) | yes |
| `ym:s:lastTrafficSource`, `ym:s:lastSearchEngineRoot` | built from the documented `<attribution>` rule; the literal names are not written out |
| The search engine id of Yandex (`yandex`) | not documented; Yandex visits are matched by id `yandex` or a name containing Yandex |
