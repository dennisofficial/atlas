import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { messageOf } from './error-text'

export const SANDBOX_VCPU_STEPS = [2, 4, 8] as const

export const DEFAULT_SANDBOX_VCPUS = 2

export const memoryGbOf = (vcpus: number): number => vcpus * 2

export enum EResourcesPhase {
  Loading = 'loading',
  Ready = 'ready',
  Applying = 'applying',
}

export type ContainerResourcesState = {
  phase: EResourcesPhase
  vcpus: number
  error: string | null
}

export type ContainerResourcesControl = {
  state: ContainerResourcesState | null
  handleOpen: () => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
}

const clampStep = (vcpus: number): number => {
  for (const step of SANDBOX_VCPU_STEPS) {
    if (step >= vcpus) return step
  }
  return SANDBOX_VCPU_STEPS[SANDBOX_VCPU_STEPS.length - 1] ?? DEFAULT_SANDBOX_VCPUS
}

const stepBy = (vcpus: number, delta: number): number => {
  const at = SANDBOX_VCPU_STEPS.indexOf(clampStep(vcpus) as (typeof SANDBOX_VCPU_STEPS)[number])
  const next = Math.min(SANDBOX_VCPU_STEPS.length - 1, Math.max(0, at + delta))
  return SANDBOX_VCPU_STEPS[next] ?? DEFAULT_SANDBOX_VCPUS
}

/**
 * The `/container resources` overlay: a live resize of the sandbox this session runs in. Opens at
 * the allocation Vercel reports, Enter applies through the bridge, Esc cancels. Never touches the
 * stored creation-time default — that is the `sandbox.vcpus` setting's job.
 */
export function useContainerResources(args: {
  readResources: () => Promise<{ vcpus?: number; memoryMb?: number }>
  updateResources: (vcpus: number) => Promise<void>
}): ContainerResourcesControl {
  const [state, setState] = useState<ContainerResourcesState | null>(null)

  const handleOpen = useCallback(() => {
    setState({ phase: EResourcesPhase.Loading, vcpus: DEFAULT_SANDBOX_VCPUS, error: null })
    void args
      .readResources()
      .then((live) => {
        setState((current) =>
          current === null || current.phase !== EResourcesPhase.Loading
            ? current
            : {
                phase: EResourcesPhase.Ready,
                vcpus: live.vcpus === undefined ? current.vcpus : clampStep(live.vcpus),
                error: null,
              },
        )
      })
      .catch((failure: unknown) => {
        setState((current) =>
          current === null || current.phase !== EResourcesPhase.Loading
            ? current
            : { ...current, phase: EResourcesPhase.Ready, error: messageOf(failure) },
        )
      })
  }, [args])

  const handleDismiss = useCallback(() => setState(null), [])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (key.name === 'escape') {
        handleDismiss()
        return
      }
      if (key.name === 'down' || key.name === 'left') {
        setState((current) =>
          current === null || current.phase === EResourcesPhase.Applying
            ? current
            : { ...current, vcpus: stepBy(current.vcpus, -1), error: null },
        )
        return
      }
      if (key.name === 'up' || key.name === 'right') {
        setState((current) =>
          current === null || current.phase === EResourcesPhase.Applying
            ? current
            : { ...current, vcpus: stepBy(current.vcpus, 1), error: null },
        )
        return
      }
      if (key.name !== 'return') return
      const pending = state
      if (pending === null || pending.phase === EResourcesPhase.Applying) return
      setState({ ...pending, phase: EResourcesPhase.Applying, error: null })
      void args
        .updateResources(pending.vcpus)
        .then(() => {
          setState(null)
          notify({
            text: `sandbox resized to ${pending.vcpus} vCPU · ${memoryGbOf(pending.vcpus)} GB`,
          })
        })
        .catch((failure: unknown) => {
          setState((current) =>
            current === null || current.phase !== EResourcesPhase.Applying
              ? current
              : { ...current, phase: EResourcesPhase.Ready, error: messageOf(failure) },
          )
          notify({
            key: 'container-resources',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: `the sandbox was not resized — ${messageOf(failure)}`,
          })
        })
    },
    [args, state],
  )

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handleKey }),
    [state, handleOpen, handleDismiss, handleKey],
  )
}
