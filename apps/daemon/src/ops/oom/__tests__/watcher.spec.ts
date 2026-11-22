import { describe, expect, it } from 'bun:test'

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EOomScope } from '@dltech/atlas-core'
import type { DaemonEvent, PodOomEvent } from '@dltech/atlas-protocol'

import { OomJournal } from '../journal'
import { podOomWatcherOf } from '../watcher'

type Rig = {
  env: Record<string, string | undefined>
  journal: OomJournal
  events: PodOomEvent[]
  setOomKills: (kills: number) => Promise<void>
  home: string
}

const rig = async (): Promise<Rig> => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-oom-watch-'))
  const proc = join(home, 'proc')
  const workGroup = join(home, 'atlas-work')
  await mkdir(proc, { recursive: true })
  await mkdir(workGroup, { recursive: true })
  await writeFile(join(proc, 'meminfo'), 'MemTotal:        4194304 kB\nMemFree:          100 kB\n')
  await writeFile(join(proc, 'vmstat'), 'oom_kill 0\n')
  await writeFile(join(workGroup, 'memory.max'), '2684354560\n')
  const events: PodOomEvent[] = []
  return {
    home,
    journal: new OomJournal(home),
    events,
    env: {
      ATLAS_WORKLOAD_CGROUP: workGroup,
      ATLAS_DAEMON_PROC_ROOT: proc,
    },
    setOomKills: (kills: number) => writeFile(join(proc, 'vmstat'), `oom_kill ${kills}\n`),
  }
}

const publish = (events: PodOomEvent[]) => (event: DaemonEvent) => {
  if (event.type === 'pod.oom') events.push(event)
}

describe('the pod oom watcher', () => {
  it('records growth no command claims as a pod incident', async () => {
    const state = await rig()
    try {
      const watcher = podOomWatcherOf({
        env: state.env,
        journal: state.journal,
        publish: publish(state.events),
        graceMs: 0,
      })
      await state.setOomKills(3)
      watcher.poll()
      expect(state.events).toHaveLength(1)
      const incident = state.events[0]?.incident
      expect(incident?.scope).toBe(EOomScope.Pod)
      expect(incident?.processes).toBe(3)
      expect(incident?.memory).toEqual({
        commandLimitBytes: 2_684_354_560,
        podBytes: 4 * 1024 ** 3,
      })
    } finally {
      await rm(state.home, { recursive: true, force: true })
    }
  })

  it('leaves growth alone when a command claims it inside the grace window', async () => {
    const state = await rig()
    try {
      const watcher = podOomWatcherOf({
        env: state.env,
        journal: state.journal,
        publish: publish(state.events),
        graceMs: 5000,
      })
      await state.setOomKills(2)
      watcher.poll()
      watcher.claim(2)
      watcher.poll()
      expect(state.events).toHaveLength(0)
      expect(state.journal.count).toBe(0)
    } finally {
      await rm(state.home, { recursive: true, force: true })
    }
  })

  it('holds unclaimed growth until the grace window passes', async () => {
    const state = await rig()
    try {
      let clock = 1_000
      const watcher = podOomWatcherOf({
        env: state.env,
        journal: state.journal,
        publish: publish(state.events),
        graceMs: 5000,
        now: () => clock,
      })
      await state.setOomKills(1)
      watcher.poll()
      expect(state.events).toHaveLength(0)
      clock += 5000
      watcher.poll()
      expect(state.events).toHaveLength(1)
      expect(state.events[0]?.incident.processes).toBe(1)
    } finally {
      await rm(state.home, { recursive: true, force: true })
    }
  })

  it('counts growth a command already claimed before the poll saw it once', async () => {
    const state = await rig()
    try {
      const watcher = podOomWatcherOf({
        env: state.env,
        journal: state.journal,
        publish: publish(state.events),
        graceMs: 0,
      })
      watcher.claim(2)
      await state.setOomKills(2)
      watcher.poll()
      expect(state.events).toHaveLength(0)
    } finally {
      await rm(state.home, { recursive: true, force: true })
    }
  })
})
