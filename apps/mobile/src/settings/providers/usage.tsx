import { EMeterBand } from '@dltech/atlas-core'
import { providerUsageAgeOf, providerUsageWindowsOf } from '@dltech/atlas-client/settings'
import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { View } from 'react-native'
import { useAuth } from '../../auth/auth-provider'
import { useApiResource } from '../use-api-resource'

export function ProviderUsage({ accountId }: { accountId: string }) {
  const { api } = useAuth()
  const theme = useTheme()
  const { data } = useApiResource({
    load: () => {
      if (api === undefined) throw new Error('Sign in first')
      return api.usage.report.query({ accountId })
    },
    deps: [api, accountId],
  })
  if (data === null || !data.metered) return null
  const now = Date.now()
  const age = providerUsageAgeOf({ fetchedAt: data.fetchedAt, now })
  return (
    <View accessibilityLabel="Plan usage" style={{ padding: 16, gap: 8 }}>
      {providerUsageWindowsOf({ report: data, now }).map((window) => (
        <View key={window.key} style={{ gap: 4 }}>
          <Text
            size={ETextRole.Xs}
            tone={ETextTone.Muted}
          >{`${window.label} · ${window.text}${window.countdown ? ` · resets in ${window.countdown}` : ''}`}</Text>
          {window.utilization === null ? null : (
            <View style={{ height: 4, backgroundColor: theme.muted, borderRadius: 2 }}>
              <View
                style={{
                  height: 4,
                  width: `${window.percent}%`,
                  backgroundColor:
                    window.band === EMeterBand.Normal
                      ? theme.primary
                      : window.band === EMeterBand.Warn
                        ? theme.warning
                        : theme.destructive,
                  borderRadius: 2,
                }}
              />
            </View>
          )}
        </View>
      ))}
      {age === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {age}
        </Text>
      )}
    </View>
  )
}
