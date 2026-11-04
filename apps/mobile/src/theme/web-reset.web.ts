const RESET_ID = 'atlas-web-reset'

export const installWebReset = (): void => {
  if (typeof document === 'undefined' || document.getElementById(RESET_ID) !== null) return
  const style = document.createElement('style')
  style.id = RESET_ID
  style.textContent =
    'input:focus, input:focus-visible, textarea:focus, textarea:focus-visible { outline: none; }'
  document.head.append(style)
}
