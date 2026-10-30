/**
 * The tag of a system known only from a route plotted in the game (plan 1.3.3 R-2, owner 2026-10-30: 'with a tag
 * "plotted in-game but not visited, no information from EDSM" or something like that'). Visited: no tag, the
 * commander's own records speak for it.
 */
export function plottedTag(p: { visited: boolean; edsm: boolean | undefined | null }): string | null {
  if (p.visited) return null;
  const edsm = p.edsm === false ? "not on EDSM" : p.edsm === true ? "on EDSM" : "EDSM not asked";
  return `Plotted in-game, not visited · ${edsm}`;
}
