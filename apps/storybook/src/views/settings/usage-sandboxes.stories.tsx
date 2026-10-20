import type { Meta, StoryObj } from "@storybook/react-vite";

import { PAUSED_SANDBOXES } from "../../fixtures/settings-usage";
import { UsageSandboxesView } from "./pages/usage-sandboxes";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Personal/Usage Sandboxes",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.UsageSandboxes} renderPage={renderSettingsPage} />
  ),
};

export const NoneRunning: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.UsageSandboxes}
      renderPage={() => <UsageSandboxesView running={[]} paused={PAUSED_SANDBOXES} />}
    />
  ),
};
