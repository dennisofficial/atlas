import type { Meta, StoryObj } from "@storybook/react-vite";

import { WorkspaceSecretsPage } from "./pages/workspace-secrets";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Workspace/Secrets & Env Vars",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.WorkspaceSecrets} renderPage={renderSettingsPage} />
  ),
};

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceSecrets}
      renderPage={(page) => (page === ESettingsPage.WorkspaceSecrets ? <WorkspaceSecretsPage initial={[]} /> : renderSettingsPage(page))}
    />
  ),
};
