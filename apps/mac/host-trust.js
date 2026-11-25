export const TRUSTED_HOSTNAME = '127.0.0.1'
export const VERDICT_TRUSTED = 0
export const VERDICT_DEFAULT = -3

export function certificateVerdictOf({ hostname, fingerprint, trusted }) {
  if (hostname !== TRUSTED_HOSTNAME) return VERDICT_DEFAULT
  return trusted.has(fingerprint) ? VERDICT_TRUSTED : VERDICT_DEFAULT
}

export function createHostTrust({ sessionOf }) {
  const trusted = new Set()
  let installed = false
  return {
    install: () => {
      if (installed) return
      installed = true
      sessionOf().setCertificateVerifyProc((request, callback) => {
        callback(
          certificateVerdictOf({
            hostname: request.hostname,
            fingerprint: request.certificate?.fingerprint,
            trusted,
          }),
        )
      })
    },
    trust: (fingerprint) => {
      if (typeof fingerprint === 'string' && fingerprint.length > 0) trusted.add(fingerprint)
    },
    trusted: () => [...trusted],
  }
}
