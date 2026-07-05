import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_STREAM_FILTERS,
  loadStreamFilters,
  loadStreamPresets,
  saveStreamFilters,
  saveStreamPresets,
  type StreamFilterPreset,
  type StreamFilterState,
} from "./streamFilters";

export function useStreamFilterState() {
  const [filters, setFilters] = useState<StreamFilterState>(() => loadStreamFilters());
  const [presets, setPresets] = useState<StreamFilterPreset[]>(() => loadStreamPresets());

  useEffect(() => {
    saveStreamFilters(filters);
  }, [filters]);

  const updateFilters = useCallback((patch: Partial<StreamFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const savePreset = useCallback(
    (name: string) => {
      setPresets((prev) => {
        const next = [...prev.filter((p) => p.name !== name), { name, filters }];
        saveStreamPresets(next);
        return next;
      });
    },
    [filters]
  );

  const applyPreset = useCallback(
    (name: string) => {
      const preset = presets.find((p) => p.name === name);
      if (!preset) return;
      setFilters((prev) => ({
        ...DEFAULT_STREAM_FILTERS,
        ...preset.filters,
        searchText: prev.searchText,
      }));
    },
    [presets]
  );

  const deletePreset = useCallback((name: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.name !== name);
      saveStreamPresets(next);
      return next;
    });
  }, []);

  return { filters, updateFilters, presets, savePreset, applyPreset, deletePreset };
}
