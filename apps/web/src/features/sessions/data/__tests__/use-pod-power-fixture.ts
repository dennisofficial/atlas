import { act, createElement } from 'react'

import type { EPodPowerPhase } from '@dltech/atlas-core'
import type {
  SessionSleepPodInput,
  SessionSleepPodOutput,
  SessionWakeInput,
  SessionWakeOutput,
} from '@dltech/atlas-protocol'

import { CloudApiError } from '@/lib/cloud-api'

import {
  POD_TURN_RUNNING,
  usePodPower,
  type PodDeclaredState,
  type PodPower,
} from '../use-pod-power'

export const turnRunning = (): CloudApiError =>
  new CloudApiError({
    message: 'the pod is busy: Agent turn',
    status: 409,
    code: POD_TURN_RUNNING,
  })

export const WOKEN: SessionWakeOutput = { state: 'waking' }
export const ELSEWHERE: SessionWakeOutput = { state: 'elsewhere' }
export const SLEEPING: SessionSleepPodOutput = { state: 'sleeping' }

export const mountPodPower = async (args: {
  declared?: PodDeclaredState | undefined
  power?: EPodPowerPhase | undefined
  wake: (input: SessionWakeInput) => Promise<SessionWakeOutput>
  sleep?: (input: SessionSleepPodInput) => Promise<SessionSleepPodOutput>
  wakeDeadlineMs?: number | undefined
  sleepDeadlineMs?: number | undefined
}) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const handle: { power: PodPower | undefined } = { power: undefined }

  const Probe = (props: {
    declared?: PodDeclaredState | undefined
    power?: EPodPowerPhase | undefined
  }) => {
    const power = usePodPower({
      sessionId: 'session-1',
      declared: props.declared,
      power: props.power,
      wake: args.wake,
      ...(args.sleep === undefined ? {} : { sleep: args.sleep }),
      ...(args.wakeDeadlineMs === undefined ? {} : { wakeDeadlineMs: args.wakeDeadlineMs }),
      ...(args.sleepDeadlineMs === undefined ? {} : { sleepDeadlineMs: args.sleepDeadlineMs }),
    })
    handle.power = power
    return createElement('p', null, power.state.phase)
  }

  const render = async (declared?: PodDeclaredState, power?: EPodPowerPhase) => {
    await act(async () => root.render(createElement(Probe, { declared, power })))
  }

  await render(args.declared, args.power)

  return {
    power: () => {
      if (handle.power === undefined) throw new Error('the pod power probe did not render')
      return handle.power
    },
    render,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

export const settlePromises = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

export const wait = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
