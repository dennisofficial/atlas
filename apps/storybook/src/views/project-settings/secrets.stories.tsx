import type { Meta, StoryObj } from "@storybook/react-vite";

import { BULK_ADD_SAMPLE, EProjectSettingsPage } from "../../fixtures/project-settings";
import { ProjectSettingsShell } from "./project-settings-shell";
import { ESecretsDialog, SecretsPage } from "./secrets-page";

const meta = {
  title: "Views/Project Settings/Secrets & Env Vars",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Secrets}>
      <SecretsPage />
    </ProjectSettingsShell>
  ),
};

export const Empty: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Secrets}>
      <SecretsPage initialRows={[]} />
    </ProjectSettingsShell>
  ),
};

export const AddDialog: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Secrets}>
      <SecretsPage openDialog={ESecretsDialog.Add} />
    </ProjectSettingsShell>
  ),
};

export const BulkAddDialog: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Secrets}>
      <SecretsPage openDialog={ESecretsDialog.BulkAdd} bulkText={BULK_ADD_SAMPLE} />
    </ProjectSettingsShell>
  ),
};
