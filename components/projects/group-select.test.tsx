import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Agency fork: the group picker. Its behaviour (pick, new group, Enter and
// Escape) is the pure step in lib/projects/group-names.ts, tested here with
// what the component renders.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { GroupSelect, ProjectGroupPicker } = await import("./group-select");
const { GroupTitle } = await import("./group-actions");
const { GROUP_DRAFT_IDLE, groupOptions, resolveGroupName, stepGroupDraft } = await import("@/lib/projects/group-names");

const GROUPS = [
  { name: "Centro Adelante", count: 4 },
  { name: "Other", count: 1 },
];
const names = GROUPS.map((g) => g.name);

describe("stepGroupDraft", () => {
  const typing = (text: string) => stepGroupDraft(stepGroupDraft(GROUP_DRAFT_IDLE, { type: "new" }, names).draft, { type: "type", text }, names).draft;

  it("opens the new-group input empty", () => {
    expect(stepGroupDraft(GROUP_DRAFT_IDLE, { type: "new" }, names).draft).toEqual({ mode: "new", text: "", error: null });
  });

  it("Enter confirms a new name, tidied, and stops the key", () => {
    const r = stepGroupDraft(typing("  Brand   New "), { type: "key", key: "Enter" }, names);
    expect(r).toEqual({ draft: GROUP_DRAFT_IDLE, commit: "Brand New", handled: true });
  });

  it("a name that matches an existing group picks that group", () => {
    expect(stepGroupDraft(typing("centro  ADELANTE"), { type: "confirm" }, names).commit).toBe("Centro Adelante");
  });

  it("Escape cancels without a change; other keys type on", () => {
    expect(stepGroupDraft(typing("abc"), { type: "key", key: "Escape" }, names)).toEqual({ draft: GROUP_DRAFT_IDLE, handled: true });
    expect(stepGroupDraft(typing("abc"), { type: "key", key: "a" }, names)).toEqual({ draft: typing("abc") });
    expect(stepGroupDraft(GROUP_DRAFT_IDLE, { type: "key", key: "Enter" }, names)).toEqual({ draft: GROUP_DRAFT_IDLE });
  });

  it("an empty or too long name stays open with an error, cleared by typing", () => {
    const empty = stepGroupDraft(typing("   "), { type: "key", key: "Enter" }, names);
    expect(empty.commit).toBeUndefined();
    expect(empty.handled).toBe(true);
    expect(empty.draft).toMatchObject({ mode: "new", error: "Type a group name" });
    expect(stepGroupDraft(empty.draft, { type: "type", text: "a" }, names).draft.error).toBeNull();
    expect(stepGroupDraft(typing("x".repeat(81)), { type: "confirm" }, names).draft.error).toMatch(/at most 80/);
  });

  it("resolves names and keeps the current value among the options", () => {
    expect(resolveGroupName("other ", names)).toBe("Other");
    expect(resolveGroupName("  ", names)).toBeNull();
    expect(groupOptions("Legacy", GROUPS).map((g) => g.name)).toEqual(["Centro Adelante", "Legacy", "Other"]);
    expect(groupOptions("other", GROUPS)).toHaveLength(2);
  });
});

describe("GroupSelect", () => {
  it("shows the current group on a labelled menu button", () => {
    const html = renderToStaticMarkup(<GroupSelect value="Other" groups={GROUPS} onChange={() => {}} labelledBy="lbl" />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toMatch(/aria-labelledby="lbl [^"]+"/);
    expect(html).toContain(">Other<");
  });

  it("shows No group, muted, and can be disabled", () => {
    const html = renderToStaticMarkup(<GroupSelect value={null} groups={GROUPS} onChange={() => {}} disabled />);
    expect(html).toContain('aria-label="Group: No group"');
    expect(html).toContain("text-muted-foreground\">No group<");
    expect(html).toContain("disabled");
  });
});

describe("ProjectGroupPicker", () => {
  it("is the picker for an editor and plain text for a viewer", () => {
    const edit = renderToStaticMarkup(<ProjectGroupPicker slug="acme" value="Other" groups={GROUPS} canEdit />);
    expect(edit).toContain('aria-haspopup="menu"');
    expect(edit).toContain('aria-live="polite"');
    const view = renderToStaticMarkup(<ProjectGroupPicker slug="acme" value={null} groups={GROUPS} canEdit={false} />);
    expect(view).not.toContain("<button");
    expect(view).toContain("No group");
  });
});

describe("GroupTitle", () => {
  it("has the actions menu only for someone who can edit a project of the group", () => {
    const menu = renderToStaticMarkup(<GroupTitle name="Centro Adelante" count={4} shown={3} editable={2} variant="menu" />);
    expect(menu).toContain('aria-label="Actions for group Centro Adelante"');
    expect(menu).toMatch(/<h2[^>]*>.*Centro Adelante.*>3</);
    const none = renderToStaticMarkup(<GroupTitle name="Centro Adelante" count={4} editable={0} variant="menu" />);
    expect(none).not.toContain("<button");
    const buttons = renderToStaticMarkup(<GroupTitle name="Other" count={1} editable={1} variant="buttons" level={3} />);
    expect(buttons).toContain('aria-label="Rename Other"');
    expect(buttons).toContain('aria-label="Ungroup Other"');
    expect(buttons).toContain("<h3");
  });
});
