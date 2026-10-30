import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'

import { BUSY_REASON, type RunAttention } from '@dltech/atlas-client/transcript'
import {
  ERunFailureKind,
  ERunRemedy,
  remediesOf,
  toRunId,
  type RunFailure,
} from '@dltech/atlas-core'

import type { TranscriptModel } from '../../store'
import { COMPACT_HINT, SETTINGS_HINT, SWITCH_MODEL_HINT } from '../components/blocks/error-block'
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
  attention?: RunAttention
  onRetry?: () => void
  onResume?: () => void
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
        {...(args.attention === undefined ? {} : { attention: args.attention })}
        {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
        {...(args.onResume === undefined ? {} : { onResume: args.onResume })}
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
    const auth: RunFailure = {
      kind: ERunFailureKind.Auth,
      message: 'invalid x-api-key',
      providerId: 'anthropic',
    }
    const frame = await frameOf({
      model: durable(auth),
      attention: attentionOf({ failure: auth, enabled: true }),
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
    const network: RunFailure = {
      kind: ERunFailureKind.Network,
      message: 'ECONNRESET',
      providerId: 'openai',
    }
    const frame = await frameOf({
      model: durable(network),
      attention: attentionOf({ failure: network, enabled: true }),
      onRetry: () => undefined,
    })

    expect(frame).toContain("Couldn't reach")
    expect(frame).toContain('ctrl+r')
    expect(frame).not.toContain(SETTINGS_HINT)
  })
})

const attentionOf = (args: { failure: RunFailure; enabled: boolean }): RunAttention => ({
  failure: args.failure,
  message: args.failure.message,
  failureSeq: 3,
  runId: toRunId('run-1'),
  remedies: remediesOf(args.failure.kind).map((remedy) => ({
    remedy,
    enabled: remedy === ERunRemedy.Retry ? args.enabled : true,
  })),
  dismissible: true,
  busyReason: args.enabled ? null : BUSY_REASON,
})

const AUTH: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  providerId: 'anthropic',
}

describe('the failed block from the shared attention', () => {
  it('draws copy, remedy hints and ctrl+r', async () => {
    const frame = await frameOf({
      model: durable(AUTH),
      attention: attentionOf({ failure: AUTH, enabled: true }),
      onRetry: () => undefined,
    })
    expect(frame).toContain('rejected the API key')
    expect(frame).toContain(SETTINGS_HINT)
    expect(frame).toContain(SWITCH_MODEL_HINT)
    expect(frame).toContain('ctrl+r retry')
    expect(frame).not.toContain(BUSY_REASON)
  })

  it('names compact for a context overflow', async () => {
    const failure: RunFailure = { kind: ERunFailureKind.ContextOverflow, message: 'too long' }
    const frame = await frameOf({
      model: durable(failure),
      attention: attentionOf({ failure, enabled: true }),
    })
    expect(frame).toContain(COMPACT_HINT)
  })

  it('shows the busy reason and no enabled retry while a run is in flight', async () => {
    const frame = await frameOf({
      model: durable(AUTH),
      attention: attentionOf({ failure: AUTH, enabled: false }),
    })
    expect(frame).toContain(BUSY_REASON)
    expect(frame).toContain('ctrl+r retry')
  })

  it('draws the resume affordance only from a resume-only attention', async () => {
    const resumeOnly: RunAttention = {
      failure: null,
      message: 'stopped',
      failureSeq: null,
      runId: null,
      remedies: [{ remedy: ERunRemedy.Resume, enabled: true }],
      dismissible: false,
      busyReason: null,
    }
    const idle = { ...FAILED_WITH_A_REASON, failure: null }
    expect(
      await frameOf({ model: idle, attention: resumeOnly, onResume: () => undefined }),
    ).toContain('ctrl+r resume')
    expect(await frameOf({ model: idle, onResume: () => undefined })).not.toContain('ctrl+r resume')
  })
})
