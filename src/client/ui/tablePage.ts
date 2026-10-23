/**
 * How many rows a table draws as one page. A module of its own (audit 2026-10-22) so the first-discovery
 * backlog can read the number without loading the table, or the discoveries tabs, with it.
 */

/** Rows rendered at once. Enough to scroll through, far short of what would stall the panel. */
export const PAGE = 300;
