'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ensureDeclaredServices,
  listDeclaredServices,
  restartService,
  stopService,
  type RequestChannel,
} from '@dltech/atlas-client/channel'
import type { DeclaredServicesViewWire } from '@dltech/atlas-wire/web'

import { sameViewOf } from './services-model'
import type { RosterChannel } from './roster-source'
import { useRoster } from './use-roster'

export type ServiceFailure = { name: string; reason: string }

export type DeclaredServicesData = {
  view: DeclaredServicesViewWire | null
  busyName: string | null
  error: ServiceFailure | null
  handleStart: (name: string) => Promise<void>
  handleStop: (args: { name: string; serviceId: string }) => Promise<void>
  handleRestart: (args: { name: string; serviceId: string }) => Promise<void>
}

type Outcome = { ok: true } | { ok: false; reason: string }

const UNANSWERED = 'The pod could not answer'

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : UNANSWERED

const unreadyOf = (
  results: readonly { ready: boolean; reason?: string | undefined }[],
): Outcome => {
  const unready = results.find((result) => !result.ready && result.reason !== undefined)
  return unready?.reason === undefined ? { ok: true } : { ok: false, reason: unready.reason }
}

export function useDeclaredServices(channel: RosterChannel | null): DeclaredServicesData {
  const roster = useRoster(channel)
  const [view, setView] = useState<DeclaredServicesViewWire | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<ServiceFailure | null>(null)
  const latest = useRef(view)
  latest.current = view

  const refetch = useCallback(async () => {
    if (channel === null) return
    try {
      const reply = await listDeclaredServices({ channel })
      if (!reply.ok) return
      if (sameViewOf({ previous: latest.current, next: reply.view })) return
      setView(reply.view)
    } catch {
      return
    }
  }, [channel])

  useEffect(() => {
    if (channel === null) {
      setView(null)
      return
    }
    void refetch()
  }, [channel, roster, refetch])

  const perform = async (args: {
    name: string
    request: (live: RequestChannel) => Promise<Outcome>
  }) => {
    if (channel === null) return
    setError(null)
    setBusyName(args.name)
    try {
      const outcome = await args.request(channel)
      if (!outcome.ok) setError({ name: args.name, reason: outcome.reason })
    } catch (failure) {
      setError({ name: args.name, reason: reasonOf(failure) })
    }
    setBusyName(null)
    await refetch()
  }

  const handleStart = (name: string) =>
    perform({
      name,
      request: async (live) => {
        const reply = await ensureDeclaredServices({ channel: live, names: [name] })
        return reply.ok ? unreadyOf(reply.results) : reply
      },
    })

  const handleRestart = (args: { name: string; serviceId: string }) =>
    perform({
      name: args.name,
      request: async (live) => {
        const reply = await restartService({ channel: live, serviceId: args.serviceId })
        return reply.ok ? { ok: true } : reply
      },
    })

  const handleStop = (args: { name: string; serviceId: string }) =>
    perform({
      name: args.name,
      request: async (live) => {
        const reply = await stopService({ channel: live, serviceId: args.serviceId })
        return reply.ok ? { ok: true } : { ok: false, reason: reply.reason }
      },
    })

  return { view, busyName, error, handleStart, handleStop, handleRestart }
}
