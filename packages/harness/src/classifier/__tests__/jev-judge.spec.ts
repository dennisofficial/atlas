import { describe, expect, it } from 'bun:test'

import { EConsultation, EJudgment, type Brief } from '@dltech/atlas-core'

import { JevJudge, type JevFetcher } from '../jev-judge'

const BRIEF: Brief = {
  system: 'you are a second pair of eyes',
  prompt: 'the call about to run',
  targets: ['worktree:eng-412-sidebar'],
}

const answering = (body: unknown, status = 200): JevFetcher => async () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const noulBody = (noul: number) => ({
  model: 'laya',
  answers: { danger: { type: 'noul', noul, rl_agent: { act_probability: 1 } } },
  usage: { input_tokens: 100, output_tokens: 0 },
})

const judgeWith = (fetcher: JevFetcher): JevJudge =>
  new JevJudge({ config: { baseUrl: 'https://decisions.example/v1', token: 'sk-test' }, fetcher })

const consult = (judge: JevJudge) => judge.consult({ brief: BRIEF, signal: AbortSignal.timeout(5000) })

describe('JevJudge', () => {
  it('proceeds when the probability is under the threshold', async () => {
    const consultation = await consult(judgeWith(answering(noulBody(0.11))))
    expect(consultation.kind).toBe(EConsultation.Judged)
    if (consultation.kind !== EConsultation.Judged) return
    expect(consultation.verdict.judgment).toBe(EJudgment.Proceed)
    expect(consultation.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('checks when the probability crosses the threshold, naming a target', async () => {
    const consultation = await consult(judgeWith(answering(noulBody(0.72))))
    if (consultation.kind !== EConsultation.Judged) throw new Error('expected a verdict')
    expect(consultation.verdict.judgment).toBe(EJudgment.Check)
    expect(consultation.verdict.reason).toContain('worktree:eng-412-sidebar')
  })

  it('posts the jev wire shape with the bearer token', async () => {
    let seen: { url: unknown; init: RequestInit | undefined } | undefined
    const fetcher: JevFetcher = async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify(noulBody(0.1)))
    }

    await consult(judgeWith(fetcher))

    expect(seen?.url).toBe('https://decisions.example/v1')
    const headers = seen?.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(seen?.init?.body))
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe(BRIEF.prompt)
    expect(body.questions.danger.type).toBe('noul')
  })

  it('omits the authorization header without a token', async () => {
    let seen: RequestInit | undefined
    const fetcher: JevFetcher = async (_url, init) => {
      seen = init
      return new Response(JSON.stringify(noulBody(0.1)))
    }
    const judge = new JevJudge({ config: { baseUrl: 'http://localhost:8080', token: undefined }, fetcher })

    await consult(judge)

    expect((seen?.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('is unreachable on a non-200', async () => {
    const consultation = await consult(judgeWith(answering({}, 401)))
    expect(consultation.kind).toBe(EConsultation.Unreachable)
    if (consultation.kind !== EConsultation.Unreachable) return
    expect(consultation.fault).toContain('401')
  })

  it('is unreachable on an unreadable body', async () => {
    const consultation = await consult(judgeWith(answering({ answers: {} })))
    expect(consultation.kind).toBe(EConsultation.Unreachable)
  })

  it('is unreachable when the fetch throws', async () => {
    const fetcher: JevFetcher = async () => {
      throw new Error('socket hangup')
    }
    const consultation = await consult(judgeWith(fetcher))
    expect(consultation.kind).toBe(EConsultation.Unreachable)
    if (consultation.kind !== EConsultation.Unreachable) return
    expect(consultation.fault).toContain('socket hangup')
  })

  it('is unreachable when the answer outlasts the timeout', async () => {
    const fetcher: JevFetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const judge = new JevJudge({
      config: { baseUrl: 'https://decisions.example/v1', token: undefined },
      fetcher,
      timeoutMs: 20,
    })

    const consultation = await consult(judge)
    expect(consultation.kind).toBe(EConsultation.Unreachable)
  })
})
