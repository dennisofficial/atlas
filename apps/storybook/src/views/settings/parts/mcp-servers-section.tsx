import { useState } from "react";

import type { McpServer } from "../../../fixtures/settings-mcp";
import { SettingsSection } from "../settings-layout";
import { McpAddDialog } from "./mcp-add-dialog";
import { McpServerList } from "./mcp-server-list";

export function McpServersSection({
  title = "MCP servers",
  description,
  initialServers,
}: {
  title?: string;
  description: string;
  initialServers: McpServer[];
}) {
  const [servers, setServers] = useState(initialServers);

  const handleAdd = (server: McpServer) => setServers((current) => [...current, server]);

  const handleToggle = (id: string, enabled: boolean) =>
    setServers((current) =>
      current.map((server) => (server.id === id ? { ...server, enabled } : server)),
    );

  const handleRemove = (id: string) =>
    setServers((current) => current.filter((server) => server.id !== id));

  return (
    <SettingsSection
      title={title}
      description={description}
      actions={<McpAddDialog onAdd={handleAdd} />}
    >
      <McpServerList servers={servers} onToggle={handleToggle} onRemove={handleRemove} />
    </SettingsSection>
  );
}
