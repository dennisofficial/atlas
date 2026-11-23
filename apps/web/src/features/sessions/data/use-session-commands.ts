'use client'

import { useQuery } from '@tanstack/react-query'

import type { CommandEntry } from '@dltech/atlas-commands'

import { SESSION_COMMANDS_KEY } from '@/lib/cloud-keys'

import { fetchSessionCommands } from './session-commands-api'

const NO_COMMANDS: readonly CommandEntry[] = []

export function useSessionCommands(): readonly CommandEntry[] {
  const query = useQuery({
    queryKey: [SESSION_COMMANDS_KEY],
    queryFn: fetchSessionCommands,
    staleTime: Infinity,
  })
  return query.data ?? NO_COMMANDS
}
