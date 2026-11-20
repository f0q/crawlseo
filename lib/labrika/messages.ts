/*
 * Every UI string of the Labrika screens (Positions page, the site settings
 * section, the Settings connection row), in one place so a translation
 * replaces this file only.
 */

export const LABRIKA_UI = {
  nav: "Positions",
  page: {
    title: "Positions (Yandex/Labrika)",
    description: "Keyword positions from your Labrika rank tracking projects, per search engine, region and device.",
    noLinkTitle: "No Labrika search engine linked",
    noLinkDescription: "Link one or more Labrika search engines to this site in Site settings. The first sync loads every check Labrika has.",
    noLinkAction: "Open site settings",
    noDataTitle: "No checks synced yet",
    noDataDescription: "The first sync is queued or running. Reload in a minute, or run Sync Labrika in Site settings.",
    engine: "Search engine",
    checkOf: (date: string) => `Check ${date}`,
    comparedTo: (date: string) => `vs ${date}`,
    noPrevious: "first check",
    lastSynced: (when: string) => `synced ${when}`,
  },
  cards: {
    top3: "Top 3",
    top10: "Top 10",
    top30: "Top 30",
    notRanked: "Not ranked",
    noChange: "No change",
    firstCheck: "First check",
    vsPrevious: (delta: string) => `${delta} vs previous`,
  },
  table: {
    keyword: "Keyword",
    frequency: "Freq.",
    frequencyExact: "Exact freq.",
    position: "Position",
    change: "Change",
    url: "URL",
    filter: "Filter by keyword or URL...",
    noneMatch: "No keywords match",
    loosen: "Loosen the search.",
    notRanked: "not ranked",
    newEntry: "new",
    lost: "lost",
    footer: (shown: number, total: number, sort: string) =>
      `Showing ${shown} of ${total} keywords · sorted by ${sort}`,
  },
  chart: {
    title: "Keywords in the top over time",
    empty: "The trend shows once there are two checks.",
  },
  settings: {
    title: "Labrika rank tracking",
    description:
      "Positions in Yandex (or other engines Labrika checks) by region and device. Pick the search engines of the Labrika project for this site; each one is a region and a device.",
    connected: "Linked",
    notConnected: "Not linked",
    load: "Load Labrika projects",
    loading: "Loading…",
    suggested: "Matches this site",
    otherProjects: "Other projects",
    noProjects: "This Labrika account has no rank tracking projects.",
    save: "Save",
    sync: "Sync Labrika",
    saved: (added: number, removed: number) =>
      `Saved: ${added} engine(s) added, ${removed} removed.${added ? " The first sync loads every check Labrika has." : ""}`,
    synced: (engines: number, dates: number, rows: number) =>
      `Synced ${engines} engine(s): ${dates} check date(s), ${rows} rows.`,
    partly: (failed: string[]) => `Some engines failed: ${failed.join("; ")}`,
    notConnectedKey: "Labrika is not connected.",
    connectKey: "Connect Labrika in Settings",
    syncedAt: (when: string) => `last sync ${when}`,
    never: "not synced yet",
  },
} as const;
