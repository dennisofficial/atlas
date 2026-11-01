import { describe, expect, it } from 'bun:test'
import {
  EGithubPrStatesFrame,
  githubPrStatesFrameSchema,
  githubPrStatesInputSchema,
} from '../github-wire'

describe('GitHub observational stream wire contract', () => {
  it('accepts legacy undefined input and bounded optional observations', () => {
    expect(githubPrStatesInputSchema.parse(undefined)).toBeUndefined()
    expect(githubPrStatesInputSchema.parse({})).toEqual({})
    expect(
      githubPrStatesInputSchema.parse({ observe: [{ repo: 'CompAI/App', number: 42 }] }),
    ).toEqual({ observe: [{ repo: 'CompAI/App', number: 42 }] })
    expect(
      githubPrStatesInputSchema.safeParse({
        observe: Array.from({ length: 129 }, (_, index) => ({
          repo: 'compai/app',
          number: index + 1,
        })),
      }).success,
    ).toBe(false)
    expect(
      githubPrStatesInputSchema.safeParse({ observe: [{ repo: 'compai/app', number: 1.5 }] })
        .success,
    ).toBe(false)
    expect(githubPrStatesInputSchema.safeParse({ userId: 'another-user' }).success).toBe(false)
  })
  it('represents coordinator retry and recovery without breaking heartbeat frames', () => {
    expect(
      githubPrStatesFrameSchema.parse({
        type: EGithubPrStatesFrame.ObservationStatus,
        available: false,
        message: 'Retrying',
        retryAfterMs: 45_000,
      }),
    ).toMatchObject({ available: false })
    expect(
      githubPrStatesFrameSchema.parse({
        type: EGithubPrStatesFrame.ObservationStatus,
        available: true,
      }),
    ).toMatchObject({ available: true })
    expect(githubPrStatesFrameSchema.parse({ type: EGithubPrStatesFrame.Heartbeat })).toEqual({
      type: EGithubPrStatesFrame.Heartbeat,
    })
  })
})
