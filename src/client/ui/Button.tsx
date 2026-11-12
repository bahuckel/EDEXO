/**
 * The app's buttons (review 2026-11-07 §9, plan 7.5 round 6): four looks and two sizes instead of 41 selectors, five
 * heights and four "primary" looks. primary = the one action of a panel (filled), secondary = every other action
 * (outline), ghost = a quiet action (text only), danger = destroys something. sm 28 px, md 34 px.
 *
 * Toggles and chips that show a selection are not buttons in this sense (ui-system.css rule 1: selected = outline +
 * faint fill); they keep their own classes.
 */
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

/** The classes for a button look, for an element that is not a <button> (a link) or keeps an older class beside it. */
export function uiBtn(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `ui-btn ui-btn--${variant} ui-btn--${size}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${uiBtn(variant, size)}${className ? ` ${className}` : ""}`} {...rest} />;
}
