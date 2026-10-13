import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { FakeUserFilesServer, makeDevice, readAt, writeAt, type Device } from './fixture'

const devices: Device[] = []
afterEach(() => {
  for (const device of devices.splice(0)) device.engine.stop()
})

describe('MEMORY.md', () => {
  it('union-merges concurrent index edits instead of forking a conflict copy', async () => {
    const server = new FakeUserFilesServer()
    const a = await makeDevice({ server, name: 'a' })
    const b = await makeDevice({ server, name: 'b' })
    devices.push(a, b)
    const base = '# Memory\n\n- [Alpha](alpha.md) — first\n'
    await writeAt({ path: join(a.atlasHome, 'memory', 'MEMORY.md'), content: base })
    await a.engine.start()
    await b.engine.pullNow()

    await writeAt({ path: join(b.atlasHome, 'memory', 'MEMORY.md'), content: `${base}- [Beta](beta.md) — from B\n` })
    await b.engine.reconcileNow()
    await writeAt({ path: join(a.atlasHome, 'memory', 'MEMORY.md'), content: `${base}- [Gamma](gamma.md) — from A\n` })
    await a.engine.pullNow()

    const merged = await readAt(join(a.atlasHome, 'memory', 'MEMORY.md'))
    expect(merged).toContain('- [Alpha](alpha.md) — first')
    expect(merged).toContain('- [Beta](beta.md) — from B')
    expect(merged).toContain('- [Gamma](gamma.md) — from A')

    await a.engine.reconcileNow()
    expect(server.text({ tree: 'memory', path: 'user/MEMORY.md' })).toBe(merged)
    await b.engine.pullNow()
    expect(await readAt(join(b.atlasHome, 'memory', 'MEMORY.md'))).toBe(merged)
  })

  it('lets the remote line win when both sides rewrote the same entry', async () => {
    const server = new FakeUserFilesServer()
    const a = await makeDevice({ server, name: 'a' })
    const b = await makeDevice({ server, name: 'b' })
    devices.push(a, b)
    await writeAt({ path: join(a.atlasHome, 'memory', 'MEMORY.md'), content: '- [Alpha](alpha.md) — old\n' })
    await a.engine.start()
    await b.engine.pullNow()

    await writeAt({ path: join(b.atlasHome, 'memory', 'MEMORY.md'), content: '- [Alpha](alpha.md) — remote\n' })
    await b.engine.reconcileNow()
    await writeAt({ path: join(a.atlasHome, 'memory', 'MEMORY.md'), content: '- [Alpha](alpha.md) — local\n' })
    await a.engine.pullNow()

    expect(await readAt(join(a.atlasHome, 'memory', 'MEMORY.md'))).toBe('- [Alpha](alpha.md) — remote\n')
  })
})
