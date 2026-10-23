/**
 * The legal footer under every app page: Compare, Colonize (PC and phone) and their loading screens.
 *
 * Its own module, not App.tsx (audit 2026-10-22): Colonize imported it from App, and that one import made the
 * Colonize window fetch, parse and run Compare's whole App chunk (BodyPane, SpeciesCard and the rest) for a footer.
 */
import { memo } from "react";
import { STREAMER_MODE } from "./streamerMode";

/** Memo: static, and the app shell re-renders on every push. */
export const AppLegalFooter = memo(function AppLegalFooter() {
  /*
    The privacy policy and terms ship with the app (public/legal/) and are served by its own server
    (owner, 2026-09-29): they were on edexo.bahuckel.com, served from this PC, and went dead (530) with
    it. Same-origin links work offline, over the LAN and on a phone, and always match this version.
  */
  return (
    <>
      {/* Takes the window's leftover height, so the footer sits at the bottom of a short page (owner, 2026-10-22). */}
      <div className="app-legal-footer-spacer" aria-hidden="true" />
      <footer className="app-legal-footer">
      <p className="app-legal-footer-note dim">
        EDEXO is owned and operated by Bahuckel™. Independent fan software using local Elite
        Dangerous journal data — not affiliated with Frontier Developments. <em>Elite Dangerous</em> and
        related marks belong to Frontier; all rights reserved by their owners.
      </p>
      <div className="app-legal-footer-links">
        <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer">
          Terms of Service
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        {/*
          The project's page on the owner's site.
        */}
        <a href="https://bahuckel.com/projects/edexo-compare" target="_blank" rel="noopener noreferrer">
          bahuckel.com/projects/edexo-compare
        </a>
        {/* The owner's Ko-fi (2026-10-21): last, and never in the streamer view, which asks nothing of a stream. */}
        {STREAMER_MODE ? null : (
          <>
            <span className="app-legal-footer-sep dim">·</span>
            <a className="app-legal-footer-coffee" href="https://ko-fi.com/bahuckel" target="_blank" rel="noopener noreferrer">
              Buy me a coffee
            </a>
          </>
        )}
      </div>
      </footer>
    </>
  );
});
