# Navigation: projects first (agency fork)

A project is the only top-level entity of the interface. A site is part of a
project: the sidebar, the home and the site pages lead through the project.
Every URL (`/projects/{slug}?tab=...`, `/projects/sources`,
`/projects/groups`, `/sites/...`), `/api/v1` and the MCP work as before; only
where the links stand changed. The code: `lib/projects/nav-items.ts` (every
item of the sidebar and of the phone strip, pure), `lib/projects/navigation.ts`
(the switcher's data and where it leads), `lib/projects/shell.ts` (the loader),
`components/projects/` (`project-sidebar.tsx`, `project-switcher.tsx`,
`global-nav.tsx`, `mobile-header.tsx`, `context-strip.tsx`, `breadcrumbs.tsx`,
`site-project-crumb.tsx`); every string in `lib/projects/messages.ts`.
Upstream's `components/layout/sidebar-nav.tsx` and
`components/sites/site-switcher.tsx` are unchanged and no longer used by the
shell; `app-shell.tsx` mounts the agency sidebar, the General block and the
phone header in their place.

## Sidebar

Three rules (navigation review of 2026-11-23): top to bottom is a path
(Projects, the project, its sites), the bottom is about every project, and
exactly one item is active: the open screen.

- The logo leads to `/projects` and does nothing else.
- **Projects**, active on `/projects` and `/projects/new` only.
- **The switcher** under it changes the client. It names the open project
  (its group, if any, in a small line above), "Sites without a project" on
  such a site, "Go to project..." elsewhere. The menu: the projects by group
  (the ungrouped first, then named groups alphabetically; clients, prospects,
  paused, archived inside a group), **Sites without a project** (the user's
  own sites in none of the projects they see), New project. Choosing a
  project keeps the screen (`switchTarget`): from a project section the same
  section of the other project, from a site page the same page of its first
  site (its Overview when it has no site of the user's), from anywhere else
  its Overview.
- **Inside a project**, the section **Project**: Overview, Tasks, Journal,
  Data, Money, About (the `?tab=` links; a former key counts as the tab it
  moved to). Then a section per site of the project (only the user's own,
  the only ones they can open), titled with the domain: Site overview,
  Keywords, Saved keywords, Positions, Yandex, Pages, Crawl / Audit, Vitals,
  Opportunities, Alerts, Research (Keyword research, Domain overview,
  Backlinks; only with DataForSEO connected, the pages still open by link),
  Site settings last. AI & MCP is left out; `/sites/{id}/mcp` still opens and
  Settings > MCP has the same.
- A site page shows **the same sidebar**: only the active item changes, and
  the project's sections are one click away. There is no "Back to" line and
  no site picker.
- **Several sites**: each domain is a line of its own; only the open site
  unfolds its pages, on the project's own pages all are folded. Another
  domain from a site page opens the same page of that site.
- **No site**: an editor or owner sees "+ Add a domain"
  (`?tab=data#sites`), a viewer nothing.
- **A site without a project**: no Project section; "Link to a project"
  (`/projects#unassigned`) above the site's section.
- **General**, fixed at the bottom with the user menu (the middle scrolls):
  Data sources (`/projects/sources`, see
  [sources-and-billing.md](sources-and-billing.md)), Groups
  (`/projects/groups`, see [projects.md](projects.md#groups)), Settings. The
  same on every screen. The GSC status ("GSC data through ...") shows only on
  a site, it is about that site. Settings is also still in the user menu
  (upstream file, left alone).
- **Collapsed**: the same zones as icons with dividers: Projects, the
  project's first letter (the switcher), the six section icons, the open
  site's page icons (a globe per folded site), the three General icons.

`lib/projects/nav-items.test.ts` fails when upstream adds a site page to
`SITE_SUB_PAGES` that is neither in the menu (`SITE_PAGES`,
`SITE_RESEARCH_PAGES`, `SITE_SETTINGS_PAGE`) nor hidden on purpose
(`SITE_HIDDEN_PAGES`, `mcp`).

## Phone

Below `md` the client's navigation is a strip under the header, never the
sidebar and the strip at once. The header (fixed with the strip): the menu
button and the client's name, a tap on which opens the switcher; on a
general page its name ("Projects", "Data sources", ...), the logo elsewhere.
The strip: the project's six sections, or on a site a line back to the
project's Overview (the domain) and the site's pages; it scrolls sideways,
fades at the right edge and keeps the open item in view. The menu button
opens the same sidebar, with the logo and the close button on one line.
Breadcrumbs are hidden on a phone.

## Breadcrumbs

Only the path by the hierarchy, one look, no chevron, hidden on a phone:
`Projects / project` on the Overview, `Projects / project / Tasks` on a
section, `Projects / project / domain` above every site page
(`app/(dashboard)/sites/[siteId]/layout.tsx`; a site in none of the user's
projects says "Sites without a project" and links to that block of
`/projects`; the page title names the screen). Data sources, Groups and
Settings have none.

## Site pages

Since UX step 3:

- Keywords and Positions render 100 rows and grow with "Show 100 more" or
  "Show all" (`components/ui/show-more.tsx`). Filters and sorting run on every
  row first and the footer counts them; CSV export is server side and has
  every row.
- Alerts describe each rule in words ("Fires when Search Console clicks of the
  last 7 days fall 20% or more ...", `lib/alerts/describe.ts`) instead of the
  config JSON.
- The Positions chart scales its lines to the top 3/10/30 counts; keywords not
  ranked are a band of their own under them (the share of all keywords), so
  a big "not ranked" count no longer flattens the lines.
- Date-times are shown in the user's time zone: see [time-zone.md](time-zone.md).

## Projects page

No All sites button, and since the navigation step A no Data sources and
Groups buttons either (they are in the General block); New project only.
Since UX step 2 a table, not cards: Needs attention, then
the projects by `group`, prospects, paused and archived (folded), with a data
column from the sources matrix and a paid until column (see
[sources-and-billing.md](sources-and-billing.md)). Below them, while there are
any, **Sites without a project** lists the user's sites outside every project,
with the one remaining link to `/sites`.

## Project groups

`Project.group`: optional free text, at most 80 characters (migration
`20261125000000_agency_project_group`, one nullable column). Projects with the
same group are listed together, e.g. "Centro Adelante" for one client's four
projects. Set it with the group picker (About tab, New project, the Groups
page), with `POST` or `PATCH /api/v1/projects/{slug}` (`"group": "..."`; `""`
or `null` clears it), or with the MCP tools `create_project` and
`update_project`. `GET /projects` and `GET /projects/{slug}` return it with
the passport. Renaming and ungrouping a whole group: see
[projects.md](projects.md#groups). On `/projects` each named group's heading
has a "⋯" menu (Rename, Ungroup) for its owners and editors.

## Project page

Six sections since UX step 3 (`lib/projects/tabs.ts`). Since the navigation
step B they are items of the sidebar (and of the phone strip), not tabs on
the page; the header has the name, the status badge and the number of sites.
The Data section's "In the panel for all projects" link leads to
`/projects/sources#p-{slug}`, where that row is highlighted.

| Section | `?tab=` | What it holds |
| --- | --- | --- |
| **Overview** | none (the default) | see below |
| Tasks | `tasks` | |
| Journal | `journal` | |
| Data | `data` | the project's line of the data sources panel (`#sources`), its sites and Yandex cards (`#sites`), rank tracking settings (`#rank`) |
| Money | `money` | client payment and spending (`&month=YYYY-MM` for the spending) |
| About | `about` | passport (`#passport`), brief and materials (`#brief`), members and deleting the project (`#members`) |

The former keys still work: the page redirects `?tab=sites` to
`?tab=data#sites`, `rank` to `?tab=data#rank`, `budget` to `?tab=money`
(keeping `month`), `passport` to `?tab=about#passport` and `brief` to
`?tab=about#brief`. Any other value opens the Overview.

The Overview only shows and links on, from data that is already there:

- Needs attention: alerts of the project's sites that fired in the last 7
  days (enabled alerts, `Alert.lastFired`), overdue open tasks, tasks in review.
- Last 28 days against the 28 before, per site: Search Console clicks,
  impressions and average position (`getSitePeriodMetrics`, only when the site
  has data), Yandex visits, visits from Yandex search, goal reaches and SQI
  (`lib/yandex/report.ts`, only with a Yandex link), and links to the site's
  pages. Numbers are not added up across sites. A site's numbers and alerts
  are shown only to its owner; other members see the domain.
- Data: the project's line of the data sources panel; a payment overdue or
  paid collection paused by the billing rule is listed under Needs attention.
- Rank tracking on or off, source, frequency, the last started check.
- Open tasks: review first, then in progress, then to do; high priority and
  the earliest due first.
- The latest journal entries, without the agent's platform sync lines (a short
  line naming `crawlseo-sync`); the Journal section still has them.

No site: "+ Add a domain" in the sidebar (editors and owners) and in the Overview.
