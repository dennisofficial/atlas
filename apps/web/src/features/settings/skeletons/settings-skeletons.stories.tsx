import type { ReactNode } from 'react'

import { EDeviceKind } from '../fixtures/settings-security'
import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountSignInMethodsCard } from '../parts/account-sign-in-methods-card'
import { EnvSecretsContent } from '../parts/env-secrets-table'
import { DeviceRow } from '../parts/security-device-row'
import { VercelCredentialCard } from '../parts/vercel-credential-card'
import { SettingsCard, SettingsSection } from '../settings-layout'
import { AccountSkeleton } from './account-skeletons'
import { ModelsSkeleton, NotificationsSkeleton } from './agent-skeletons'
import { MemorySkeleton, ProvidersSkeleton, SecurityDevicesSkeleton } from './library-skeletons'
import { EnvSecretsSkeleton, VercelCardSkeleton } from './table-skeletons'

function Pair({ loading, loaded }: { loading: ReactNode; loaded: ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-start gap-12 bg-background p-10">
      <div className="flex flex-col gap-8">{loading}</div>
      <div className="flex flex-col gap-8">{loaded}</div>
    </div>
  )
}

const noop = () => {}
const handlers = {
  busy: false,
  linkGoogle: noop,
  unlinkGoogle: noop,
  sendSetupLink: noop,
  removePassword: noop,
}

const meta = {
  title: 'App/Settings Skeletons',
  parameters: { layout: 'fullscreen' },
}

export default meta

export const Account = {
  render: () => (
    <Pair
      loading={<AccountSkeleton />}
      loaded={
        <>
          <SettingsSection title="Profile">
            <AccountProfileCard
              profile={{ name: 'Ada Lovelace', email: 'ada@company.com' }}
              githubLogin="ada"
              memberSince="Oct 2026"
              saving={false}
              onSave={async () => true}
            />
          </SettingsSection>
          <SettingsSection title="Sign-in methods" description="How you can sign in to Atlas.">
            <AccountSignInMethodsCard
              methods={{ google: 'g-1', password: null }}
              handlers={handlers}
            />
          </SettingsSection>
        </>
      }
    />
  ),
}

export const SecurityDevices = {
  render: () => (
    <Pair
      loading={<SecurityDevicesSkeleton />}
      loaded={
        <SettingsCard>
          {[
            {
              id: '1',
              kind: EDeviceKind.Browser,
              name: 'Chrome on macOS',
              current: true,
            },
            {
              id: '2',
              kind: EDeviceKind.Cli,
              name: 'atlas CLI',
              current: false,
            },
            {
              id: '3',
              kind: EDeviceKind.Sandbox,
              name: 'Cloud sandbox',
              current: false,
            },
          ].map((device) => (
            <DeviceRow
              key={device.id}
              device={{ ...device, meta: 'Seen 2 minutes ago · 10.0.0.1' }}
              onRevoke={noop}
            />
          ))}
        </SettingsCard>
      }
    />
  ),
}

export const Secrets = {
  render: () => (
    <Pair
      loading={<EnvSecretsSkeleton />}
      loaded={
        <EnvSecretsContent
          rows={[
            { name: 'OPENAI_API_KEY', updated: '2d ago' },
            { name: 'DATABASE_URL', updated: '5d ago' },
            { name: 'SENTRY_DSN', updated: '1w ago' },
          ]}
          emptyDescription=""
          dialogDescription=""
          fetchValue={async () => 'value'}
          onSave={async () => true}
          onRemove={noop}
        />
      }
    />
  ),
}

export const VercelCredential = {
  render: () => (
    <Pair
      loading={<VercelCardSkeleton />}
      loaded={
        <VercelCredentialCard
          view={{
            configured: true,
            teamId: 'team_abc',
            vercelProjectId: 'prj_abc',
            updatedAt: null,
          }}
          statusLine="Configured"
        />
      }
    />
  ),
}

export const Providers = {
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 bg-background p-10">
      <ProvidersSkeleton />
    </div>
  ),
}

export const Memory = {
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 bg-background p-10">
      <MemorySkeleton />
    </div>
  ),
}

export const Models = {
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 bg-background p-10">
      <ModelsSkeleton />
    </div>
  ),
}

export const Notifications = {
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 bg-background p-10">
      <NotificationsSkeleton />
    </div>
  ),
}
