import { NOTIFY_TIMEZONE_KEY, timezoneChoicesOf } from '@dltech/atlas-client/settings'
import {
  CardRow,
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { router, Stack } from 'expo-router'
import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { z } from 'zod'

import { useSettings } from '../../../settings/settings-provider'
import { Section } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'

export default function NotificationsTimezoneScreen() {
  const settings = useSettings()
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const current = settings.read({ key: NOTIFY_TIMEZONE_KEY, schema: z.string() })
  const choices = timezoneChoicesOf({ query, selected: current })

  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')

  const handleSelect = (zone: string) => {
    setFailure(null)
    void settings.save({ [NOTIFY_TIMEZONE_KEY]: zone }).then(
      () => router.back(),
      () => setFailure('That time zone could not be saved.'),
    )
  }

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search time zones',
            onChangeText: handleSearch,
            onCancelButtonPress: handleCancelSearch,
          },
        }}
      />
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Quiet hours are read in this zone, so daylight saving time is honoured.
      </Text>
      <Section title="Time zone">
        {choices.length === 0 ? (
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              No time zone matches
            </Text>
          </CardRow>
        ) : (
          choices.map((zone) => (
            <Pressable
              key={zone}
              accessibilityRole="button"
              accessibilityLabel={zone}
              accessibilityState={{ selected: zone === current }}
              onPress={() => handleSelect(zone)}
            >
              <CardRow>
                <Text
                  size={ETextRole.Sm}
                  family={EFontFamily.Mono}
                  numberOfLines={1}
                  style={styles.zone}
                >
                  {zone}
                </Text>
                {zone === current ? <Icon icon={Check} color={theme.primary} size={16} /> : null}
              </CardRow>
            </Pressable>
          ))
        )}
      </Section>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  zone: {
    flexShrink: 1,
  },
})
