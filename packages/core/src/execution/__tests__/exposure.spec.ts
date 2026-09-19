import { describe, expect, it } from 'bun:test'

import {
  EXPOSURE_HOST_SUFFIX,
  exposurePortFromHost,
  exposureUrlFor,
} from '../exposure'

describe('exposureUrlFor', () => {
  it('puts the container port in the hostname and the proxy port in the URL port', () => {
    expect(exposureUrlFor({ containerPort: 5173, hostPort: 20482 })).toBe(
      'http://5173.sandbox.localhost:20482',
    )
  })
})

describe('exposurePortFromHost', () => {
  it('parses a port-prefixed host with or without the URL port', () => {
    expect(exposurePortFromHost(`5173${EXPOSURE_HOST_SUFFIX}:20482`)).toBe(5173)
    expect(exposurePortFromHost(`3000${EXPOSURE_HOST_SUFFIX}`)).toBe(3000)
  })

  it('round-trips every URL exposureUrlFor builds', () => {
    for (const port of [1, 3000, 5173, 65_535]) {
      const url = new URL(exposureUrlFor({ containerPort: port, hostPort: 20482 }))
      expect(exposurePortFromHost(url.host)).toBe(port)
    }
  })

  it('rejects hosts outside the exposure suffix', () => {
    expect(exposurePortFromHost('5173.example.com')).toBeUndefined()
    expect(exposurePortFromHost('localhost:20482')).toBeUndefined()
    expect(exposurePortFromHost(`sandbox.localhost:20482`)).toBeUndefined()
  })

  it('rejects non-numeric and out-of-range prefixes', () => {
    expect(exposurePortFromHost(`web${EXPOSURE_HOST_SUFFIX}:20482`)).toBeUndefined()
    expect(exposurePortFromHost(`0${EXPOSURE_HOST_SUFFIX}:20482`)).toBeUndefined()
    expect(exposurePortFromHost(`65536${EXPOSURE_HOST_SUFFIX}:20482`)).toBeUndefined()
    expect(exposurePortFromHost(`123456${EXPOSURE_HOST_SUFFIX}:20482`)).toBeUndefined()
  })
})
