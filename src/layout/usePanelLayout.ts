import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultPanelLayout,
  movePanelInLayout,
  PANEL_LAYOUT_STORAGE_KEY,
  readPanelLayout,
  togglePanelInLayout,
  visiblePanelIds,
  type PanelId,
} from "./model";

export function usePanelLayout() {
  const [layout, setLayout] = useState(readPanelLayout);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [layout]);

  const visiblePanels = useMemo(() => visiblePanelIds(layout), [layout]);
  const togglePanel = useCallback((id: PanelId) => setLayout((current) => togglePanelInLayout(current, id)), []);
  const movePanel = useCallback((active: PanelId, target: PanelId) => {
    setLayout((current) => movePanelInLayout(current, active, target));
  }, []);
  const resetLayout = useCallback(() => setLayout(defaultPanelLayout()), []);

  return { layout, visiblePanels, storageError, togglePanel, movePanel, resetLayout };
}
