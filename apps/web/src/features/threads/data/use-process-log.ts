'use client'

import { useEffect, useRef, useState } from 'react'

import { readServiceLog, readShellOutput, type RequestChannel } from '@dltech/atlas-client/channel'
import type { ServiceSnapshotWire, ShellSnapshotWire } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'
import {
  EProcessKind,
  PEEKED_CHARACTERS,
  SERVICE_LOG_POLL_MS,
  SHELL_READ_GAP_MS,
  type ProcessRef,
} from './processes-model'

type HeldLog = { key: string; text: string | null }

const keyOf = (ref: ProcessRef): string => `${ref.kind}:${ref.id}`

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function useProcessLog(args: {
  channel: RequestChannel | null
  threadId: string
  selected: ProcessRef | null
  shells: readonly ShellSnapshotWire[]
  services: readonly ServiceSnapshotWire[]
}): string | null {
  const { channel, threadId, selected, shells, services } = args
  const [held, setHeld] = useState<HeldLog | null>(null)
  const shell =
    selected?.kind === EProcessKind.Shell
      ? shells.find((candidate) => candidate.shellId === selected.id)
      : undefined
  const shellId = shell?.shellId
  const printed = shell?.totalCharacters
  const serviceId =
    selected?.kind === EProcessKind.Service &&
    services.some((service) => service.serviceId === selected.id)
      ? selected.id
      : undefined
  const printedRef = useRef(printed)
  const lastRead = useRef<number | undefined>(undefined)
  const shellReads = useRef<{ trigger: () => void } | null>(null)

  useEffect(() => {
    printedRef.current = printed
    if (printed !== lastRead.current) shellReads.current?.trigger()
  }, [printed])

  useEffect(() => {
    if (channel === null || shellId === undefined) return undefined
    const key = keyOf({ kind: EProcessKind.Shell, id: shellId })
    let active = true
    const runner = createCoalescedRunner({
      run: async () => {
        lastRead.current = printedRef.current
        const reply = await readShellOutput({
          channel,
          threadId,
          shellId,
          characters: PEEKED_CHARACTERS,
        }).catch(() => null)
        if (active) setHeld({ key, text: reply?.ok === true ? reply.text : null })
        await pause(SHELL_READ_GAP_MS)
      },
    })
    shellReads.current = runner
    runner.trigger()
    return () => {
      active = false
      runner.stop()
      shellReads.current = null
    }
  }, [channel, threadId, shellId])

  useEffect(() => {
    if (channel === null || serviceId === undefined) return undefined
    const key = keyOf({ kind: EProcessKind.Service, id: serviceId })
    let active = true
    const runner = createCoalescedRunner({
      run: async () => {
        const text = await readServiceLog({
          channel,
          serviceId,
          characters: PEEKED_CHARACTERS,
        }).catch(() => '')
        if (active) setHeld({ key, text })
      },
    })
    runner.trigger()
    const interval = setInterval(runner.trigger, SERVICE_LOG_POLL_MS)
    return () => {
      active = false
      runner.stop()
      clearInterval(interval)
    }
  }, [channel, serviceId])

  return selected !== null && held?.key === keyOf(selected) ? held.text : null
}
