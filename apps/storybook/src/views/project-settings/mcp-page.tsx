import { useState } from "react";
import { ArrowUpRightIcon, EllipsisIcon, GlobeIcon, PlugIcon, TerminalIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dltech/atlas-ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";
import { Switch } from "@dltech/atlas-ui/components/switch";
import { cn } from "@dltech/atlas-ui/lib/utils";

import {
  EMcpTransport,
  MCP_SERVERS,
  type McpServer,
} from "../../fixtures/project-settings";
import { AddMcpServerDialog, type McpServerDraft } from "./mcp-add-dialog";
import { SettingsCard, SettingsSection } from "./settings-layout";

function ServerRow({
  server,
  onToggle,
  onRemove,
}: {
  server: McpServer;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const TransportIcon = server.transport === EMcpTransport.Stdio ? TerminalIcon : GlobeIcon;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", !server.enabled && "opacity-60")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <TransportIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{server.id}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
            Not checked
          </span>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{server.target}</span>
      </div>
      <Switch
        aria-label={`Enable ${server.id}`}
        checked={server.enabled}
        onCheckedChange={onToggle}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${server.id}`} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ServersEmpty() {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugIcon />
        </EmptyMedia>
        <EmptyTitle>No project MCP servers</EmptyTitle>
        <EmptyDescription>
          Threads still get your personal and workspace servers. Add one here to share it with everyone on this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function McpPage({
  initialServers = MCP_SERVERS,
  addDialogOpen = false,
}: {
  initialServers?: readonly McpServer[];
  addDialogOpen?: boolean;
}) {
  const [servers, setServers] = useState<readonly McpServer[]>(initialServers);

  const handleAdd = (draft: McpServerDraft) =>
    setServers((current) => [
      ...current.filter((server) => server.id !== draft.id),
      { ...draft, enabled: true },
    ]);
  const handleToggle = ({ id, enabled }: { id: string; enabled: boolean }) =>
    setServers((current) => current.map((server) => (server.id === id ? { ...server, enabled } : server)));
  const handleRemove = (id: string) => setServers((current) => current.filter((server) => server.id !== id));

  return (
    <>
      <SettingsSection
        title="MCP"
        description="Workspace servers apply first, a member's personal servers override them, and project servers override both."
        actions={
          <>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Personal MCP settings
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
            <AddMcpServerDialog defaultOpen={addDialogOpen} onAdd={handleAdd} />
          </>
        }
      >
        <SettingsCard>
          {servers.length === 0 ? (
            <ServersEmpty />
          ) : (
            servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                onToggle={(enabled) => handleToggle({ id: server.id, enabled })}
                onRemove={() => handleRemove(server.id)}
              />
            ))
          )}
        </SettingsCard>
        {servers.some((server) => server.id === "linear") ? (
          <p className="text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-1.5">
              Overrides
            </Badge>
            <span className="font-mono">linear</span> replaces a member&apos;s personal server with
            the same ID.
          </p>
        ) : null}
      </SettingsSection>
    </>
  );
}
