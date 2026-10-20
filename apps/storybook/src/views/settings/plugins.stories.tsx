import type { Meta, StoryObj } from "@storybook/react-vite";

import { PluginsPage } from "./pages/plugins";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Personal/Plugins",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Plugins} renderPage={renderSettingsPage} />
  ),
};

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Plugins}
      renderPage={(page) => (page === ESettingsPage.Plugins ? <PluginsPage initial={[]} /> : renderSettingsPage(page))}
    />
  ),
};
