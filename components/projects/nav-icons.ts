import {
  Activity,
  FolderKanban,
  Layers,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/projects/nav-items";

/** Agency fork: the icon of each sidebar item (lib/projects/nav-items.ts), shown when the sidebar is collapsed. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  projects: FolderKanban,
  sources: Activity,
  groups: Layers,
  settings: Settings,
};
