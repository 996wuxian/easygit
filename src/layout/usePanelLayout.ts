import { useCallback, useEffect, useMemo, useState } from "react";
import { appStorage } from '../services/storage';
import {
  defaultPanelLayout,
  clampPanelSize,
  movePanelInLayout,
  PANEL_LAYOUT_STORAGE_KEY,
  readPanelLayout,
  togglePanelInLayout,
  visiblePanelIds,
  type PanelId,
  type PanelSize,
} from "./model";

export function usePanelLayout() {
  const [layout, setLayout] = useState(readPanelLayout);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      appStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [layout]);

  const visiblePanels = useMemo(() => visiblePanelIds(layout), [layout]);
  const togglePanel = useCallback((id: PanelId) => setLayout((current) => togglePanelInLayout(current, id)), []);
  const showPanel = useCallback((id: PanelId) => setLayout(current => current.hidden.includes(id)
    ? { ...current, hidden: current.hidden.filter(panel => panel !== id) }
    : current), []);
  const movePanel = useCallback((active: PanelId, target: PanelId) => {
    setLayout((current) => movePanelInLayout(current, active, target));
  }, []);
  const resetLayout = useCallback(() => setLayout(defaultPanelLayout()), []);
  const resizePanel = useCallback((id: PanelId, size: PanelSize | null) => {
    setLayout(current => {
      const sizes = { ...current.sizes };
      if (size) sizes[id] = clampPanelSize(size);
      else delete sizes[id];
      return { ...current, sizes };
    });
  }, []);

  return { layout, visiblePanels, storageError, togglePanel, showPanel, movePanel, resizePanel, resetLayout };
}
