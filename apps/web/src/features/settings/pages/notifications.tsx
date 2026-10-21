'use client'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Switch } from '@dltech/atlas-ui/components/switch'

import type { SettingValues } from '@/lib/cloud-settings'
import { useSessionUser } from '../session/use-session-identity'

import { notificationChanges, notificationsFrom } from '../data/personal/interface-settings'
import { QueryPage } from '../data/personal/query-boundary'
import { usePersonalSettings, useSettingsDraft } from '../data/personal/use-settings-draft'
import { type ChannelState, type ENotifyChannel } from '../fixtures/settings-interface'
import { NotifyMatrixTable } from '../parts/interface-notify-matrix'
import { QuietHourSelect } from '../parts/interface-quiet-hours'
import {
  Mono,
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'

const TITLE = 'Notifications'
const DESCRIPTION = 'Decide where Atlas gets your attention.'

export function NotificationsPage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage query={settings.query} title={TITLE} description={DESCRIPTION}>
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
    fromValues: notificationsFrom,
    toChanges: notificationChanges,
    save,
  })
  const { value, setValue } = draft
  const { user } = useSessionUser()

  const handleChannelChange = (params: { channel: keyof ChannelState; enabled: boolean }) => {
    setValue({ ...value, channels: { ...value.channels, [params.channel]: params.enabled } })
  }

  const handleMatrixToggle = (params: {
    eventId: string
    channel: ENotifyChannel
    checked: boolean
  }) => {
    const row = value.matrix[params.eventId]
    if (!row) return
    setValue({
      ...value,
      matrix: { ...value.matrix, [params.eventId]: { ...row, [params.channel]: params.checked } },
    })
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection title="Channels" description="Where notifications can be delivered.">
        <SettingsCard>
          <SettingsRow
            title="Browser push"
            description="Desktop alerts while Atlas is open in a background tab."
            control={
              <Switch
                checked={value.channels.push}
                onCheckedChange={(enabled) => handleChannelChange({ channel: 'push', enabled })}
                aria-label="Browser push"
              />
            }
          />
          <SettingsRow
            title="Email"
            description={
              <>
                Sent to <Mono>{user?.email ?? 'your account email'}</Mono>.
              </>
            }
            control={
              <Switch
                checked={value.channels.email}
                onCheckedChange={(enabled) => handleChannelChange({ channel: 'email', enabled })}
                aria-label="Email"
              />
            }
          />
          <SettingsRow
            title="Slack"
            description="Post to a DM or channel in your connected workspace."
            control={
              value.channels.slack ? (
                <>
                  <Badge variant="secondary">Connected</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleChannelChange({ channel: 'slack', enabled: false })}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleChannelChange({ channel: 'slack', enabled: true })}
                >
                  Connect
                </Button>
              )
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Notify me when" description="Pick a delivery channel for each event.">
        <SettingsCard
          footer={
            <SaveFooter
              dirty={draft.dirty && !saving}
              onDiscard={draft.discard}
              onSave={() => void handleSave()}
            />
          }
        >
          <NotifyMatrixTable matrix={value.matrix} onToggle={handleMatrixToggle} />
          <SettingsRow
            title="Quiet hours"
            description="Hold push and email notifications during this window."
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
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
