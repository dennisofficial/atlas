import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { useCallback, useEffect, useRef } from 'react'
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native'

import { EMessageAuthor, ERowKind, type ThreadRow } from '../rows'
import { MessageRowView } from './message-row'
import { NoticeRowView } from './notice-row'
import { WorkRowView } from './work-row'

const NEAR_BOTTOM_PX = 80

const keyOf = (row: ThreadRow): string => row.id

const tailSizeOf = (rows: readonly ThreadRow[]): number => {
  const last = rows.at(-1)
  return last?.kind === ERowKind.Message ? last.text.length : 0
}

const isStreamingMessage = (row: ThreadRow | undefined): boolean =>
  row?.kind === ERowKind.Message && row.author === EMessageAuthor.Atlas && row.streaming

const WorkingFooter = () => (
  <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
    Working…
  </Text>
)

export const Transcript = ({
  rows,
  working,
  threadId,
}: {
  rows: readonly ThreadRow[]
  working: boolean
  now: number
  threadId: string | undefined
}) => {
  const listRef = useRef<FlatList<ThreadRow>>(null)
  const isNearBottom = useRef(true)
  const tailSize = tailSizeOf(rows)
  const showWorking = working && !isStreamingMessage(rows.at(-1))
  const renderRow = useCallback<ListRenderItem<ThreadRow>>(
    ({ item }) => {
      if (item.kind === ERowKind.Message) return <MessageRowView row={item} threadId={threadId} />
      if (item.kind === ERowKind.Work) return <WorkRowView row={item} />
      return <NoticeRowView row={item} />
    },
    [threadId],
  )

  const scrollToEnd = () => listRef.current?.scrollToEnd({ animated: true })

  useEffect(() => {
    if (isNearBottom.current) scrollToEnd()
  }, [rows.length, tailSize])

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    isNearBottom.current = distance < NEAR_BOTTOM_PX
  }

  const handleContentSizeChange = () => {
    if (isNearBottom.current) scrollToEnd()
  }

  if (rows.length === 0 && !working) {
    return (
      <View style={styles.empty}>
        <Text tone={ETextTone.Muted}>Nothing here yet.</Text>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
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
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      ListFooterComponent={showWorking ? WorkingFooter : undefined}
    />
  )
}

const styles = StyleSheet.create({
  content: {
    gap: space(5),
    padding: space(4),
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: space(1),
    justifyContent: 'center',
    padding: space(4),
  },
})
