import { AccountProfileCard } from "../parts/account-profile-card";
import { AccountWorkspacesCard } from "../parts/account-workspaces-card";
import { DangerZone, SettingsPage, SettingsSection } from "../settings-layout";

export function AccountPage() {
  return (
    <SettingsPage title="Account" description="Your profile and the workspaces you belong to.">
      <SettingsSection title="Profile">
        <AccountProfileCard />
      </SettingsSection>
      <SettingsSection
        title="Workspaces"
        description="Workspaces you are a member of. Owners cannot leave without transferring ownership."
      >
        <AccountWorkspacesCard />
      </SettingsSection>
      <DangerZone
        actions={[
          {
            title: "Delete account",
            description:
              "Permanently delete your account, threads, and personal secrets. This cannot be undone.",
            buttonLabel: "Delete account",
            confirmTitle: "Delete your account?",
            confirmDescription:
              "All of your threads, sandboxes, and personal settings will be removed. Workspaces you own must be transferred or deleted first.",
          },
        ]}
      />
    </SettingsPage>
  );
}
