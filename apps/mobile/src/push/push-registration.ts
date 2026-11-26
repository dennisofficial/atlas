export enum EPushSkipReason {
  NotNative = 'not-native',
  NotDevice = 'not-device',
  NoProjectId = 'no-project-id',
  PermissionDenied = 'permission-denied',
}

export enum EPushStep {
  Install = 'install',
  Token = 'token',
  Register = 'register',
}

export enum EPushRegistrationStatus {
  Idle = 'idle',
  Registering = 'registering',
  Registered = 'registered',
  Skipped = 'skipped',
  Failed = 'failed',
}

export type TPushTokenResult =
  | { status: 'ok'; token: string }
  | { status: 'skipped'; reason: EPushSkipReason }

export type TPushRegistration =
  | { status: EPushRegistrationStatus.Idle }
  | { status: EPushRegistrationStatus.Registering }
  | { status: EPushRegistrationStatus.Registered; deviceId: string }
  | { status: EPushRegistrationStatus.Skipped; reason: EPushSkipReason }
  | { status: EPushRegistrationStatus.Failed; step: EPushStep; message: string }

export type TPushRegistrationEvent = Record<string, string>

const skipLabels: Record<EPushSkipReason, string> = {
  [EPushSkipReason.NotNative]: 'Not available on this platform',
  [EPushSkipReason.NotDevice]: 'Not available in the simulator',
  [EPushSkipReason.NoProjectId]: 'No EAS project id in this build',
  [EPushSkipReason.PermissionDenied]: 'Permission denied',
}

const stepLabels: Record<EPushStep, string> = {
  [EPushStep.Install]: 'Install id',
  [EPushStep.Token]: 'Push token',
  [EPushStep.Register]: 'Registration',
}

export const pushRegistrationLabelOf = (registration: TPushRegistration): string => {
  switch (registration.status) {
    case EPushRegistrationStatus.Idle:
      return 'Not registered'
    case EPushRegistrationStatus.Registering:
      return 'Registering…'
    case EPushRegistrationStatus.Registered:
      return 'Registered'
    case EPushRegistrationStatus.Skipped:
      return skipLabels[registration.reason]
    case EPushRegistrationStatus.Failed:
      return `${stepLabels[registration.step]} failed: ${registration.message}`
  }
}

export const shouldRegisterOf = (registration: TPushRegistration): boolean => {
  if (registration.status === EPushRegistrationStatus.Idle) return true
  if (registration.status === EPushRegistrationStatus.Failed) return true
  if (registration.status !== EPushRegistrationStatus.Skipped) return false
  return registration.reason === EPushSkipReason.PermissionDenied
}

export const pushRegistrationEventOf = (
  registration: TPushRegistration,
): TPushRegistrationEvent | undefined => {
  switch (registration.status) {
    case EPushRegistrationStatus.Idle:
    case EPushRegistrationStatus.Registering:
      return undefined
    case EPushRegistrationStatus.Registered:
      return { status: registration.status }
    case EPushRegistrationStatus.Skipped:
      return { status: registration.status, reason: registration.reason }
    case EPushRegistrationStatus.Failed:
      return { status: registration.status, step: registration.step, message: registration.message }
  }
}

export const pushDeviceIdOf = (registration: TPushRegistration): string | undefined =>
  registration.status === EPushRegistrationStatus.Registered ? registration.deviceId : undefined
