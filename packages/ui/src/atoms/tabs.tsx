"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva } from "class-variance-authority";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export type TabItem = {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number | string;
  disabled?: boolean;
};

export type TabsProps = {
  tabs: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  variant?: "underline" | "segmented";
  size?: "sm" | "md";
  style?: CSSProperties;
  className?: string;
};

const listVariants = cva("", {
  variants: {
    variant: {
      underline: "flex gap-1 border-b border-border",
      segmented:
        "inline-flex gap-1 rounded-md border border-border bg-muted p-1",
    },
  },
  defaultVariants: { variant: "underline" },
});

const triggerVariants = cva(
  "group inline-flex items-center gap-3 whitespace-nowrap border-transparent font-sans font-medium leading-none outline-none transition-[color,background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        underline:
          "-mb-px border-b-2 text-meta hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
        segmented:
          "rounded-sm border text-meta hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground",
      },
      size: {
        sm: "",
        md: "",
      },
    },
    compoundVariants: [
      { variant: "underline", size: "sm", class: "h-control-sm px-5 text-sm" },
      {
        variant: "underline",
        size: "md",
        class: "h-control-md px-5 text-base",
      },
      { variant: "segmented", size: "sm", class: "h-10 px-[9px] text-sm" },
      { variant: "segmented", size: "md", class: "h-12 px-[9px] text-sm" },
    ],
    defaultVariants: { variant: "underline", size: "md" },
  },
);

const countVariants = cva("font-mono text-2xs leading-none", {
  variants: {
    variant: {
      underline: "text-hint group-data-[state=active]:text-primary",
      segmented: "text-hint",
    },
  },
  defaultVariants: { variant: "underline" },
});

export function Tabs({
  tabs,
  value,
  onChange,
  variant = "underline",
  size = "md",
  style,
  className,
}: TabsProps) {
  const firstTab = tabs[0];
  return (
    <TabsPrimitive.Root
      className={className}
      style={style}
      {...(value !== undefined
        ? { value }
        : firstTab
          ? { defaultValue: firstTab.value }
          : {})}
      {...(onChange !== undefined ? { onValueChange: onChange } : {})}
    >
      <TabsPrimitive.List className={cn(listVariants({ variant }))}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className={cn(triggerVariants({ variant, size }))}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined ? (
              <span className={cn(countVariants({ variant }))}>
                {tab.count}
              </span>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
