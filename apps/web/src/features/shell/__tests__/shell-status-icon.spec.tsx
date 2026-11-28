import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EAgentStatus } from '@dltech/atlas-core'
import { AgentStatusIcon, ThreadStatusIcon } from '../shell-status-icon'
import { EThreadStatus } from '../thread-status'

const iconOf = (status: EThreadStatus) => renderToStaticMarkup(<ThreadStatusIcon status={status} />)

describe('AgentStatusIcon', () => {
  for (const [status, label, shape, tone] of [
    [EAgentStatus.Running, 'Running', 'loader-circle', 'text-primary'],
    [EAgentStatus.WaitingForModel, 'Waiting for model', 'circle-alert', 'text-warning'],
    [EAgentStatus.Blocked, 'Blocked', 'circle-alert', 'text-warning'],
    [EAgentStatus.Failed, 'Failed', 'circle-x', 'text-destructive'],
    [EAgentStatus.Finished, 'Finished', 'circle', 'text-muted-foreground'],
    [EAgentStatus.Stopped, 'Stopped', 'circle', 'text-muted-foreground'],
    [EAgentStatus.Paused, 'Paused', 'circle', 'text-muted-foreground'],
  ] as const) {
    it(`labels ${status} with the sidebar shape and tone`, () => {
      const html = renderToStaticMarkup(<AgentStatusIcon status={status} />)
      expect(html).toContain('role="img"')
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain(`lucide-${shape}`)
      expect(html).toContain(tone)
      expect(html).toContain('size-3.5')
      expect(html.includes('animate-spin')).toBe(status === EAgentStatus.Running)
      expect(html.includes('motion-reduce:animate-none')).toBe(status === EAgentStatus.Running)
    })
  }
})

describe('ThreadStatusIcon', () => {
  for (const [status, label, icon, spinning] of [
    [EThreadStatus.Running, 'Working', 'lucide-loader-circle', true],
    [EThreadStatus.Awaiting, 'Waiting for you', 'lucide-circle-alert', false],
    [EThreadStatus.Starting, 'Starting pod', 'lucide-circle-dashed', true],
    [EThreadStatus.Failed, 'Failed', 'lucide-circle-x', false],
    [EThreadStatus.Idle, 'Idle', 'lucide-circle', false],
    [EThreadStatus.Parked, 'Parked', 'lucide-circle-dashed', false],
  ] as const) {
    it(`distinguishes ${label} by an accessible label, shape and animation`, () => {
      const html = iconOf(status)
      expect(html).toContain('role="img"')
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain(icon)
      expect(html.includes('animate-spin')).toBe(spinning)
      expect(html.includes('motion-reduce:animate-none')).toBe(spinning)
    })
  }

  it('keeps idle solid while parked and starting use a dashed ring', () => {
    expect(iconOf(EThreadStatus.Idle)).not.toContain('lucide-circle-dashed')
    expect(iconOf(EThreadStatus.Parked)).toContain('text-muted-foreground/60')
  })

  it('keeps the status icon visible with the unread dot centered inside it', () => {
    const unreadHtml = renderToStaticMarkup(<ThreadStatusIcon status={EThreadStatus.Idle} unread />)
    expect(unreadHtml).toContain('aria-label="Unread"')
    expect(unreadHtml).toContain('aria-label="Idle"')
    expect(unreadHtml).toContain('col-start-1 row-start-1')
    expect(iconOf(EThreadStatus.Idle)).not.toContain('aria-label="Unread"')
  })

  it('retains legacy PR icon consumers and forwards sizing classes', () => {
    for (const status of [EThreadStatus.PrOpen, EThreadStatus.PrMerged, EThreadStatus.PrClosed]) {
      expect(iconOf(status)).toContain('aria-label="Pull request')
    }
    const html = renderToStaticMarkup(
      <ThreadStatusIcon status={EThreadStatus.Idle} className="size-3.5" />,
    )
    expect(html).toContain('size-3.5')
    expect(html).not.toContain('size-4 ')
  })
})
