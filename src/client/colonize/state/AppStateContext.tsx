import { useEffect, useReducer, type ReactNode } from "react";
import { UiDispatchContext, UiStateContext } from "./contexts";
import { STORAGE_KEYS, removeRaw, writeJson, writeRaw } from "./persisted";
import { initialUiState, uiReducer, type UiState } from "./uiState";

/**
 * Persistence lives here rather than at each call site.
 *
 * The old app wrote to storage from wherever a value happened to change, and any path that
 * forgot simply lost the change. One effect per slice means a value is saved because it
 * changed, not because someone remembered to save it.
 */
function usePersistUiState(state: UiState): void {
  useEffect(() => {
    writeJson(STORAGE_KEYS.checkoutFilters, state.checkoutFilters);
  }, [state.checkoutFilters]);

  useEffect(() => {
    writeRaw(STORAGE_KEYS.checkoutRouting, state.routingMode);
  }, [state.routingMode]);

  useEffect(() => {
    if (Object.keys(state.depotRefPins).length) writeJson(STORAGE_KEYS.depotRefPins, state.depotRefPins);
    else removeRaw(STORAGE_KEYS.depotRefPins);
  }, [state.depotRefPins]);

  useEffect(() => {
    if (Object.keys(state.carrierHaul).length) writeJson(STORAGE_KEYS.carrierHaul, state.carrierHaul);
    else removeRaw(STORAGE_KEYS.carrierHaul);
  }, [state.carrierHaul]);

  useEffect(() => {
    if (Object.keys(state.projects).length) writeJson(STORAGE_KEYS.projects, state.projects);
    else removeRaw(STORAGE_KEYS.projects);
  }, [state.projects]);

  useEffect(() => {
    if (state.hudFollow) writeRaw(STORAGE_KEYS.hudFollow, state.hudFollow);
    else removeRaw(STORAGE_KEYS.hudFollow);
  }, [state.hudFollow]);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, undefined, initialUiState);
  usePersistUiState(state);

  return (
    <UiStateContext.Provider value={state}>
      <UiDispatchContext.Provider value={dispatch}>{children}</UiDispatchContext.Provider>
    </UiStateContext.Provider>
  );
}
