import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Sidebar footer: the user button (avatar, name) and the app version under it.

const nav = vi.hoisted(() => ({ pathname: "/sites", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/app/(dashboard)/settings/actions", () => ({ signOutAction: vi.fn() }));

const { AppShell } = await import("./app-shell");
const { APP_VERSION } = await import("@/lib/version");
const { SiteSwitcher } = await import("@/components/sites/site-switcher");
const { SITE_SUB_PAGES } = await import("@/lib/site-routes");
const { ProjectSidebar } = await import("@/components/projects/project-sidebar");
const { GlobalNav } = await import("@/components/projects/global-nav");

const SITES = [
  { id: "site-a", domain: "Alpha.example", dataThrough: null },
  { id: "site-b", domain: "beta.example", dataThrough: null },
];

function render(props: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  update?: { version: string; url: string } | null;
  sites?: typeof SITES;
  projectNav?: import("@/lib/projects/navigation").ProjectNav;
  research?: boolean;
}) {
  return renderToStaticMarkup(
    <AppShell {...props} version={APP_VERSION} sites={props.sites ?? []} showCloudPromo={false}>
      <p>page</p>
    </AppShell>
  );
}

/** The hrefs of the links marked as the current page (the desktop sidebar and the mobile drawer render the same links). */
function activeHrefs(html: string): string[] {
  return [...new Set([...html.matchAll(/<a [^>]*>/g)]
    .map((m) => m[0])
    .filter((a) => a.includes('aria-current="page"'))
    .map((a) => a.match(/href="([^"]*)"/)?.[1] ?? ""))];
}

describe("sidebar footer", () => {
  it("shows the package.json version in mono", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    const html = render({ name: "Mike Gafin", email: "mike@quilltab.app" });
    expect(html).toMatch(new RegExp(`class="font-data[^"]*"[^>]*>v${pkg.version.replaceAll(".", "\\.")}<`));
  });

  it("shows the name with initials, and the email when there is no name", () => {
    const named = render({ name: "Mike Gafin", email: "mike@quilltab.app" });
    expect(named).toContain(">Mike Gafin<");
    expect(named).toContain(">MG<");

    const unnamed = render({ name: null, email: "mike@quilltab.app" });
    expect(unnamed).toContain(">mike@quilltab.app<");
    expect(unnamed).toContain(">MI<");
  });

  it("shows the Google picture when there is one", () => {
    const html = render({ name: "Mike", email: "mike@quilltab.app", image: "https://lh3.googleusercontent.com/a/x" });
    expect(html).toContain('src="https://lh3.googleusercontent.com/a/x"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("has no Account or Log out links any more", () => {
    const html = render({ name: "Mike", email: "mike@quilltab.app" });
    expect(html).not.toContain('href="/account"');
    expect(html).not.toContain("Log out");
  });

  it("links a newer release next to the version, and shows nothing without one", () => {
    const url = "https://github.com/crawlseo/crawlseo/releases/tag/v9.0.0";
    const html = render({ name: "Mike", update: { version: "9.0.0", url } });
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('>Update available: v9.0.0<span class="sr-only"> (opens in a new tab)</span></a>');

    expect(render({ name: "Mike" })).not.toContain("Update available");
    expect(render({ name: "Mike", update: null })).not.toContain("Update available");
  });
});

describe("sidebar home and workspace switcher", () => {
  // Agency fork (UX step 1): the logo leads to /projects and the switcher is the project switcher.
  it("has no Dashboard or Sites items and the logo leads to Projects", () => {
    nav.pathname = "/sites";
    const html = render({ name: "Mike", sites: SITES });
    expect(html).not.toContain("/dashboard");
    expect(html).not.toContain(">Dashboard<");
    expect(html).toMatch(/<a href="\/projects" aria-label="crawlseo"|<a aria-label="crawlseo"[^>]*href="\/projects"/);
    expect(html).not.toMatch(/aria-label="crawlseo"[^>]*href="\/sites"|href="\/sites" aria-label="crawlseo"/);
  });

  it("shows Go to project in the switcher, a Projects item and no site groups on the home", () => {
    nav.pathname = "/sites";
    const html = render({ name: "Mike", sites: SITES });
    expect(html).toContain('aria-label="Project: Go to project\u2026"');
    expect(html).toContain('href="/projects"');
    expect(html).not.toContain(">All projects<");
    expect(html).not.toContain(">Clients<");
    expect(html).not.toContain(">Workspace<");
    expect(html).not.toContain(">Research<");
    expect(html).not.toContain(">Site overview<");
  });

  it("has a General block with Data sources, Groups and Settings on every page, the open one highlighted", () => {
    for (const path of ["/projects", "/projects/one", "/sites/site-a/keywords", "/settings"]) {
      nav.pathname = path;
      const html = render({ name: "Mike", sites: SITES });
      expect(html).toMatch(/<nav aria-label="General"[^]*>General<[^]*href="\/projects\/sources"[^]*href="\/projects\/groups"[^]*href="\/settings"/);
    }
    nav.pathname = "/projects/groups";
    const groups = render({ name: "Mike", sites: SITES });
    expect(activeHrefs(groups)).toEqual(["/projects/groups"]);
    nav.pathname = "/projects";
    expect(activeHrefs(render({ name: "Mike", sites: SITES }))).toEqual(["/projects"]);
  });

  it("shows the GSC status only on a site", () => {
    nav.pathname = "/projects";
    expect(render({ name: "Mike", sites: SITES })).not.toContain("GSC data");
    nav.pathname = "/sites/site-a";
    expect(render({ name: "Mike", sites: SITES })).toContain("No GSC data yet");
  });

  it("shows the switcher with no sites too", () => {
    nav.pathname = "/sites";
    expect(render({ name: "Mike" })).toContain('aria-label="Project: Go to project\u2026"');
  });

  it("names a site's section after the domain, in its own case, with Research and without AI & MCP", () => {
    nav.pathname = "/sites/site-a/keywords";
    const html = render({ name: "Mike", sites: SITES });
    // Without project data, every site counts as one without a project.
    expect(html).toContain('aria-label="Project: Sites without a project"');
    expect(html).toContain(">Alpha.example<");
    expect(html).toContain(">Link to a project<");
    expect(html).not.toContain(">Workspace<");
    expect(html).not.toContain(">Connect<");
    expect(html).toContain(">Keyword research<");
    expect(html).toContain('href="/sites/site-a/keywords"');
    expect(html).not.toContain('href="/sites/site-a/mcp"');
    expect(render({ name: "Mike", sites: SITES, research: false })).not.toContain(">Keyword research<");
  });

  it("on a project and its site: one sidebar with the project's sections and the site's pages, no way back line or site picker", () => {
    const project = { slug: "one", name: "One", status: "client", group: "Group", canEdit: true, sites: [{ id: "site-a", domain: "Alpha.example" }] };
    const projectNav = { groups: [{ name: "Group", projects: [project] }], unassigned: [{ id: "site-b", domain: "beta.example" }] };

    nav.pathname = "/sites/site-a/keywords";
    const onSite = render({ name: "Mike", sites: SITES, projectNav });
    expect(onSite).toContain('aria-label="Project: One"');
    expect(onSite).toMatch(/>Group<\/span><span[^>]*>One</);
    expect(onSite).toMatch(/>Project<[^]*href="\/projects\/one"[^]*href="\/projects\/one\?tab=tasks"[^]*>Alpha\.example<[^]*>Site overview<[^]*>Site settings</);
    expect(onSite).not.toContain("Back to");
    expect(onSite).not.toContain('aria-label="Site: ');
    expect(activeHrefs(onSite)).toEqual(["/sites/site-a/keywords"]);

    nav.pathname = "/projects/one";
    nav.search = "tab=journal";
    const onProject = render({ name: "Mike", sites: SITES, projectNav });
    expect(onProject).toContain('href="/sites/site-a"');
    expect(activeHrefs(onProject)).toEqual(["/projects/one?tab=journal"]);
    nav.search = "";
  });

  it("collapsed: icons of the project's sections and of the site, the General block too", () => {
    const project = { slug: "one", name: "One", status: "client", group: null, canEdit: true, sites: [{ id: "site-a", domain: "Alpha.example" }] };
    const projectNav = { groups: [{ name: null, projects: [project] }], unassigned: [] };
    nav.pathname = "/projects/one";
    const html = renderToStaticMarkup(
      <>
        <ProjectSidebar nav={projectNav} collapsed />
        <GlobalNav collapsed />
      </>
    );
    for (const label of ["Projects", "Overview", "Tasks", "About", "Site overview", "Site settings", "Data sources", "Groups", "Settings"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // The switcher is the project's first letter.
    expect(html).toContain('title="One"');
  });

  it("shows a compact square with the site's first letter when collapsed", () => {
    nav.pathname = "/sites/site-b";
    const html = renderToStaticMarkup(<SiteSwitcher sites={SITES} collapsed />);
    expect(html).toContain('aria-label="Workspace: beta.example"');
    expect(html).toContain('title="beta.example"');
    expect(html).toMatch(/size-10[^"]*"/);
    expect(html).toContain(">b</span>");
  });

  it("keeps every site route of this build when switching site", () => {
    const routes = readdirSync(resolve(__dirname, "../../app/(dashboard)/sites/[siteId]"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !(SITE_SUB_PAGES as readonly string[]).includes(r))).toEqual([]);
  });
});

describe("mobile header", () => {
  const project = { slug: "one", name: "One", status: "client", group: null, canEdit: true, sites: [{ id: "site-a", domain: "Alpha.example" }] };
  const projectNav = { groups: [{ name: null, projects: [project] }], unassigned: [] };
  /** The sticky block above the page on a phone: the header and the strip. */
  const mobileTop = (html: string) => html.match(/<div class="sticky top-0 z-30 md:hidden">[^]*?<\/header>(?:<div class="border-b[^]*?<\/nav>)?/)?.[0] ?? "";

  it("shows the menu button and the client, its sections in a strip with the open one current", () => {
    nav.pathname = "/projects/one";
    nav.search = "tab=money";
    const top = mobileTop(render({ name: "Mike", sites: SITES, projectNav }));
    nav.search = "";
    expect(top).toContain('aria-label="Open menu"');
    expect(top).toContain('aria-label="Project: One"');
    expect(top).toMatch(/<nav[^>]*aria-label="Sections of One"/);
    expect(top).toMatch(/>Overview<[^]*>Tasks<[^]*>Journal<[^]*>Data<[^]*>Money<[^]*>About</);
    expect(activeHrefs(top)).toEqual(["/projects/one?tab=money"]);
    // No logo: the header names where you are.
    expect(top).not.toContain('aria-label="crawlseo"');
  });

  it("on a site: a line back to the project overview, then the site's pages", () => {
    nav.pathname = "/sites/site-a/positions";
    const top = mobileTop(render({ name: "Mike", sites: SITES, projectNav }));
    expect(top).toMatch(/<a (?=[^>]*href="\/projects\/one")(?=[^>]*title="One")[^>]*>[^]*?>Alpha\.example</);
    expect(top).toMatch(/>Site overview<[^]*>Positions<[^]*>Site settings</);
    expect(activeHrefs(top)).toEqual(["/sites/site-a/positions"]);
  });

  it("on a general page: its name and no strip; the logo where there is no name", () => {
    nav.pathname = "/projects/sources";
    const top = mobileTop(render({ name: "Mike", sites: SITES, projectNav }));
    expect(top).toContain(">Data sources</span>");
    expect(top).not.toContain("Sections of");
    expect(top).not.toContain('aria-label="Project: ');
    nav.pathname = "/projects/unknown-page/deeper";
    expect(mobileTop(render({ name: "Mike", sites: SITES, projectNav }))).toContain('aria-label="crawlseo"');
  });

  it("the drawer has one line with the logo and the close button", () => {
    nav.pathname = "/projects";
    const html = render({ name: "Mike", sites: SITES, projectNav });
    expect(html).toMatch(/aria-label="crawlseo"[^]*?aria-label="Collapse sidebar"[^]*?aria-label="Close menu"/);
  });
});
