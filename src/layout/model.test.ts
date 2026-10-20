import { describe, expect, it } from "vitest";
import {
  defaultPanelLayout,
  movePanelInLayout,
  normalizePanelLayout,
  PANEL_IDS,
  readPanelLayout,
  togglePanelInLayout,
  visiblePanelIds,
} from "./model";

describe("workspace layout persistence", () => {
  it("recovers from corrupt JSON and unavailable storage", () => {
    expect(readPanelLayout({ getItem: () => "{broken" })).toEqual(defaultPanelLayout());
    expect(readPanelLayout({ getItem: () => { throw new Error("blocked"); } })).toEqual(defaultPanelLayout());
    expect(normalizePanelLayout({ version: 9, order: PANEL_IDS, hidden: [] })).toEqual(defaultPanelLayout());
  });

  it("repairs duplicate, removed and newly added panel ids without losing the chosen order", () => {
    const repaired = normalizePanelLayout({ version: 1, order: ["diff", "obsolete", "diff", "changes"], hidden: ["stash", "obsolete", "stash"] });
    expect(repaired.order.slice(0, 2)).toEqual(["diff", "changes"]);
    expect(new Set(repaired.order)).toEqual(new Set(PANEL_IDS));
    expect(repaired.order).toHaveLength(PANEL_IDS.length);
    expect(repaired.hidden).toEqual(["stash"]);
  });

  it("always keeps a visible panel, including when restoring a damaged layout", () => {
    const restored = normalizePanelLayout({ version: 1, order: PANEL_IDS, hidden: PANEL_IDS });
    expect(visiblePanelIds(restored).length).toBeGreaterThan(0);
    let layout = defaultPanelLayout();
    for (const id of PANEL_IDS) layout = togglePanelInLayout(layout, id);
    expect(visiblePanelIds(layout).length).toBeGreaterThan(0);
    const onlyChanges = { ...defaultPanelLayout(), hidden: PANEL_IDS.filter((id) => id !== "changes") };
    expect(togglePanelInLayout(onlyChanges, "changes")).toBe(onlyChanges);
  });
});

describe("panel movement", () => {
  it("keeps hidden modules and all visible modules across repeated moves", () => {
    let layout = defaultPanelLayout();
    const originalOrder = [...layout.order];
    const moves = [["changes", "diff"], ["branches", "stash"], ["diff", "commits"], ["changes", "branches"]] as const;
    for (const [from, to] of moves) {
      layout = movePanelInLayout(layout, from, to);
      expect(new Set(layout.order)).toEqual(new Set(originalOrder));
      expect(layout.order).toHaveLength(originalOrder.length);
      expect(layout.hidden).toEqual(["activity"]);
    }
    expect(layout.order).not.toEqual(originalOrder);
  });

  it("does not move an invisible module or mutate the caller's layout", () => {
    const layout = defaultPanelLayout();
    const before = JSON.stringify(layout);
    expect(movePanelInLayout(layout, "activity", "changes")).toBe(layout);
    const moved = movePanelInLayout(layout, "changes", "diff");
    expect(moved.order.slice(0, 2)).toEqual(["diff", "changes"]);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
