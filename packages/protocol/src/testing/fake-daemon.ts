import { randomUUID } from 'node:crypto'

import {
  DaemonEngine,
  MemoryCallStore,
  UNSUPPORTED_PROTECTION,
  daemonToken,
  type DaemonGroupFactory,
} from '../engine'
import { FrameQueue, type DaemonSession, sessionOverQueue } from './client'
import { fakeDaemonGroups } from './fake'
import { MemoryFileSystem } from './memory-files'

export type InMemoryDaemonOptions = {
  version: string
  sandboxName: string
  secret: string
  groups?: ((args: { fs: MemoryFileSystem }) => readonly DaemonGroupFactory[]) | undefined
}

export type InMemoryDaemon = {
  bootId(): string
  runCount(): number
  connect(): DaemonSession
  restart(): Promise<void>
  stop(): Promise<void>
}

export const inMemoryDaemonToken = daemonToken

export const createInMemoryDaemon = async (
  options: InMemoryDaemonOptions,
): Promise<InMemoryDaemon> => {
  const fs = new MemoryFileSystem()
  const store = new MemoryCallStore()
  const groupsOf = options.groups ?? fakeDaemonGroups
  const closers = new Set<() => void>()
  let boot = randomUUID()

  const engineFor = async (bootId: string): Promise<DaemonEngine> => {
    const engine = new DaemonEngine({
      bootId,
      version: options.version,
      secret: options.secret,
      sandboxName: options.sandboxName,
      store,
      groups: groupsOf({ fs }),
      health: () => ({ protection: UNSUPPORTED_PROTECTION }),
      onFault: () => {},
    })
    await engine.open()
    return engine
  }

  let engine = await engineFor(boot)

  const dropAll = async (): Promise<void> => {
    for (const close of [...closers]) close()
    await engine.stop()
  }

  const connect = (): DaemonSession => {
    const queue = new FrameQueue()
    let open = true
    let resolveClosed: (value: { code: number; reason: string }) => void = () => {}
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      resolveClosed = resolve
    })
    const shut = (args: { code: number; reason: string }): void => {
      if (!open) return
      open = false
      closers.delete(drop)
      queueMicrotask(() => {
        link.closed()
        resolveClosed(args)
      })
    }
    const drop = (): void => shut({ code: 1006, reason: 'daemon stopped' })
    closers.add(drop)
    const link = engine.connect({
      send: (text) => {
        if (open) queueMicrotask(() => queue.pushText(text))
      },
      close: ({ code, reason }) => shut({ code, reason }),
    })
    return sessionOverQueue({
      queue,
      sendText: (text) => {
        if (open) queueMicrotask(() => link.receive(text))
      },
      close: () => shut({ code: 1000, reason: '' }),
      closed,
    })
  }

  return {
    bootId: () => boot,
    runCount: () => engine.runCount(),
    connect,
    restart: async () => {
      await dropAll()
      boot = randomUUID()
      engine = await engineFor(boot)
    },
    stop: dropAll,
  }
}
