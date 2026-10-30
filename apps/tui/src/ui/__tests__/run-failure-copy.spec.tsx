import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, toRunId, type RunFailure } from '@dltech/atlas-core'

import type { TranscriptModel } from '../../store'
import { SETTINGS_HINT } from '../components/blocks/error-block'
import { Transcript } from '../components/transcript'
import { grammarsReady, teardown } from '../markdown/__tests__/harness'
import { CWD, FAILED_WITH_A_REASON, FINISHED, HEIGHT, NOW } from './transcript-fixture'

await grammarsReady()

const WIDTH = 120

const durable = (failure: RunFailure): TranscriptModel => ({
  ...FAILED_WITH_A_REASON,
  failure: { message: failure.message, failure, runId: toRunId('run-1') },
})

const frameOf = async (args: {
  model: TranscriptModel
  accountLabel?: string
  onRetry?: () => void
}): Promise<string> => {
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <Transcript
        model={args.model}
        width={WIDTH}
        now={NOW}
        cwd={CWD}
        turn={FINISHED}
        {...(args.accountLabel === undefined ? {} : { accountLabel: args.accountLabel })}
        {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
      />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )
  await setup.flush()
  try {
    return setup.captureCharFrame()
  } finally {
    teardown(setup)
  }
}

describe('the failed block copy', () => {
  it('names the provider and account and points at /auth for an auth failure', async () => {
    const frame = await frameOf({
      model: durable({
        kind: ERunFailureKind.Auth,
        message: 'invalid x-api-key',
        providerId: 'anthropic',
      }),
      accountLabel: 'work key',
      onRetry: () => undefined,
    })

    expect(frame).toContain('rejected the API key')
    expect(frame).toContain('work key')
    expect(frame).toContain(SETTINGS_HINT)
    expect(frame).toContain('ctrl+r')
  })

  it('keeps the raw message and no settings hint for a legacy failure', async () => {
    const frame = await frameOf({
      model: FAILED_WITH_A_REASON,
      onRetry: () => undefined,
    })

    expect(frame).toContain('failed')
    expect(frame).toContain('overloaded_error: the model is overloaded')
    expect(frame).not.toContain(SETTINGS_HINT)
  })

  it('shows retry copy without the settings hint for a network failure', async () => {
    const frame = await frameOf({
      model: durable({
        kind: ERunFailureKind.Network,
        message: 'ECONNRESET',
        providerId: 'openai',
      }),
      onRetry: () => undefined,
    })

    expect(frame).toContain("Couldn't reach")
    expect(frame).toContain('ctrl+r')
    expect(frame).not.toContain(SETTINGS_HINT)
  })
})
