# Display time zone (agency fork)

Times are stored in UTC. Each user picks the zone date-times are shown in:
Settings > Time zone (`/settings#time-zone`), a list of every IANA zone the
server knows, the common ones first, with a filter and a "Use it" link for the
browser's own zone. The default for existing and new users is
`Asia/Makassar`.

Migration `20261127000000_agency_time_zone`:

```sql
ALTER TABLE "UserSettings" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Makassar';
```

A user without a `UserSettings` row gets the same default in code
(`lib/timezone-server.ts`); a stored value that is not a zone reads as the
default too.

## What moves and what does not

- Date-times move: "22 Nov 17:30 UTC" becomes "23 Nov 01:30" in
  Asia/Makassar (no suffix unless the zone is UTC). Alerts (last fired, on the
  Alerts page and in the project Overview), the data sources panel (the day,
  and the time on hover), Yandex "updated", rank check runs and the last
  sync of a rank source, positions "last synced", vitals checks, crawl
  failures, webhook and email delivery lines, MCP key "last used", job retry
  notes, note versions, file uploads, Yandex connection dates.
- Calendar days never move: Search Console and Metrika days (charts, "GSC data
  through" in the sidebar), journal dates, task due dates, paid until and
  contract dates, rank check days, spending dates, any `YYYY-MM-DD` value.
- A new journal entry is dated today in the user's zone. The API keeps its
  own default (today in UTC).

## Code

- `lib/timezone.ts` (pure): the default, validation, the zone list,
  `zonedParts`, `todayIn`.
- `lib/format.ts` `formatDay(value, { time, year, timeZone })`: with
  `timeZone` an instant is shown in that zone. With `time` and no `timeZone`,
  the browser uses the signed-in user's zone (set by the provider) and the
  server UTC, so two requests never share a zone. Without `time`, only an
  explicit `timeZone` moves the day.
- `lib/timezone-server.ts`: `getDisplayTimeZone()` for server components
  (once per request), `readTimeZone`, `saveTimeZone`.
- `components/timezone-provider.tsx`: wraps the dashboard layout;
  `useTimeZone()` in client components, so the server render and the browser
  agree.
- `app/(dashboard)/settings/time-zone-actions.ts`: the server action that
  saves it.
