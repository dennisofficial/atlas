import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { EServiceStatus } from '@dltech/atlas-core'

import { serviceLogTail } from '../service-log-tail'
import type { ServiceSnapshot } from '../service-process'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const servicesWith = (logPath: string) => {
  const snapshot: ServiceSnapshot = {
    serviceId: 'svc-1',
    command: 'bun run dev',
    description: 'dev server',
    status: EServiceStatus.Running,
    logPath,
    startedAt: '2026-10-28T10:00:00.000Z',
  }
  return { list: () => [snapshot] }
}

const seededLog = (text: string): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-service-log-tail-'))
  homes.push(home)
  const path = join(home, 'svc-1.log')
  writeFileSync(path, text)
  return path
}

describe('serviceLogTail', () => {
  it("reads a service's log tail by id", () => {
    const services = servicesWith(seededLog('booting\nlistening on 3000\n'))

    expect(serviceLogTail({ services, serviceId: 'svc-1', characters: 4000 })).toBe(
      'booting\nlistening on 3000\n',
    )
  })

  it('answers an empty tail for an unknown service id', () => {
    const services = servicesWith(seededLog('booting\n'))

    expect(serviceLogTail({ services, serviceId: 'svc-2', characters: 4000 })).toBe('')
  })
})
