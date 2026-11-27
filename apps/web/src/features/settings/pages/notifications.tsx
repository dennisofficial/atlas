'use client'

import {
  deviceTimezone,
  NOTIFY_TIMEZONE_KEY,
  notificationChanges,
  notificationsFrom,
  withDeviceZone,
} from '@dltech/atlas-client/settings'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { useEffect, useRef } from 'react'

import { RoutineTimezoneField } from '@/features/routines/routine-timezone-field'
import type { SettingValues } from '@/lib/cloud-settings'

import { QueryPage } from '../data/personal/query-boundary'
import { useCloudSettings } from '@/lib/cloud-settings'
import { useSettingsDraft } from '../data/personal/use-settings-draft'
import { type NotifyEventToggles, type NotifyMomentId } from '../fixtures/settings-interface'
import { QuietHourSelect } from '../parts/interface-quiet-hours'
import { NotifyDevicesCard } from '../parts/notify-devices-card'
import { NotifyEventToggles as NotifyEventToggleRows } from '../parts/notify-event-toggles'
import { ThisDeviceNotifications } from '../parts/this-device-notifications'
import { NotificationsSkeleton } from '../skeletons/agent-skeletons'
import {
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'

const TITLE = 'Notifications'
const DESCRIPTION = 'Decide where Atlas gets your attention.'

export function NotificationsPage() {
  const settings = useCloudSettings()
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<NotificationsSkeleton />}
    >
      {(values) => <NotificationsEditor values={values} save={settings.save} />}
    </QueryPage>
  )
}

function NotificationsEditor({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: Record<string, string | number | boolean | null>) => Promise<void>
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: (current) => withDeviceZone(notificationsFrom(current)),
    toChanges: notificationChanges,
    save,
  })
  const { value, setValue } = draft
  const defaulted = useRef(false)
  const storedZone = values.get(NOTIFY_TIMEZONE_KEY)

  useEffect(() => {
    if (defaulted.current) return
    defaulted.current = true
    if (storedZone === undefined || storedZone === '') {
      void save({ [NOTIFY_TIMEZONE_KEY]: deviceTimezone() })
    }
  }, [storedZone, save])

  const handleEventToggle = (params: { moment: NotifyMomentId; enabled: boolean }) => {
    const events: NotifyEventToggles = { ...value.events, [params.moment]: params.enabled }
    setValue({ ...value, events })
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <ThisDeviceNotifications />
      <SettingsSection
        title="Notify me when"
        description="Each switch holds or sends this moment on every device."
      >
        <SettingsCard>
          <NotifyEventToggleRows value={value.events} onToggle={handleEventToggle} />
        </SettingsCard>
      </SettingsSection>
      <NotifyDevicesCard />
      <SettingsSection
        title="Quiet hours"
        description="Nothing leaves Atlas during this window, read in the time zone below."
      >
        <SettingsCard
          footer={
            <SaveFooter
              dirty={draft.dirty && !saving}
              onDiscard={draft.discard}
              onSave={() => void handleSave()}
            />
          }
        >
          <SettingsRow
            title="Quiet hours"
            description="Hold every notification during this window."
            control={
              <>
                <Switch
                  checked={value.quietHours}
                  onCheckedChange={(quietHours) => setValue({ ...value, quietHours })}
                  aria-label="Quiet hours"
                />
                <QuietHourSelect
                  value={value.quietFrom}
                  label="Quiet hours start"
                  disabled={!value.quietHours}
                  onChange={(quietFrom) => setValue({ ...value, quietFrom })}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <QuietHourSelect
                  value={value.quietTo}
                  label="Quiet hours end"
                  disabled={!value.quietHours}
                  onChange={(quietTo) => setValue({ ...value, quietTo })}
                />
              </>
            }
          />
          <SettingsRow
            title="Time zone"
            description="Quiet hours are read in this zone, so daylight saving time is honoured."
            control={
              <RoutineTimezoneField
                id="notifications-timezone"
                value={value.timezone}
                onChange={(timezone) => setValue({ ...value, timezone })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
