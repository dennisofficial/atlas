import type { Control } from '@/proto/use-prototype'

export enum ESignInState {
  Idle = 'idle',
  Busy = 'busy',
  Error = 'error',
  GoogleError = 'google-error',
}

export enum ESignInContext {
  Default = 'default',
  Device = 'device',
  Invite = 'invite',
}

export enum ESignUpState {
  Idle = 'idle',
  Busy = 'busy',
  EmailTaken = 'email-taken',
}

export enum EForgotState {
  Idle = 'idle',
  Sent = 'sent',
}

export enum EResetState {
  Idle = 'idle',
  Mismatch = 'mismatch',
  Success = 'success',
  Expired = 'expired',
}

export enum EDeviceStep {
  EnterCode = 'enter-code',
  Confirm = 'confirm',
  ConfirmBusy = 'confirm-busy',
  Approved = 'approved',
  Denied = 'denied',
  ExpiredCode = 'expired-code',
  SignedOut = 'signed-out',
}

export enum ESetupState {
  CreateWorkspace = 'create-workspace',
  Done = 'done',
}

export enum EInviteState {
  SignedIn = 'signed-in',
  SignedOut = 'signed-out',
  Expired = 'expired',
}

type SelectControl = Extract<Control, { type: 'select' }>

export function selectOf<E extends Record<string, string>>({
  label,
  values,
  fallback,
}: {
  label: string
  values: E
  fallback: E[keyof E]
}): SelectControl {
  return { type: 'select', label, options: Object.values(values), default: fallback }
}

export function parseEnum<E extends Record<string, string>>({
  values,
  raw,
  fallback,
}: {
  values: E
  raw: string
  fallback: E[keyof E]
}): E[keyof E] {
  return Object.values(values).find((value): value is E[keyof E] => value === raw) ?? fallback
}
