import { describe, expect, it } from 'bun:test'

import { prepareContainerForOperator } from '../operator-setup'
import { FAKE_CONFIG, fakeEngine } from './fake-engine'

describe('prepareContainerForOperator', () => {
  it('creates the sudoers directory before writing the drop-in for minimal images', async () => {
    const { engine, execs } = fakeEngine()

    await prepareContainerForOperator({ engine, containerId: 'minimal-image', config: FAKE_CONFIG })

    const script = execs[0]?.cmd[2] ?? ''
    const directory = script.indexOf('mkdir -p /etc/sudoers.d')
    const dropIn = script.indexOf('> /etc/sudoers.d/atlas-operator')
    expect(directory).toBeGreaterThanOrEqual(0)
    expect(dropIn).toBeGreaterThan(directory)
    expect(execs[0]?.user).toBe('0')
    expect(script).toContain('chmod 0440 /etc/sudoers.d/atlas-operator')
  })
})
