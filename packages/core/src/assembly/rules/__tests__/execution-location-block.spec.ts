import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '../../../execution/location'
import { executionLocationNote } from '../execution-location-block'

const noteFor = (location: EExecutionLocation, mounts: readonly string[] = []): string =>
  executionLocationNote({ location, mounts })

describe('executionLocationNote', () => {
  it('names the host so a return from a sandbox is explicit', () => {
    const note = noteFor(EExecutionLocation.Host)

    expect(note).toContain('Execution location: host')
    expect(note).not.toContain('mounted')
  })

  it('describes Docker as a local harness with routed tools and external MCP connections', () => {
    const note = noteFor(EExecutionLocation.Docker)

    expect(note).toContain('Docker container')
    expect(note).toContain('harness runs locally')
    expect(note).toContain('bash and file tools are routed')
    expect(note).toContain('MCP servers remain external connections')
  })

  it('lists supplied mounts without promising an active-worktree mount', () => {
    const note = noteFor(EExecutionLocation.Docker, ['/var/lib/postgres'])

    expect(note).toContain('Additional configured mounts: /var/lib/postgres')
    expect(note).not.toContain('project directory is mounted')
  })

  it('does not claim a read-only gitconfig or any git configuration restriction', () => {
    for (const location of Object.values(EExecutionLocation)) {
      const note = noteFor(location)
      expect(note).not.toContain('gitconfig')
      expect(note).not.toContain('read-only')
    }
  })

  it('places the whole cloud session in an isolated machine accessible through the terminal client', () => {
    const note = noteFor(EExecutionLocation.Cloud, ['/ignored'])

    expect(note).toContain('You are inside an isolated cloud machine')
    expect(note).toContain('Vercel sandbox where the harness and its tools run together')
    expect(note).toContain('terminal client')
    expect(note).toContain('does not have direct filesystem access')
    expect(note).not.toContain('Docker')
    expect(note).not.toContain('mounted at its usual path')
    expect(note).not.toMatch(/upload|transfer/)
  })

  it('distinguishes an existing session resume from a handoff into a new session', () => {
    const note = noteFor(EExecutionLocation.Cloud)

    expect(note).toContain('Each new cloud session has its own isolated environment')
    expect(note).toContain('Resuming this session continues its persisted workspace')
    expect(note).toContain('a handoff creates a new session and environment')
    for (const location of [EExecutionLocation.Host, EExecutionLocation.Docker]) {
      expect(noteFor(location)).not.toContain('Each new cloud session')
    }
  })

  it('gives minimal publication facts without browser-policy or tool-availability assumptions', () => {
    for (const location of [EExecutionLocation.Docker, EExecutionLocation.Cloud]) {
      const note = noteFor(location)
      expect(note).toContain('For exposed services')
      expect(note).toContain('0.0.0.0')
      expect(note).toContain('returned URL')
      expect(note).not.toContain('service_start')
      expect(note).not.toContain('cookies')
    }
    expect(noteFor(EExecutionLocation.Host)).not.toContain('For exposed services')
  })
})
