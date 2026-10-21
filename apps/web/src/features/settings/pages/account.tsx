'use client'

import { useCallback } from 'react'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { fetchAccountData, type AccountData } from '../data/personal/account-data'
import { updateName } from '../data/personal/auth-session-api'
import { QueryPage } from '../data/personal/query-boundary'
import { useSaveAction } from '../data/personal/use-save-action'
import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountWorkspacesCard } from '../parts/account-workspaces-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Account'
const DESCRIPTION = 'Your profile and the workspaces you belong to.'

export function AccountPage() {
  const query = useCloudQuery({ key: 'personal-account', load: fetchAccountData })
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(data) => <AccountContent data={data} reload={query.reload} />}
    </QueryPage>
  )
}

function AccountContent({ data, reload }: { data: AccountData; reload: () => void }) {
  const { saving, run } = useSaveAction()
  const handleSaveName = useCallback(
    async (name: string) => {
      const saved = await run({ work: () => updateName(name), success: 'Profile updated' })
      if (saved) reload()
      return saved
    },
    [run, reload],
  )
  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection title="Profile">
        <AccountProfileCard
          profile={{ name: data.name, email: data.email }}
          githubLogin={data.githubLogin}
          memberSince={data.memberSince}
          saving={saving}
          onSave={handleSaveName}
        />
      </SettingsSection>
      <SettingsSection
        title="Workspaces"
        description="Workspaces you are a member of."
      >
        <AccountWorkspacesCard workspaces={data.workspaces} />
      </SettingsSection>
    </SettingsPage>
  )
}
