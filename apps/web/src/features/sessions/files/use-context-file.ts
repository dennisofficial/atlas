'use client'

import { useCallback, useState } from 'react'

import { recallContextFile, rememberContextFile } from './files-memory'

export function useContextFile(sessionId: string) {
  const [contextPath, setContextPathState] = useState(() => recallContextFile(sessionId))
  const setContextPath = useCallback(
    (path: string | undefined) => {
      rememberContextFile({ sessionId, path })
      setContextPathState(path)
    },
    [sessionId],
  )
  return { contextPath, setContextPath }
}
