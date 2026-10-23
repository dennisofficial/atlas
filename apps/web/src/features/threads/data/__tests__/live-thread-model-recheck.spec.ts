import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'

import { flush, rig } from './live-thread-fixture'

const API = { ref: 'anthropic/claude-opus-5', effort: 'high' }
const POD = { ref: 'openai/gpt-5-codex', effort: 'medium' }

const podThread = (model?: { ref: string; effort: string }) => ({
  thread: {
    id: 'thr_1',
    head: 2,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    workspace: null,
    repo: null,
    ...(model === undefined ? {} : { model }),
  },
})

const modelRequests = (test: ReturnType<typeof rig>) =>
  test.requests().filter((request) => request.op === EClientRequest.SetThreadModel)

const connect = async (test: ReturnType<typeof rig>) => {
  test.controller.start()
  await flush()
  test.ready()
  await flush()
}

const readIndex = (test: ReturnType<typeof rig>) =>
  test.requests().findIndex((request) => request.op === EClientRequest.ReadThread)

describe('the connect re-check of the pod model', () => {
  it("sends the API's model once when the pod runs a different one", async () => {
    const test = rig({ readStoredModel: async () => API })
    await connect(test)

    expect(test.requests()[readIndex(test)]?.params).toEqual({ threadId: 'thr_1' })
    test.reply({ index: readIndex(test), data: podThread(POD) })
    await flush()

    expect(modelRequests(test)).toHaveLength(1)
    expect(modelRequests(test)[0]?.params).toEqual({ threadId: 'thr_1', model: API })
  })

  it('sends nothing when the pod already runs the API model', async () => {
    const test = rig({ readStoredModel: async () => API })
    await connect(test)

    test.reply({ index: readIndex(test), data: podThread(API) })
    await flush()

    expect(modelRequests(test)).toEqual([])
  })

  it('sends nothing and does not ask the pod when the API thread has no model', async () => {
    const test = rig({ readStoredModel: async () => undefined })
    await connect(test)

    expect(readIndex(test)).toBe(-1)
    expect(modelRequests(test)).toEqual([])
  })

  it('sends nothing when the pod thread carries no model', async () => {
    const test = rig({ readStoredModel: async () => API })
    await connect(test)

    test.reply({ index: readIndex(test), data: podThread() })
    await flush()

    expect(modelRequests(test)).toEqual([])
  })

  it('re-checks again on each reconnect', async () => {
    const test = rig({ readStoredModel: async () => API })
    await connect(test)
    test.reply({ index: readIndex(test), data: podThread(API) })
    await flush()

    test.socket().handlers.handleClose()
    await flush()
    test.ready()
    await flush()

    expect(readIndex(test)).toBeGreaterThanOrEqual(0)
    test.reply({ index: readIndex(test), data: podThread(POD) })
    await flush()
    expect(modelRequests(test)).toHaveLength(1)
  })

  it('does not override a model the user picked while the re-check was in flight', async () => {
    const test = rig({ readStoredModel: async () => API })
    await connect(test)

    const chosen = test.controller.chooseModel(POD)
    await flush()
    test.reply({ index: readIndex(test), data: podThread(POD) })
    await flush()
    const picked = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.SetThreadModel)
    test.reply({ index: picked, data: { threadId: 'thr_1', model: POD } })
    await chosen

    expect(modelRequests(test)).toHaveLength(1)
    expect(modelRequests(test)[0]?.params).toEqual({ threadId: 'thr_1', model: POD })
  })

  it('stays live when the API read fails', async () => {
    const test = rig({
      readStoredModel: async () => {
        throw new Error('api down')
      },
    })
    await connect(test)

    expect(test.state().live).toBe(true)
    expect(modelRequests(test)).toEqual([])
  })
})
