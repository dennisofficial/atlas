import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { SettingsCard, SettingsSection } from '../settings-layout'
import { ERowControl, Line, RowCardSkeleton, SettingsRowSkeleton } from './primitives'
import { EnvSecretsSkeleton, SandboxTableSkeleton, VercelCardSkeleton } from './table-skeletons'

export function MemorySearchSkeleton() {
  return <Skeleton className="h-8 w-full rounded-lg sm:w-48" />
}

function MemoryRowSkeleton() {
  return (
    <SettingsRowSkeleton
      media
      lines={2}
      custom={<Skeleton className="size-7 rounded-lg" />}
      titleWidth="w-48"
    />
  )
}

export function MemorySkeleton() {
  return (
    <>
      <SettingsSection title="Scope">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Line width="w-64" />
      </SettingsSection>
      <SettingsSection title="Memories" actions={<Skeleton className="h-7 w-72 rounded-lg" />}>
        <SettingsCard>
          {[0, 1, 2].map((key) => (
            <MemoryRowSkeleton key={key} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Danger zone">
        <SettingsCard tone="destructive">
          <SettingsRowSkeleton control={ERowControl.Button} lines={1} />
        </SettingsCard>
      </SettingsSection>
    </>
  )
}

export function MemorySheetSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-0.5 pr-8">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-[4.75rem] rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Line width="w-full" />
        <Line width="w-40" />
      </div>
      <div className="min-h-0 flex-1">
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
      <div className="mt-auto flex flex-row justify-between gap-2">
        <Skeleton className="h-7 w-20 rounded-lg" />
        <Skeleton className="h-7 w-16 rounded-lg" />
      </div>
    </>
  )
}

export function ProvidersSkeleton() {
  return (
    <>
      <SettingsSection
        title="Subscriptions"
        description="Sign in with a plan you already pay for. Takes precedence over API keys."
      >
        <RowCardSkeleton controls={[ERowControl.Button, ERowControl.Button]} media badge />
      </SettingsSection>
      <SettingsSection
        title="API keys"
        description="Used when no subscription covers the model. Billed by the provider."
      >
        <RowCardSkeleton
          controls={[
            ERowControl.Buttons,
            ERowControl.Buttons,
            ERowControl.Buttons,
            ERowControl.Buttons,
            ERowControl.Button,
          ]}
          media
        />
      </SettingsSection>
    </>
  )
}

export function SecretsSkeleton() {
  return <EnvSecretsSkeleton />
}

export function SecurityDevicesSkeleton() {
  return (
    <SettingsCard>
      {[0, 1, 2].map((key) => (
        <SettingsRowSkeleton
          key={key}
          media
          badge={key === 0}
          control={key === 0 ? ERowControl.None : ERowControl.Button}
        />
      ))}
    </SettingsCard>
  )
}

export function UsageSandboxesSkeleton() {
  return (
    <>
      <SettingsSection
        title="Sandbox credential"
        description="Lets Atlas Cloud create sandboxes for your projects and threads."
      >
        <VercelCardSkeleton />
      </SettingsSection>
      <SettingsSection title="Currently running">
        <SandboxTableSkeleton rows={2} />
      </SettingsSection>
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-96 max-w-full" />
      </div>
    </>
  )
}

export function InstructionsActionsSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="size-7 rounded-lg" />
      <Skeleton className="h-7 w-14 rounded-lg" />
    </>
  )
}

export function InstructionsSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="h-9 w-full rounded-none" />
      <div className="flex flex-col gap-3 py-6">
        <Skeleton className="h-7 w-1/3" />
        {['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-2/3'].map((width, index) => (
          <Skeleton key={index} className={`h-4 ${width}`} />
        ))}
      </div>
    </div>
  )
}

export function GithubIntegrationSkeleton() {
  return (
    <SettingsCard>
      <SettingsRowSkeleton
        media
        badge
        control={ERowControl.Buttons}
        extra={
          <div className="flex gap-x-5 pl-12">
            {['w-28', 'w-28', 'w-28'].map((width, index) => (
              <Skeleton key={index} className={`h-4 ${width}`} />
            ))}
          </div>
        }
      />
    </SettingsCard>
  )
}

export function McpListSkeleton() {
  return (
    <SettingsCard>
      {[0, 1].map((key) => (
        <SettingsRowSkeleton key={key} badge control={ERowControl.SwitchMenu} titleWidth="w-28" />
      ))}
    </SettingsCard>
  )
}
