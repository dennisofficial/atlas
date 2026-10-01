#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core'
import { createRoot, useKeyboard, useRenderer } from '@opentui/react'
import { testRender } from '@opentui/react/test-utils'
import React, { useState } from 'react'

import { EAuthor, EEntryKind, EPendingKind, type PendingRow, type TranscriptEntry } from '../src/store'
import { PendingBlock } from '../src/ui/components/blocks/pending-block'
import { EntryView } from '../src/ui/components/entry-view'
import { frameToHtml } from '../src/ui/frame-html'
import { theme } from '../src/ui/theme'

const WIDTH = 100

const durableShellEnded = (): TranscriptEntry => ({
  kind: EEntryKind.BackgroundShellEnded,
  author: EAuthor.Model,
  key: 'd1',
  text: 'Background shell "Run full TUI suite" completed (exit code 0)',
  shellId: 'bash_1',
  output: ['261 pass, 0 fail', 'Ran 261 tests across 42 files.'].join('\n'),
  failed: false,
})

const durableAgentEnded = (): TranscriptEntry => ({
  kind: EEntryKind.AgentEnded,
  author: EAuthor.Model,
  key: 'd2',
  text: 'Sub-agent explore "audit the credential vault" finished after 3 turns and 12 tool calls',
  agentId: 'thread-child',
  report: ['## What I found', '', 'Every call site is in the loop package.'].join('\n'),
  failed: false,
})

const pending: readonly PendingRow[] = [
  {
    kind: EPendingKind.Agent,
    id: 'agent-finished-thread-second',
    text: 'Sub-agent explore "trace the intake path" finished after 5 turns and 21 tool calls',
    failed: false,
    body: ['## What I found', '', 'Intake commits at the next safe point.'].join('\n'),
    entryKind: EEntryKind.AgentEnded,
  },
  {
    kind: EPendingKind.BackgroundShell,
    id: 'shell-ended-bash_9',
    text: 'Background shell "Watch the docs" failed (exit code 2)',
    failed: true,
    body: ['error: unknown flag --docs', '', 'bun run watch --help'].join('\n'),
    entryKind: EEntryKind.BackgroundShellEnded,
  },
  {
    kind: EPendingKind.BackgroundShell,
    id: 'shell-matched-bash_7',
    text: 'Background shell "Follow the deploy log" matched its watch and is still running',
    failed: false,
    body: ['12 fail', '13 fail'].join('\n'),
    entryKind: EEntryKind.BackgroundShellMatched,
  },
  {
    kind: EPendingKind.BackgroundShell,
    id: 'shell-awaiting-bash_8',
    text: 'Background shell "Serve the preview" is waiting on input and cannot be answered',
    failed: true,
    body: null,
    entryKind: EEntryKind.BackgroundShellAwaitingInput,
  },
  {
    kind: EPendingKind.Service,
    id: 'service-exited-svc_1',
    text: 'Service svc_1 "web dev server" exited cleanly',
    failed: false,
    body: null,
    entryKind: EEntryKind.ServiceEnded,
  },
]

function Scene(props: {
  opened: ReadonlySet<string>
  onToggle: (key: string) => void
}): React.ReactNode {
  return (
    <box flexDirection="column" paddingLeft={1}>
      <EntryView
        entry={durableShellEnded()}
        width={WIDTH}
        expanded={props.opened.has('d1')}
        onToggle={props.onToggle}
      />
      <EntryView
        entry={durableAgentEnded()}
        width={WIDTH}
        expanded={props.opened.has('d2')}
        onToggle={props.onToggle}
      />
      <EntryView
        entry={{ kind: EEntryKind.AgentEnded, author: EAuthor.Model, key: 'teammate',
          text: 'Teammate "Inspect serve" finished', agentId: 'peer',
          report: 'Done. My report was delivered earlier.', failed: false }}
        width={WIDTH}
      />
      <box flexDirection="row" marginTop={1} marginBottom={1}>
        <text fg={theme.accent}>{'⣾ Working for 12s (↓ 1.2k tokens · esc to interrupt)'}</text>
      </box>
      <PendingBlock rows={pending} width={WIDTH} />
    </box>
  )
}

function ProbeApp(): React.ReactNode {
  const renderer = useRenderer()
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())

  useKeyboard((key) => {
    if (key.name === 'return') {
      setOpened((held) => {
        const next = new Set(held)
        if (next.has('d1')) next.delete('d1')
        else next.add('d1')
        return next
      })
    }
    if (key.name === 'q') {
      renderer.destroy()
      process.exit(0)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Scene opened={opened} onToggle={(key) => setOpened((held) => new Set(held).add(key))} />
      <text fg={theme.dim}>{'enter opens/closes the durable shell row · q quit · queued rows answer to nothing'}</text>
    </box>
  )
}

async function frame(): Promise<void> {
  const setup = await testRender(<Scene opened={new Set(['d1'])} onToggle={() => {}} />, {
    width: WIDTH + 4,
    height: 40,
  })
  try {
    await setup.flush()
    console.log(setup.captureCharFrame())
  } finally {
    setup.renderer.destroy()
  }
}

async function html(): Promise<void> {
  const setup = await testRender(<Scene opened={new Set(['d1'])} onToggle={() => {}} />, {
    width: WIDTH + 4,
    height: 40,
  })
  try {
    await setup.flush()
    console.log(
      frameToHtml({
        frame: setup.captureSpans(),
        title: 'message intake: durable transcript vs queued notices',
      }),
    )
  } finally {
    setup.renderer.destroy()
  }
}

if (process.argv.includes('--html')) {
  await html()
  process.exit(0)
}

if (process.argv.includes('--frame')) {
  await frame()
  process.exit(0)
}

const renderer = await createCliRenderer({ exitOnCtrlC: true })
createRoot(renderer).render(<ProbeApp />)
