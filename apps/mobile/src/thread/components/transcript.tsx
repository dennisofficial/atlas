import { space } from '@dltech/atlas-ui/tokens'
import { EFontWeight, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { useCallback, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native'

import { EMessageAuthor, ERowKind, type SessionNameOf, type ThreadRow } from '../rows'
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
import { ThreadRowView } from './thread-row'

const NEAR_TOP_PX = 400

const keyOf = (row: ThreadRow): string => row.id

const UNMEASURED: TTailPin = { offset: 0, contentHeight: 0, viewportHeight: 0 }

const isStreamingMessage = (row: ThreadRow | undefined): boolean =>
  row?.kind === ERowKind.Message && row.author === EMessageAuthor.Atlas && row.streaming

const hasRunningWork = (rows: readonly ThreadRow[]): boolean =>
  rows.some((row) => row.kind === ERowKind.Work && row.running)

const WorkingFooter = () => {
  const theme = useTheme()
  return (
    <View style={styles.working}>
      <ActivityIndicator size="small" color={theme.mutedForeground} />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Working…
      </Text>
    </View>
  )
}

export const Transcript = ({
  rows,
  working,
  threadId,
  sessionId,
  onLoadOlder,
  agentLinks,
  sessionNameOf,
  onOpenAgent,
}: {
  rows: readonly ThreadRow[]
  working: boolean
  now: number
  threadId: string | undefined
  sessionId?: string | undefined
  onLoadOlder?: (() => Promise<number>) | undefined
  agentLinks?: AgentLinks | undefined
  sessionNameOf?: SessionNameOf | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  const listRef = useRef<FlatList<ThreadRow>>(null)
  const tail = useRef<TTailFollow>(FOLLOWING_TAIL)
  const measured = useRef<TTailPin>(UNMEASURED)
  const loadingOlder = useRef(false)
  const keyboardVisible = useKeyboard().inset > 0
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
        />
      </View>
    ),
    [threadId, sessionId, agentLinks, sessionNameOf, onOpenAgent],
  )

  const pinToTail = () => {
    if (!tail.current.following) return
    const offset = pinOffsetOf(measured.current)
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

  if (rows.length === 0 && !working) {
    return (
      <View style={styles.empty}>
        <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
          Nothing here yet
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          Send a message to start.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={keyOf}
      scrollsToTop={false}
      renderItem={renderRow}
      contentContainerStyle={styles.content}
      keyboardDismissMode="none"
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
      ListFooterComponent={showWorking ? WorkingFooter : undefined}
    />
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space(2),
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
