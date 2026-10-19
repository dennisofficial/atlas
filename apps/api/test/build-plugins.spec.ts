import { describe, expect, it } from 'vitest'
import { assertNoRuntimeRequires, findRuntimeRequires } from '../build-plugins'

const bundleWithRequire = `
import { createRequire as createRequire2 } from "module";
require$1 = createRequire2(import.meta.url);
function load() { return require$1("express"); }
function builtin() { return require$1("node:fs") + require$1("crypto"); }
function relative() { return require$1("./local.js"); }
function inline() { return createRequire(import.meta.url)("@scope/pkg"); }
`

describe('findRuntimeRequires', () => {
  it('finds bare package names required through createRequire, aliased or inline', () => {
    expect(findRuntimeRequires({ bundle: bundleWithRequire })).toEqual(['express', '@scope/pkg'])
  })

  it('ignores a bundle that never uses createRequire', () => {
    expect(findRuntimeRequires({ bundle: 'const express = require("express")' })).toEqual([])
  })
})

describe('assertNoRuntimeRequires', () => {
  it('throws naming every escaped package', () => {
    expect(() => assertNoRuntimeRequires({ bundle: bundleWithRequire, allowed: [] })).toThrow(/"express", "@scope\/pkg"/)
  })

  it('passes when every escape is allowed', () => {
    expect(() =>
      assertNoRuntimeRequires({ bundle: bundleWithRequire, allowed: ['express', '@scope/pkg'] }),
    ).not.toThrow()
  })
})
