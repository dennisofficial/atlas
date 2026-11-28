import {
  createAccessMemberApi,
  scopeKeyOf,
  type AccessScope,
  type AccessRouteParams,
  accessParamsOfScope,
} from '@dltech/atlas-client/settings'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'
import { Platform, StyleSheet } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { useApiResource } from '../use-api-resource'

export const useAccess = (scope: AccessScope) => {
  const { api } = useAuth()
  const resource = useApiResource({
    load: async () => {
      if (api === undefined) throw new Error('Sign in to manage access.')
      return (await api.accessGrants.list.query({ scope })).grants
    },
    deps: [api, scopeKeyOf(scope)],
  })
  const focused = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (focused.current) resource.reload()
      focused.current = true
    }, [resource.reload]),
  )
  return {
    ...resource,
    api,
    members: api === undefined ? undefined : createAccessMemberApi({ api, scope }),
  }
}

export const openAccessForm = ({
  scope,
  ...params
}: Omit<AccessRouteParams, 'scope'> & { scope: AccessScope }) =>
  router.push({
    pathname: '/settings/access-form',
    params: { ...accessParamsOfScope(scope), ...params },
  })

export const AccessHeaderAction = ({
  label,
  symbol,
  onPress,
  disabled = false,
}: {
  label: string
  symbol: 'plus' | 'checkmark' | 'pencil'
  onPress: () => void
  disabled?: boolean
}) => (
  <Stack.Screen
    options={
      Platform.OS === 'ios'
        ? {
            unstable_headerRightItems: () => [
              {
                type: 'button',
                label,
                accessibilityLabel: label,
                icon: { type: 'sfSymbol', name: symbol },
                onPress,
                disabled,
              },
            ],
          }
        : {
            headerRight: () => (
              <Button
                label={label}
                onPress={onPress}
                disabled={disabled}
                variant={EButtonVariant.Ghost}
                size={EButtonSize.Sm}
              />
            ),
          }
    }
  />
)

export const AccessNote = ({
  children,
  text,
  error = false,
}: {
  children?: string
  text?: string
  error?: boolean
}) => (
  <Text
    size={ETextRole.Sm}
    tone={error ? ETextTone.Destructive : ETextTone.Muted}
    style={accessStyles.note}
  >
    {text ?? children}
  </Text>
)

export const accessStyles = StyleSheet.create({
  note: { paddingHorizontal: space(4), paddingVertical: space(2) },
  field: { padding: space(4), gap: space(2) },
})
