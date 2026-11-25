import { describe, expect, test } from 'bun:test'
import { createHash, X509Certificate } from 'node:crypto'
import { createSecureServer } from 'node:http2'
import { connect } from 'node:tls'

import { createSelfSignedCert } from '../tls/self-signed'

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0)

describe('createSelfSignedCert', () => {
  test('names 127.0.0.1 in the subject alternative name and is valid now', () => {
    const { certPem } = createSelfSignedCert({ now: NOW })
    const certificate = new X509Certificate(certPem)
    expect(certificate.subjectAltName).toContain('IP Address:127.0.0.1')
    expect(certificate.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(Date.parse(certificate.validFrom)).toBeLessThan(NOW)
    expect(Date.parse(certificate.validTo)).toBeGreaterThan(NOW + 396 * 86_400_000)
  })

  test('fingerprints the raw DER the way Electron reports a certificate', () => {
    const { certPem, fingerprint } = createSelfSignedCert({ now: NOW })
    const raw = Buffer.from(new X509Certificate(certPem).raw)
    expect(fingerprint).toBe(`sha256/${createHash('sha256').update(raw).digest('base64')}`)
  })

  test('a TLS client that trusts the certificate verifies the connection', async () => {
    const { certPem, keyPem } = createSelfSignedCert({ now: NOW })
    const server = createSecureServer({ cert: certPem, key: keyPem })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      const authorized = await new Promise<boolean>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port, ca: certPem })
        socket.once('secureConnect', () => {
          const result = socket.authorized
          socket.destroy()
          resolve(result)
        })
        socket.once('error', reject)
      })
      expect(authorized).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test('every start mints its own key and certificate', () => {
    const first = createSelfSignedCert({ now: NOW })
    const second = createSelfSignedCert({ now: NOW })
    expect(first.fingerprint).not.toBe(second.fingerprint)
    expect(first.keyPem).not.toBe(second.keyPem)
  })
})
