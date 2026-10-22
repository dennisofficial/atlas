import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountWorkspacesCard } from '../parts/account-workspaces-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

export function AccountPage() {
  return (
    <SettingsPage title="Account" description="Your profile and the workspaces you belong to.">
      <SettingsSection title="Profile">
        <AccountProfileCard />
      </SettingsSection>
      <SettingsSection title="Workspaces" description="Workspaces you are a member of.">
        <AccountWorkspacesCard />
      </SettingsSection>
    </SettingsPage>
  )
}
