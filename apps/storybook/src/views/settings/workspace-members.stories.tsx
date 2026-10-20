import type { Meta, StoryObj } from "@storybook/react-vite";

import { WorkspaceMembersPage } from "./pages/workspace-members";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Workspace/Members",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.WorkspaceMembers} renderPage={renderSettingsPage} />
  ),
};

export const InviteOpen: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceMembers}
      renderPage={(page) =>
        page === ESettingsPage.WorkspaceMembers ? (
          <WorkspaceMembersPage defaultInviteOpen />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
};

export const NoPendingInvites: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceMembers}
      renderPage={(page) =>
        page === ESettingsPage.WorkspaceMembers ? (
          <WorkspaceMembersPage initialPending={[]} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
};
