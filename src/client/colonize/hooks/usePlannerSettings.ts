import { loadPlannerSettings, savePlannerSettings, type PlannerSettings } from "../../../shared/colonize/plannerSettings";
import { useCallback, useState } from "react";

export function usePlannerSettings() {
  const [plannerSettings, setPlannerSettings] = useState<PlannerSettings>(() => loadPlannerSettings());

  const updatePlannerSettings = useCallback((next: PlannerSettings) => {
    setPlannerSettings(next);
    savePlannerSettings(next);
  }, []);

  return { plannerSettings, setPlannerSettings: updatePlannerSettings };
}
