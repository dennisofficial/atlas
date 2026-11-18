'use client'

import { useCallback, useEffect, useRef } from 'react'

export const LOAD_OLDER_THRESHOLD_PX = 400

export function useLoadOlder({
  onLoadOlder,
}: {
  onLoadOlder: (() => Promise<number>) | undefined
}) {
  const loading = useRef(false)
  const exhausted = useRef(false)

  useEffect(() => {
    exhausted.current = false
  }, [onLoadOlder])

  return useCallback(
    (offset: number) => {
      if (onLoadOlder === undefined) return
      if (offset > LOAD_OLDER_THRESHOLD_PX) return
      if (loading.current || exhausted.current) return
      loading.current = true
      void onLoadOlder()
        .then((loaded) => {
          if (loaded === 0) exhausted.current = true
        })
        .catch(() => undefined)
        .finally(() => {
          loading.current = false
        })
    },
    [onLoadOlder],
  )
}
