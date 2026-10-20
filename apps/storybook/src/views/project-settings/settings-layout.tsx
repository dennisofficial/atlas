import { useId, type ReactNode } from "react";

import { Card, CardFooter } from "@dltech/atlas-ui/components/card";
import { Label } from "@dltech/atlas-ui/components/label";
import { cn } from "@dltech/atlas-ui/lib/utils";

export enum ERowLayout {
  Inline = "inline",
  Stacked = "stacked",
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id={headingId} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsCard({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="divide-y">{children}</div>
      {footer ? <CardFooter className="justify-end gap-2 px-4 py-3">{footer}</CardFooter> : null}
    </Card>
  );
}

export function SettingsRow({
  title,
  description,
  htmlFor,
  layout = ERowLayout.Inline,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  layout?: ERowLayout;
  children?: ReactNode;
}) {
  const stacked = layout === ERowLayout.Stacked;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4",
        !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-8",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{title}</Label>
        ) : (
          <div className="flex items-center gap-2 text-sm leading-none font-medium">{title}</div>
        )}
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            !stacked && "shrink-0 sm:w-96 sm:justify-end",
            stacked && "flex-col items-stretch",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MonogramTile({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground uppercase ring-1 ring-foreground/10",
        className,
      )}
    >
      {label.slice(0, 1)}
    </span>
  );
}

export function FileChip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

export function UnsavedHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>;
}
