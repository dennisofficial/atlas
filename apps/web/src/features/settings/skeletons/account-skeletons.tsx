import { CardRow } from '@dltech/atlas-ui/components/card'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { PROFILE_GRID_CLASS, PROFILE_ROW_CLASS } from '../parts/account-profile-card'
import { SettingsCard, SettingsSection } from '../settings-layout'
import { ERowControl, RowCardSkeleton } from './primitives'

const PROFILE_FIELD_WIDTHS = ['w-24', 'w-40', 'w-20', 'w-8', 'w-24']

function ProfileFieldSkeleton({ width }: { width: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Skeleton className="h-[11px] w-12" />
      <div className="flex h-5 items-center">
        <Skeleton className={`h-3.5 ${width}`} />
      </div>
    </div>
  )
}

export function AccountSkeleton() {
  return (
    <>
      <SettingsSection title="Profile">
        <SettingsCard>
          <CardRow className={PROFILE_ROW_CLASS}>
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className={PROFILE_GRID_CLASS}>
              {PROFILE_FIELD_WIDTHS.map((width) => (
                <ProfileFieldSkeleton key={width + width.length} width={width} />
              ))}
            </div>
            <Skeleton className="h-7 w-12 rounded-lg" />
          </CardRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="How you can sign in to Atlas.">
        <RowCardSkeleton controls={[ERowControl.Button, ERowControl.Button]} media badge />
      </SettingsSection>
    </>
  )
}
