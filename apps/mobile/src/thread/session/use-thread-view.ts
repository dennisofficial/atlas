import { useMemo, useRef } from 'react'

import type { SessionSnapshot } from '@dltech/atlas-client/stream'

import type { ThreadRow } from '../rows'
import { modelOf, viewOf, type ThreadView } from './rows'

export const useThreadView = (args: { snapshot: SessionSnapshot; now: number }): ThreadView => {
  const { snapshot, now } = args
  const model = useMemo(() => modelOf({ snapshot }), [snapshot])
  const settled = useRef<readonly ThreadRow[]>([])
  return useMemo(() => {
    const view = viewOf({ model, snapshot, now, previous: settled.current })
    settled.current = view.rows
    return view
  }, [model, snapshot, now])
}
