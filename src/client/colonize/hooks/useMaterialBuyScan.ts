import type { colonizeApi } from "../api";
import { useEffect, useRef, useState } from "react";
import type { MaterialBuyScanStatus } from "../../../shared/colonize/materialBuyScanStatus";
import { normalizeMaterialBuyScanStatus } from "../../../shared/colonize/materialBuyScanStatus";

export function useMaterialBuyScanStatus(api: typeof colonizeApi) {
  const [materialBuyScanStatus, setMaterialBuyScanStatus] = useState<MaterialBuyScanStatus | null>(null);
  const lastScanStatusJsonRef = useRef("");

  useEffect(() => {
    const applyStatus = (s: MaterialBuyScanStatus) => {
      const norm = normalizeMaterialBuyScanStatus(s);
      const json = JSON.stringify(norm);
      if (json === lastScanStatusJsonRef.current) return;
      lastScanStatusJsonRef.current = json;
      setMaterialBuyScanStatus(norm);
    };
    // A failed first ask is not an error to show: the push below keeps the status current (audit 2026-10-22).
    void api.getMaterialBuyScanStatus().then(applyStatus, () => {});
    return api.onMaterialBuyScanStatus(applyStatus);
  }, [api]);

  return materialBuyScanStatus;
}
