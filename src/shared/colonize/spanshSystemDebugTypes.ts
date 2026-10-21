/** Raw Spansh HTTP capture — no normalization or localization. */

export type SpanshRawHttpCapture = {

  url: string;

  method: string;

  status: number;

  ok: boolean;

  durationMs: number;

  body: unknown;

  error?: string;

};



/** Buy/sell row extracted from Spansh dump (or station API). */

export type SpanshDebugCommodityHit = {

  stationName: string;

  commodity: string;

  /** FDev symbol slug (e.g. HazardousEnvironmentSuits). */

  symbol?: string;

  supply?: number;

  buyPrice?: number;

  sellPrice?: number;

  demand?: number;

};



export type SpanshSystemDebugResult =

  | {

      ok: true;

      requestedSystem: string;

      resolvedSystem: string;

      systemId64: string;

      fetchedAtIso: string;

      stationMarketFetches: number;

      stationsWithMarkets: number;

      captures: SpanshRawHttpCapture[];

      commoditySummary: SpanshDebugCommodityHit[];

    }

  | {

      ok: false;

      err: string;

      requestedSystem: string;

      resolvedSystem?: string;

      systemId64?: string;

      fetchedAtIso: string;

      stationMarketFetches?: number;

      stationsWithMarkets?: number;

      captures: SpanshRawHttpCapture[];

      commoditySummary?: SpanshDebugCommodityHit[];

    };



/** Lightweight payload returned to the renderer (full JSON lives on disk). */

export type SpanshSystemDebugClientResult = SpanshSystemDebugResult & {

  previewJson: string;

  fullJsonBytes: number;

  tempJsonPath: string | null;

  /** Rows merged into local material-buy-index.json after a successful fetch. */
  buyIndexRowsSaved?: number;

};


