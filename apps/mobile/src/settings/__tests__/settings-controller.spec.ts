import { describe, expect, it } from 'bun:test'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { memoryJsonStore } from '../../storage/json-store'
import { createSettingsController, type SettingsGateway } from '../settings-controller'
import { jsonSettingsStorage } from '../settings-store'

const gatewayOf = (args: {
  list?: () => Promise<{ settings: readonly { key: string; value: string }[] }>
  patch?: (values: Record<string, string | null>) => Promise<void>
}): SettingsGateway => ({
  list: args.list ?? (() => Promise.resolve({ settings: [] })),
  patch: args.patch ?? (() => Promise.resolve()),
})

const setup = (args: Parameters<typeof gatewayOf>[0] = {}) => {
  const storage = jsonSettingsStorage({ store: memoryJsonStore() })
  const controller = createSettingsController({ gateway: () => gatewayOf(args), storage })
  return { controller, storage }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the settings controller', () => {
  it('falls back to the registry before anything loads', () => {
    const { controller } = setup()

    expect(controller.read({ key: 'model.effort', schema: z.string() })).toBe('medium')
    expect(controller.read({ key: 'model.id', schema: z.string() })).toBe('')
  })

  it('paints the persisted values, then the server ones', async () => {
    let answer: () => void = () => undefined
    const { controller, storage } = setup({
      list: () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({ settings: [{ key: 'model.id', value: encodeSettingValue('openai/gpt') }] })
        }),
    })
    await storage.save(new Map([['model.id', 'anthropic/claude']]))

    const loading = controller.load()
    await settle()
    expect(controller.getState().values.get('model.id')).toBe('anthropic/claude')

    answer()
    await loading
    expect(controller.read({ key: 'model.id', schema: z.string() })).toBe('openai/gpt')
    expect(controller.getState().ready).toBe(true)
  })

  it('keeps the persisted values when the server cannot be reached', async () => {
    const { controller, storage } = setup({ list: () => Promise.reject(new Error('offline')) })
    await storage.save(new Map([['model.effort', 'high']]))

    await controller.load()

    expect(controller.read({ key: 'model.effort', schema: z.string() })).toBe('high')
    expect(controller.getState()).toMatchObject({ ready: true, failed: false })
  })

  it('reports the failure when it has nothing cached', async () => {
    const { controller } = setup({ list: () => Promise.reject(new Error('offline')) })

    await controller.load()

    expect(controller.getState()).toMatchObject({ ready: false, failed: true })
  })

  it('applies a save before the server answers', async () => {
    const patched: Record<string, string | null>[] = []
    const { controller } = setup({
      patch: (values) => {
        patched.push(values)
        return Promise.resolve()
      },
    })
    const saving = controller.save({ 'model.fast': true })

    expect(controller.read({ key: 'model.fast', schema: z.boolean() })).toBe(true)
    await saving
    expect(patched).toHaveLength(1)
    expect(patched[0]).toEqual({ 'model.fast': encodeSettingValue(true) })
  })

  it('rolls a failed save back and throws', async () => {
    const { controller, storage } = setup({
      patch: () => Promise.reject(new Error('rejected')),
    })
    const failing = controller.save({ 'model.fast': true })

    await expect(failing).rejects.toThrow('rejected')
    await settle()
    expect(controller.read({ key: 'model.fast', schema: z.boolean() })).toBe(false)
    expect((await storage.load()).has('model.fast')).toBe(false)
  })

  it('refuses to save while signed out', async () => {
    const storage = jsonSettingsStorage({ store: memoryJsonStore() })
    const controller = createSettingsController({ gateway: () => undefined, storage })

    await expect(controller.save({ 'model.fast': true })).rejects.toThrow('signed out')
  })
})
