import { createContext } from "react";
import type { UiAction, UiState } from "./uiState";

export const UiStateContext = createContext<UiState | null>(null);
export const UiDispatchContext = createContext<((action: UiAction) => void) | null>(null);
