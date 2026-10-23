import { Switch } from '@dltech/atlas-ui/components/switch'

import {
  NOTIFICATION_DEFAULTS,
  type ChannelState,
  type ENotifyChannel,
} from '../../../fixtures/settings-interface'
import { CURRENT_USER } from '../../../fixtures/settings'
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
import { useDraft } from '../use-draft'

export function NotificationsPage() {
  const draft = useDraft(NOTIFICATION_DEFAULTS)
  const { value, setValue } = draft

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
    <SettingsPage title="Notifications" description="Decide where Atlas gets your attention.">
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
                Sent to <Mono>{CURRENT_USER.email}</Mono>.
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
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Notify me when" description="Pick a delivery channel for each event.">
        <SettingsCard
          footer={<SaveFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />}
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
