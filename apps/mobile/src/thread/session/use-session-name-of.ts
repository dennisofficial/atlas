import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { useMemo, useRef } from 'react'

import type { SessionNameOf } from '../rows'
import { sessionTitlesOf, type SessionTitles } from './session-titles'

export const useSessionNameOf = (
  sessionRows: readonly StreamSessionRow[] | undefined,
): SessionNameOf => {
  const settled = useRef<SessionTitles>(new Map())
  const titles = useMemo(() => {
    settled.current = sessionTitlesOf({ rows: sessionRows, previous: settled.current })
    return settled.current
  }, [sessionRows])
  return useMemo<SessionNameOf>(() => (sender) => titles.get(sender), [titles])
}
