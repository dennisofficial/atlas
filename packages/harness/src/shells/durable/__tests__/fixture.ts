import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launchDurableShell, type DurableShellHandle, type LaunchArgs } from '../client'

export async function scratchDirectory(): Promise<{ shellDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'durable-spec-'))
  return { shellDir: join(root, 'shell'), cleanup: () => rm(root, { recursive: true, force: true }) }
}

export async function launchOrThrow(args: Omit<LaunchArgs, 'cwd'>): Promise<DurableShellHandle> {
  const outcome = await launchDurableShell({ ...args, cwd: tmpdir(), pollMs: 20 })
  if (!outcome.ok) throw new Error(`launch failed: ${outcome.reason}`)
  return outcome.handle
}

export async function collect({ stream }: { stream: ReadableStream<Uint8Array> }): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    text += decoder.decode(value, { stream: true })
  }
}

export async function readUntil({
  stream,
  pattern,
}: {
  stream: ReadableStream<Uint8Array>
  pattern: string
}): Promise<{ text: string; reader: { read: () => Promise<{ done: boolean; value?: Uint8Array | undefined }> } }> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let text = ''
  while (!text.includes(pattern)) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return { text, reader }
}

export function isAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const launcherScript = join(import.meta.dir, 'launcher-script.ts')
