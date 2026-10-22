import { describe, expect, it } from 'vitest'

import { EThreadStatus } from '../../../../fixtures/app'
import {
  EMPTY_THREAD_TITLE,
  FIXTURE_PROMPT,
  NO_PROJECT_LABEL,
  PENDING_THREAD_ID,
  pendingThreadOf,
  POD_STAGES,
  projectLabelOf,
  titleOf,
} from '../new-thread-data'
import { seededCore } from '../new-thread-seed'
import {
  advancePod,
  retryFrom,
  sendFrom,
  takeBackFrom,
  type ThreadCore,
} from '../new-thread-transitions'
import { EFirstMessage, ENewThreadOutcome, EPodProgress, startPodOf } from '../new-thread-types'

const SUCCESS = ENewThreadOutcome.Success

const PENDING: ThreadCore = {
  pod: EPodProgress.WaitingForPod,
  message: EFirstMessage.Pending,
  prompt: FIXTURE_PROMPT,
  draft: '',
}

const TAKEN_BACK: ThreadCore = {
  pod: EPodProgress.WaitingForPod,
  message: EFirstMessage.None,
  prompt: '',
  draft: FIXTURE_PROMPT,
}

describe('startPodOf', () => {
  it('fails fast for the token outcome and provisions otherwise', () => {
    expect(startPodOf(ENewThreadOutcome.NoVercelToken)).toBe(EPodProgress.NoVercelToken)
    expect(startPodOf(SUCCESS)).toBe(EPodProgress.WaitingForPod)
    expect(startPodOf(ENewThreadOutcome.ProvisionFailed)).toBe(EPodProgress.WaitingForPod)
  })

  it('has no not-signed-in outcome', () => {
    expect(Object.values(ENewThreadOutcome)).not.toContain('not-signed-in')
  })
})

describe('sendFrom', () => {
  const draft: ThreadCore = {
    pod: EPodProgress.None,
    message: EFirstMessage.None,
    prompt: '',
    draft: 'hi',
  }

  it('starts the pod and makes the message pending from the welcome screen', () => {
    expect(sendFrom({ core: draft, text: 'hi', outcome: SUCCESS })).toEqual({
      pod: EPodProgress.WaitingForPod,
      message: EFirstMessage.Pending,
      prompt: 'hi',
      draft: '',
    })
  })

  it('makes a send while the pod is starting the pending message without restarting the pod', () => {
    for (const pod of [EPodProgress.WaitingForPod, EPodProgress.SettingUpWorkspace]) {
      const next = sendFrom({
        core: { ...TAKEN_BACK, pod },
        text: FIXTURE_PROMPT,
        outcome: SUCCESS,
      })
      expect(next).toEqual({
        pod,
        message: EFirstMessage.Pending,
        prompt: FIXTURE_PROMPT,
        draft: '',
      })
    }
  })

  it('runs the message immediately when the pod is ready with no message', () => {
    const core: ThreadCore = { ...TAKEN_BACK, pod: EPodProgress.Ready }
    const next = sendFrom({ core, text: FIXTURE_PROMPT, outcome: SUCCESS })
    expect(next).toEqual({
      pod: EPodProgress.Ready,
      message: EFirstMessage.Running,
      prompt: FIXTURE_PROMPT,
      draft: '',
    })
  })

  it('keeps the composer empty after a failure outcome', () => {
    const next = sendFrom({ core: draft, text: 'hi', outcome: ENewThreadOutcome.NoVercelToken })
    expect(next?.pod).toBe(EPodProgress.NoVercelToken)
    expect(next?.draft).toBe('')
  })

  it('leaves a thread with a first message alone', () => {
    for (const message of [EFirstMessage.Pending, EFirstMessage.Running, EFirstMessage.Done]) {
      expect(
        sendFrom({ core: { ...PENDING, message }, text: 'x', outcome: SUCCESS }),
      ).toBeUndefined()
    }
  })
})

describe('takeBackFrom', () => {
  it('returns the pending message to the composer and never stops the pod', () => {
    for (const pod of [
      EPodProgress.WaitingForPod,
      EPodProgress.SettingUpWorkspace,
      EPodProgress.ProvisionFailed,
    ]) {
      const next = takeBackFrom({ ...PENDING, pod })
      expect(next).toEqual({ pod, message: EFirstMessage.None, prompt: '', draft: FIXTURE_PROMPT })
    }
  })

  it('ignores a message that is already running or done', () => {
    for (const message of [EFirstMessage.Running, EFirstMessage.Done]) {
      const core = { ...PENDING, pod: EPodProgress.Ready, message }
      expect(takeBackFrom(core)).toBe(core)
    }
  })

  it('does nothing when there is no message to take back', () => {
    expect(takeBackFrom(TAKEN_BACK)).toBe(TAKEN_BACK)
  })

  it('is idempotent, so a repeated Escape cannot lose the draft', () => {
    const once = takeBackFrom(PENDING)
    expect(takeBackFrom(once)).toBe(once)
    expect(once.draft).toBe(FIXTURE_PROMPT)
  })
})

describe('advancePod', () => {
  it('keeps advancing after a take-back and reaches ready with no message', () => {
    const setting = advancePod({ core: TAKEN_BACK, outcome: SUCCESS })
    expect(setting.pod).toBe(EPodProgress.SettingUpWorkspace)
    const ready = advancePod({ core: setting, outcome: SUCCESS })
    expect(ready.pod).toBe(EPodProgress.Ready)
    expect(ready.message).toBe(EFirstMessage.None)
    expect(ready.draft).toBe(FIXTURE_PROMPT)
  })

  it('runs the pending message once the pod is ready', () => {
    const setting = advancePod({ core: PENDING, outcome: SUCCESS })
    const ready = advancePod({ core: setting, outcome: SUCCESS })
    expect(ready.message).toBe(EFirstMessage.Running)
  })

  it('fails at the first stage on a provision failure and keeps the pending message', () => {
    const failed = advancePod({ core: PENDING, outcome: ENewThreadOutcome.ProvisionFailed })
    expect(failed.pod).toBe(EPodProgress.ProvisionFailed)
    expect(failed.message).toBe(EFirstMessage.Pending)
  })

  it('leaves settled pods alone', () => {
    const ready: ThreadCore = { ...PENDING, pod: EPodProgress.Ready }
    expect(advancePod({ core: ready, outcome: SUCCESS })).toBe(ready)
  })
})

describe('retryFrom', () => {
  it('re-provisions and keeps the pending message and an empty composer', () => {
    const failed = { ...PENDING, pod: EPodProgress.ProvisionFailed }
    expect(retryFrom({ core: failed, outcome: SUCCESS })).toEqual(PENDING)
  })

  it('retries a failure with no message', () => {
    const failed = { ...TAKEN_BACK, pod: EPodProgress.ProvisionFailed }
    expect(retryFrom({ core: failed, outcome: SUCCESS }).pod).toBe(EPodProgress.WaitingForPod)
  })
})

describe('seededCore', () => {
  it('seeds a taken-back thread with the text in the composer and no message', () => {
    expect(seededCore({ pod: EPodProgress.WaitingForPod, message: EFirstMessage.None })).toEqual(
      TAKEN_BACK,
    )
  })

  it('seeds a ready pod with no message and an empty composer', () => {
    const core = seededCore({ pod: EPodProgress.Ready, message: EFirstMessage.None })
    expect(core.draft).toBe('')
    expect(core.prompt).toBe('')
  })
})

describe('pod stage labels', () => {
  it('uses the real birth wave labels in sentence case', () => {
    expect(POD_STAGES.map((entry) => entry.label)).toEqual([
      'Waiting for the pod',
      'Setting up the workspace',
    ])
  })
})

describe('project labels', () => {
  it('shows owner/name for a project and No project for null', () => {
    expect(projectLabelOf('atlas')).toBe('dennisofficial/atlas')
    expect(projectLabelOf(null)).toBe(NO_PROJECT_LABEL)
  })
})

describe('titleOf', () => {
  it('truncates long prompts, keeps short ones and titles an empty thread', () => {
    expect(titleOf(FIXTURE_PROMPT)).toBe(FIXTURE_PROMPT)
    expect(titleOf('x'.repeat(80))).toHaveLength(58)
    expect(titleOf('')).toBe(EMPTY_THREAD_TITLE)
  })
})

describe('pendingThreadOf', () => {
  const base = { prompt: FIXTURE_PROMPT, projectId: 'atlas' }

  it('is absent on the welcome screen', () => {
    const input = { ...base, pod: EPodProgress.None, message: EFirstMessage.None }
    expect(pendingThreadOf(input)).toBeUndefined()
  })

  it('runs while the pod starts or the message runs, and idles otherwise', () => {
    const starting = pendingThreadOf({
      ...base,
      pod: EPodProgress.WaitingForPod,
      message: EFirstMessage.None,
    })
    expect(starting?.id).toBe(PENDING_THREAD_ID)
    expect(starting?.status).toBe(EThreadStatus.Running)
    const running = pendingThreadOf({
      ...base,
      pod: EPodProgress.Ready,
      message: EFirstMessage.Running,
    })
    expect(running?.status).toBe(EThreadStatus.Running)
    const ready = pendingThreadOf({ ...base, pod: EPodProgress.Ready, message: EFirstMessage.None })
    expect(ready?.status).toBe(EThreadStatus.Idle)
    const failed = pendingThreadOf({
      ...base,
      pod: EPodProgress.ProvisionFailed,
      message: EFirstMessage.Pending,
    })
    expect(failed?.status).toBe(EThreadStatus.Idle)
  })

  it('stays when the project is none', () => {
    const input = { ...base, projectId: null, pod: EPodProgress.Ready, message: EFirstMessage.Done }
    expect(pendingThreadOf(input)?.projectId).toBeNull()
  })
})
