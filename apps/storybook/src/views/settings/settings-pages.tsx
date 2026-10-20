import type { ComponentType, ReactNode } from "react";

import { AccountPage } from "./pages/account";
import { IntegrationsPage } from "./pages/integrations";
import { ExperimentalPage } from "./pages/experimental";
import { UsageModelsPage } from "./pages/usage-models";
import { UsageSandboxesPage } from "./pages/usage-sandboxes";
import { InstructionsPage } from "./pages/instructions";
import { ModelsEffortPage } from "./pages/models-effort";
import { ProvidersPage } from "./pages/providers";
import { SecretsPage } from "./pages/secrets";
import { SkillsPage } from "./pages/skills";
import { PluginsPage } from "./pages/plugins";
import { AppearancePage } from "./pages/appearance";
import { KeyboardShortcutsPage } from "./pages/keyboard-shortcuts";
import { NotificationsPage } from "./pages/notifications";
import { SecurityPage } from "./pages/security";
import { WorkspaceGeneralPage } from "./pages/workspace-general";
import { WorkspaceMembersPage } from "./pages/workspace-members";
import { WorkspaceSecretsPage } from "./pages/workspace-secrets";
import { WorkspaceMcpPage } from "./pages/workspace-mcp";
import { ESettingsPage } from "./settings-nav";

const PAGES: Record<ESettingsPage, ComponentType> = {
  [ESettingsPage.Account]: AccountPage,
  [ESettingsPage.Integrations]: IntegrationsPage,
  [ESettingsPage.Experimental]: ExperimentalPage,
  [ESettingsPage.UsageModels]: UsageModelsPage,
  [ESettingsPage.UsageSandboxes]: UsageSandboxesPage,
  [ESettingsPage.Instructions]: InstructionsPage,
  [ESettingsPage.ModelsEffort]: ModelsEffortPage,
  [ESettingsPage.Providers]: ProvidersPage,
  [ESettingsPage.Secrets]: SecretsPage,
  [ESettingsPage.Skills]: SkillsPage,
  [ESettingsPage.Plugins]: PluginsPage,
  [ESettingsPage.Appearance]: AppearancePage,
  [ESettingsPage.KeyboardShortcuts]: KeyboardShortcutsPage,
  [ESettingsPage.Notifications]: NotificationsPage,
  [ESettingsPage.Security]: SecurityPage,
  [ESettingsPage.WorkspaceGeneral]: WorkspaceGeneralPage,
  [ESettingsPage.WorkspaceMembers]: WorkspaceMembersPage,
  [ESettingsPage.WorkspaceSecrets]: WorkspaceSecretsPage,
  [ESettingsPage.WorkspaceMcp]: WorkspaceMcpPage,
};

export function renderSettingsPage(page: ESettingsPage): ReactNode {
  const Page = PAGES[page];
  return <Page />;
}
