import type { DepotSnapshot, OwnColony } from "./types";

/** The colony a site is in, when it is one of the commander's (by system address, else by name). */
export function colonyOf(d: Pick<DepotSnapshot, "starSystem" | "systemAddress">, colonies: OwnColony[]): OwnColony | null {
  const name = d.starSystem?.trim().toLowerCase() ?? "";
  return (
    colonies.find((c) => (d.systemAddress != null && c.systemAddress === d.systemAddress) || (name && c.name.toLowerCase() === name)) ??
    null
  );
}
