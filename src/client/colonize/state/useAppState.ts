import { useContext } from "react";
import { UiDispatchContext, UiStateContext } from "./contexts";
import type { UiAction, UiState } from "./uiState";

export function useUiState(): UiState {
  const state = useContext(UiStateContext);
  if (!state) throw new Error("useUiState must be used inside AppStateProvider");
  return state;
}

export function useUiDispatch(): (action: UiAction) => void {
  const dispatch = useContext(UiDispatchContext);
  if (!dispatch) throw new Error("useUiDispatch must be used inside AppStateProvider");
  return dispatch;
}
