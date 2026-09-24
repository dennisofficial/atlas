import { describe, expect, it } from 'bun:test'

import { truncatesWatch, waitsByWatching } from '../watching'

describe('a foreground command that only ends when what it watches ends', () => {
  it('catches the gh blocking waits', () => {
    expect(waitsByWatching({ command: 'gh run watch 36029861813 --exit-status --interval 60' })).toBe(true)
    expect(waitsByWatching({ command: 'gh pr checks 272 --watch' })).toBe(true)
  })

  it('catches follow flags, combined or long', () => {
    expect(waitsByWatching({ command: 'tail -f /tmp/serve.log' })).toBe(true)
    expect(waitsByWatching({ command: 'tail -n 100 -F /tmp/serve.log' })).toBe(true)
    expect(waitsByWatching({ command: 'tail --follow=name /tmp/serve.log' })).toBe(true)
    expect(waitsByWatching({ command: 'docker logs -f atlas-api' })).toBe(true)
    expect(waitsByWatching({ command: 'docker container logs --follow atlas-api' })).toBe(true)
    expect(waitsByWatching({ command: 'kubectl logs -f deploy/api' })).toBe(true)
    expect(waitsByWatching({ command: 'journalctl -fu atlas' })).toBe(true)
  })

  it('catches kubectl wait, which blocks until the condition lands', () => {
    expect(waitsByWatching({ command: 'kubectl wait --for=condition=ready pod/api' })).toBe(true)
  })

  it('catches a watch hiding behind a pipe', () => {
    expect(waitsByWatching({ command: 'gh run watch 123 --exit-status 2>&1 | tail -5' })).toBe(true)
  })

  it('leaves one-shot reads alone', () => {
    expect(waitsByWatching({ command: 'gh run view 36029861813' })).toBe(false)
    expect(waitsByWatching({ command: 'gh pr checks 272' })).toBe(false)
    expect(waitsByWatching({ command: 'tail -5 /tmp/serve.log' })).toBe(false)
    expect(waitsByWatching({ command: 'docker logs --tail 50 atlas-api' })).toBe(false)
    expect(waitsByWatching({ command: 'kubectl get pods -w=false' })).toBe(false)
  })

  it('does not mistake a longer word or an argument for the command', () => {
    expect(waitsByWatching({ command: 'echo gh run watch is blocked' })).toBe(false)
    expect(waitsByWatching({ command: 'grep watcher debug.log' })).toBe(false)
    expect(waitsByWatching({ command: 'gh run view --log-failed' })).toBe(false)
  })
})

describe('a CI watch piped through a truncator', () => {
  it('catches tail and head on a watch', () => {
    expect(truncatesWatch({ command: 'gh run watch 123 --exit-status 2>&1 | tail -5' })).toBe(true)
    expect(truncatesWatch({ command: 'gh pr checks 272 --watch | head -20' })).toBe(true)
  })

  it('leaves an untruncated watch alone', () => {
    expect(truncatesWatch({ command: 'gh run watch 123 --exit-status' })).toBe(false)
    expect(truncatesWatch({ command: 'gh pr checks 272 --watch' })).toBe(false)
  })

  it('leaves a truncated one-shot read alone', () => {
    expect(truncatesWatch({ command: 'gh pr checks 272 | tail -3' })).toBe(false)
    expect(truncatesWatch({ command: 'gh run view 123 | tail -3' })).toBe(false)
  })
})
