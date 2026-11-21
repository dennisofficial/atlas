import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EPodAction,
  POD_CONFIRM_BODY,
  POD_CONFIRM_LABEL,
  POD_CONFIRM_TITLE,
} from '../internal/pod-action-confirm'
import { planCapHintOf } from '../internal/pod-size-control'
import { POD_SECTION_SIZES, POD_SERIES } from '../pod-metrics.fixtures'
import { PodSection, type PodSectionProps } from '../pod-section'
import { EPodState } from '../pod-status'

const BASE: PodSectionProps = {
  state: EPodState.Running,
  vcpus: 4,
  sizes: POD_SECTION_SIZES,
  maxVcpus: 8,
  series: POD_SERIES,
}

function htmlOf(overrides: Partial<PodSectionProps> = {}): string {
  return renderToStaticMarkup(<PodSection {...BASE} {...overrides} />)
}

describe('pod section header', () => {
  it('labels the single power button with what pressing it does', () => {
    expect(htmlOf()).toContain('aria-label="Stop pod"')
    expect(htmlOf({ state: EPodState.Parked })).toContain('aria-label="Start pod"')
    expect(htmlOf({ state: EPodState.Stopped })).toContain('aria-label="Start pod"')
  })

  it('names the state in words', () => {
    expect(htmlOf()).toContain('Running')
    expect(htmlOf({ state: EPodState.Parked })).toContain('Sleeping')
    expect(htmlOf({ state: EPodState.Starting })).toContain('Starting…')
    expect(htmlOf({ state: EPodState.Stopped })).toContain('Stopped')
  })

  it('spins and disables the power button while the pod comes up or a stop is in flight', () => {
    expect(htmlOf({ state: EPodState.Starting })).toContain('aria-label="Starting pod"')
    expect(htmlOf({ state: EPodState.Starting })).toContain('disabled')
    expect(htmlOf({ stopping: true })).toContain('aria-label="Stopping pod"')
    expect(htmlOf({ stopping: true })).toContain('disabled')
  })
})

describe('pod section chart', () => {
  it('draws the live chart only while the pod runs', () => {
    expect(htmlOf()).toContain('CPU and RAM over the last 15 minutes')
    expect(htmlOf()).toContain('Last 15 min')
  })

  it('replaces a stale chart with a quiet empty state while asleep', () => {
    const asleep = htmlOf({ state: EPodState.Parked })
    expect(asleep).toContain('Pod is asleep — start it to see live usage')
    expect(asleep).not.toContain('CPU and RAM over the last 15 minutes')
    expect(asleep).not.toContain('Last 15 min')
  })

  it('keeps the signals footer', () => {
    const loud = htmlOf({ throttled: true, oomKills: 1 })
    expect(loud).toContain('Throttled')
    expect(loud).toContain('1 OOM kill')
    expect(htmlOf()).not.toContain('Throttled')
  })
})

describe('pod size control', () => {
  it('shows every size in vCPU and the RAM it buys', () => {
    const html = htmlOf()
    expect(html).toContain('2 vCPU')
    expect(html).toContain('4 GB')
    expect(html).toContain('8 vCPU')
    expect(html).toContain('16 GB')
  })

  it('marks the current size as pressed', () => {
    expect(htmlOf()).toContain('aria-pressed="true"')
    expect(htmlOf({ vcpus: 2 }).match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('disables sizes above the plan cap', () => {
    const capped = htmlOf({ maxVcpus: 4 })
    expect(capped).toContain('aria-disabled="true"')
    expect(htmlOf({ maxVcpus: 8 })).not.toContain('aria-disabled="true"')
    expect(planCapHintOf({ size: 8, maxVcpus: 4 })).toBe('8 vCPU is above your plan limit of 4')
  })

  it('names the pending size and warns that the pod restarts', () => {
    expect(htmlOf({ pendingVcpus: 8 })).toContain('Resizing to 8 vCPU — the pod restarts')
  })

  it('offers a retry when the resize failed', () => {
    const failed = htmlOf({ pendingVcpus: 8, resizeError: 'The pod did not come back in time' })
    expect(failed).toContain('Could not resize the pod. The pod did not come back in time')
    expect(failed).toContain('Retry')
  })

  it('locks the sizes while the pod starts', () => {
    const starting = htmlOf({ state: EPodState.Starting })
    expect(starting.match(/aria-disabled="true"/g)).toHaveLength(POD_SECTION_SIZES.length)
  })
})

describe('pod action confirm', () => {
  it('asks before stopping and keeps the reason short', () => {
    expect(POD_CONFIRM_TITLE[EPodAction.Stop]).toBe('Stop the pod?')
    expect(POD_CONFIRM_BODY).toBe(
      'The current turn stops and running processes end. Files are kept.',
    )
    expect(POD_CONFIRM_LABEL[EPodAction.Stop]).toBe('Stop')
  })

  it('asks before restarting for a resize', () => {
    expect(POD_CONFIRM_TITLE[EPodAction.Resize]).toBe('Restart the pod?')
    expect(POD_CONFIRM_LABEL[EPodAction.Resize]).toBe('Restart')
  })
})
