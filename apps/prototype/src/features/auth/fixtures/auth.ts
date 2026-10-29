export interface AuthPerson {
  name: string
  email: string
  initials: string
}

export const AUTH_USER: AuthPerson = {
  name: 'Ada Lovelace',
  email: 'ada@analytical.dev',
  initials: 'AL',
}

export const AUTH_DEVICE_CODE = 'WDJB-MJHT'
export const AUTH_LOGIN_COMMAND = 'atlas login'
export const AUTH_INSTALL_COMMAND = 'curl -fsSL https://install.byatlas.io | bash'
export const AUTH_RESEND_COOLDOWN_SECONDS = 30
export const AUTH_PASSWORD_MIN_LENGTH = 8
