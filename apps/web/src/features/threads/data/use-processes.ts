'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  killShell,
  readServiceLog,
  readShellOutput,
  startShell,
  stopService,
} from '@dltech/atlas-client/channel'
import type { RosterWire, ServiceSnapshotWire, ShellSnapshotWire } from '@dltech/atlas-wire/web'

import {
  EProcessKind,
  ownShellsOf,
  PEEKED_CHARACTERS,
  SERVICE_LOG_POLL_MS,
  type ProcessRef,
} from './processes-model'
import type { RosterChannel } from './roster-source'
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

type HeldUntilPush = { value: string; roster: RosterWire | null }

type HeldLog = { key: string; text: string | null }

const NO_SHELLS: readonly ShellSnapshotWire[] = []
const NO_SERVICES: readonly ServiceSnapshotWire[] = []

const keyOf = (ref: ProcessRef): string => `${ref.kind}:${ref.id}`

const valueWhileUnpushed = (args: {
  held: HeldUntilPush | null
  roster: RosterWire | null
}): string | null =>
  args.held !== null && args.held.roster === args.roster ? args.held.value : null

export function useProcesses(args: {
  threadId: string
  channel: RosterChannel | null
}): ProcessesData {
  const { threadId, channel } = args
  const roster = useRoster(channel)
  const [busy, setBusy] = useState<HeldUntilPush | null>(null)
  const [notice, setNotice] = useState<HeldUntilPush | null>(null)
  const [selected, setSelected] = useState<ProcessRef | null>(null)
  const [held, setHeld] = useState<HeldLog | null>(null)
  const latestRoster = useRef(roster)

  useEffect(() => {
    latestRoster.current = roster
  }, [roster])

  const shells = useMemo(
    () => (roster === null ? NO_SHELLS : ownShellsOf({ shells: roster.shells, threadId })),
    [roster, threadId],
  )
  const services = roster?.services ?? NO_SERVICES

  const selectedShell =
    selected?.kind === EProcessKind.Shell
      ? shells.find((shell) => shell.shellId === selected.id)
      : undefined
  const selectedServiceId =
    selected?.kind === EProcessKind.Service &&
    services.some((service) => service.serviceId === selected.id)
      ? selected.id
      : undefined
  const shellId = selectedShell?.shellId
  const printed = selectedShell?.totalCharacters

  useEffect(() => {
    if (channel === null || shellId === undefined) return undefined
    let active = true
    void readShellOutput({ channel, threadId, shellId, characters: PEEKED_CHARACTERS }).then(
      (reply) => {
        if (!active) return
        const text = reply.ok ? reply.text : null
        setHeld({ key: keyOf({ kind: EProcessKind.Shell, id: shellId }), text })
      },
    )
    return () => {
      active = false
    }
  }, [channel, threadId, shellId, printed])

  useEffect(() => {
    if (channel === null || selectedServiceId === undefined) return undefined
    let active = true
    const key = keyOf({ kind: EProcessKind.Service, id: selectedServiceId })
    const read = () =>
      void readServiceLog({
        channel,
        serviceId: selectedServiceId,
        characters: PEEKED_CHARACTERS,
      }).then((text) => {
        if (active) setHeld({ key, text })
      })
    read()
    const interval = setInterval(read, SERVICE_LOG_POLL_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [channel, selectedServiceId])

  const refuse = (reason: string) => {
    setBusy(null)
    setNotice({ value: reason, roster: latestRoster.current })
  }

  const handleKill = async (id: string) => {
    if (channel === null) return
    setBusy({ value: id, roster })
    const reply = await killShell({ channel, threadId, shellId: id })
    if (!reply.ok) refuse(reply.reason)
  }

  const handleStop = async (serviceId: string) => {
    if (channel === null) return
    setBusy({ value: serviceId, roster })
    const reply = await stopService({ channel, serviceId })
    if (!reply.ok) refuse(reply.reason)
  }

  const handleStart = async (command: string): Promise<boolean> => {
    if (channel === null) return false
    const reply = await startShell({ channel, threadId, command, description: command })
    if (!reply.ok) setNotice({ value: reply.reason, roster: latestRoster.current })
    return reply.ok
  }

  const log = selected !== null && held?.key === keyOf(selected) ? held.text : null

  return {
    loaded: roster !== null,
    shells,
    services,
    busyId: valueWhileUnpushed({ held: busy, roster }),
    notice: valueWhileUnpushed({ held: notice, roster }),
    selected,
    log,
    handleSelect: setSelected,
    handleKill,
    handleStop,
    handleStart,
  }
}
