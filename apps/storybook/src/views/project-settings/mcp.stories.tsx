import type { Meta, StoryObj } from "@storybook/react-vite";

import { EProjectSettingsPage } from "../../fixtures/project-settings";
import { McpPage } from "./mcp-page";
import { ProjectSettingsShell } from "./project-settings-shell";

const meta = {
  title: "Views/Project Settings/MCP",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Configured: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Mcp}>
      <McpPage />
    </ProjectSettingsShell>
  ),
};

export const Empty: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Mcp}>
      <McpPage initialServers={[]} />
    </ProjectSettingsShell>
  ),
};

export const AddServerDialog: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Mcp}>
      <McpPage addDialogOpen />
    </ProjectSettingsShell>
  ),
};
