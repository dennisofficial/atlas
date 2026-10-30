import { afterEach, describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { ECapability, SERVE_CAPABILITIES } from '@dltech/atlas-wire'

import { connect } from './client'
import { hello, releaseServeSpec, start, TOKEN } from './serve-spec-fixture'

afterEach(releaseServeSpec)

const ask = async (args: { port: number; params: unknown }) => {
  const client = await connect({ port: args.port, token: TOKEN })
  client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  client.send({
    kind: EClientFrame.Request,
    id: 'cmds-1',
    op: EClientRequest.ListCommands,
    params: args.params,
  })
  return client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'cmds-1')
}

describe('the list-commands request', () => {
  it('advertises the command-list capability', () => {
    expect(SERVE_CAPABILITIES).toContain(ECapability.CommandList)
  })

  it('answers with the skills the app lists, passing reload through', async () => {
    const seen: boolean[] = []
    const { handle } = await start({
      commands: {
        skills: async ({ reload }) => {
          seen.push(reload)
          return [{ name: 'review', summary: 'Review changes' }]
        },
      },
    })

    const reply = await ask({ port: handle.port, params: { reload: true } })

    expect(reply).toMatchObject({ ok: true, data: { skills: [{ name: 'review' }] } })
    expect(seen).toEqual([true])
  })

  it('answers an empty list when the app composes without commands', async () => {
    const { handle } = await start({})

    const reply = await ask({ port: handle.port, params: {} })

    expect(reply).toMatchObject({ ok: true, data: { skills: [] } })
  })

  it('refuses malformed params', async () => {
    const { handle } = await start({})

    const reply = await ask({ port: handle.port, params: { reload: 'yes' } })

    expect(reply).toMatchObject({ ok: false })
  })

  it('refuses a reply that fails the wire schema', async () => {
    const { handle } = await start({
      commands: { skills: async () => [{ name: 3 } as never] },
    })

    const reply = await ask({ port: handle.port, params: {} })

    expect(reply).toMatchObject({ ok: false })
  })
})
