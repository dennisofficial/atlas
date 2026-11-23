'use client'

import { useEffect, useRef, type RefObject } from 'react'

import {
  findChangedRow,
  resolveChangedPath,
} from '@/features/threads/panel/changes/focus-changed-path'

import type { CheckoutOption } from '../checkouts/checkout-options'
import { EPaneOpen, type PaneOpenRequest, checkoutPathOf, contextPathOf } from '../panel/pane-open'
import { scopedPathsOf, withScopedPaths } from './changes-memory'
import { changedFilesOf } from './rows'
import type { ChangesState } from './use-changes'

const scrolledIntoView = (row: Element): void => {
  if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
}

export function useOpenRequest(args: {
  sessionId: string
  changes: ChangesState
  options: CheckoutOption[]
  selectedId: string | undefined
  select: (checkoutId: string) => void
  expanded: string[]
  setExpanded: (paths: string[]) => void
  openRequest: PaneOpenRequest | undefined
  requestOpen: (request: { kind: EPaneOpen; path: string }) => void
  consumeOpenRequest: (id: number) => void
}): RefObject<HTMLDivElement | null> {
  const {
    sessionId,
    changes,
    options,
    selectedId,
    select,
    expanded,
    setExpanded,
    openRequest,
    requestOpen,
    consumeOpenRequest,
  } = args
  const scroller = useRef<HTMLDivElement | null>(null)
  const pendingScroll = useRef<string | undefined>(undefined)
  const handled = useRef(0)

  useEffect(() => {
    if (openRequest === undefined || openRequest.kind !== EPaneOpen.Changes) return
    if (handled.current === openRequest.id) return
    if (changes.status !== 'ready') return
    handled.current = openRequest.id
    const target = checkoutPathOf({ path: openRequest.path, options, selectedId })
    const checkout =
      target === undefined
        ? undefined
        : changes.checkouts.find((row) => row.checkoutId === target.checkoutId)
    const relative =
      target === undefined || checkout === undefined
        ? undefined
        : resolveChangedPath({
            files: changedFilesOf({ files: checkout.files, diffs: new Map() }),
            path: target.path,
          })
    if (target === undefined || checkout === undefined || relative === undefined) {
      consumeOpenRequest(openRequest.id)
      requestOpen({
        kind:
          contextPathOf({ path: openRequest.path, sessionId }) === undefined
            ? EPaneOpen.File
            : EPaneOpen.Context,
        path: openRequest.path,
      })
      return
    }
    select(checkout.checkoutId)
    setExpanded(
      withScopedPaths({
        checkoutId: checkout.checkoutId,
        expanded,
        paths: [
          ...new Set([...scopedPathsOf({ checkoutId: checkout.checkoutId, expanded }), relative]),
        ],
      }),
    )
    pendingScroll.current = relative
    consumeOpenRequest(openRequest.id)
  }, [
    openRequest,
    changes,
    options,
    selectedId,
    select,
    expanded,
    setExpanded,
    requestOpen,
    consumeOpenRequest,
    sessionId,
  ])

  useEffect(() => {
    const wanted = pendingScroll.current
    const root = scroller.current
    if (wanted === undefined || root === null) return
    const row = findChangedRow({ root, path: wanted })
    if (row === null) return
    scrolledIntoView(row)
    pendingScroll.current = undefined
  }, [changes, expanded])

  return scroller
}
