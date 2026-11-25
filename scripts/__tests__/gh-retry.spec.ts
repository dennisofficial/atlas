import { describe, expect, it } from 'bun:test'

import {
  delayMsOf,
  decideNext,
  describeFailure,
  ECall,
  EFailureKind,
  ENext,
  type Failure,
  failureOf,
  parseGhRetryArgs,
  runGh,
  statusOf,
} from '../gh-retry'

const http = (args: { status: number; alreadyExists?: boolean }): Failure => ({
  kind: EFailureKind.Http,
  status: args.status,
  alreadyExists: args.alreadyExists ?? false,
})

const NETWORK: Failure = { kind: EFailureKind.Network }

const harness = (results: readonly { code: number; output: string }[]) => {
  const calls: string[][] = []
  const sleeps: number[] = []
  return {
    calls,
    sleeps,
    spawn: (argv: readonly string[]) => {
      calls.push([...argv])
      return results[calls.length - 1] ?? { code: 0, output: '' }
    },
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  }
}

describe('statusOf', () => {
  it('reads the status gh prints in front of its message', () => {
    expect(
      statusOf(
        'HTTP 502: Error creating policy (https://uploads.github.com/repos/o/r/releases/1/assets?name=a.dmg)',
      ),
    ).toBe(502)
    expect(
      statusOf('HTTP 404: Not Found (https://api.github.com/repos/o/r/releases/assets/2)'),
    ).toBe(404)
    expect(statusOf('something else went wrong')).toBeNull()
  })
})

describe('failureOf', () => {
  it('leaves a successful call with no failure', () => {
    expect(failureOf({ code: 0, output: '' })).toBeNull()
  })

  it('classifies a 5xx and a 4xx as http', () => {
    expect(failureOf({ code: 1, output: 'HTTP 500: Server Error' })).toEqual(http({ status: 500 }))
    expect(failureOf({ code: 1, output: 'HTTP 401: Bad credentials' })).toEqual(
      http({ status: 401 }),
    )
  })

  it('marks a 422 that names an existing asset', () => {
    expect(
      failureOf({
        code: 1,
        output:
          'HTTP 422: Validation Failed (https://uploads.github.com/repos/o/r/releases/1/assets) already_exists',
      }),
    ).toEqual(http({ status: 422, alreadyExists: true }))
    expect(failureOf({ code: 1, output: 'HTTP 422: Validation Failed' })).toEqual(
      http({ status: 422 }),
    )
  })

  it('classifies a dropped socket as a network failure and an unknown message as unknown', () => {
    expect(failureOf({ code: 1, output: 'read tcp: connection reset by peer' })).toEqual(NETWORK)
    expect(failureOf({ code: 1, output: 'failed to run git: exit status 128' })).toEqual({
      kind: EFailureKind.Unknown,
    })
  })
})

describe('decideNext', () => {
  it('retries a 5xx twice and gives up on the third attempt', () => {
    const attempts = [1, 2, 3].map((attempt) =>
      decideNext({ call: ECall.Upload, attempt, failure: http({ status: 502 }) }),
    )
    expect(attempts).toEqual([ENext.Retry, ENext.Retry, ENext.Fail])
  })

  it('fails a 4xx at once', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(decideNext({ call: ECall.Create, attempt: 1, failure: http({ status }) })).toBe(
        ENext.Fail,
      )
    }
  })

  it('repeats the 404 an upload answers, never the one a create answers', () => {
    expect(decideNext({ call: ECall.Upload, attempt: 1, failure: http({ status: 404 }) })).toBe(
      ENext.Retry,
    )
    expect(decideNext({ call: ECall.Create, attempt: 1, failure: http({ status: 404 }) })).toBe(
      ENext.Fail,
    )
  })

  it('treats a create that finds the release an earlier attempt made as done and an upload that finds the asset as retryable', () => {
    const existing = http({ status: 422, alreadyExists: true })
    expect(decideNext({ call: ECall.Create, attempt: 1, failure: existing })).toBe(ENext.Fail)
    expect(decideNext({ call: ECall.Create, attempt: 2, failure: existing })).toBe(ENext.Succeed)
    expect(decideNext({ call: ECall.Upload, attempt: 1, failure: existing })).toBe(ENext.Retry)
    expect(decideNext({ call: ECall.Upload, attempt: 3, failure: existing })).toBe(ENext.Fail)
  })

  it('retries a network failure and fails an unknown one at once', () => {
    expect(decideNext({ call: ECall.Upload, attempt: 1, failure: NETWORK })).toBe(ENext.Retry)
    expect(decideNext({ call: ECall.Upload, attempt: 3, failure: NETWORK })).toBe(ENext.Fail)
    expect(
      decideNext({ call: ECall.Upload, attempt: 1, failure: { kind: EFailureKind.Unknown } }),
    ).toBe(ENext.Fail)
  })
})

describe('delayMsOf', () => {
  it('waits 2 s after the first attempt and 4 s after the second', () => {
    expect(delayMsOf(1)).toBe(2000)
    expect(delayMsOf(2)).toBe(4000)
  })
})

describe('describeFailure', () => {
  it('names the status or the class of failure', () => {
    expect(describeFailure(http({ status: 502 }))).toBe('HTTP 502')
    expect(describeFailure(NETWORK)).toBe('network error')
    expect(describeFailure({ kind: EFailureKind.Unknown })).toBe('unknown error')
  })
})

describe('runGh', () => {
  it('retries a 5xx twice, sleeps 2 s then 4 s, and succeeds on the third call', async () => {
    const fake = harness([
      { code: 1, output: 'HTTP 502: Error creating policy' },
      { code: 1, output: 'HTTP 500' },
      { code: 0, output: 'uploaded' },
    ])
    await runGh({
      call: ECall.Upload,
      argv: ['gh', 'release', 'upload', 'tui-v1.2.3', 'a.dmg'],
      spawn: fake.spawn,
      sleep: fake.sleep,
    })
    expect(fake.calls).toHaveLength(3)
    expect(fake.sleeps).toEqual([2000, 4000])
  })

  it('fails a 4xx on the first call and never sleeps', async () => {
    const fake = harness([{ code: 1, output: 'HTTP 401: Bad credentials' }])
    const run = runGh({
      call: ECall.Upload,
      argv: ['gh', 'release', 'upload', 'tui-v1.2.3', 'a.dmg'],
      spawn: fake.spawn,
      sleep: fake.sleep,
    })
    await expect(run).rejects.toThrow('HTTP 401')
    expect(fake.calls).toHaveLength(1)
    expect(fake.sleeps).toEqual([])
  })

  it('repeats a 404 on an upload and finishes on the second call', async () => {
    const fake = harness([
      {
        code: 1,
        output:
          'HTTP 404: Not Found (https://uploads.github.com/repos/o/r/releases/1/assets?name=macos-arm64-Atlas.dmg)',
      },
      { code: 0, output: 'uploaded' },
    ])
    await runGh({
      call: ECall.Upload,
      argv: ['gh', 'release', 'upload', 'tui-v1.2.3', 'macos-arm64-Atlas.dmg'],
      spawn: fake.spawn,
      sleep: fake.sleep,
    })
    expect(fake.calls).toHaveLength(2)
    expect(fake.sleeps).toEqual([2000])
  })

  it('gives up after three 5xx answers', async () => {
    const fake = harness([
      { code: 1, output: 'HTTP 502: Server Error' },
      { code: 1, output: 'HTTP 502: Server Error' },
      { code: 1, output: 'HTTP 503: Service Unavailable' },
    ])
    const run = runGh({
      call: ECall.Upload,
      argv: ['gh', 'release', 'upload', 'tui-v1.2.3', 'a.dmg'],
      spawn: fake.spawn,
      sleep: fake.sleep,
    })
    await expect(run).rejects.toThrow('failed on attempt 3: HTTP 503')
    expect(fake.calls).toHaveLength(3)
    expect(fake.sleeps).toEqual([2000, 4000])
  })

  it('counts a create that finds the release after a 5xx as done', async () => {
    const fake = harness([
      { code: 1, output: 'HTTP 502: Server Error (https://api.github.com/o/r/releases)' },
      {
        code: 1,
        output: 'HTTP 422: Validation Failed (https://api.github.com/o/r/releases) already_exists',
      },
    ])
    await runGh({
      call: ECall.Create,
      argv: ['gh', 'release', 'create', 'tui-v1.2.3', '--generate-notes'],
      spawn: fake.spawn,
      sleep: fake.sleep,
    })
    expect(fake.calls).toHaveLength(2)
    expect(fake.sleeps).toEqual([2000])
  })
})

describe('parseGhRetryArgs', () => {
  it('takes the call and the gh command after the separator', () => {
    expect(parseGhRetryArgs(['--call=upload', '--', 'gh', 'release', 'upload', 'x'])).toEqual({
      call: ECall.Upload,
      command: ['gh', 'release', 'upload', 'x'],
    })
  })

  it('refuses a missing separator, a missing call, an unknown call and an unknown flag', () => {
    expect(() => parseGhRetryArgs(['--call=upload', 'gh', 'release'])).toThrow('usage')
    expect(() => parseGhRetryArgs(['--call=upload', '--'])).toThrow('usage')
    expect(() => parseGhRetryArgs(['--', 'gh', 'release'])).toThrow('usage')
    expect(() => parseGhRetryArgs(['--call=clone', '--', 'gh', 'release'])).toThrow('unknown call')
    expect(() => parseGhRetryArgs(['--call=upload', '--retry=9', '--', 'gh'])).toThrow(
      'unknown flags: --retry=9',
    )
  })
})
