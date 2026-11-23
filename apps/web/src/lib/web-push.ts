import { ENotifyDeviceKind } from '@dltech/atlas-core'
import type { RegisterNotifyDeviceInput } from '@dltech/atlas-wire'

import { SERVICE_WORKER_PATH } from './service-worker-source'

export type BrowserSubscription = {
  endpoint: string
  toJSON(): { keys?: { p256dh?: string; auth?: string } }
}

export type EnableWebPushResult =
  | { state: 'unsupported' }
  | { state: 'denied' }
  | { state: 'subscribed'; input: RegisterNotifyDeviceInput }

export const webPushSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

export const applicationServerKeyOf = (publicKey: string): Uint8Array<ArrayBuffer> => {
  const padded = `${publicKey}${'='.repeat((4 - (publicKey.length % 4)) % 4)}`
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

export const registerDeviceInputOf = (args: {
  subscription: BrowserSubscription
  clientId: string
  label: string
}): RegisterNotifyDeviceInput => {
  const keys = args.subscription.toJSON().keys
  if (keys?.p256dh === undefined || keys.auth === undefined) {
    throw new Error('the push subscription carries no p256dh and auth keys')
  }
  return {
    kind: ENotifyDeviceKind.WebPush,
    clientId: args.clientId,
    token: args.subscription.endpoint,
    secret: JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }),
    label: args.label,
  }
}

export const deviceLabelOf = (args: { standalone: boolean; userAgent: string }): string => {
  if (args.standalone) return 'Home Screen'
  if (/Edg\//.test(args.userAgent)) return 'Edge'
  if (/Firefox\//.test(args.userAgent)) return 'Firefox'
  if (/Chrome\//.test(args.userAgent)) return 'Chrome'
  if (/Safari\//.test(args.userAgent)) return 'Safari'
  return 'Browser'
}

const standaloneNow = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches

const requestSubscription = async (args: { publicKey: string }): Promise<BrowserSubscription> => {
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing !== null) return existing
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKeyOf(args.publicKey),
  })
}

export const enableWebPush = async (args: {
  clientId: string
  publicKey: string
}): Promise<EnableWebPushResult> => {
  if (!webPushSupported()) return { state: 'unsupported' }
  await navigator.serviceWorker.register(SERVICE_WORKER_PATH)
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { state: 'denied' }
  const subscription = await requestSubscription({ publicKey: args.publicKey })
  return {
    state: 'subscribed',
    input: registerDeviceInputOf({
      subscription,
      clientId: args.clientId,
      label: deviceLabelOf({ standalone: standaloneNow(), userAgent: navigator.userAgent }),
    }),
  }
}

export const closeSessionNotifications = async (sessionId: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
  const shown = await registration?.getNotifications({ tag: sessionId })
  await Promise.all((shown ?? []).map((notification) => notification.close()))
}

export const currentSubscriptionEndpoint = async (): Promise<string | null> => {
  if (!webPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}
