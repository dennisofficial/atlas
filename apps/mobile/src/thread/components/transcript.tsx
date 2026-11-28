import type { BootView } from '@dltech/atlas-client/session'
import { space } from '@dltech/atlas-ui/tokens'
import { EFontWeight, ETextRole, ETextTone, Spinner, Text, useTheme } from '@dltech/atlas-ui-native'
import { type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  FlatList,
  Platform,
  type ListRenderItem,
  type NativeScrollEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native'

import type { MessageActionHandlers } from '../message-actions'
import { EMessageAuthor, ERowKind, type SessionNameOf, type ThreadRow } from '../rows'
import { listBottomPaddingOf, nativeBottomInsetOf } from '../../layout/transcript-inset'
import { useKeyboard } from '../../layout/use-keyboard'
import {
  EScrollSignal,
  FOLLOWING_TAIL,
  pinOffsetOf,
  tailFollowAfter,
  type TTailFollow,
  type TTailPin,
} from '../tail-follow'
import type { AgentLinks } from '../session/agent-links'
import type { BackgroundWait } from '../session/background-wait'
import { BackgroundWaitRow } from './background-wait-row'
import { BootRowView } from './boot-row'
import { QueuedTurns, type QueuedTurnsProps } from './queued-turns'
import { ThreadRowView } from './thread-row'
import type { SignInAgainHandler } from './sign-in-row'

const NEAR_TOP_PX = 400

const keyOf = (row: ThreadRow): string => row.id

const UNMEASURED: TTailPin = { offset: 0, contentHeight: 0, viewportHeight: 0 }

const NO_RETRY = () => undefined

const isStreamingMessage = (row: ThreadRow | undefined): boolean =>
  row?.kind === ERowKind.Message && row.author === EMessageAuthor.Atlas && row.streaming

const hasRunningWork = (rows: readonly ThreadRow[]): boolean =>
  rows.some((row) => row.kind === ERowKind.Work && row.running)

const WorkingFooter = () => {
  const theme = useTheme()
  return (
    <View style={styles.working}>
      <Spinner color={theme.mutedForeground} />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Working…
      </Text>
    </View>
  )
}

const EmptyTranscript = () => (
  <View style={styles.empty}>
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
      Nothing here yet
    </Text>
    <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
      Send a message to start.
    </Text>
  </View>
)

export const Transcript = ({
  rows,
  working,
  placeholder,
  now,
  boot,
  onRetryBoot,
  threadId,
  sessionId,
  onLoadOlder,
  agentLinks,
  sessionNameOf,
  onOpenAgent,
  bottomInset = 0,
  queued,
  background,
  messageActions,
  onSignInAgain,
}: {
  rows: readonly ThreadRow[]
  working: boolean
  placeholder?: ReactElement | undefined
  now: number
  boot?: BootView | null
  onRetryBoot?: () => void
  threadId: string | undefined
  sessionId?: string | undefined
  onLoadOlder?: (() => Promise<number>) | undefined
  agentLinks?: AgentLinks | undefined
  sessionNameOf?: SessionNameOf | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
  bottomInset?: number
  queued?: QueuedTurnsProps | undefined
  background?: BackgroundWait | null | undefined
  messageActions?: MessageActionHandlers | undefined
  onSignInAgain?: SignInAgainHandler | undefined
}) => {
  const listRef = useRef<FlatList<ThreadRow>>(null)
  const tail = useRef<TTailFollow>(FOLLOWING_TAIL)
  const measured = useRef<TTailPin>(UNMEASURED)
  const loadingOlder = useRef(false)
  const keyboardVisible = useKeyboard().inset > 0
  const safeArea = useSafeAreaInsets()
  const nativeBottom = nativeBottomInsetOf({ platform: Platform.OS, safeBottom: safeArea.bottom })
  const insets = useMemo(() => {
    const padding = listBottomPaddingOf({ clearance: bottomInset, nativeBottom })
    return {
      content: [styles.content, { paddingBottom: space(2) + padding }],
      indicator: { bottom: padding },
    }
  }, [bottomInset, nativeBottom])
  const showWorking = working && !isStreamingMessage(rows.at(-1)) && !hasRunningWork(rows)
  const renderRow = useCallback<ListRenderItem<ThreadRow>>(
    ({ item }) => (
      <View style={styles.item}>
        <ThreadRowView
          row={item}
          threadId={threadId}
          sessionId={sessionId}
          agentLinks={agentLinks}
          sessionNameOf={sessionNameOf}
          onOpenAgent={onOpenAgent}
          messageActions={messageActions}
          onSignInAgain={onSignInAgain}
        />
      </View>
    ),
    [threadId, sessionId, agentLinks, sessionNameOf, onOpenAgent, messageActions, onSignInAgain],
  )

  const pinToTail = () => {
    if (!tail.current.following) return
    const offset = pinOffsetOf({ ...measured.current, nativeBottom })
    if (offset === undefined) return
    measured.current = { ...measured.current, offset }
    listRef.current?.scrollToOffset({ offset, animated: false })
  }

  useEffect(() => {
    tail.current = FOLLOWING_TAIL
  }, [threadId])

  useEffect(() => {
    if (keyboardVisible) pinToTail()
  }, [keyboardVisible])

  const signalOf = (signal: EScrollSignal) => (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    tail.current = tailFollowAfter({ state: tail.current, signal, metrics: event.nativeEvent })
  }

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    measured.current = { ...measured.current, offset: event.nativeEvent.contentOffset.y }
    if (tail.current.following) return
    if (onLoadOlder === undefined || loadingOlder.current) return
    if (event.nativeEvent.contentOffset.y > NEAR_TOP_PX) return
    loadingOlder.current = true
    void onLoadOlder().finally(() => {
      loadingOlder.current = false
    })
  }

  const handleContentSizeChange = (_width: number, contentHeight: number) => {
    measured.current = { ...measured.current, contentHeight }
    pinToTail()
  }

  const handleLayout = (event: LayoutChangeEvent) => {
    measured.current = { ...measured.current, viewportHeight: event.nativeEvent.layout.height }
    pinToTail()
  }

  const header =
    boot === undefined || boot === null ? null : (
      <BootRowView view={boot} now={now} onRetry={onRetryBoot ?? NO_RETRY} />
    )

  const hasQueued = queued !== undefined && queued.queued.rows.length > 0
  const waiting = !working && background !== undefined && background !== null
  const footer =
    !showWorking && !hasQueued && !waiting ? undefined : (
      <>
        {showWorking ? <WorkingFooter /> : null}
        {waiting ? (
          <View style={styles.item}>
            <BackgroundWaitRow wait={background} />
          </View>
        ) : null}
        {queued === undefined ? null : (
          <QueuedTurns
            {...queued}
            threadId={threadId}
            sessionId={sessionId}
            sessionNameOf={sessionNameOf}
          />
        )}
      </>
    )

  const emptyView =
    placeholder ??
    (working || header !== null || hasQueued || waiting ? undefined : <EmptyTranscript />)

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={keyOf}
      // iOS 27 scrolls this list to the top on any tap on the native bar, header buttons included.
      // ScrollToTopGuard and a UIControl overlay both failed on the iPhone Duo; only this holds.
      // Do not remove. https://github.com/react/react-native/issues/56061
      scrollsToTop={false}
      renderItem={renderRow}
      contentInsetAdjustmentBehavior="automatic"
      scrollToOverflowEnabled
      contentContainerStyle={insets.content}
      scrollIndicatorInsets={insets.indicator}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onScroll={handleScroll}
      onScrollBeginDrag={signalOf(EScrollSignal.BeginDrag)}
      onScrollEndDrag={signalOf(EScrollSignal.EndDrag)}
      onMomentumScrollBegin={signalOf(EScrollSignal.BeginMomentum)}
      onMomentumScrollEnd={signalOf(EScrollSignal.EndMomentum)}
      scrollEventThrottle={16}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onContentSizeChange={handleContentSizeChange}
      onLayout={handleLayout}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={emptyView}
      ListFooterComponent={footer}
    />
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space(4),
    paddingTop: space(1),
  },
  item: {
    paddingVertical: space(1.5),
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: space(1),
    justifyContent: 'center',
    padding: space(6),
  },
  working: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingVertical: space(3),
  },
})
