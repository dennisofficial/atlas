import { afterEach, describe, expect, it } from 'bun:test'

import { THREAD, open } from './declared-fixture'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const yamlWith = (command: string): string =>
  `services:\n  web:\n    command: ${command}\n    port: 24610\n`

describe('manual restart of a declared service', () => {
  it('runs the command currently in services.yaml, not the one it started with', async () => {
    const { registry, processes, file } = open({ yaml: yamlWith('serve old') })
    closers.push(() => registry.closeAll())
    await registry.ensureDeclared({ threadId: THREAD, names: ['web'] })
    file.yaml = yamlWith('serve new')

    const restarted = await registry.restart({ serviceId: registry.list()[0]?.serviceId ?? '' })

    expect(restarted.ok).toBe(true)
    expect(processes.servicesStarted().map((one) => one.cmd[2])).toEqual(['serve old', 'serve new'])
  })
})
