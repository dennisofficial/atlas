import { icons, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "../lib/cn";

export type IconProps = {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
};

const iconsByName = new Map<string, LucideIcon>(Object.entries(icons));

function toPascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function Icon({
  name,
  size = 14,
  color,
  strokeWidth = 2,
  title,
  className,
  style,
}: IconProps) {
  const LucideGlyph = iconsByName.get(toPascalCase(name));
  if (!LucideGlyph) return null;
  return (
    <LucideGlyph
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={cn("block shrink-0", className)}
      style={style}
      {...(title
        ? { role: "img", "aria-label": title }
        : { role: "presentation", "aria-hidden": true })}
    />
  );
}
