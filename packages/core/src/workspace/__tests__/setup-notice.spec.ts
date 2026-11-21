import { describe, expect, it } from 'bun:test'

import { setupFinishedText, setupStartedText } from '../setup-notice'

describe('setupStartedText', () => {
  it('keeps a short single-line script inline', () => {
    const text = setupStartedText({ script: 'bun install' })
    expect(text).toContain('started in the background: `bun install`')
    expect(text).toContain('in the background')
    expect(text).toContain('A notice follows when the script ends.')
    expect(text).not.toContain('```')
  })

  it('fences a multi-line script whole', () => {
    const text = setupStartedText({ script: 'bun install\nbun run build\n' })
    expect(text).toContain('```sh\nbun install\nbun run build\n```')
  })

  it('fences a long single-line script instead of inlining it', () => {
    const text = setupStartedText({ script: `bun install ${'--frozen-lockfile '.repeat(8)}` })
    expect(text).toContain('```sh')
    expect(text).not.toContain('`bun install')
  })

  it('fences a script that carries a backtick rather than inlining it', () => {
    const text = setupStartedText({ script: 'echo `date`' })
    expect(text).toContain('```sh\necho `date`\n```')
  })

  it('caps a long script and counts the lines it hides', () => {
    const lines = Array.from({ length: 26 }, (_, index) => `step-${index + 1}`)
    const text = setupStartedText({ script: lines.join('\n') })
    expect(text).toContain('step-20')
    expect(text).not.toContain('step-21')
    expect(text).toContain('… 6 more lines')
  })

  it('widens the fence when the script contains one', () => {
    const text = setupStartedText({ script: 'echo ```\necho done' })
    expect(text).toContain('````sh\necho ```\necho done\n````')
  })
})

describe('setupFinishedText', () => {
  it('reports a success with the duration and the command', () => {
    const text = setupFinishedText({
      script: 'bun install',
      ok: true,
      durationMs: 12_400,
      output: 'installed 412 packages\n',
    })
    expect(text).toContain('finished after 12s: `bun install`')
    expect(text).toContain('are in place now')
    expect(text).not.toContain('installed 412 packages')
  })

  it('formats a duration under ten seconds with one decimal', () => {
    const text = setupFinishedText({ script: 'true', ok: true, durationMs: 640, output: '' })
    expect(text).toContain('finished after 0.6s')
  })

  it('formats a duration over a minute in minutes and seconds', () => {
    const text = setupFinishedText({ script: 'true', ok: true, durationMs: 125_000, output: '' })
    expect(text).toContain('finished after 2m 5s')
  })

  it('reports a failure with the output tail', () => {
    const text = setupFinishedText({
      script: 'bun install\nexit 3',
      ok: false,
      durationMs: 3_000,
      output: 'resolving\nboom-marker\n',
    })
    expect(text).toContain('failed after 3.0s')
    expect(text).toContain('```sh\nresolving\nboom-marker\n```')
  })

  it('says so when a failure printed nothing', () => {
    const text = setupFinishedText({ script: 'exit 1', ok: false, durationMs: 1_000, output: '  ' })
    expect(text).toContain('ended without any output')
  })

  it('keeps only the tail of a long failing output', () => {
    const text = setupFinishedText({
      script: 'noisy',
      ok: false,
      durationMs: 2_000,
      output: `${'x'.repeat(10_000)}tail-marker`,
    })
    expect(text).toContain('tail-marker')
    expect(text).toContain('…')
    expect(text.length).toBeLessThan(5_000)
    expect(text).not.toContain('x'.repeat(4_100))
  })
})
