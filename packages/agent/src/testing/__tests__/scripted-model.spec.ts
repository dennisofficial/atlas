import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'bun:test'

import { EFinishReason, type Chunk } from '@dltech/atlas-core'

import { ScriptedModel } from '../scripted-model'

const stepArgs = (signal?: AbortSignal) => ({
  assembled: { system: [], messages: [] },
  tools: [],
  signal: signal ?? new AbortController().signal,
})

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'scripted-model-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const deltaText = (chunks: readonly Chunk[]): string =>
  chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => (chunk as { text: string }).text)
    .join('')

describe('ScriptedModel streamMs', () => {
  it('emits the text through onChunk in pieces over the duration', async () => {
    const text = 'a'.repeat(64)
    const chunks: Chunk[] = []
    const model = new ScriptedModel([{ text, streamMs: 200 }])
    const started = Date.now()
    const result = await model.step({
      ...stepArgs(),
      onChunk: (chunk) => {
        chunks.push(chunk)
        return chunk
      },
    })
    const elapsed = Date.now() - started
    expect(chunks[0]?.type).toBe('text-start')
    expect(chunks.at(-1)?.type).toBe('text-end')
    expect(chunks.filter((chunk) => chunk.type === 'text-delta').length).toBe(32)
    expect(deltaText(chunks)).toBe(text)
    expect(elapsed).toBeGreaterThanOrEqual(150)
    expect(result.parts).toEqual([{ type: 'text', text }])
  })

  it('splits a non-divisible length into exactly pieces segments over the full duration', async () => {
    const text = 'x'.repeat(100)
    const chunks: Chunk[] = []
    const model = new ScriptedModel([{ text, streamMs: 320 }])
    const started = Date.now()
    await model.step({
      ...stepArgs(),
      onChunk: (chunk) => {
        chunks.push(chunk)
        return chunk
      },
    })
    const elapsed = Date.now() - started
    const deltas = chunks.filter((chunk) => chunk.type === 'text-delta')
    expect(deltas.length).toBe(32)
    expect(deltaText(chunks)).toBe(text)
    expect(elapsed).toBeGreaterThanOrEqual(300)
    expect(elapsed).toBeLessThan(3_000)
  })

  it('returns the parts streamed so far when aborted mid-stream', async () => {
    const text = 'a'.repeat(64)
    const controller = new AbortController()
    const model = new ScriptedModel([{ text, streamMs: 3_200 }])
    const chunks: Chunk[] = []
    const pending = model.step({
      ...stepArgs(controller.signal),
      onChunk: (chunk) => {
        chunks.push(chunk)
        return chunk
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    controller.abort('handoff')
    const result = await pending
    const streamed = deltaText(chunks)
    expect(streamed.length).toBeGreaterThan(0)
    expect(streamed.length).toBeLessThan(text.length)
    expect(result.parts).toEqual([{ type: 'text', text: streamed }])
    expect(result.toolCalls).toEqual([])
    expect(result.finishReason).toBe(EFinishReason.Stop)
    expect(chunks.at(-1)?.type).not.toBe('text-end')
  })
})

describe('ScriptedModel gateFile', () => {
  it('holds the step until the file exists', async () => {
    const dir = tempDir()
    const gate = join(dir, 'gate')
    const model = new ScriptedModel([{ text: 'gated', gateFile: gate }], undefined, existsSync)
    const pending = model.step(stepArgs())
    await new Promise((resolve) => setTimeout(resolve, 150))
    writeFileSync(gate, 'open')
    const result = await pending
    expect(result.parts).toEqual([{ type: 'text', text: 'gated' }])
  })

  it('throws the abort reason when aborted while gated', async () => {
    const dir = tempDir()
    const gate = join(dir, 'gate')
    const controller = new AbortController()
    const model = new ScriptedModel([{ text: 'gated', gateFile: gate }], undefined, existsSync)
    const pending = model.step(stepArgs(controller.signal))
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort('handoff')
    await expect(pending).rejects.toBe('handoff')
  })
})

describe('ScriptedModel unchanged behaviour', () => {
  it('returns scripted steps without the new options as before', async () => {
    const model = new ScriptedModel([
      { calls: [{ callId: 'c1', name: 'bash', input: { command: 'true' } }] },
      { text: 'done' },
    ])
    const first = await model.step(stepArgs())
    expect(first.toolCalls.length).toBe(1)
    const second = await model.step(stepArgs())
    expect(second.parts).toEqual([{ type: 'text', text: 'done' }])
  })
})
