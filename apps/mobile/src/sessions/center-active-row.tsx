import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import type { LayoutChangeEvent, SectionList } from 'react-native'

import {
  activeRowOf,
  centerMoveOf,
  ECenterMove,
  isActiveCellOf,
  type TActiveRow,
  type TRowFrame,
} from './active-row'
import type { ISessionSection, SectionItem } from './session-sections'

const RETRY_LIMIT = 6
const RETRY_DELAY_MS = 60
const CENTER = 0.5

type TSessionsSectionList = SectionList<SectionItem, ISessionSection>

type TScrollFailure = { index: number; averageItemLength: number }

type TActiveCellReport = {
  activeKey: string | null
  onActiveLayout: (event: LayoutChangeEvent) => void
}

const ActiveCellContext = createContext<TActiveCellReport>({
  activeKey: null,
  onActiveLayout: () => {},
})

export const ActiveCellProvider = ActiveCellContext.Provider

export const useActiveCellLayout = (
  item: unknown,
): ((event: LayoutChangeEvent) => void) | undefined => {
  const { activeKey, onActiveLayout } = useContext(ActiveCellContext)
  return isActiveCellOf({ item, activeKey }) ? onActiveLayout : undefined
}

export const useCenterActiveRow = ({
  sections,
  activeId,
  open,
}: {
  sections: readonly ISessionSection[]
  activeId: string | null
  open: boolean
}): {
  listRef: RefObject<TSessionsSectionList | null>
  cellReport: TActiveCellReport
  handleListLayout: (event: LayoutChangeEvent) => void
  handleScrollToIndexFailed: (failure: TScrollFailure) => void
} => {
  const listRef = useRef<TSessionsSectionList | null>(null)
  const active = useMemo(() => activeRowOf({ sections, activeId }), [sections, activeId])
  const latest = useRef<{ active: TActiveRow | null; open: boolean }>({ active, open })
  latest.current = { active, open }
  const pending = useRef(true)
  const retries = useRef(0)
  const failed = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewportHeight = useRef<number | null>(null)
  const activeFrame = useRef<{ key: string; frame: TRowFrame } | null>(null)

  const center = useCallback(() => {
    const { active: row, open: visible } = latest.current
    if (!visible || !pending.current || row === null) return
    const frame = activeFrame.current?.key === row.key ? activeFrame.current.frame : null
    const move = centerMoveOf({ row: frame, viewportHeight: viewportHeight.current })
    if (move === ECenterMove.Wait) return
    pending.current = false
    if (move === ECenterMove.Stay) return
    failed.current = false
    listRef.current?.scrollToLocation({
      sectionIndex: row.sectionIndex,
      itemIndex: row.itemIndex,
      viewPosition: CENTER,
      animated: false,
    })
    if (failed.current) pending.current = true
  }, [])

  useEffect(() => {
    if (open) return
    pending.current = true
    retries.current = 0
    if (retryTimer.current !== null) clearTimeout(retryTimer.current)
  }, [open])

  useEffect(() => {
    center()
  }, [center, open, active])

  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current)
    },
    [],
  )

  const handleScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: TScrollFailure) => {
      failed.current = true
      if (retries.current >= RETRY_LIMIT) return
      retries.current += 1
      if (averageItemLength > 0) {
        listRef.current
          ?.getScrollResponder()
          ?.scrollTo({ y: averageItemLength * index, animated: false })
      }
      retryTimer.current = setTimeout(center, RETRY_DELAY_MS)
    },
    [center],
  )

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height
      center()
    },
    [center],
  )

  const handleActiveLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const key = latest.current.active?.key
      if (key === undefined) return
      const { y, height } = event.nativeEvent.layout
      activeFrame.current = { key, frame: { top: y, height } }
      center()
    },
    [center],
  )

  const cellReport = useMemo(
    () => ({ activeKey: active?.key ?? null, onActiveLayout: handleActiveLayout }),
    [active?.key, handleActiveLayout],
  )

  return { listRef, cellReport, handleListLayout, handleScrollToIndexFailed }
}
