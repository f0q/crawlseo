import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Sidebar footer: the user button (avatar, name) and the app version under it.

const nav = vi.hoisted(() => ({ pathname: "/sites" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/app/(dashboard)/settings/actions", () => ({ signOutAction: vi.fn() }));

const { AppShell } = await import("./app-shell");
const { APP_VERSION } = await import("@/lib/version");
const { SiteSwitcher } = await import("@/components/sites/site-switcher");
const { SITE_SUB_PAGES } = await import("@/lib/site-routes");

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

  it("shows All projects in the switcher, a Projects item and no site groups on the home", () => {
    nav.pathname = "/sites";
    const html = render({ name: "Mike", sites: SITES });
    expect(html).toContain('aria-label="Project: All projects"');
    expect(html).toContain('href="/projects"');
    expect(html).not.toContain(">Clients<");
    expect(html).not.toContain(">Workspace<");
    expect(html).not.toContain(">Research<");
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
    expect(render({ name: "Mike" })).toContain('aria-label="Project: All projects"');
  });

  it("names the site group after the domain, in its own case, with Research and without AI & MCP", () => {
    nav.pathname = "/sites/site-a/keywords";
    const html = render({ name: "Mike", sites: SITES });
    // Without project data, every site counts as one without a project.
    expect(html).toContain('aria-label="Project: Sites without a project"');
    expect(html).toContain(">Alpha.example<");
    expect(html).not.toContain(">Workspace<");
    expect(html).toContain(">Research<");
    expect(html).toContain('href="/sites/site-a/keywords"');
    expect(html).not.toContain('href="/sites/site-a/mcp"');
    expect(render({ name: "Mike", sites: SITES, research: false })).not.toContain(">Research<");
  });

  it("on a site of a project: the project in the switcher, the way back to it and a picker of its sites", () => {
    const projectNav = {
      groups: [{ name: "Group", projects: [{ slug: "one", name: "One", status: "client", group: "Group", sites: SITES.map(({ id, domain }) => ({ id, domain })) }] }],
      unassigned: [],
    };
    nav.pathname = "/sites/site-a/keywords";
    const html = render({ name: "Mike", sites: SITES, projectNav });
    expect(html).toContain('aria-label="Project: One"');
    expect(html).toContain('href="/projects/one"');
    expect(html).toContain(">Back to One<");
    expect(html).toContain('aria-label="Site: Alpha.example"');

    // A project with one site shows it as a plain link; the project page has no way back line.
    const single = { ...projectNav, groups: [{ ...projectNav.groups[0], projects: [{ ...projectNav.groups[0].projects[0], sites: [{ id: "site-a", domain: "Alpha.example" }] }] }] };
    nav.pathname = "/projects/one";
    const onProject = render({ name: "Mike", sites: SITES, projectNav: single });
    expect(onProject).toContain('aria-label="Project: One"');
    expect(onProject).toMatch(/href="\/sites\/site-a"><svg[^]*?>Alpha\.example<\/span><\/a>/);
    expect(onProject).not.toContain('aria-label="Site: ');
    expect(onProject).not.toContain("Back to One");
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
