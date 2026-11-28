import { repositoryPickerChoices } from '@dltech/atlas-client/settings'
import {
  CardRow,
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Input,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { EResourceState } from '../../../../settings/api-resource-state'
import { Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { useApiResource } from '../../../../settings/use-api-resource'

export default function RepositoryPickerScreen() {
  const { api } = useAuth()
  const theme = useTheme()
  const { projectId, index, current, taken } = useLocalSearchParams<{
    projectId: string
    index: string
    current?: string
    taken?: string
  }>()
  const [query, setQuery] = useState('')
  const { data, state, reload } = useApiResource({
    load: async () => {
      if (api === undefined) return null
      const connection = await api.github.get.query()
      return connection.connected ? api.githubRepos.list.query() : null
    },
    deps: [api],
  })
  const choices = repositoryPickerChoices({
    repos: data ?? [],
    query,
    taken: taken?.split(',') ?? [],
  })
  const handleSearch = (event: { nativeEvent: { text: string } }) =>
    setQuery(event.nativeEvent.text)
  const handleCancelSearch = () => setQuery('')
  const handleSelect = (repository: string) =>
    router.dismissTo({
      pathname: '/project-settings/[projectId]/overview',
      params: { projectId, pickedIndex: index, pickedRepository: repository },
    })

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placement: 'integratedButton',
            placeholder: 'Search repositories',
            onChangeText: handleSearch,
            onCancelButtonPress: handleCancelSearch,
          },
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Choose a repository to clone next to the main repository. Save the project to keep this
        change.
      </Text>
      {Platform.OS === 'ios' ? null : (
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search repositories or paste a GitHub URL"
          accessibilityLabel="Search repositories"
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}
      <StatusRows
        state={state}
        onRetry={reload}
        failure="GitHub repositories could not be loaded."
      />
      {state === EResourceState.Ready ? (
        <Section title="Repositories">
          {choices.length === 0 ? (
            <CardRow>
              <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                {query.trim() !== ''
                  ? 'No repositories match. Try another search or paste a GitHub URL.'
                  : data === null
                    ? 'Connect GitHub in Integrations, or paste a GitHub URL to choose a repository.'
                    : 'No repositories available. Repositories already in this project are not shown.'}
              </Text>
            </CardRow>
          ) : (
            choices.map((repository) => (
              <Pressable
                key={repository}
                accessibilityRole="button"
                accessibilityLabel={repository}
                accessibilityState={{ selected: repository === current }}
                onPress={() => handleSelect(repository)}
              >
                <CardRow>
                  <Text size={ETextRole.Sm} family={EFontFamily.Mono} style={styles.name}>
                    {repository}
                  </Text>
                  {repository === current ? (
                    <Icon icon={Check} color={theme.primary} size={16} />
                  ) : null}
                </CardRow>
              </Pressable>
            ))
          )}
        </Section>
      ) : null}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({ name: { flexShrink: 1, paddingVertical: space(1) } })
