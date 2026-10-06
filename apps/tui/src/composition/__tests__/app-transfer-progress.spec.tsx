import { describe, expect, it } from 'bun:test'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { formatBytes } from '../../ui/components/transfer-meter'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { promiseGate, until } from './app-fixture'
import { mount, speaking } from './app-container-cloud-fixture'

await grammarsReady()

type Mounted = Awaited<ReturnType<typeof mount>>

const WAIT_MS = 20_000
const MEBIBYTE = 1024 * 1024
const TOTAL = 20 * MEBIBYTE
const TRANSFER_ID = 'workspace-upload'
const LABEL = 'uploading workspace'

const nextFrame = async (mounted: Mounted): Promise<string> => {
  try {
    return await mounted.nextFrame()
  } catch (error) {
    if (error instanceof Error && error.message.includes('visual idle')) return ''
    throw error
  }
}

const frameHolding = async (args: {
  mounted: Mounted
  holds: (frame: string) => boolean
  what: string
}): Promise<string> => {
  const deadline = Date.now() + WAIT_MS
  let frame = ''
  while (Date.now() < deadline) {
    frame = await nextFrame(args.mounted)
    if (args.holds(frame)) return frame
    await settle(10)
  }
  throw new Error(`waited past ${WAIT_MS} ms for ${args.what}\n\n${frame}`)
}

const shown = ({ mounted, text }: { mounted: Mounted; text: string }): Promise<string> =>
  frameHolding({ mounted, holds: (frame) => frame.includes(text), what: JSON.stringify(text) })

const cleared = ({ mounted, text }: { mounted: Mounted; text: string }): Promise<string> =>
  frameHolding({
    mounted,
    holds: (frame) => !frame.includes(text),
    what: `${JSON.stringify(text)} to go away`,
  })

const gatedCreate = (args: { bridge: ReturnType<typeof fakeBridge>; readings: readonly number[] }) => {
  const { gate, release } = promiseGate()
  const create = args.bridge.sandboxes.create.bind(args.bridge.sandboxes)
  args.bridge.sandboxes.create = async (createArgs) => {
    for (const transferredBytes of args.readings) {
      createArgs.onTransferProgress?.({
        transferId: TRANSFER_ID,
        label: LABEL,
        transferredBytes,
        totalBytes: TOTAL,
        complete: transferredBytes === TOTAL,
      })
    }
    await gate
    return create(createArgs)
  }
  return { release }
}

describe('transfer progress through the lift flow', () => {
  it('shows the meter while the create gate is held', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const gated = gatedCreate({ bridge, readings: [5 * MEBIBYTE] })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')

      const partial = await shown({ mounted, text: LABEL })
      expect(partial).toContain('MOVING TO THE CLOUD')
      expect(partial).toContain('25%')
      expect(partial).toContain(`${formatBytes(5 * MEBIBYTE)} / ${formatBytes(TOTAL)}`)
      expect(partial).toContain('█')
      expect(bridge.created).toHaveLength(0)
    } finally {
      gated.release()
      await mounted.done()
    }
  }, 60_000)

  it('keeps the drawer and the covered composer after the transfer reads 100% until released', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const gated = gatedCreate({ bridge, readings: [5 * MEBIBYTE, TOTAL] })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')

      const done = await shown({ mounted, text: '100%' })
      expect(done).toContain(`✓ ${LABEL}`)
      expect(done).toContain(`${formatBytes(TOTAL)} / ${formatBytes(TOTAL)}`)
      expect(done).toContain('MOVING TO THE CLOUD')

      await mounted.typeText('typed behind the drawer')
      await settle(200)
      const held = await nextFrame(mounted)
      expect(held).toContain('MOVING TO THE CLOUD')
      expect(held).toContain(`✓ ${LABEL}`)
      expect(held).not.toContain('typed behind the drawer')
      expect(bridge.attached).toHaveLength(0)

      gated.release()
      expect(await until({ holds: async () => bridge.attached.length === 1, within: WAIT_MS })).toBe(true)
      await cleared({ mounted, text: 'MOVING TO THE CLOUD' })
      expect(await nextFrame(mounted)).not.toContain(LABEL)

      await mounted.typeText('typed after the drawer')
      expect(await shown({ mounted, text: 'typed after the drawer' })).toContain('typed after the drawer')
    } finally {
      gated.release()
      await mounted.done()
    }
  }, 60_000)
})
