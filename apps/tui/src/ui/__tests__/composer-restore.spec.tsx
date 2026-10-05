import { EImageDelivery } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { insertToken, liveTokens, substitutePastedTokens } from '../composer-tokens'
import { adoptToken, planRestoredTokens, restoredDraft } from '../composer-restore'
import type { DraftImage } from '../draft-images'
import { teardown } from '../markdown/__tests__/harness'

const image = (ordinal: number): DraftImage => ({
  ordinal,
  path: `/tmp/shot-${ordinal}.png`,
  mediaType: 'image/png',
  byteLength: 1234,
  width: 640,
  height: 480,
  delivery: EImageDelivery.Inline,
  tokens: 100,
})

describe('planRestoredTokens', () => {
  it('adopts a whole-message tag at offset zero and appends no second label', () => {
    const plan = planRestoredTokens({ text: '[Image #1]', images: [image(1)] })

    expect(plan.text).toBe('[Image #1]')
    expect(plan.adoptions).toEqual([{ start: 0, end: 10, ordinal: 1 }])
    expect(plan.appends).toEqual([])
  })

  it('adopts an inline tag at the position it already sits, nothing appended', () => {
    const plan = planRestoredTokens({
      text: 'look at [Image #1] closely',
      images: [image(1)],
    })

    expect(plan.text).toBe('look at [Image #1] closely')
    expect(plan.adoptions).toEqual([{ start: 8, end: 18, ordinal: 1 }])
    expect(plan.appends).toEqual([])
  })

  it('adopts several mid-text tags in place, in order', () => {
    const text = 'a [Image #1] b [Image #2] c'
    const plan = planRestoredTokens({ text, images: [image(1), image(2)] })

    expect(plan.text).toBe(text)
    expect(plan.adoptions).toEqual([
      { start: 2, end: 12, ordinal: 1 },
      { start: 15, end: 25, ordinal: 2 },
    ])
    expect(plan.appends).toEqual([])
  })

  it('drops an orphan tag whose picture is gone', () => {
    const plan = planRestoredTokens({ text: 'look at [Image #1] closely', images: [] })

    expect(plan.text).toBe('look at closely')
    expect(plan.adoptions).toEqual([])
    expect(plan.appends).toEqual([])
  })

  it('appends an attachment whose tag the text no longer carries', () => {
    const plan = planRestoredTokens({ text: 'plain words', images: [image(1)] })

    expect(plan.text).toBe('plain words [Image #1] ')
    expect(plan.adoptions).toEqual([])
    expect(plan.appends).toEqual([{ start: 12, end: 22, ordinal: 1 }])
  })

  it('appends at a clean boundary when the text ends mid-whitespace', () => {
    const plan = planRestoredTokens({ text: 'plain words ', images: [image(1)] })

    expect(plan.text).toBe('plain words [Image #1] ')
    expect(plan.appends).toEqual([{ start: 12, end: 22, ordinal: 1 }])
  })

  it('adopts the first of a duplicated ordinal and deletes the copy', () => {
    const plan = planRestoredTokens({
      text: '[Image #1] and again [Image #1]',
      images: [image(1)],
    })

    expect(plan.text).toBe('[Image #1] and again ')
    expect(plan.adoptions).toEqual([{ start: 0, end: 10, ordinal: 1 }])
    expect(plan.appends).toEqual([])
  })

  it('adopts a surviving paste label with the content the caller still holds', () => {
    const text = 'see [Pasted text #1 +5 lines] here'
    const plan = planRestoredTokens({
      text,
      images: [],
      pastes: [{ ordinal: 1, content: 'one\ntwo\nthree\nfour\nfive' }],
    })

    expect(plan.text).toBe(text)
    expect(plan.pastes).toEqual([
      { start: 4, end: 4 + '[Pasted text #1 +5 lines]'.length, content: 'one\ntwo\nthree\nfour\nfive' },
    ])
  })

  it('falls back to the label as content when no paste content survives', () => {
    const text = 'see [Pasted text #1 +5 lines] here'
    const plan = planRestoredTokens({ text, images: [] })

    expect(plan.pastes).toEqual([
      {
        start: 4,
        end: 4 + '[Pasted text #1 +5 lines]'.length,
        content: '[Pasted text #1 +5 lines]',
      },
    ])
  })

  it('keeps a dangling image and an orphan tag on their own tracks', () => {
    const plan = planRestoredTokens({
      text: 'old [Image #9] words',
      images: [image(1)],
    })

    expect(plan.text).toBe('old words [Image #1] ')
    expect(plan.adoptions).toEqual([])
    expect(plan.appends).toEqual([{ start: 10, end: 20, ordinal: 1 }])
  })
})

async function mountEditor(): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>
  editor: TextareaRenderable
}> {
  let editor: TextareaRenderable | null = null
  const setup = await testRender(
    <textarea
      ref={(target) => {
        editor = target
      }}
    />,
    { width: 80, height: 10 },
  )
  await setup.renderOnce()
  if (editor === null) throw new Error('the textarea never mounted')
  return { setup, editor }
}

describe('restoredDraft against a live editor', () => {
  it('restores a whole-message picture as one live token at offset zero, never a duplicate label', async () => {
    const { setup, editor } = await mountEditor()
    try {
      restoredDraft({ editor, text: '[Image #1]', images: [image(1)] })

      expect(editor.plainText).toBe('[Image #1]')
      expect(editor.plainText.split('[Image #1]').length - 1).toBe(1)
      const tokens = liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        start: 0,
        end: 10,
        ordinal: 1,
        slot: { kind: 'image', settled: true },
      })
    } finally {
      await teardown(setup)
    }
  })

  it('re-tokenises a mid-text tag in place rather than appending', async () => {
    const { setup, editor } = await mountEditor()
    try {
      restoredDraft({ editor, text: 'look at [Image #1] closely', images: [image(1)] })

      expect(editor.plainText).toBe('look at [Image #1] closely')
      const tokens = liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        start: 8,
        end: 18,
        ordinal: 1,
        slot: { kind: 'image', settled: true },
      })
    } finally {
      await teardown(setup)
    }
  })

  it('deletes an orphan tag rather than leaving dead text', async () => {
    const { setup, editor } = await mountEditor()
    try {
      restoredDraft({ editor, text: 'look at [Image #1] closely', images: [] })

      expect(editor.plainText).toBe('look at closely')
      expect(liveTokens(editor)).toHaveLength(0)
    } finally {
      await teardown(setup)
    }
  })

  it('appends a dangling attachment at the end, adopted live', async () => {
    const { setup, editor } = await mountEditor()
    try {
      restoredDraft({ editor, text: 'plain words', images: [image(1)] })

      expect(editor.plainText).toBe('plain words [Image #1] ')
      const tokens = liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({ start: 12, end: 22, ordinal: 1 })
    } finally {
      await teardown(setup)
    }
  })

  it('adopts only the first of a duplicated ordinal and deletes the copy', async () => {
    const { setup, editor } = await mountEditor()
    try {
      restoredDraft({ editor, text: '[Image #1] and again [Image #1]', images: [image(1)] })

      expect(editor.plainText).toBe('[Image #1] and again ')
      const tokens = liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({ start: 0, end: 10, ordinal: 1 })
    } finally {
      await teardown(setup)
    }
  })

  it('adopts a surviving paste label with the real content supplied for it', async () => {
    const { setup, editor } = await mountEditor()
    try {
      const text = 'see [Pasted text #1 +5 lines] here'
      const content = 'one\ntwo\nthree\nfour\nfive'
      restoredDraft({ editor, text, images: [], pastes: [{ ordinal: 1, content }] })

      expect(editor.plainText).toBe(text)
      const tokens = liveTokens(editor)
      expect(tokens).toHaveLength(1)
      expect(tokens[0]?.slot).toEqual({
        kind: 'pasted',
        label: '[Pasted text #1 +5 lines]',
        content,
      })
      expect(substitutePastedTokens({ text: editor.plainText, tokens })).toBe(`see ${content} here`)
    } finally {
      await teardown(setup)
    }
  })

  it('falls back to the label itself when the paste content did not survive', async () => {
    const { setup, editor } = await mountEditor()
    try {
      const text = 'see [Pasted text #1 +5 lines] here'
      restoredDraft({ editor, text, images: [] })

      const tokens = liveTokens(editor)
      expect(tokens[0]?.slot).toEqual({
        kind: 'pasted',
        label: '[Pasted text #1 +5 lines]',
        content: '[Pasted text #1 +5 lines]',
      })
      expect(substitutePastedTokens({ text: editor.plainText, tokens })).toBe(text)
    } finally {
      await teardown(setup)
    }
  })
})

describe('adoptToken', () => {
  it('marks an existing span without inserting text', async () => {
    const { setup, editor } = await mountEditor()
    try {
      editor.replaceText('look at [Image #1] closely')

      const token = adoptToken({
        editor,
        start: 8,
        end: 18,
        slot: { kind: 'image', ordinal: 1, settled: true, image: image(1) },
      })

      expect(editor.plainText).toBe('look at [Image #1] closely')
      expect(token).toMatchObject({ start: 8, end: 18, ordinal: 1 })
      expect(liveTokens(editor)).toHaveLength(1)
    } finally {
      await teardown(setup)
    }
  })

  it('interleaves with inserted tokens, each keeping its own span', async () => {
    const { setup, editor } = await mountEditor()
    try {
      editor.replaceText('an adopted ')

      const adopted = adoptToken({
        editor,
        start: 3,
        end: 10,
        slot: { kind: 'image', ordinal: 1, settled: true, image: image(1) },
      })
      editor.cursorOffset = editor.plainText.length
      const inserted = insertToken({
        editor,
        label: '[Image #2]',
        slot: { kind: 'image', ordinal: 2, settled: true, image: image(2) },
      })

      expect(editor.plainText).toBe('an adopted [Image #2] ')
      expect(adopted.start).toBe(3)
      expect(inserted.start).toBe('an adopted '.length)
      expect(liveTokens(editor)).toHaveLength(2)
    } finally {
      await teardown(setup)
    }
  })
})

