import {
  Button,
  EButtonSize,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import * as Updates from 'expo-updates'
import { ArrowDownToLine, RefreshCw, X } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  EUpdateCardAction,
  EUpdateCardKind,
  type UpdateCardModel,
  updateCardOf,
} from './update-card-state'

const HEADER_HEIGHT = 48
const CARD_TOP_GAP = space(2)
const CHECK_INTERVAL_MS = 5 * 60 * 1000

const updatesEnabled = Platform.OS !== 'web' && Updates.isEnabled && !__DEV__

export const UpdateCardView = ({
  model,
  topOffset,
  working,
  error,
  onAction,
  onDismiss,
}: {
  model: UpdateCardModel
  topOffset: number
  working: boolean
  error: string | null
  onAction: () => void
  onDismiss: () => void
}) => {
  const theme = useTheme()
  const Glyph = model.kind === EUpdateCardKind.Ready ? RefreshCw : ArrowDownToLine
  const detail = error ?? model.detail
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: topOffset }]}>
      <View
        accessibilityRole="summary"
        accessibilityLabel={`${model.title}. ${detail}`}
        style={[styles.card, { backgroundColor: theme.popover, borderColor: theme.border }]}
      >
        <View style={styles.row}>
          <View
            style={[
              styles.glyph,
              { backgroundColor: withAlpha({ color: theme.primary, alpha: 0.12 }) },
            ]}
          >
            {model.kind === EUpdateCardKind.Downloading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Glyph size={16} color={theme.primary} />
            )}
          </View>
          <View style={styles.copy}>
            <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
              {model.title}
            </Text>
            <Text
              size={ETextRole.Xs}
              tone={error === null ? ETextTone.Muted : ETextTone.Destructive}
            >
              {detail}
            </Text>
          </View>
          {model.dismissible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss update"
              hitSlop={10}
              onPress={onDismiss}
              style={styles.dismiss}
            >
              <X size={16} color={theme.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        {model.actionLabel === null ? null : (
          <Button
            label={model.actionLabel}
            size={EButtonSize.Sm}
            loading={working}
            onPress={onAction}
            stretch
          />
        )}
      </View>
    </View>
  )
}

const LiveUpdateCard = () => {
  const insets = useSafeAreaInsets()
  const { isUpdateAvailable, isUpdatePending, isChecking, isDownloading } = Updates.useUpdates()
  const [dismissed, setDismissed] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastCheckedAt = useRef(0)
  const busy = isChecking || isUpdatePending || isDownloading || downloaded

  useEffect(() => {
    if (!isUpdatePending) return
    setDismissed(false)
    setError(null)
  }, [isUpdatePending])

  const checkInBackground = useCallback(() => {
    const now = Date.now()
    if (now - lastCheckedAt.current < CHECK_INTERVAL_MS) return
    lastCheckedAt.current = now
    void Updates.checkForUpdateAsync()
      .then((update) => (update.isAvailable ? Updates.fetchUpdateAsync() : undefined))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !busy) checkInBackground()
    })
    return () => subscription.remove()
  }, [busy, checkInBackground])

  const model = updateCardOf({
    enabled: updatesEnabled,
    dismissed,
    isUpdateAvailable,
    isUpdatePending: isUpdatePending || downloaded,
    isDownloading,
  })
  if (model === null) return null

  const handleAction = () => {
    if (model.action === EUpdateCardAction.Restart) {
      setWorking(true)
      void Updates.reloadAsync().catch(() => {
        setWorking(false)
        setError('Close and reopen Atlas to finish.')
      })
      return
    }
    setWorking(true)
    setError(null)
    void Updates.fetchUpdateAsync()
      .then(() => {
        setDownloaded(true)
        setWorking(false)
      })
      .catch(() => {
        setWorking(false)
        setError('The update could not be downloaded.')
      })
  }

  return (
    <UpdateCardView
      model={model}
      topOffset={insets.top + HEADER_HEIGHT + CARD_TOP_GAP}
      working={working}
      error={error}
      onAction={handleAction}
      onDismiss={() => setDismissed(true)}
    />
  )
}

export const UpdateCard = () => (updatesEnabled ? <LiveUpdateCard /> : null)

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    left: space(4),
    position: 'absolute',
    right: space(4),
    zIndex: 20,
  },
  card: {
    borderRadius: radius(1.4),
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 12,
    gap: space(2.5),
    padding: space(3.5),
    shadowColor: '#000000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    maxWidth: 480,
    width: '100%',
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space(2.5),
  },
  glyph: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  copy: {
    flex: 1,
    gap: space(0.5),
  },
  dismiss: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
})
