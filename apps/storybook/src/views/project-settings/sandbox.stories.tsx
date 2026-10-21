import type { Meta, StoryObj } from "@storybook/react-vite";

import { EProjectSettingsPage } from "../../fixtures/project-settings";
import { ProjectSettingsShell } from "./project-settings-shell";
import { SandboxPage } from "./sandbox-page";

const meta = {
  title: "Views/Project Settings/Sandbox",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Sandbox}>
      <SandboxPage />
    </ProjectSettingsShell>
  ),
};

export const VercelUnavailable: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Sandbox}>
      <SandboxPage vercelEnabled={false} />
    </ProjectSettingsShell>
  ),
};
