import { describe, expect, it } from 'bun:test'

import { ECallFailure } from '../../ops'
import {
  EPOCH,
  connectAt,
  failureOf,
  okValue,
  replyOf,
  resultOf,
  runToEnd,
  sendRun,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

import { readLines, requestOf, spawnEcho, spawnSilent } from './mcp-support'

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

export const describeMcpRequestConformance = (target: DaemonConformanceTarget): void => {
  describe(`mcp request conformance (${target.name})`, () => {
    it('answers a request by its call key and still publishes the line', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-request' })
          const value = await requestOf({
            session,
            serverId: 'srv-request',
            key: 'req-answer',
            method: 'tools/call',
            params: { name: 'search', arguments: { q: 'x' } },
          })
          if (value.kind !== 'response') throw new Error(`expected a response, got ${value.kind}`)
          const response = recordOf(value.response)
          expect(response?.['id']).toBe('req-answer')
          const echo = recordOf(response?.['result'])?.['echo']
          expect(JSON.parse(String(echo))).toEqual({
            jsonrpc: '2.0',
            id: 'req-answer',
            method: 'tools/call',
            params: { name: 'search', arguments: { q: 'x' } },
          })
          expect(await readLines({ session, serverId: 'srv-request' })).toHaveLength(1)
        },
      }))

    it('resolves a waiting request as exited, with the exit of the server', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnSilent({ session, serverId: 'srv-request-exit' })
          sendRun({
            session,
            key: 'req-exit',
            op: {
              op: 'mcp.request',
              serverId: 'srv-request-exit',
              method: 'tools/call',
              params: { name: 'count' },
              timeoutMs: 5_000,
            },
          })
          await replyOf({ session, key: 'req-exit' })
          await runToEnd({
            session,
            key: 'close-request-exit',
            op: { op: 'mcp.close', serverId: 'srv-request-exit' },
          })
          const value = await resultOf({ session, key: 'req-exit' }).then((result) =>
            okValue({ result, op: 'mcp.request' }),
          )
          expect(value).toEqual({ kind: 'exited', exit: { exitCode: 0, signal: null }, stderr: [] })
        },
      }))

    it('times out a request the server never answers', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnSilent({ session, serverId: 'srv-request-timeout' })
          const value = await requestOf({
            session,
            serverId: 'srv-request-timeout',
            key: 'req-timeout',
            method: 'tools/call',
            params: { name: 'count' },
            timeoutMs: 50,
          })
          expect(value).toEqual({ kind: 'timed-out' })
        },
      }))

    it('cancels a waiting request with the cancelled outcome', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnSilent({ session, serverId: 'srv-request-cancel' })
          sendRun({
            session,
            key: 'req-cancel',
            op: {
              op: 'mcp.request',
              serverId: 'srv-request-cancel',
              method: 'tools/call',
              params: { name: 'count' },
              timeoutMs: 5_000,
            },
          })
          await replyOf({ session, key: 'req-cancel' })
          session.send({ kind: 'cancel', key: 'req-cancel', epoch: EPOCH })
          const result = await resultOf({ session, key: 'req-cancel', timeoutMs: 5_000 })
          expect(failureOf(result)).toBe(ECallFailure.Cancelled)
        },
      }))

    it('replays a done request under its key without writing it twice', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-request-replay' })
          const first = await requestOf({
            session,
            serverId: 'srv-request-replay',
            key: 'req-replay',
            method: 'tools/list',
          })
          const again = await requestOf({
            session,
            serverId: 'srv-request-replay',
            key: 'req-replay',
            method: 'tools/list',
          })
          expect(again).toEqual(first)
          expect(await readLines({ session, serverId: 'srv-request-replay' })).toHaveLength(1)
        },
      }))

    it('fails an unknown server id with not-found', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const request = await runToEnd({
            session,
            key: 'request-unknown',
            op: {
              op: 'mcp.request',
              serverId: 'srv-unknown',
              method: 'tools/list',
              timeoutMs: 1_000,
            },
          })
          expect(failureOf(request)).toBe(ECallFailure.NotFound)
        },
      }))
  })
}
