import { describe, expect, test } from 'bun:test'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, WITHIN } from './app-next-harness'
import { PRODUCTION_COMMANDS, PRODUCTION_SKILLS, withoutOpens } from './command-catalogue-fixture'

const openWith = async (commands: typeof PRODUCTION_COMMANDS) =>
  openSession({
    configure: (client) => {
      client.setCommands(commands)
      client.setSkills(PRODUCTION_SKILLS)
    },
  })

describe('one enter on a slash command', () => {
  test('/skills opens the skills panel', async () => {
    const mounted = await openWith(PRODUCTION_COMMANDS)

    try {
      await mounted.setup.mockInput.typeText('/skills')
      await frameShowing({ setup: mounted.setup, text: 'list the skills', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'put it in the composer',
        within: WITHIN,
      })
      expect(frame).toContain('/atlas')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('/mcp opens the mcp panel', async () => {
    const mounted = await openWith(PRODUCTION_COMMANDS)

    try {
      await mounted.setup.mockInput.typeText('/mcp')
      await frameShowing({
        setup: mounted.setup,
        text: "the session's MCP servers",
        within: WITHIN,
      })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({
        setup: mounted.setup,
        text: 'this session has no MCP servers',
        within: WITHIN,
      })
      expect(mounted.client()?.calls.post).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('/skills opens its panel when the catalogue names no client action', async () => {
    const mounted = await openWith(withoutOpens(PRODUCTION_COMMANDS))

    try {
      await mounted.setup.mockInput.typeText('/skills')
      await frameShowing({ setup: mounted.setup, text: 'list the skills', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({
        setup: mounted.setup,
        text: 'put it in the composer',
        within: WITHIN,
      })
      expect(mounted.client()?.calls.post).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('/mcp opens its panel when the catalogue names no client action', async () => {
    const mounted = await openWith(withoutOpens(PRODUCTION_COMMANDS))

    try {
      await mounted.setup.mockInput.typeText('/mcp')
      await frameShowing({
        setup: mounted.setup,
        text: "the session's MCP servers",
        within: WITHIN,
      })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({
        setup: mounted.setup,
        text: 'this session has no MCP servers',
        within: WITHIN,
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('a command whose argument is optional runs on one enter', async () => {
    const mounted = await openWith(PRODUCTION_COMMANDS)

    try {
      await mounted.setup.mockInput.typeText('/rotate')
      await frameShowing({ setup: mounted.setup, text: 'replace the sandbox', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client()?.calls.post.length === 1,
        describe: 'the command to be posted',
        within: WITHIN,
      })
      expect(mounted.client()?.calls.post[0]?.text).toBe('/rotate')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('a command that needs an argument completes instead of posting', async () => {
    const mounted = await openWith(PRODUCTION_COMMANDS)

    try {
      await mounted.setup.mockInput.typeText('/rename')
      await frameShowing({ setup: mounted.setup, text: 'name this session', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      const frame = await frameWhen({
        setup: mounted.setup,
        holds: (drawn) => drawn.includes('/rename ') && !drawn.includes('name this session'),
        describe: 'the completed command and the menu shut',
        within: WITHIN,
      })
      expect(frame).toContain('/rename')
      expect(mounted.client()?.calls.post).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
