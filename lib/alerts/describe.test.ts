import { describe, expect, it } from "vitest";
import { describeAlertRule } from "./describe";

describe("describeAlertRule", () => {
  it("puts the thresholds of the default alerts in words", () => {
    expect(describeAlertRule("TRAFFIC_DROP", { thresholdPct: -20 })).toBe(
      "Fires when Search Console clicks of the last 7 days fall 20% or more against the 7 days before (with at least 5 clicks)."
    );
    expect(describeAlertRule("POSITION_CHANGE", { thresholdPositions: -2.5 })).toContain("worse by 2.5 or more");
    expect(describeAlertRule("CRAWL_ISSUES", {})).toBe("Fires when the health score of the latest crawl is under 70.");
    expect(describeAlertRule("VITALS_DEGRADED", {})).toContain("LCP over 2.5 s");
    expect(describeAlertRule("NOINDEX_SITEWIDE", null)).toBe("Fires when most pages of the latest crawl are noindex.");
  });

  it("uses the defaults when a threshold is missing", () => {
    expect(describeAlertRule("TRAFFIC_DROP", {})).toContain("fall 20% or more");
    expect(describeAlertRule("POSITION_CHANGE", { thresholdPositions: "x" })).toContain("worse by 2 or more");
  });

  it("lists unknown settings in plain text, never raw JSON of the whole config", () => {
    expect(describeAlertRule("CRAWL_ISSUES", { minScore: 60, note: "x" })).toBe(
      "Fires when the health score of the latest crawl is under 70. Settings: minScore: 60, note: x."
    );
    expect(describeAlertRule("SOMETHING_NEW", { a: 1 })).toBe("Settings: a: 1.");
    expect(describeAlertRule("SOMETHING_NEW", {})).toBe("");
  });
});
