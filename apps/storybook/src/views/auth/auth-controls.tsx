import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@dltech/atlas-ui/components/alert";
import { Button } from "@dltech/atlas-ui/components/button";
import { Separator } from "@dltech/atlas-ui/components/separator";
import { Spinner } from "@dltech/atlas-ui/components/spinner";
import { cn } from "@dltech/atlas-ui/lib/utils";

import { GoogleLogo } from "./google-logo";

export const CONTROL_CLASS = "h-10";

export function AuthLink({
  onPress,
  className,
  children,
}: {
  onPress?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const handleClick = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onPress?.();
  };
  return (
    <a
      href="#"
      onClick={handleClick}
      className={cn(
        "rounded-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
    </a>
  );
}

export function GoogleButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(CONTROL_CLASS, "w-full gap-2")}
      disabled={disabled}
      onClick={onPress}
    >
      {busy ? <Spinner /> : <GoogleLogo className="size-4" />}
      {label}
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
      <Separator className="flex-1" />
      or
      <Separator className="flex-1" />
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      className={cn(CONTROL_CLASS, "w-full")}
      disabled={busy || disabled}
    >
      {busy && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}

export function AuthFooterText({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-muted-foreground">{children}</p>;
}
