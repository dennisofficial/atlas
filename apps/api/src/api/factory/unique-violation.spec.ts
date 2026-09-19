import { describe, expect, it } from 'vitest'
import { Prisma } from '../../generated/prisma/client'
import { inconsistentStore, isUniqueViolation } from './unique-violation'

const p2002 = (target: readonly string[]): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta: { target: [...target] },
  })

const p2002DriverAdapter = (fields: readonly string[]): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { kind: 'UniqueConstraintViolation', constraint: { fields: [...fields] } },
      },
    },
  })

describe('isUniqueViolation', () => {
  it('matches a P2002 on exactly the expected target', () => {
    expect(isUniqueViolation(p2002(['surface', 'deliveryId']), ['surface', 'deliveryId'])).toBe(true)
  })

  it('reads the driver-adapter constraint shape, unquoting camelCase columns', () => {
    expect(
      isUniqueViolation(p2002DriverAdapter(['surface', '"deliveryId"']), ['surface', 'deliveryId']),
    ).toBe(true)
  })

  it('rejects a driver-adapter violation on a different constraint', () => {
    expect(isUniqueViolation(p2002DriverAdapter(['id']), ['surface', 'deliveryId'])).toBe(false)
  })

  it('is insensitive to target order', () => {
    expect(isUniqueViolation(p2002(['deliveryId', 'surface']), ['surface', 'deliveryId'])).toBe(true)
  })

  it('rejects a P2002 on a different constraint, so unrelated violations surface raw', () => {
    expect(isUniqueViolation(p2002(['id']), ['surface', 'deliveryId'])).toBe(false)
  })

  it('rejects other Prisma codes and non-Prisma errors', () => {
    const other = new Prisma.PrismaClientKnownRequestError('gone', {
      code: 'P2025',
      clientVersion: Prisma.prismaVersion.client,
    })
    expect(isUniqueViolation(other, ['id'])).toBe(false)
    expect(isUniqueViolation(new Error('nope'), ['id'])).toBe(false)
    expect(isUniqueViolation('P2002', ['id'])).toBe(false)
  })

  it('rejects a P2002 without meta rather than guessing', () => {
    const bare = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    })
    expect(isUniqueViolation(bare, ['surface'])).toBe(false)
  })
})

describe('inconsistentStore', () => {
  it('names the missing row', () => {
    expect(inconsistentStore('alias').message).toContain('stored alias')
  })
})
