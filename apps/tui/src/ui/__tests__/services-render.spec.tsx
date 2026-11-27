import { EServiceStatus } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'

import { Services } from '../components/services'
import { teardown } from '../markdown/__tests__/harness'
import { buildServiceRows } from '../services-model'

const WIDTH = 40

const HEIGHT = 30

const LOG_CELLS = 34

const STARTED_AT = '2026-08-27T12:00:00.000Z'

const [ROW] = buildServiceRows({
  declared: null,
  services: [
    {
      serviceId: 'svc_1',
      command: 'bun run dev',
      description: 'bun run dev',
      status: EServiceStatus.Running,
      logPath: '/tmp/svc.log',
      startedAt: STARTED_AT,
    },
  ],
})

const LOG_LINE = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'

async function rowsOf(log: string): Promise<string[]> {
  const setup = await testRender(
    <box flexDirection="row" width={WIDTH} height={HEIGHT}>
      <Services
        width={WIDTH}
        rows={ROW === undefined ? [] : [ROW]}
        now={Date.parse(STARTED_AT) + 5_000}
        selected={ROW}
        log={log}
        onStart={() => undefined}
        onRestart={() => undefined}
        onStop={() => undefined}
        onDismiss={() => undefined}
      />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

  try {
    await setup.flush()
    return setup.captureCharFrame().split('\n')
  } finally {
    await teardown(setup)
  }
}

describe('the services drawer log', () => {
  it('wraps a long log line inside the drawer, beside the scrollbar column', async () => {
    const rows = await rowsOf(`${LOG_LINE}\n`)
    const head = LOG_LINE.slice(0, LOG_CELLS)
    const tail = LOG_LINE.slice(LOG_CELLS)

    const headRow = rows.findIndex((row) => row.includes(head))
    expect(headRow).toBeGreaterThan(-1)
    expect(rows[headRow]?.includes(`${head}${tail.slice(0, 1)}`)).toBe(false)
    expect(rows[headRow + 1]?.trim().startsWith(tail)).toBe(true)
  })
})
