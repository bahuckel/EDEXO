/**
 * A notice's icon, by kind, for the app's mail list and the HUD's Notices (owner, 2026-10-28: lucide's icons, no
 * emoji anywhere). One map for both, so a kind looks the same in each.
 */
import { Anchor, Diamond, Flag, FlaskConical, MapPin, Medal, Sparkle, Star, Trophy, type LucideIcon } from "lucide-react";
import type { NoticeKind } from "@shared/notices";

const ICON: Record<NoticeKind, LucideIcon> = {
  notable: Star,
  record: Medal,
  nsp: Sparkle,
  poi: MapPin,
  carrier: Anchor,
  codex: Diamond,
  achievement: Trophy,
  jumponium: FlaskConical,
  cg: Flag,
};

export function NoticeIcon({ kind, className }: { kind: string; className?: string }) {
  const I = ICON[kind as NoticeKind] ?? Star;
  return <I className={className ?? "notice__ico"} aria-hidden="true" />;
}
