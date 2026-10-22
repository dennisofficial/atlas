import { afterEach, describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { UserLayerSyncEngine, type Schedule } from '../engine'
import { EUserLayerTree, type TreeLayout } from '../layout'
import { userLayerTrees } from '../roots'
import type { WatchDirectory } from '../watcher'

import { FakeUserFilesServer, makeDevice, waitFor, writeAt } from './fixture'

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

class DroppingWatch {
  private readonly listeners: ((event: string, filename: string | null) => void)[] = []
  private opened = false

  constructor(private readonly onFirstOpen: () => void = () => undefined) {}

  readonly watch: WatchDirectory = (_directory, _options, listener) => {
    if (!this.opened) {
      this.opened = true
      this.onFirstOpen()
    }
    this.listeners.push(listener)
    return { unref: () => undefined, on: () => undefined, close: () => undefined }
  }

  deliver(): void {
    for (const listener of this.listeners) listener('change', 'late.md')
  }
}

class ManualSchedule {
  readonly scheduled: { run: () => void; delayMs: number; cancelled: boolean }[] = []

  readonly schedule: Schedule = ({ run, delayMs }) => {
    const entry = { run, delayMs, cancelled: false }
    this.scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }

  fire(): void {
    for (const entry of this.scheduled) entry.run()
  }
}

type Rig = {
  server: FakeUserFilesServer
  engine: UserLayerSyncEngine
  skillScans: () => number
  skillFile: (name: string) => string
  lateText: () => string | undefined
}

const engines: UserLayerSyncEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop()
})

async function rig(args: { watch: (rig: () => Rig) => WatchDirectory; schedule: Schedule }): Promise<Rig> {
  const server = new FakeUserFilesServer()
  const device = await makeDevice({ server, name: 'attach' })
  const skillsDirectory = join(device.atlasHome, 'skills')
  await writeAt({ path: join(skillsDirectory, 'first.md'), content: '# first' })
  let scans = 0
  const trees: readonly TreeLayout[] = userLayerTrees({ atlasHome: device.atlasHome, home: device.home }).map((tree) =>
    tree.tree === EUserLayerTree.Skills
      ? {
          ...tree,
          scan: async () => {
            scans += 1
            return tree.scan()
          },
        }
      : tree,
  )
  const built: { current: Rig | null } = { current: null }
  const engine = new UserLayerSyncEngine({
    client: device.client,
    trees,
    stateFile: join(device.atlasHome, 'sync', 'user-layer-sync.json'),
    log: device.log,
    debounceMs: 20,
    watch: args.watch(() => {
      if (built.current === null) throw new Error('rig not built yet')
      return built.current
    }),
    schedule: args.schedule,
  })
  engines.push(engine)
  built.current = {
    server,
    engine,
    skillScans: () => scans,
    skillFile: (name) => join(skillsDirectory, name),
    lateText: () => server.text({ tree: 'skills', path: '.atlas/late.md' }),
  }
  return built.current
}

describe('attach reconcile', () => {
  it('syncs a file written between the boot reconcile and the watch going live', async () => {
    const manual = new ManualSchedule()
    const dropping = (get: () => Rig): DroppingWatch =>
      new DroppingWatch(() => writeFileSync(get().skillFile('late.md'), '# late', 'utf8'))
    let watch: DroppingWatch | null = null
    const attached = await rig({
      watch: (get) => {
        watch ??= dropping(get)
        return watch.watch
      },
      schedule: manual.schedule,
    })

    await attached.engine.start()

    expect(attached.server.text({ tree: 'skills', path: '.atlas/first.md' })).toBe('# first')
    expect(attached.lateText()).toBe('# late')
  })

  it('pushes a file whose event the watch dropped just after attach', async () => {
    const manual = new ManualSchedule()
    const attached = await rig({ watch: () => new DroppingWatch().watch, schedule: manual.schedule })
    await attached.engine.start()

    await writeAt({ path: attached.skillFile('late.md'), content: '# late' })
    await pause(60)
    expect(attached.lateText()).toBeUndefined()

    manual.fire()
    await waitFor(() => attached.lateText() === '# late')
  })

  it('arms the delayed catch-up once, 50 ms after attach', async () => {
    const manual = new ManualSchedule()
    const attached = await rig({ watch: () => new DroppingWatch().watch, schedule: manual.schedule })

    await attached.engine.start()

    expect(manual.scheduled.map((entry) => entry.delayMs)).toEqual([50])
  })
})

describe('steady state', () => {
  it('runs the boot, attach and delayed reconciles, pushes nothing extra and never repeats', async () => {
    const manual = new ManualSchedule()
    const attached = await rig({ watch: () => new DroppingWatch().watch, schedule: manual.schedule })

    await attached.engine.start()
    expect(attached.skillScans()).toBe(2)

    manual.fire()
    await waitFor(() => attached.skillScans() === 3)
    await pause(200)

    expect(attached.skillScans()).toBe(3)
    expect(attached.server.puts).toEqual(['skills/.atlas/first.md'])
    expect(manual.scheduled.length).toBe(1)
  })

  it('skips the delayed catch-up when the watcher already delivered an event', async () => {
    const manual = new ManualSchedule()
    const dropping = new DroppingWatch()
    const attached = await rig({ watch: () => dropping.watch, schedule: manual.schedule })
    await attached.engine.start()
    expect(attached.skillScans()).toBe(2)

    dropping.deliver()
    await waitFor(() => attached.skillScans() === 3)
    manual.fire()
    await pause(100)

    expect(attached.skillScans()).toBe(3)
  })
})

describe('stop', () => {
  it('cancels the delayed catch-up and runs no reconcile afterwards', async () => {
    const manual = new ManualSchedule()
    const attached = await rig({ watch: () => new DroppingWatch().watch, schedule: manual.schedule })
    await attached.engine.start()
    await writeAt({ path: attached.skillFile('late.md'), content: '# late' })

    attached.engine.stop()
    manual.fire()
    await pause(100)

    expect(manual.scheduled[0]?.cancelled).toBe(true)
    expect(attached.skillScans()).toBe(2)
    expect(attached.lateText()).toBeUndefined()
  })

  it('arms nothing and reconciles nothing when stopped while the watch is attaching', async () => {
    const manual = new ManualSchedule()
    const attached = await rig({
      watch: (get) => new DroppingWatch(() => get().engine.stop()).watch,
      schedule: manual.schedule,
    })

    await attached.engine.start()
    manual.fire()
    await pause(100)

    expect(manual.scheduled.length).toBe(0)
    expect(attached.skillScans()).toBe(1)
  })
})
