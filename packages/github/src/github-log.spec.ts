import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { githubLogOf, resetGithubLogSink, setGithubLogSink } from './github-log'

describe('githubLogOf', () => {
  beforeEach(() => {
    resetGithubLogSink()
  })

  afterEach(() => {
    mock.restore()
    resetGithubLogSink()
  })

  it('prefixes every line with the context on the default sink', () => {
    const log = spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = spyOn(console, 'error').mockImplementation(() => undefined)

    const logger = githubLogOf('GithubCall')
    logger.log('one')
    logger.warn('two')
    logger.error(new Error('three'))

    expect(log).toHaveBeenCalledWith('[GithubCall] one')
    expect(warn).toHaveBeenCalledWith('[GithubCall] two')
    expect(String(error.mock.calls[0]?.[0])).toContain('[GithubCall] Error: three')
  })

  it('reaches a sink installed after the logger was built', () => {
    const lines: string[] = []
    const logger = githubLogOf('GithubBudget')

    setGithubLogSink(() => ({
      log: (message) => lines.push(message),
      warn: (message) => lines.push(message),
      error: (message) => lines.push(String(message)),
    }))
    logger.warn('a warning')

    expect(lines).toEqual(['a warning'])
  })

  it('restores the console sink on reset', () => {
    setGithubLogSink(() => ({
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }))
    const log = spyOn(console, 'log').mockImplementation(() => undefined)

    resetGithubLogSink()
    githubLogOf('GithubCall').log('after reset')

    expect(log).toHaveBeenCalledWith('[GithubCall] after reset')
  })
})
