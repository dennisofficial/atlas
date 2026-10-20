import type { Meta, StoryObj } from "@storybook/react-vite";

import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";
import { WorkspaceMcpPage } from "./pages/workspace-mcp";

const meta = {
  title: "Views/Settings/Workspace/MCP",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.WorkspaceMcp} renderPage={renderSettingsPage} />
  ),
};

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceMcp}
      renderPage={(page) =>
        page === ESettingsPage.WorkspaceMcp ? <WorkspaceMcpPage servers={[]} /> : renderSettingsPage(page)
      }
    />
  ),
};
