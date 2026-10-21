import { colonizeApi } from "../api";
import { useEffect, useRef, useState } from "react";
import type { MaterialBuyScanStatus } from "../../../shared/colonize/materialBuyScanStatus";
import { normalizeMaterialBuyScanStatus } from "../../../shared/colonize/materialBuyScanStatus";

export function useMaterialBuyScanStatus(api: typeof colonizeApi) {
  const [materialBuyScanStatus, setMaterialBuyScanStatus] = useState<MaterialBuyScanStatus | null>(null);
  const lastScanStatusJsonRef = useRef("");

  useEffect(() => {
    if (!api?.getMaterialBuyScanStatus || !api.onMaterialBuyScanStatus) return;
    const applyStatus = (s: MaterialBuyScanStatus) => {
      const norm = normalizeMaterialBuyScanStatus(s);
      const json = JSON.stringify(norm);
      if (json === lastScanStatusJsonRef.current) return;
      lastScanStatusJsonRef.current = json;
      setMaterialBuyScanStatus(norm);
    };
    void api.getMaterialBuyScanStatus().then(applyStatus);
    return api.onMaterialBuyScanStatus(applyStatus);
  }, [api]);

  return materialBuyScanStatus;
}
