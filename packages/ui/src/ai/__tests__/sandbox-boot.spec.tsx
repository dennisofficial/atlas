import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EBootStepState,
  SandboxBoot,
  sandboxBootSummary,
  sandboxBootTitle,
  type SandboxBootProps,
  type SandboxBootStep,
} from '../sandbox-boot'

const CLONE_ERROR = 'Repository not found, or the GitHub connection cannot read it.'

const steps = (states: EBootStepState[]): SandboxBootStep[] =>
  states.map((state, index) => ({
    id: `step-${index}`,
    label: `Step label ${index}`,
    state,
    detail: state === EBootStepState.Error ? CLONE_ERROR : `detail ${index}`,
  }))

const { Pending, Running, Done, Error, Interrupted } = EBootStepState

const render = (props: Partial<SandboxBootProps> = {}) =>
  renderToStaticMarkup(
    <SandboxBoot
      steps={steps([Done, Running, Pending])}
      state={Running}
      elapsedMs={4400}
      {...props}
    />,
  )

describe('sandboxBootTitle', () => {
  it('titles each state', () => {
    expect(sandboxBootTitle(Running)).toBe('Starting sandbox')
    expect(sandboxBootTitle(Done)).toBe('Sandbox ready')
    expect(sandboxBootTitle(Error)).toBe('Sandbox failed to start')
    expect(sandboxBootTitle(Pending)).toBe('Waiting for sandbox')
    expect(sandboxBootTitle(Interrupted)).toBe('Setup restarted, running again')
  })
})

describe('sandboxBootSummary', () => {
  const list = steps([Done, Running, Pending])

  it('counts finished steps and elapsed seconds while running', () => {
    expect(sandboxBootSummary({ steps: list, state: Running, elapsedMs: 4400 })).toBe('1/3, 4.4s')
    expect(sandboxBootSummary({ steps: list, state: Running })).toBe('1/3')
  })

  it('shows only the elapsed time when done', () => {
    expect(sandboxBootSummary({ steps: list, state: Done, elapsedMs: 10200 })).toBe('10.2s')
    expect(sandboxBootSummary({ steps: list, state: Done })).toBeUndefined()
  })

  it('leaves the failed row to its title alone', () => {
    expect(sandboxBootSummary({ steps: steps([Done, Error]), state: Error })).toBeUndefined()
  })

  it('has no summary while pending', () => {
    expect(sandboxBootSummary({ steps: list, state: Pending, elapsedMs: 0 })).toBeUndefined()
  })
})

describe('SandboxBoot', () => {
  it('renders open while running with every step label and the running status', () => {
    const html = render()

    expect(html).toContain('Starting sandbox')
    expect(html).toContain('1/3, 4.4s')
    expect(html).toContain('data-status="running"')
    expect(html).toContain('Step label 0')
    expect(html).toContain('Step label 1')
    expect(html).toContain('Step label 2')
    expect(html).toContain('detail 1')
  })

  it('marks pending steps as pending', () => {
    expect(render()).toContain('data-status="pending"')
  })

  it('renders collapsed when done', () => {
    const html = render({ steps: steps([Done, Done]), state: Done, elapsedMs: 9800 })

    expect(html).toContain('Sandbox ready')
    expect(html).toContain('9.8s')
    expect(html).not.toContain('Step label 0')
    expect(html).not.toContain('Retry')
  })

  it('renders a given title instead of the state title', () => {
    const html = render({
      steps: steps([Done, Error]),
      state: Error,
      title: 'Setup script failed',
      onRetry: () => {},
    })

    expect(html).toContain('Setup script failed')
    expect(html).not.toContain('Sandbox failed to start')
    expect(html).toContain('Retry')
  })

  it('renders open on error with the failed step title and the error in a card', () => {
    const html = render({ steps: steps([Done, Error, Pending]), state: Error })

    expect(html).toContain('Sandbox failed to start')
    expect(html).toContain('data-status="error"')
    expect(html).toContain('Step label 1')
    expect(html).toContain('data-slot="sandbox-boot-error"')
    expect(html).toContain('>Sandbox<')
    expect(html.split(CLONE_ERROR)).toHaveLength(2)
  })

  it('keeps every line of the error and wraps it in a scrollable card', () => {
    const multiline =
      'sandbox daemon did not answer atlas-daemon on port 3000\ntail:\nline one\nline two'
    const html = render({
      steps: [{ id: 'sandbox', label: 'Starting sandbox', state: Error, detail: multiline }],
      state: Error,
      error: multiline,
    })

    expect(html.split('sandbox-boot-error')).toHaveLength(2)
    expect(html).toContain('line one\nline two')
    expect(html).toContain('data-wrap')
    expect(html).toContain('max-h-64')
  })

  it('falls back to the error prop when no step carries it', () => {
    const html = render({ steps: steps([Done]), state: Error, error: 'daemon did not answer' })

    expect(html).toContain('data-slot="sandbox-boot-error"')
    expect(html).toContain('daemon did not answer')
  })

  it('renders an interrupted setup as running, without a failure title or Retry', () => {
    const html = render({
      steps: [
        {
          id: 'setup',
          label: 'Setup restarted, running again',
          state: Interrupted,
          command: 'bun install',
        },
      ],
      state: Interrupted,
      onRetry: () => {},
    })

    expect(html).toContain('Setup restarted, running again')
    expect(html).toContain('data-status="running"')
    expect(html).not.toContain('Sandbox failed to start')
    expect(html).not.toContain('sandbox-boot-error')
    expect(html).not.toContain('Retry')
  })

  it('shows Retry only on error and only with onRetry', () => {
    const failed = { steps: steps([Done, Error]), state: Error }

    expect(render({ ...failed, onRetry: () => {} })).toContain('Retry')
    expect(render(failed)).not.toContain('Retry')
    expect(render({ onRetry: () => {} })).not.toContain('Retry')
  })

  it('nests child rows under their step with the error detail', () => {
    const withChildren: SandboxBootStep[] = [
      {
        id: 'clone',
        label: 'Clone repository',
        state: Running,
        children: [
          { id: 'acme/web-child', label: 'web-child', state: Done },
          {
            id: 'acme/docs-child',
            label: 'docs-child',
            state: Error,
            detail: 'Repository not found',
          },
        ],
      },
    ]
    const html = render({ steps: withChildren })

    expect(html).toContain('data-slot="sandbox-boot-children"')
    expect(html).toContain('web-child')
    expect(html).toContain('docs-child')
    expect(html).toContain('Repository not found')
    expect(render({ steps: steps([Done]) })).not.toContain('sandbox-boot-children')
  })
})

describe('SandboxBoot with a failed repo in a finished boot', () => {
  it('stays open so the failed repo and its reason show', () => {
    const html = render({
      state: Done,
      elapsedMs: 9800,
      steps: [
        {
          id: 'clone',
          label: 'Repository cloned',
          state: Done,
          children: [
            { id: 'acme/app', label: 'app', state: Done },
            { id: 'acme/lib', label: 'lib', state: Error, detail: 'Repository not found' },
          ],
        },
      ],
    })

    expect(html).toContain('Sandbox ready')
    expect(html).toContain('Repository not found')
    expect(html).not.toContain('Retry')
  })
})

describe('SandboxBoot command step', () => {
  it('renders the command and its output under the step', () => {
    const html = render({
      steps: [
        {
          id: 'setup',
          label: 'Running setup script',
          state: Running,
          command: 'bun install',
          output: 'resolving deps',
        },
      ],
    })
    expect(html).toContain('sandbox-boot-terminal')
    expect(html).toContain('$ bun install')
    expect(html).toContain('resolving deps')
  })
})
