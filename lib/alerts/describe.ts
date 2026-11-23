/*
 * Agency fork: the rule of an alert in words, for the Alerts page, instead of
 * its raw config JSON. The thresholds and their defaults are those of
 * lib/alerts/evaluate.ts.
 */

type Config = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const trim = (n: number) => String(Number(n.toFixed(1)));

/** The config keys each type reads; any other key is listed as is after the rule. */
const KNOWN_KEYS: Record<string, string[]> = { TRAFFIC_DROP: ["thresholdPct"], POSITION_CHANGE: ["thresholdPositions"] };

function rule(type: string, config: Config): string {
  switch (type) {
    case "TRAFFIC_DROP": {
      const pct = Math.abs(num(config.thresholdPct) ?? -20);
      return `Fires when Search Console clicks of the last 7 days fall ${trim(pct)}% or more against the 7 days before (with at least 5 clicks).`;
    }
    case "POSITION_CHANGE": {
      const by = Math.abs(num(config.thresholdPositions) ?? -2);
      return `Fires when the average position of the last 28 days gets worse by ${trim(by)} or more against the 28 days before.`;
    }
    case "CRAWL_ISSUES":
      return "Fires when the health score of the latest crawl is under 70.";
    case "VITALS_DEGRADED":
      return "Fires when 2 of the last 5 vitals checks are poor: LCP over 2.5 s, CLS over 0.1 or performance under 50.";
    case "NOINDEX_SITEWIDE":
      return "Fires when most pages of the latest crawl are noindex.";
    case "NEW_404":
      return "Fires when a crawl finds new broken links.";
    default:
      return "";
  }
}

function plain(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** "Fires when ..." for the alert's type and config; unknown settings are added as "name: value". */
export function describeAlertRule(type: string, config: unknown): string {
  const c: Config = config && typeof config === "object" && !Array.isArray(config) ? (config as Config) : {};
  const known = new Set(KNOWN_KEYS[type] ?? []);
  const extra = Object.entries(c)
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => `${k}: ${plain(v)}`);
  return [rule(type, c), extra.length ? `Settings: ${extra.join(", ")}.` : ""].filter(Boolean).join(" ");
}
