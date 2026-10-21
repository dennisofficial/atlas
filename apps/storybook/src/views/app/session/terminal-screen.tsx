import { useEffect, useRef, useState, type FormEvent } from "react";

import { cn } from "@dltech/atlas-ui/lib/utils";

import { ETerminalEntry, SANDBOX, type TerminalEntry, type UserTerminal } from "./sandbox-terminal";

export interface TerminalScreenProps {
  terminal: UserTerminal;
  live: boolean;
  onRun?: (command: string) => void;
}

function Prompt({ cwd, host = SANDBOX.host }: { cwd: string; host?: string }) {
  return (
    <span className="select-none">
      <span className="text-success">
        {SANDBOX.user}@{host}
      </span>{" "}
      <span className="text-link">{cwd}</span>{" "}
      <span className="text-warning">({SANDBOX.branch})</span>{" "}
      <span className="text-muted-foreground">$</span>{" "}
    </span>
  );
}

function Entry({ entry, host }: { entry: TerminalEntry; host?: string }) {
  if (entry.kind === ETerminalEntry.Output) {
    return <div className="whitespace-pre-wrap text-foreground/80">{entry.text}</div>;
  }
  return (
    <div className="whitespace-pre-wrap">
      <Prompt cwd={entry.cwd} host={host} />
      <span className="text-foreground">{entry.command}</span>
    </div>
  );
}

function LivePrompt({ cwd, host, onRun }: { cwd: string; host?: string; onRun?: (command: string) => void }) {
  const [command, setCommand] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRun?.(command.trim());
    setCommand("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-baseline">
      <Prompt cwd={cwd} host={host} />
      <input
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        aria-label="Pod shell input"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-foreground caret-success outline-none"
      />
    </form>
  );
}

export function TerminalScreen({ terminal, live, onRun }: TerminalScreenProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [terminal.id, terminal.entries.length]);

  return (
    <div
      ref={ref}
      role="log"
      aria-label={`${terminal.label} scrollback`}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-3 py-2 font-mono text-xs leading-5",
        !live && "opacity-60",
      )}
    >
      {terminal.entries.map((entry, index) => (
        <Entry key={`${terminal.id}-${index}`} entry={entry} host={terminal.host} />
      ))}
      {live ? <LivePrompt cwd={terminal.cwd} host={terminal.host} onRun={onRun} /> : null}
    </div>
  );
}
