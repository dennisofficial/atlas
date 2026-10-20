import type { Meta, StoryObj } from "@storybook/react-vite";

import { SkillsPage } from "./pages/skills";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Personal/Skills",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Skills} renderPage={renderSettingsPage} />
  ),
};

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Skills}
      renderPage={(page) => (page === ESettingsPage.Skills ? <SkillsPage initial={[]} /> : renderSettingsPage(page))}
    />
  ),
};
