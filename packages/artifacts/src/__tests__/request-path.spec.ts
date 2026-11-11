import { describe, expect, it } from 'bun:test'

import { sanitizeRequestPath } from '../request-path'

const rejected: readonly string[] = [
  '/..',
  '/../secret',
  '/assets/../../secret',
  '/%2e%2e/secret',
  '/%2e%2e%2fsecret',
  '/..%2fsecret',
  '/assets%2f..%2f..%2fsecret',
  '/assets\\..\\..\\secret',
  '/index.html%00.js',
  '/%zz',
  '/',
  '/./',
  '///',
  '',
]

describe('sanitizeRequestPath', () => {
  it.each(rejected)('rejects %p', (pathname) => {
    expect(sanitizeRequestPath(pathname)).toBeNull()
  })

  it('strips the leading slash', () => {
    expect(sanitizeRequestPath('/index.html')).toBe('index.html')
  })

  it('collapses duplicate and trailing slashes', () => {
    expect(sanitizeRequestPath('//assets///app.js//')).toBe('assets/app.js')
  })

  it('drops dot segments', () => {
    expect(sanitizeRequestPath('/./assets/./app.js')).toBe('assets/app.js')
  })

  it('percent-decodes a segment', () => {
    expect(sanitizeRequestPath('/my%20page.html')).toBe('my page.html')
  })

  it('accepts a path with no leading slash', () => {
    expect(sanitizeRequestPath('assets/app.js')).toBe('assets/app.js')
  })

  it('keeps an encoded traversal inside a single segment literal', () => {
    expect(sanitizeRequestPath('/%252e%252e/x')).toBe('%2e%2e/x')
  })

  it('treats an absolute path as relative to the route tree', () => {
    expect(sanitizeRequestPath('/etc/passwd')).toBe('etc/passwd')
  })
})
