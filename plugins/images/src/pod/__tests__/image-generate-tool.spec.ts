import { describe, expect, it } from 'bun:test'

import { EToolEffect, TAKES_NO_PATHS } from '@dltech/atlas-core'

import { EGenerateRefusal, type GenerateOutcome } from '../generate'
import { ImageGenerateTool } from '../image-generate-tool'
import { SESSION_DIR, generatedOf, gifOf, invoke, liveOutcomeOf, pngOf, rigOf, toolOf } from './rig'

describe('ImageGenerateTool', () => {
  it('tells the model how to write a full image prompt', () => {
    const { description } = toolOf({ rig: rigOf() })

    expect(description).toContain('never this conversation')
    expect(description).toContain('read the source image')
    expect(description).toContain('must stay as they are')
    expect(description).toContain('one instruction per sentence')
  })

  it('refuses without a gateway account and names /auth', async () => {
    const tool = toolOf({ rig: rigOf({ apiKey: undefined }) })
    const outcome = await invoke(tool, { prompt: 'a lighthouse' })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('no Vercel AI Gateway account')
    expect(outcome.ok ? '' : outcome.reason).toContain('/auth')
  })

  it('writes the generated image under the session and hands it back inline', async () => {
    const rig = rigOf()
    const bytes = pngOf({ width: 1024, height: 768, byteLength: 4096 })
    const tool = toolOf({ rig, deps: { generate: generatedOf(bytes) } })

    const outcome = liveOutcomeOf(await invoke(tool, { prompt: 'a lighthouse at dusk' }))
    const path = `${SESSION_DIR}/generated-images/20261123-101112-google_gemini-3.1-flash-image-`
    const written = [...rig.files.keys()]

    expect(rig.made).toEqual([`${SESSION_DIR}/generated-images`])
    expect(written).toHaveLength(1)
    expect(written[0]?.startsWith(path)).toBe(true)
    expect(written[0]?.endsWith('.png')).toBe(true)
    expect(rig.files.get(written[0] ?? '')).toEqual(bytes)
    expect(outcome.output).toEqual({
      path: written[0] ?? '',
      mediaType: 'image/png',
      byteLength: 4096,
      width: 1024,
      height: 768,
      inlined: true,
      model: 'google/gemini-3.1-flash-image',
    })
    expect(outcome.modelText).toBe(
      `Generated ${written[0] ?? ''} with google/gemini-3.1-flash-image — image/png, 1024×768, 4 KB.`,
    )
    expect(outcome.modelParts).toEqual([
      { type: 'text', text: outcome.modelText },
      {
        type: 'image',
        bytes: { kind: 'inline', data: Buffer.from(bytes).toString('base64') },
        mediaType: 'image/png',
        source: written[0] ?? '',
        width: 1024,
        height: 768,
      },
    ])
  })

  it('edits the pictures it is given, with the media types read from their bytes', async () => {
    const files = new Map<string, Uint8Array>([
      ['/atlas/home/uploads/one.png', pngOf({ width: 8, height: 8 })],
      ['/atlas/home/uploads/two.gif', gifOf({ width: 4, height: 4 })],
    ])
    const seen: { images: readonly { bytes: Uint8Array; mediaType: string }[] }[] = []
    const rig = rigOf({ files })

    const generate = async (args: {
      images: readonly { bytes: Uint8Array; mediaType: string }[]
    }): Promise<GenerateOutcome> => {
      seen.push({ images: args.images })
      return { ok: true, bytes: pngOf({ width: 8, height: 8 }), mediaType: 'image/png' }
    }

    const tool = toolOf({ rig, deps: { generate } })
    const outcome = liveOutcomeOf(
      await invoke(tool, {
        prompt: 'make it blue',
        images: ['/atlas/home/uploads/one.png', '/atlas/home/uploads/two.gif'],
        model: 'microsoft/mai-image-2.7',
      }),
    )

    expect(outcome.output).toMatchObject({ model: 'microsoft/mai-image-2.7' })
    expect(seen[0]?.images.map((image) => image.mediaType)).toEqual(['image/png', 'image/gif'])
    expect(seen[0]?.images[0]?.bytes).toEqual(
      files.get('/atlas/home/uploads/one.png') ?? new Uint8Array(),
    )
  })

  it('refuses a relative image path', async () => {
    const tool = toolOf({
      rig: rigOf(),
      deps: { generate: generatedOf(pngOf({ width: 4, height: 4 })) },
    })
    const outcome = await invoke(tool, { prompt: 'edit', images: ['uploads/one.png'] })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('is not an absolute path')
  })

  it('refuses an image it cannot read', async () => {
    const tool = toolOf({
      rig: rigOf(),
      deps: { generate: generatedOf(pngOf({ width: 4, height: 4 })) },
    })
    const outcome = await invoke(tool, {
      prompt: 'edit',
      images: ['/atlas/home/uploads/missing.png'],
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('could not read')
  })

  it('passes a gateway refusal through unchanged', async () => {
    const generate = async (): Promise<GenerateOutcome> => ({
      ok: false,
      refusal: EGenerateRefusal.Failed,
      reason: 'upstream returned 500',
    })
    const tool = toolOf({ rig: rigOf(), deps: { generate } })
    const outcome = await invoke(tool, { prompt: 'a lighthouse' })

    expect(outcome.ok ? '' : outcome.reason).toBe('upstream returned 500')
  })

  it('names the ZDR models to try, and quotes the gateway', async () => {
    const generate = async (): Promise<GenerateOutcome> => ({
      ok: false,
      refusal: EGenerateRefusal.ZeroDataRetention,
      reason: 'refused: zdr_ineligible_model',
    })
    const tool = toolOf({
      rig: rigOf(),
      deps: { generate, zdrModels: async () => ['fake/one-image', 'fake/two-image'] },
    })

    const outcome = await invoke(tool, { prompt: 'a lighthouse', model: 'openai/gpt-image-2' })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toBe(
      "openai/gpt-image-2 cannot run under this gateway's Zero Data Retention policy. Call image_generate again with a model that supports ZDR: fake/one-image, fake/two-image. Gateway said: refused: zdr_ineligible_model",
    )
  })

  it('keeps an image past the inline limit text-only, with the reason', async () => {
    const bytes = pngOf({ width: 1024, height: 1024, byteLength: 6 * 1024 * 1024 })
    const tool = toolOf({ rig: rigOf(), deps: { generate: generatedOf(bytes) } })

    const outcome = liveOutcomeOf(await invoke(tool, { prompt: 'a lighthouse' }))

    expect(outcome.output).toMatchObject({ inlined: false, byteLength: 6 * 1024 * 1024 })
    expect(outcome.modelParts).toBeUndefined()
    expect(outcome.modelText).toContain('It was not sent to you because')
    expect(outcome.modelText).toContain('inline limit')
  })

  it('needs no sdk of its own, so the default route stays the SDK path', () => {
    const rig = rigOf()
    const tool = new ImageGenerateTool(rig.ctx)

    expect(tool.name).toBe('image_generate')
    expect(tool.effect).toBe(EToolEffect.Write)
    expect(tool.isConcurrencySafe?.()).toBe(true)
    expect(tool.inputSchema.safeParse({ prompt: 'x' }).success).toBe(true)
    expect(tool.inputSchema.safeParse({ prompt: '' }).success).toBe(false)
    expect(
      tool.inputSchema.safeParse({ prompt: 'x', images: Array(9).fill('/a.png') }).success,
    ).toBe(false)
    expect(tool.pathFields).toBe(TAKES_NO_PATHS)
  })
})
