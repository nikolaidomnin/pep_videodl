import { useSyncExternalStore } from "react";

/**
 * Текущая (анимированная) высота панели. Меняется каждый кадр, пока панель растёт,
 * поэтому живёт вне состояния React: перерисовываются только украшения, а не всё приложение.
 */
let height = 0;
const listeners = new Set<() => void>();

export const panelHeight = {
  get: () => height,
  set(h: number) {
    if (h === height) return;
    height = h;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePanelHeight() {
  return useSyncExternalStore(panelHeight.subscribe, panelHeight.get);
}
