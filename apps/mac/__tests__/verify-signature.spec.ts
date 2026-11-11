import { describe, expect, test } from 'bun:test'

import { signatureProblems } from '../scripts/verify-signature'

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>`

const SIGNED = `Executable=/tmp/Atlas.app/Contents/Resources/bin/bun
Identifier=bun
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=120943 flags=0x10000(runtime) hashes=3769+7 location=embedded
Signature size=9049
Authority=Developer ID Application: Dennis Lysenko (9H7HK25CVR)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=9H7HK25CVR
Sealed Resources=none`

const UNQUALIFIED = `Executable=/tmp/Atlas.app/Contents/Resources/bin/bun
Identifier=bun
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=120943 flags=0x10000(runtime) hashes=3769+7 location=embedded
Signature size=9049
TeamIdentifier=9H7HK25CVR
Sealed Resources=none`

describe('signatureProblems', () => {
  test('passes a runtime that carries the identity, the runtime flag and the JIT entitlement', () => {
    expect(signatureProblems({ codesign: SIGNED, entitlements: ENTITLEMENTS })).toEqual([])
  })

  test('reads the authority from the display codesign prints at -dvv, not the one it prints at -dv', () => {
    expect(signatureProblems({ codesign: UNQUALIFIED, entitlements: ENTITLEMENTS })).toEqual([
      'the bun runtime is not Developer ID signed',
    ])
  })

  test('rejects a runtime signed without the hardened runtime', () => {
    const adHoc = SIGNED.replace('flags=0x10000(runtime)', 'flags=0x0(none)')
    expect(signatureProblems({ codesign: adHoc, entitlements: ENTITLEMENTS })).toEqual([
      'the bun runtime is not signed with the hardened runtime',
    ])
  })

  test('rejects a runtime without the JIT entitlement, which hardened runtime needs to start bun', () => {
    const bare = ENTITLEMENTS.replace(
      'com.apple.security.cs.allow-jit',
      'com.apple.security.network.client',
    )
    expect(signatureProblems({ codesign: SIGNED, entitlements: bare })).toEqual([
      'the bun runtime cannot use the JIT',
    ])
  })
})
