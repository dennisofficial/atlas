'use client'

import { flushSync } from 'react-dom'

export enum EDetailsMorphSurface {
  Card = 'card',
  Pane = 'pane',
}

export const DETAILS_MORPH_CLASS = '[view-transition-name:session-details-morph]'

export const COMPOSER_MORPH_CLASS = '[view-transition-name:session-composer]'

const SWAP_FLAG = 'sessionDetailsSwap'

const surfacesShown = (): Set<string> => {
  const shown = new Set<string>()
  for (const node of document.querySelectorAll<HTMLElement>('[data-details-morph]')) {
    if (node.getBoundingClientRect().width > 0) shown.add(node.dataset.detailsMorph ?? '')
  }
  return shown
}

export const isSurfaceSwap = ({
  before,
  after,
}: {
  before: ReadonlySet<string>
  after: ReadonlySet<string>
}): boolean => {
  const cardToPane = before.has(EDetailsMorphSurface.Card) && after.has(EDetailsMorphSurface.Pane)
  const paneToCard = before.has(EDetailsMorphSurface.Pane) && after.has(EDetailsMorphSurface.Card)
  return cardToPane || paneToCard
}

const canMorph = (): boolean =>
  typeof document.startViewTransition === 'function' &&
  window.matchMedia('(min-width: 768px)').matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function morphSessionDetails(update: () => void): void {
  if (!canMorph()) return update()
  const root = document.documentElement
  const before = surfacesShown()
  const transition = document.startViewTransition(() => {
    flushSync(update)
    if (isSurfaceSwap({ before, after: surfacesShown() })) root.dataset[SWAP_FLAG] = ''
  })
  void transition.finished.finally(() => delete root.dataset[SWAP_FLAG])
}
