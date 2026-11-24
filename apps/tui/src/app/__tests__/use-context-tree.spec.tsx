import type { KeyEvent } from '@opentui/core'
import { KeyEvent as KeyEventClass } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { useCallback, useState } from 'react'

import type { DirectoryEntry } from '@dltech/atlas-core'
import type { FileContent, FilesReadInput, FilesTreeInput } from '@dltech/atlas-protocol'

import { frameSettled, frameShowing } from '../../ui/__tests__/waiting'
import { ContextSection } from '../../ui/components/sidebar/context'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { ContextViewerScreen } from '../context-viewer-screen'
import { useContextTree, type ContextFilesApi, type ContextTreeControl } from '../use-context-tree'

const SESSION_ID = 'session-one'

const WIDTH = 70

const HEIGHT = 20

const WITHIN = 15_000

const TREE_MS = 3_000

type Level = readonly DirectoryEntry[]

type ContextFiles = {
  api: ContextFilesApi
  setTree: (directory: string, entries: Level) => void
  refuseFile: (path: string, reason: string) => void
  writeFile: (path: string, content: string) => void
}

const contextFilesOf = (args: {
  tree?: Readonly<Record<string, Level>>
  files?: Readonly<Record<string, FileContent>>
}): ContextFiles => {
  const tree = new Map<string, Level>(Object.entries(args.tree ?? {}))
  const files = new Map<string, FileContent>(Object.entries(args.files ?? {}))

  const api: ContextFilesApi = {
    browseContext: async (input: FilesTreeInput) => ({
      directory: input.directory,
      entries: [...(tree.get(input.directory) ?? [])].map((entry) => ({
        ...entry,
        changed: false,
      })),
    }),
    readContext: async (input: FilesReadInput) => ({
      file: files.get(input.path) ?? {
        type: 'refused',
        path: input.path,
        reason: `${input.path} is not in the context directory`,
      },
    }),
  }

  return {
    api,
    setTree: (directory, entries) => tree.set(directory, entries),
    refuseFile: (path, reason) => files.set(path, { type: 'refused', path, reason }),
    writeFile: (path, content) =>
      files.set(path, { type: 'text', path, content, truncated: false, bytes: content.length }),
  }
}

const press = (name: string): KeyEvent =>
  new KeyEventClass({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: '',
    number: false,
    raw: '',
    eventType: 'press',
    source: 'raw',
  })

type Probe = { control: ContextTreeControl | null; bump: () => void }

function Pane(props: { probe: Probe; files: ContextFiles }): React.ReactNode {
  const [head, setHead] = useState(0)
  props.probe.bump = useCallback(() => setHead((value) => value + 1), [])
  const control = useContextTree({ api: props.files.api, sessionId: SESSION_ID, head })
  props.probe.control = control

  return (
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <box flexDirection="column" flexShrink={0}>
        <ContextSection {...control.section} cells={WIDTH} />
      </box>
      {control.viewer === null ? null : (
        <ContextViewerScreen
          width={WIDTH}
          path={control.viewer.path}
          loading={control.viewer.loading}
          content={control.viewer.content}
          onDismiss={control.handleDismiss}
          attachScroll={control.attachScroll}
        />
      )}
    </box>
  )
}

const controlOf = (probe: Probe): ContextTreeControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

async function mounted(files: ContextFiles): Promise<{
  probe: Probe
  setup: Awaited<ReturnType<typeof testRender>>
  done: () => Promise<void>
}> {
  const probe: Probe = { control: null, bump: () => undefined }
  const setup = await testRender(<Pane probe={probe} files={files} />, {
    width: WIDTH,
    height: HEIGHT,
  })
  await setup.flush()
  return { probe, setup, done: () => teardown(setup) }
}

describe('the context tree', () => {
  it('reads every open level, and a folder folds shut and open again', async () => {
    const files = contextFilesOf({
      tree: {
        '': [
          { name: 'notes', isDirectory: true },
          { name: 'plan.md', isDirectory: false },
        ],
        notes: [{ name: 'day-one.md', isDirectory: false }],
      },
    })
    const { probe, setup, done } = await mounted(files)

    try {
      const root = await frameShowing({ setup, text: 'day-one.md', within: WITHIN })
      expect(root).toContain('notes')
      expect(root).toContain('plan.md')

      controlOf(probe).section.onActivate('notes')
      const folded = await frameSettled({ setup, within: TREE_MS })
      expect(folded).not.toContain('day-one.md')

      controlOf(probe).section.onActivate('notes')
      const unfolded = await frameShowing({ setup, text: 'day-one.md', within: TREE_MS })
      expect(unfolded).toContain('plan.md')
    } finally {
      await done()
    }
  }, 60_000)

  it('opens a file and draws its text, and esc closes it', async () => {
    const files = contextFilesOf({
      tree: { '': [{ name: 'plan.md', isDirectory: false }] },
      files: {
        'plan.md': {
          type: 'text',
          path: 'plan.md',
          content: 'the context viewer reads this line',
          truncated: false,
          bytes: 35,
        },
      },
    })
    const { probe, setup, done } = await mounted(files)

    try {
      await frameShowing({ setup, text: 'plan.md', within: WITHIN })

      controlOf(probe).section.onActivate('plan.md')
      const opened = await frameShowing({
        setup,
        text: 'the context viewer reads this line',
        within: TREE_MS,
      })
      expect(opened).toContain('esc to close')

      controlOf(probe).handleKey(press('escape'))
      await frameShowing({ setup, text: 'CONTEXT', within: TREE_MS })
      expect(controlOf(probe).viewer).toBeNull()
    } finally {
      await done()
    }
  }, 60_000)

  it('draws the reason a refused file gives', async () => {
    const files = contextFilesOf({
      tree: {
        '': [
          { name: 'plan.md', isDirectory: false },
          { name: 'secret.md', isDirectory: false },
        ],
      },
    })
    files.refuseFile('secret.md', 'the file is outside the context directory')
    const { probe, setup, done } = await mounted(files)

    try {
      await frameShowing({ setup, text: 'secret.md', within: WITHIN })

      controlOf(probe).section.onActivate('secret.md')
      const opened = await frameShowing({
        setup,
        text: 'the file is outside the context directory',
        within: TREE_MS,
      })
      expect(opened).toContain('secret.md')
    } finally {
      await done()
    }
  }, 60_000)

  it('re-reads the open levels when the log head moves', async () => {
    const files = contextFilesOf({
      tree: { '': [{ name: 'plan.md', isDirectory: false }] },
    })
    const { probe, setup, done } = await mounted(files)

    try {
      await frameShowing({ setup, text: 'plan.md', within: WITHIN })

      files.setTree('', [
        { name: 'plan.md', isDirectory: false },
        { name: 'sketch.md', isDirectory: false },
      ])
      probe.bump()

      const reread = await frameShowing({ setup, text: 'sketch.md', within: TREE_MS })
      expect(reread).toContain('plan.md')
    } finally {
      await done()
    }
  }, 60_000)
})
