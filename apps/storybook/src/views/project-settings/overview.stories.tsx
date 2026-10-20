import type { Meta, StoryObj } from "@storybook/react-vite";

import { EProjectSettingsPage } from "../../fixtures/project-settings";
import { OverviewPage } from "./overview-page";
import { ProjectSettingsShell } from "./project-settings-shell";

const meta = {
  title: "Views/Project Settings/Overview",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Overview}>
      <OverviewPage />
    </ProjectSettingsShell>
  ),
};
