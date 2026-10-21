import { EllipsisIcon, PlugIcon } from "lucide-react";

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

import type { McpServer } from "../../../fixtures/settings-mcp";
import { Mono, SettingsCard, SettingsRow } from "../settings-layout";

export function McpServerList({
  servers,
  onToggle,
  onRemove,
}: {
  servers: McpServer[];
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}) {
  if (servers.length === 0) {
    return (
      <Empty className="border py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>No MCP servers configured</EmptyTitle>
          <EmptyDescription>
            Add a server to give threads extra tools.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <SettingsCard>
      {servers.map((server) => (
        <SettingsRow
          key={server.id}
          title={
            <>
              <Mono className="text-sm">{server.id}</Mono>
              <Badge variant="outline">{server.transport}</Badge>
            </>
          }
          description={<Mono className="block truncate text-muted-foreground">{server.target}</Mono>}
          control={
            <>
              <Switch
                size="sm"
                aria-label={`Enable ${server.id}`}
                checked={server.enabled}
                onCheckedChange={(checked) => onToggle(server.id, checked)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`${server.id} actions`} />}
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem variant="destructive" onClick={() => onRemove(server.id)}>
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      ))}
    </SettingsCard>
  );
}
