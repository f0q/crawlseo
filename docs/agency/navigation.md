# Navigation: projects first (agency fork)

A project is the only top-level entity of the interface. A site is part of a
project: the sidebar, the home and the site pages lead through the project.
Every `/sites/...` route, `/api/v1` and the MCP keep working as before; only
the way in and out of a site changed. The code is in
`lib/projects/navigation.ts`, `lib/projects/shell.ts`,
`lib/projects/overview.ts` and `components/projects/`
(`project-switcher.tsx`, `overview-section.tsx`, `site-project-crumb.tsx`);
every string in `lib/projects/messages.ts`.

## Sidebar

- The logo leads to `/projects`, like the landing after sign-in.
- The switcher at the top lists All projects, the projects by group (named
  groups alphabetically, the ungrouped last as "Other projects"; clients,
  prospects, paused, archived inside a group), then **Sites without a
  project** (the user's own sites in none of the projects they see), then
  New project. The upstream site switcher (`components/sites/site-switcher.tsx`)
  is unchanged and no longer used by the shell.
- Under the switcher, inside a project: its sites (only the user's own, the
  only ones they can open). One site is a plain link, several are a menu that
  keeps the open site sub-page, no site shows nothing.
- Items: Projects and Data sources (`/projects/sources`, see
  [sources-and-billing.md](sources-and-billing.md)) on every page. On a site: "Back to {project}" first, the site
  group named after the domain, Research only when DataForSEO is connected
  (the pages still open by link), Site settings. AI & MCP is left out of the
  menu; `/sites/{id}/mcp` still opens and Settings > MCP has the same.

## Site pages

`app/(dashboard)/sites/[siteId]/layout.tsx` puts one line above every site
page: the project (a link to it) and the domain. A site in none of the user's
projects says "Sites without a project" and links to that block of
`/projects`.

## Projects page

No All sites button. Since UX step 2 a table, not cards: Needs attention, then
the projects by `group`, prospects, paused and archived (folded), with a data
column from the sources matrix and a paid until column (see
[sources-and-billing.md](sources-and-billing.md)). Below them, while there are
any, **Sites without a project** lists the user's sites outside every project,
with the one remaining link to `/sites`.

## Project groups

`Project.group`: optional free text, at most 80 characters (migration
`20261125000000_agency_project_group`, one nullable column). Projects with the
same group are listed together, e.g. "Centro Adelante" for one client's four
projects. Set it in the passport form, with `POST` or `PATCH
/api/v1/projects/{slug}` (`"group": "..."`; `""` or `null` clears it), or with
the MCP tools `create_project` and `update_project`. `GET /projects` and
`GET /projects/{slug}` return it with the passport.

## Project page

Tabs: **Overview** (the default, `/projects/{slug}`), Tasks, Journal, Sites,
Rank tracking, Money (`?tab=budget`: client payment and spending, formerly
Budget), Passport (`?tab=passport`, formerly the default), Brief and materials.

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
  line naming `crawlseo-sync`); the Journal tab still has them.

No project: no switcher site line, "Add a domain" in the Overview.
