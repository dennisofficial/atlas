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

  it('describes cloud as a Vercel sandbox running harness and execution, with the terminal as a client', () => {
    const note = noteFor(EExecutionLocation.Cloud, ['/ignored'])

    expect(note).toContain('Vercel sandbox')
    expect(note).toContain('harness and the execution both run')
    expect(note).toContain('terminal is only a client')
    expect(note).toContain('copy of the project, not a live mount')
    expect(note).not.toContain('Docker')
    expect(note).not.toContain('mounted at its usual path')
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
