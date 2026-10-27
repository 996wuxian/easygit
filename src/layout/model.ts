import { appStorage } from '../services/storage';

export const PANEL_IDS = ["changes", "diff", "branches", "commits", "stash", "activity", "scripts", "files"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelLayout {
  version: 1;
  order: PanelId[];
  hidden: PanelId[];
}

export const PANEL_LAYOUT_STORAGE_KEY = "esaygit.workspace-layout.v1";

export function defaultPanelLayout(): PanelLayout {
  return { version: 1, order: [...PANEL_IDS], hidden: ["activity"] };
}

function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && PANEL_IDS.includes(value as PanelId);
}

export function normalizePanelLayout(value: unknown): PanelLayout {
  if (!value || typeof value !== "object") return defaultPanelLayout();
  const input = value as Partial<PanelLayout>;
  if (input.version !== 1 || !Array.isArray(input.order) || !Array.isArray(input.hidden)) {
    return defaultPanelLayout();
  }
  const order = [...new Set(input.order.filter(isPanelId))];
  for (const id of PANEL_IDS) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set(input.hidden.filter(isPanelId))];
  // A valid saved layout must always leave an accessible workspace.
  return { version: 1, order, hidden: hidden.length === PANEL_IDS.length ? [] : hidden };
}

export function readPanelLayout(storage?: Pick<Storage, "getItem">): PanelLayout {
  try {
    const source = storage ?? (typeof window !== "undefined" ? appStorage : undefined);
    const raw = source?.getItem(PANEL_LAYOUT_STORAGE_KEY);
    return raw ? normalizePanelLayout(JSON.parse(raw)) : defaultPanelLayout();
  } catch {
    return defaultPanelLayout();
  }
}

export function visiblePanelIds(layout: PanelLayout): PanelId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

export function movePanelInLayout(layout: PanelLayout, active: PanelId, target: PanelId): PanelLayout {
  if (active === target || !layout.order.includes(active) || !layout.order.includes(target)) return layout;
  if (layout.hidden.includes(active) || layout.hidden.includes(target)) return layout;
  const order = [...layout.order];
  const from = order.indexOf(active);
  const to = order.indexOf(target);
  // Swapping slots makes a drop deterministic, including rows with unequal widths.
  [order[from], order[to]] = [order[to], order[from]];
  return { ...layout, order };
}

export function togglePanelInLayout(layout: PanelLayout, id: PanelId): PanelLayout {
  if (!PANEL_IDS.includes(id)) return layout;
  if (layout.hidden.includes(id)) return { ...layout, hidden: layout.hidden.filter((item) => item !== id) };
  if (visiblePanelIds(layout).length <= 1) return layout;
  return { ...layout, hidden: [...layout.hidden, id] };
}

/** Width belongs to the dashboard slot, so any module can occupy any position. */
export function panelSlotSpan(index: number, count: number): number {
  if (count === 1) return 12;
  if (index < 2) return index === 0 ? 4 : 8;
  const remaining = count - 2;
  if (remaining === 1) return 12;
  if (remaining === 2) return 6;
  return [4, 5, 3, 12][index - 2] ?? 12;
}
