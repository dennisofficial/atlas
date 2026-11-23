import { type CSSProperties, useSyncExternalStore } from 'react'

const COMPOSER_VIEWPORT_SHARE = 1 / 3
const COMPOSER_MIN_HEIGHT_PX = 96

export const COMPOSER_HEIGHT_CLASS = 'overflow-y-auto max-h-[max(6rem,33svh)]'

export function composerMaxHeight(viewportHeight: number): number {
  return Math.max(COMPOSER_MIN_HEIGHT_PX, Math.floor(viewportHeight * COMPOSER_VIEWPORT_SHARE))
}

function subscribe(onChange: () => void): () => void {
  const target = window.visualViewport ?? window
  target.addEventListener('resize', onChange)
  return () => target.removeEventListener('resize', onChange)
}

function readHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function readServerHeight(): undefined {
  return undefined
}

export function useVisualViewportHeight(): number | undefined {
  return useSyncExternalStore(subscribe, readHeight, readServerHeight)
}

export function useComposerHeightStyle(): CSSProperties | undefined {
  const viewportHeight = useVisualViewportHeight()
  if (viewportHeight === undefined) return undefined
  return { maxHeight: composerMaxHeight(viewportHeight) }
}
