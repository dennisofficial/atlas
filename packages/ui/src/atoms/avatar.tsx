import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

const avatarVariants = cva(
  "flex items-center justify-center overflow-hidden rounded-sm border border-border font-mono font-medium leading-none select-none",
  {
    variants: {
      kind: {
        user: "bg-selected text-foreground",
        agent: "bg-band-agent text-band-agent-foreground",
        subagent:
          "bg-[color-mix(in_oklab,var(--external)_22%,var(--card))] text-external",
        service:
          "bg-[color-mix(in_oklab,var(--steel)_22%,var(--card))] text-steel",
      },
      size: {
        xs: "size-8 text-[7px]",
        sm: "size-10 text-[8px]",
        md: "size-12 text-2xs",
        lg: "size-16 text-base",
      },
    },
    defaultVariants: {
      kind: "user",
      size: "md",
    },
  },
);

type AvatarStatus = "running" | "awaiting" | "failed" | "idle";

const STATUS_COLORS: Record<AvatarStatus, string> = {
  running: "bg-primary",
  awaiting: "bg-warning",
  failed: "bg-destructive",
  idle: "bg-success",
};

function initials(name?: string): string {
  return (name ?? "?")
    .split(/[\s._/-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLowerCase();
}

export type AvatarProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof avatarVariants> & {
    name?: string;
    src?: string;
    glyph?: ReactNode;
    status?: AvatarStatus;
  };

export function Avatar({
  name,
  kind,
  size,
  src,
  glyph,
  status,
  className,
  ...props
}: AvatarProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} {...props}>
      <AvatarPrimitive.Root title={name} className={avatarVariants({ kind, size })}>
        {src ? (
          <AvatarPrimitive.Image
            src={src}
            alt={name ?? ""}
            className="size-full object-cover"
          />
        ) : null}
        <AvatarPrimitive.Fallback>{glyph ?? initials(name)}</AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {status ? (
        <span
          aria-label={status}
          className={cn(
            "absolute -bottom-1 -right-1 size-[7px] rounded-full border-[1.5px] border-background",
            STATUS_COLORS[status],
          )}
        />
      ) : null}
    </span>
  );
}
