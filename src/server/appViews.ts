/**
 * What `/api/ui/open-external` may open in the browser: this app's own pages, never a URL, each with the
 * path the server opens on its own port. One table (audit 2026-10-22): the type, the route's allowlist and
 * the bootstrap's URLs were three lists that had to agree.
 */
export const APP_VIEW_PATHS = {
  app: "/",
  phone: "/?screen=triage",
  stream: "/?view=stream",
  colonize: "/?screen=colonize",
  "colonize-phone": "/?screen=colonize&phone=1",
  "colonize-stream": "/?screen=colonize&view=stream",
} as const;

export type AppView = keyof typeof APP_VIEW_PATHS;

export const APP_VIEWS = Object.keys(APP_VIEW_PATHS) as AppView[];

/** Own keys only: `"toString" in APP_VIEW_PATHS` is true. */
export const isAppView = (v: unknown): v is AppView => (APP_VIEWS as readonly unknown[]).includes(v);

/** The address of a view on this PC; an unknown one opens the app, as the old chain of ternaries did. */
export const appViewUrl = (port: number, view: AppView): string =>
  `http://127.0.0.1:${port}${APP_VIEW_PATHS[view] ?? "/"}`;
