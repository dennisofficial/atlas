import { describe, expect, it } from 'bun:test'

import { createFinishRequest } from '../finish-request'

describe('createFinishRequest', () => {
  it('runs one settle for every caller waiting on it', async () => {
    const finish = createFinishRequest()
    const runs: number[] = []
    let settle: (text: string) => void = () => undefined
    const task = () =>
      new Promise<string>((resolve) => {
        runs.push(1)
        settle = resolve
      })

    const first = finish.request(task)
    const second = finish.request(task)
    settle('Ask not what your country can do')
    const texts = await Promise.all([first, second])

    expect(runs).toHaveLength(1)
    expect(texts).toEqual(['Ask not what your country can do', 'Ask not what your country can do'])
  })

  it('starts a new settle once the last one finished', async () => {
    const finish = createFinishRequest()
    let runs = 0
    const task = async () => {
      runs += 1
      return `run ${runs}`
    }

    expect(await finish.request(task)).toBe('run 1')
    expect(await finish.request(task)).toBe('run 2')
  })

  it('lets the next caller retry after a failed settle', async () => {
    const finish = createFinishRequest()
    const failing = async (): Promise<string> => {
      throw new Error('the settle died')
    }

    await expect(finish.request(failing)).rejects.toThrow('the settle died')
    expect(await finish.request(async () => 'Ask not')).toBe('Ask not')
  })
})
