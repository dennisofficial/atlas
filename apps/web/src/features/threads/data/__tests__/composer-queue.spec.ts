import { describe, expect, it } from 'bun:test'

import { queuedOf, takeBackableIdOf } from '../composer-queue'

describe('queuedOf', () => {
  it('shows each pending entry as an editable queued message', () => {
    expect(
      queuedOf([
        { id: 'p1', text: 'a', reserved: false },
        { id: 'p2', text: 'b', via: 'parent-agent', reserved: true },
      ]),
    ).toEqual([
      { id: 'p1', text: 'a', attachments: [] },
      { id: 'p2', text: 'b', attachments: [] },
    ])
  })
})

describe('takeBackableIdOf', () => {
  it('picks the newest unreserved operator entry', () => {
    expect(
      takeBackableIdOf([
        { id: 'p1', text: 'a', reserved: false },
        { id: 'p2', text: 'b', reserved: false },
        { id: 'p3', text: 'c', via: 'parent-agent', reserved: false },
        { id: 'p4', text: 'd', reserved: true },
      ]),
    ).toBe('p2')
  })

  it('is null when nothing can be taken back', () => {
    expect(takeBackableIdOf([])).toBeNull()
  })
})

describe('queuedOf uploads', () => {
  it('shows entry uploads as attachment chips', () => {
    const [entry] = queuedOf([
      {
        id: 'p1',
        text: 'a',
        reserved: false,
        uploads: [
          {
            uploadId: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01',
            pathname: 'p',
            name: 'r.pdf',
            size: 9,
            mediaType: 'application/pdf',
          },
          {
            uploadId: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a02',
            pathname: 'p',
            name: 's.png',
            size: 4,
            mediaType: 'image/png',
          },
        ],
      },
    ])
    expect(entry?.attachments).toEqual([
      { id: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01', name: 'r.pdf', kind: 'file', size: 9 },
      { id: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a02', name: 's.png', kind: 'image', size: 4 },
    ])
  })
})
