/**
 * Supply / colony advisor shared types (kept separate so `colonyAdvisorEngine` ↔ `recommendationEngine`
 * avoid circular runtime imports).
 */
export type SupplyMarketRow = {
  name: string;
  nameLocalised: string;
  stock: number | null;
  demandBracket: string | null;
  demand: number | null;
  /** Credits/ton station pays you (demand side). */
  buyPrice?: number | null;
  /** Credits/ton you pay station (stock for sale). */
  sellPrice?: number | null;
};

export type ColonyAdvisorBreakdown = {
  demandWeight: number;
  economyAffinity: number;
  infrastructurePriority: number;
  colonyGrowthImportance: number;
  /** Glamour/luxury drag — penalizes profitable but low-purpose cargo */
  purposefulness: number;
  shortageSeverity: number;
  finalScore: number;
};

export type SupplyRecommendation = {
  score: number;
  label: string;
  tradeCategory: string;
  sources: ("construction_need" | "market_shortage" | "market_prosperity")[];
  rationale: string;
  gapTonnes?: number | null;
  /** Best pad to sell into when merged from multiple stations */
  unloadAtStation?: string;
  /** Stations in this system that carry the commodity line */
  systemStationCount?: number;
  /** Sum of dock buy orders captured for this SKU (Spansh aggregate) */
  aggregatedDemandTonnes?: number | null;
  advisory?: ColonyAdvisorBreakdown;
};
