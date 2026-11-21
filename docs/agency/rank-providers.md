# Rank providers (agency fork)

Keyword positions come from three kinds of source, all stored the same way
(`ExternalRankEngine` + `ExternalRank`) and shown by the same Positions page,
`/api/v1` routes and MCP tools:

| Source | `source` value | How rows arrive |
| --- | --- | --- |
| A rank provider (Labrika now) | the provider id, e.g. `labrika` | The `rank-sync` job: a backfill of every check date on first link, then new dates plus the newest stored one, once a day (`SCHEDULE_RANK_SYNC_HOURS`) |
| CSV import | `import` | Site settings > Rank tracking > Import CSV |
| Your own script or parser | any name you pick, e.g. `xml-parser` | `POST /api/v1/sites/{id}/positions` or the MCP tool `push_positions`, with a write-scoped key |

An engine is one search engine, region and device of one source. Engines of
different sources with the same search engine, region and device (see
`matchKey` in `lib/rank-providers/common.ts`) can be compared side by side on
the Positions page.

## Adding a provider

A provider is one adapter directory and one line in the registry. Sync,
history, the Positions page, Settings, `/api/v1` and the MCP tools need no
change.

1. **Adapter.** Create `lib/rank-providers/<id>/provider.ts` exporting a
   `RankProvider` (`lib/rank-providers/types.ts`):

   ```ts
   export const exampleProvider: RankProvider = {
     id: "example",               // ApiKey.provider and ExternalRankEngine.source; never change it
     name: "Example",
     meta: { id: "example", name: "Example", description: "...", help: "Where the key comes from", helpLink: { href: "https://...", label: "..." } },
     hosts: ["api.example.com"],  // every host the adapter calls
     maxDatesPerRequest: 30,      // days per fetchPositions call
     createClient(apiKey, opts) { ... },   // returns a RankProviderClient
     testKey(apiKey, opts) { ... },        // true or false, never throws
   };
   ```

   Optional, for providers that can start a check: `billing` (the default
   plan: price, checks in it, monthly limit), `cabinet` (the login the
   provider needs, stored as ApiKey `cabinet.keyProvider` with a login and a
   password) and `startCheck(login, targets, opts)`, which returns per
   engine whether it started. Without them the project tab shows "Manual".
   See [rank-settings-and-budget.md](rank-settings-and-budget.md).

   The client implements `ping`, `listProjects`, `listEngines(project)`,
   `listDates(engine)` and `fetchPositions(engine, dates)`. Rows are
   `{ keyword, date: "YYYY-MM-DD", position: number | null, url, frequency?, frequencyExact? }`;
   `null` means checked and not found. Throw a subclass of
   `RankProviderError` with the HTTP status, so 400/401/403/404 count as
   permanent (no retry) and the rest are retried. Keep the provider's rate
   limit in the client (see `labrika/client.ts`: pacing, `Retry-After`, 5xx
   backoff). Use `opts.fetch`, `opts.sleep` and `opts.minGapMs` so tests run
   without the network. No database imports in the adapter: keys are read by
   `keys.ts`.

2. **Register it** in `lib/rank-providers/registry.ts`:
   `const PROVIDERS = [labrikaProvider, exampleProvider];`

   This alone adds the key row in Settings > Rank tracking (add, test,
   remove), lets `/api/user/api-keys` store and test the key, offers the
   provider under "Connect rank source" in Site settings and includes its
   engines in the daily `rank-sync` job. Removing the key unlinks that
   provider's engines with their positions; imported and pushed ones stay.

3. **Outbound hosts.** Add every host of `hosts` to `outbound-hosts.json`
   under `requests` (and to the README section "Your data stays yours", host
   table and host list). `lib/outbound-hosts.test.ts` fails on a host in the
   code that is not listed, and the adapter test below checks `hosts`.

4. **Tests.** Next to the adapter, as `labrika/` does:
   - parse tests against fixtures of real answers (hosts replaced by example ones);
   - client tests with a fake `fetch`: pagination, rate limit waits, retries, a refused key;
   - a provider test: registered, `hosts` in `outbound-hosts.json`, `listProjects` and `listEngines`, `fetchPositions` returning only the asked days.

   The generic sync (`sync.test.ts`), linking (`links.test.ts`), API
   (`api-v1.test.ts`) and MCP tests already cover the shared parts.

## Pushing positions from a script

Create a key with "Read and write positions" in Settings > MCP (MCP must be
on). Then:

```sh
curl -X POST "$CRAWLSEO/api/v1/sites/$SITE_ID/positions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "source": "xml-parser",
    "engine": "Яндекс", "region": "Москва", "device": "desktop",
    "label": "",
    "rows": [
      { "keyword": "печь для бани", "date": "2026-11-20", "position": 7, "url": "https://example.com/pechi" },
      { "keyword": "барбекю комплекс", "date": "2026-11-20", "position": null }
    ]
  }'
```

- At most 5000 rows and 4 MB per request, 20 writes a minute per key, on top of
  the shared `API_RATE_LIMIT_PER_MINUTE`.
- Idempotent: the same keyword on the same day of the same engine is replaced,
  so a retried request leaves the same rows.
- `source` is 2 to 32 of `a-z`, `0-9`, `-`, `_`, and cannot be a provider id
  (those engines belong to the sync). `label` keeps two runs of one source apart.
- Read back with `GET /api/v1/sites/{id}/rank-engines` and
  `GET /api/v1/sites/{id}/positions?source=xml-parser&from=&to=`.

## CSV import

Columns by header name, English or Russian, any order: `keyword`, `date`,
`position`, `engine` (required), `url`, `region`, `device`, `frequency`
(optional). Comma, semicolon or tab separated. Dates as `YYYY-MM-DD` or
`DD.MM.YYYY`. An empty position, `0`, `-` or `>100` means not ranked. The
browser shows a preview and every line it cannot use before anything is sent;
the server checks the rows again with the same schema (`rows.ts`).
