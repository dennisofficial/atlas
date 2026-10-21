import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@dltech/atlas-ui/components/tabs";

import {
  ETerminalConnection,
  ETerminalEntry,
  INITIAL_TERMINALS,
  type CommandEntry,
  type UserTerminal,
} from "./sandbox-terminal";
import { TerminalScreen } from "./terminal-screen";
import { ConnectingNotice, ConnectionHeader, DisconnectedBar, PausedNotice } from "./terminal-states";

export interface TerminalTabProps {
  initialConnection?: ETerminalConnection;
  terminals?: UserTerminal[];
  noun?: string;
  disconnectedMessage?: string;
  onReconnect?: () => void;
}

function freshTerminal(index: number): UserTerminal {
  return { id: `term-${index}`, label: `Terminal ${index}`, cwd: "~/workspace", entries: [] };
}

function appendCommand({ terminal, command }: { terminal: UserTerminal; command: string }): UserTerminal {
  const entry: CommandEntry = { kind: ETerminalEntry.Command, cwd: terminal.cwd, command };
  return { ...terminal, entries: [...terminal.entries, entry] };
}

export function TerminalTab({
  initialConnection = ETerminalConnection.Connected,
  terminals: initialTerminals = INITIAL_TERMINALS,
  noun,
  disconnectedMessage,
  onReconnect,
}: TerminalTabProps) {
  const [connection, setConnection] = useState(initialConnection);
  const [terminals, setTerminals] = useState(initialTerminals);
  const [activeId, setActiveId] = useState(initialTerminals[0]?.id ?? "");
  const active = terminals.find((terminal) => terminal.id === activeId) ?? terminals[0];
  const showScreen =
    connection === ETerminalConnection.Connected || connection === ETerminalConnection.Disconnected;

  const handleTabChange = (value: unknown) => {
    if (typeof value === "string") setActiveId(value);
  };

  const handleNewTerminal = () => {
    const terminal = freshTerminal(terminals.length + 1);
    setTerminals([...terminals, terminal]);
    setActiveId(terminal.id);
  };

  const handleRun = (command: string) => {
    setTerminals((previous) =>
      previous.map((terminal) => (terminal.id === activeId ? appendCommand({ terminal, command }) : terminal)),
    );
  };

  const handleReconnect = () => {
    if (onReconnect) onReconnect();
    else setConnection(ETerminalConnection.Connected);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConnectionHeader connection={connection} noun={noun} />
      <Tabs value={active?.id ?? ""} onValueChange={handleTabChange} className="shrink-0 gap-0 border-b border-border">
        <div className="flex h-9 items-center gap-1 pr-2">
          <TabsList variant="line" className="h-9 min-w-0 flex-1 justify-start gap-3 overflow-x-auto px-3">
            {terminals.map((terminal) => (
              <TabsTrigger key={terminal.id} value={terminal.id} className="flex-none px-1 text-xs">
                {terminal.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button size="xs" variant="ghost" onClick={handleNewTerminal}>
            <PlusIcon data-icon="inline-start" />
            New terminal
          </Button>
        </div>
      </Tabs>
      {connection === ETerminalConnection.Connecting ? <ConnectingNotice noun={noun} /> : null}
      {connection === ETerminalConnection.Paused ? <PausedNotice onResume={handleReconnect} /> : null}
      {active && showScreen ? (
        <TerminalScreen terminal={active} live={connection === ETerminalConnection.Connected} onRun={handleRun} />
      ) : null}
      {connection === ETerminalConnection.Disconnected ? <DisconnectedBar onReconnect={handleReconnect} message={disconnectedMessage} /> : null}
    </div>
  );
}
