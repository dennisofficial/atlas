#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/25f527937b651ef80d37bd709e3b809696f9475417e6b889079f399cc70f116c/contract';
import startContract from '../../snapshots/25f527937b651ef80d37bd709e3b809696f9475417e6b889079f399cc70f116c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d23bb282103f356355aa25e6ef1b04f866cf8ec2c86579853d9410d1f7f0831e/contract';
import endContract from '../../snapshots/d23bb282103f356355aa25e6ef1b04f866cf8ec2c86579853d9410d1f7f0831e/contract.json' with { type: 'json' };
import {
  createMainAndTeammateSessions,
  assignSubAgentsToAncestorSession,
  createSessionsForRemainingThreads,
  linkTeammateSessionsToManager,
  moveSandboxRowsToSessions,
} from './data-steps';
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'Session',
        columns: [
          col('archivedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('executionLocation', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mainThreadId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('managedBySessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('pinnedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('projectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('repo', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('workspace', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'CloudSandbox',
        column: col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'SandboxBootStep',
        column: col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      createMainAndTeammateSessions,
      assignSubAgentsToAncestorSession,
      createSessionsForRemainingThreads,
      linkTeammateSessionsToManager,
      moveSandboxRowsToSessions,
      this.dropConstraint({
        schema: 'public',
        table: 'CloudSandbox',
        constraint: 'CloudSandbox_threadId_fkey',
        kind: 'foreignKey',
      }),
      this.dropConstraint({
        schema: 'public',
        table: 'CloudSandbox',
        constraint: 'CloudSandbox_threadId_key',
      }),
      this.dropColumn({ schema: 'public', table: 'CloudSandbox', column: 'threadId' }),
      this.dropConstraint({
        schema: 'public',
        table: 'SandboxBootStep',
        constraint: 'SandboxBootStep_threadId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'SandboxBootStep',
        index: 'SandboxBootStep_threadId_at_idx',
      }),
      this.dropColumn({ schema: 'public', table: 'SandboxBootStep', column: 'threadId' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'archivedAt' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'executionLocation' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'pinnedAt' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'title' }),
      this.dropConstraint({
        schema: 'public',
        table: 'Thread',
        constraint: 'Thread_projectId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({ schema: 'public', table: 'Thread', index: 'Thread_projectId_idx' }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'projectId' }),
      this.dropIndex({
        schema: 'public',
        table: 'Thread',
        index: 'Thread_userId_repo_updatedAt_idx',
      }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'repo' }),
      this.dropIndex({
        schema: 'public',
        table: 'Thread',
        index: 'Thread_userId_workspace_updatedAt_idx',
      }),
      this.dropColumn({ schema: 'public', table: 'Thread', column: 'workspace' }),
      this.setNotNull({ schema: 'public', table: 'CloudSandbox', column: 'sessionId' }),
      this.setNotNull({ schema: 'public', table: 'SandboxBootStep', column: 'sessionId' }),
      this.setNotNull({ schema: 'public', table: 'Thread', column: 'sessionId' }),
      this.addUnique({
        schema: 'public',
        table: 'CloudSandbox',
        constraint: 'CloudSandbox_sessionId_key',
        columns: ['sessionId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Session',
        constraint: 'Session_mainThreadId_key',
        columns: ['mainThreadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'SandboxBootStep',
        index: 'SandboxBootStep_sessionId_at_idx',
        columns: ['sessionId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_managedBySessionId_idx',
        columns: ['managedBySessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_projectId_idx',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_userId_repo_updatedAt_idx',
        columns: ['userId', 'repo', 'updatedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_userId_updatedAt_idx',
        columns: ['userId', 'updatedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_userId_workspace_updatedAt_idx',
        columns: ['userId', 'workspace', 'updatedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Thread',
        index: 'Thread_sessionId_idx',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Session',
        foreignKey: {
          name: 'Session_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Session',
        foreignKey: {
          name: 'Session_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Session',
        foreignKey: {
          name: 'Session_mainThreadId_fkey',
          columns: ['mainThreadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Session',
        foreignKey: {
          name: 'Session_managedBySessionId_fkey',
          columns: ['managedBySessionId'],
          references: { schema: 'public', table: 'Session', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'CloudSandbox',
        foreignKey: {
          name: 'CloudSandbox_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'SandboxBootStep',
        foreignKey: {
          name: 'SandboxBootStep_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Thread',
        foreignKey: {
          name: 'Thread_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
