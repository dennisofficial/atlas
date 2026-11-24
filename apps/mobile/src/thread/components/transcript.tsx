import { space } from '@dltech/atlas-ui/tokens'
import { EFontWeight, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { useCallback, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native'

import { EMessageAuthor, ERowKind, type ThreadRow } from '../rows'
import { useKeyboard } from '../../layout/use-keyboard'
import { followsTailAfterUserScroll } from '../tail-follow'
import type { AgentLinks } from '../v2/agent-links'
import { MessageRowView } from './message-row'
import { NoticeRowView } from './notice-row'
import { WorkRowView } from './work-row'

const NEAR_TOP_PX = 400

const keyOf = (row: ThreadRow): string => row.id

const tailSizeOf = (rows: readonly ThreadRow[]): number => {
  const last = rows.at(-1)
  return last?.kind === ERowKind.Message ? last.text.length : 0
}

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
  onOpenAgent,
}: {
  rows: readonly ThreadRow[]
  working: boolean
  now: number
  threadId: string | undefined
  sessionId?: string | undefined
  onLoadOlder?: (() => Promise<number>) | undefined
  agentLinks?: AgentLinks | undefined
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  const listRef = useRef<FlatList<ThreadRow>>(null)
  const followsTail = useRef(true)
  const settled = useRef(false)
  const loadingOlder = useRef(false)
  const keyboardInset = useKeyboard().inset
  const keyboardVisible = keyboardInset > 0
  const tailSize = tailSizeOf(rows)
  const showWorking = working && !isStreamingMessage(rows.at(-1)) && !hasRunningWork(rows)
  const renderRow = useCallback<ListRenderItem<ThreadRow>>(
    ({ item }) => (
      <View style={styles.item}>
        {item.kind === ERowKind.Message ? (
          <MessageRowView row={item} threadId={threadId} sessionId={sessionId} />
        ) : null}
        {item.kind === ERowKind.Work ? <WorkRowView row={item} onOpenAgent={onOpenAgent} /> : null}
        {item.kind === ERowKind.Notice ? (
          <NoticeRowView
            row={item}
            agentId={agentLinks?.byEventId.get(item.id)}
            onOpenAgent={onOpenAgent}
          />
        ) : null}
      </View>
    ),
    [threadId, sessionId, agentLinks, onOpenAgent],
  )

  const scrollToEnd = () => listRef.current?.scrollToEnd({ animated: settled.current })

  useEffect(() => {
    followsTail.current = true
    settled.current = false
  }, [threadId])

  useEffect(() => {
    if (followsTail.current) scrollToEnd()
  }, [rows.length, tailSize])

  useEffect(() => {
    if (keyboardVisible && followsTail.current) scrollToEnd()
  }, [keyboardVisible])

  const handleScrollBeginDrag = () => {
    settled.current = true
    followsTail.current = false
  }

  const handleUserScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    followsTail.current = followsTailAfterUserScroll(event.nativeEvent)
  }

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (followsTail.current) return
    if (onLoadOlder === undefined || loadingOlder.current) return
    if (event.nativeEvent.contentOffset.y > NEAR_TOP_PX) return
    loadingOlder.current = true
    void onLoadOlder().finally(() => {
      loadingOlder.current = false
    })
  }

  const handleContentSizeChange = () => {
    if (followsTail.current) scrollToEnd()
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
      renderItem={renderRow}
      contentContainerStyle={styles.content}
      keyboardDismissMode="none"
      keyboardShouldPersistTaps="handled"
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleUserScrollEnd}
      onMomentumScrollEnd={handleUserScrollEnd}
      scrollEventThrottle={16}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onContentSizeChange={handleContentSizeChange}
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
