import { useEffect, useReducer, type ReactNode } from "react";
import { UiDispatchContext, UiStateContext } from "./contexts";
import { STORAGE_KEYS, removeRaw, writeJson, writeRaw } from "./persisted";
import { initialUiState, uiReducer, type UiState } from "./uiState";

/**
 * Persistence lives here rather than at each call site.
 *
 * The previous arrangement wrote to storage from wherever a value happened to change, so
 * the basket was saved in five places and the shopping run in five more, and any path
 * that forgot simply lost the change. One effect per slice means a value is saved because
 * it changed, not because someone remembered to save it.
 */
function usePersistUiState(state: UiState): void {
  useEffect(() => {
    writeRaw(STORAGE_KEYS.appMode, state.appMode);
  }, [state.appMode]);

  useEffect(() => {
    if (state.basket.length) writeJson(STORAGE_KEYS.basket, state.basket);
    else removeRaw(STORAGE_KEYS.basket);
  }, [state.basket]);

  useEffect(() => {
    if (state.autoBasketSync) writeRaw(STORAGE_KEYS.autoBasketSync, "1");
    else removeRaw(STORAGE_KEYS.autoBasketSync);
  }, [state.autoBasketSync]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.checkoutFilters, state.checkoutFilters);
  }, [state.checkoutFilters]);

  useEffect(() => {
    writeRaw(STORAGE_KEYS.checkoutRouting, state.routingMode);
  }, [state.routingMode]);

  useEffect(() => {
    if (state.shoppingRun) writeJson(STORAGE_KEYS.shoppingRun, state.shoppingRun);
    else removeRaw(STORAGE_KEYS.shoppingRun);
  }, [state.shoppingRun]);

  useEffect(() => {
    if (Object.keys(state.depotRefPins).length) writeJson(STORAGE_KEYS.depotRefPins, state.depotRefPins);
    else removeRaw(STORAGE_KEYS.depotRefPins);
  }, [state.depotRefPins]);

  useEffect(() => {
    if (Object.keys(state.carrierHaul).length) writeJson(STORAGE_KEYS.carrierHaul, state.carrierHaul);
    else removeRaw(STORAGE_KEYS.carrierHaul);
  }, [state.carrierHaul]);
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
