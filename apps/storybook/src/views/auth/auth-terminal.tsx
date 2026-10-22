import { AUTH_DEVICE_CODE, AUTH_LOGIN_COMMAND } from "../../fixtures/auth";

export function AuthTerminal({ code = AUTH_DEVICE_CODE }: { code?: string }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border bg-background font-mono text-sm shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-2 text-xs text-muted-foreground">~/code/atlas</span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-4 leading-relaxed">
        <p className="text-foreground">
          <span className="text-primary">$</span> {AUTH_LOGIN_COMMAND}
        </p>
        <p className="text-muted-foreground">Open byatlas.io/device and enter:</p>
        <p className="text-xl font-medium tracking-[0.12em] text-foreground">{code}</p>
        <p className="text-muted-foreground">Waiting for approval…</p>
      </div>
    </div>
  );
}
