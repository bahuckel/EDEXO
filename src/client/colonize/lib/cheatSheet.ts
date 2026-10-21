/** Condensed from community colonization guides (e.g. CMDR Mechan mega guide) — verify in-game. */
export const inheritableBodyEconomies: { body: string; economies: string }[] = [
  { body: "Black holes, neutron stars, white dwarfs", economies: "HighTech, Tourism" },
  { body: "Brown dwarfs and other star types", economies: "Military" },
  { body: "Earth-like worlds", economies: "Agriculture, HighTech, Military, Tourism" },
  { body: "Water world", economies: "Agriculture, Tourism" },
  { body: "Ammonia world", economies: "HighTech, Tourism" },
  { body: "Gas giant", economies: "HighTech, Industrial" },
  { body: "High metal content / metal rich", economies: "Extraction" },
  { body: "Rocky ice", economies: "Industrial, Refinery" },
  { body: "Rocky", economies: "Refinery" },
  { body: "Icy", economies: "Industrial" },
];

export const bodyModifiers: { mod: string; bonus: string }[] = [
  { mod: "Rings (incl. stellar asteroid belts)", bonus: "Extraction" },
  { mod: "Organics", bonus: "Agriculture, Terraforming" },
  { mod: "Geologicals (DSS features; not volcanism)", bonus: "Extraction, Industrial" },
];

export const economyPickBodies: { economy: string; bodyHint: string }[] = [
  { economy: "Extraction", bodyHint: "HMC / metal-rich, rings, avoid organics & geologicals (for “pure” setup)" },
  { economy: "Refinery", bodyHint: "Rocky*, avoid rings, organics & geologicals" },
  { economy: "Industrial", bodyHint: "Icy, avoid rings, organics & geologicals" },
  { economy: "Military", bodyHint: "Main-sequence stars (& brown dwarfs) without asteroid belts" },
  { economy: "Agriculture", bodyHint: "Water world with organics; no rings / geologicals" },
  { economy: "Tourism", bodyHint: "Ammonia or water (clean), or exotic stars without belts" },
  { economy: "HighTech", bodyHint: "Ammonia (clean) or exotic stars without belts" },
  { economy: "Terraforming", bodyHint: "Water world with organics (clean)" },
];

export const strongWeakSummary = {
  strong:
    "Strong links connect supporting (non-port) facilities to ports within the same local body. Strength is typically much higher than weak links and can be modified by body traits (e.g. volcanism affecting certain economies) and system resource tier.",
  weak: "Weak links always add a small fixed economy presence (commonly cited as 0.05 per link) from supporting facilities to ports on other bodies. Weak links are not affected by strong-link-style modifiers.",
  portBridge:
    "When multiple ports share a body, strong links can chain between main/supporting ports — plan orbitals vs surface main ports deliberately.",
};

export const linksGuideUrl = "https://thefloweringash.com/elite/colonisation/";
