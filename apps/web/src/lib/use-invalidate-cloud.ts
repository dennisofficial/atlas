'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

export function useInvalidateCloud(): (keys: readonly string[]) => Promise<void> {
  const client = useQueryClient()
  return useCallback(
    async (keys) => {
      await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })))
    },
    [client],
  )
}
