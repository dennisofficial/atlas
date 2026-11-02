'use client'

import { useEffect, useState } from 'react'

import type { ChangesLayout } from '@dltech/atlas-ui/ai/changes-panel'

export const CHANGES_LAYOUT_KEY = 'atlas.changes.layout'

export function parseChangesLayout(raw: string | null): ChangesLayout {
  return raw === 'tree' ? 'tree' : 'flat'
}

export function useChangesLayout() {
  const [layout, setLayoutState] = useState<ChangesLayout>('flat')

  useEffect(() => {
    try {
      setLayoutState(parseChangesLayout(window.localStorage.getItem(CHANGES_LAYOUT_KEY)))
    } catch {}
  }, [])

  const setLayout = (next: ChangesLayout) => {
    setLayoutState(next)
    try {
      window.localStorage.setItem(CHANGES_LAYOUT_KEY, next)
    } catch {}
  }

  return { layout, setLayout }
}
