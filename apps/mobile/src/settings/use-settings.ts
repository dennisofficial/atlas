import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { createPushApi } from '../push/push-api'

export enum ETestResult {
  Idle = 'idle',
  Sending = 'sending',
  Sent = 'sent',
  Failed = 'failed',
}

export interface ITestNotificationState {
  result: ETestResult
  detail: string
}

export const updatesSupported = Platform.OS === 'ios'

export const useTestNotification = (): {
  state: ITestNotificationState
  sendTest: () => Promise<void>
} => {
  const { api } = useAuth()
  const [state, setState] = useState<ITestNotificationState>({
    result: ETestResult.Idle,
    detail: '',
  })

  const sendTest = async () => {
    if (api === undefined) return
    setState({ result: ETestResult.Sending, detail: '' })
    try {
      const { devices } = await createPushApi({ client: api }).sendTest()
      setState({
        result: ETestResult.Sent,
        detail: `Sent to ${devices} ${devices === 1 ? 'device' : 'devices'}`,
      })
    } catch {
      setState({ result: ETestResult.Failed, detail: 'The test notification could not be sent' })
    }
  }

  return { state, sendTest }
}

export interface IUpdateInfo {
  enabled: boolean
  channel: string
  updateId: string
  runtimeVersion: string
  checking: boolean
  status: string
  check: () => Promise<void>
}

export const useUpdateInfo = (): IUpdateInfo => {
  const [state, setState] = useState<IUpdateInfo>({
    enabled: false,
    channel: '',
    updateId: 'embedded',
    runtimeVersion: '',
    checking: false,
    status: '',
    check: async () => {},
  })
  useEffect(() => {
    if (!updatesSupported) return
    void import('./updates-info').then(({ createUpdateInfo }) => {
      setState((previous) => ({ ...previous, ...createUpdateInfo({ setState }) }))
    })
  }, [])
  return state
}

export const usePermissionStatus = (): string => {
  const [status, setStatus] = useState('unavailable')
  useEffect(() => {
    if (!updatesSupported) return
    void import('../push/permission-status').then(({ readPermissionStatus }) => {
      void readPermissionStatus().then(setStatus)
    })
  }, [])
  return status
}
