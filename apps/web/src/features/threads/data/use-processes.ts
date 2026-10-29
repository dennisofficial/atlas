'use client'

import { useMemo, useState } from 'react'

import {
  killShell,
  startShell,
  stopService,
  type RequestChannel,
} from '@dltech/atlas-client/channel'
import type { ServiceSnapshotWire, ShellSnapshotWire } from '@dltech/atlas-wire/web'

import { isServiceRunning, isShellRunning, ownShellsOf, type ProcessRef } from './processes-model'
import type { RosterChannel } from './roster-source'
import { useProcessLog } from './use-process-log'
import { useRoster } from './use-roster'

export type ProcessesData = {
  loaded: boolean
  shells: readonly ShellSnapshotWire[]
  services: readonly ServiceSnapshotWire[]
  busyId: string | null
  notice: string | null
  selected: ProcessRef | null
  log: string | null
  handleSelect: (ref: ProcessRef | null) => void
  handleKill: (shellId: string) => Promise<void>
  handleStop: (serviceId: string) => Promise<void>
  handleStart: (command: string) => Promise<boolean>
}

type Reply = { ok: true } | { ok: false; reason: string }

const NO_SHELLS: readonly ShellSnapshotWire[] = []
const NO_SERVICES: readonly ServiceSnapshotWire[] = []
const UNANSWERED = 'The pod could not answer'

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : UNANSWERED

export function useProcesses(args: {
  threadId: string
  channel: RosterChannel | null
}): ProcessesData {
  const { threadId, channel } = args
  const roster = useRoster(channel)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<ProcessRef | null>(null)

  const shells = useMemo(
    () => (roster === null ? NO_SHELLS : ownShellsOf({ shells: roster.shells, threadId })),
    [roster, threadId],
  )
  const services = roster?.services ?? NO_SERVICES
  const log = useProcessLog({ channel, threadId, selected, shells, services })

  const stillRunning = (id: string): boolean =>
    shells.some((shell) => shell.shellId === id && isShellRunning(shell)) ||
    services.some((service) => service.serviceId === id && isServiceRunning(service))

  const perform = async (action: {
    id: string
    request: (live: RequestChannel) => Promise<Reply>
  }) => {
    if (channel === null) return
    setNotice(null)
    setBusy(action.id)
    try {
      const reply = await action.request(channel)
      if (reply.ok) return
      setBusy(null)
      setNotice(reply.reason)
    } catch (error) {
      setBusy(null)
      setNotice(reasonOf(error))
    }
  }

  const handleKill = (shellId: string) =>
    perform({ id: shellId, request: (live) => killShell({ channel: live, threadId, shellId }) })

  const handleStop = (serviceId: string) =>
    perform({ id: serviceId, request: (live) => stopService({ channel: live, serviceId }) })

  const handleStart = async (command: string): Promise<boolean> => {
    if (channel === null) return false
    setNotice(null)
    try {
      const reply = await startShell({ channel, threadId, command, description: command })
      if (!reply.ok) setNotice(reply.reason)
      return reply.ok
    } catch (error) {
      setNotice(reasonOf(error))
      return false
    }
  }

  const handleSelect = (ref: ProcessRef | null) => {
    setNotice(null)
    setSelected(ref)
  }

  return {
    loaded: roster !== null,
    shells,
    services,
    busyId: busy !== null && stillRunning(busy) ? busy : null,
    notice,
    selected,
    log,
    handleSelect,
    handleKill,
    handleStop,
    handleStart,
  }
}
