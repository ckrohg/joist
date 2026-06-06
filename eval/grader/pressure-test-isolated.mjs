// @purpose Pressure-test the --isolated MCP change: prove (1) the shared persistent-profile lock
// is real (MCP default mode), (2) ephemeral/isolated browsers run truly concurrently with no lock
// (MCP --isolated mode), (3) it holds RIGHT NOW while round 44 already runs ~16 browsers.
// Faithful mapping: @playwright/mcp default = launchPersistentContext(fixedDir); --isolated = launch()+ephemeral ctx.
import { chromium } from 'playwright'
import fs from 'fs'

const TARGET = 'https://example.com'           // light, reliable — isolates BROWSER concurrency, not network
const SHARED_DIR = '/tmp/pw-lock-probe-profile'
const now = () => Number(process.hrtime.bigint() / 1000000n)

// ---------- TEST 1: shared persistent profile (MCP DEFAULT) → expect a lock/contention ----------
async function test1() {
  console.log('\n=== TEST 1 — shared persistent profile (mirrors MCP default mode) ===')
  try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }) } catch {}
  let a, locked = false, errMsg = ''
  try {
    a = await chromium.launchPersistentContext(SHARED_DIR, { headless: true })
    console.log('  browser A: opened persistent profile', SHARED_DIR)
    // while A holds the profile, try a SECOND browser on the SAME dir (what 2 MCP ops would do)
    const t = now()
    try {
      const b = await chromium.launchPersistentContext(SHARED_DIR, { headless: true, timeout: 15000 })
      console.log('  browser B: opened too (no hard lock) after', now() - t, 'ms — checking if it actually attached cleanly')
      await b.close()
    } catch (e) {
      locked = true; errMsg = (e.message || '').split('\n')[0]
      console.log('  browser B: FAILED after', now() - t, 'ms →', errMsg)
    }
  } finally { if (a) await a.close() }
  console.log('  RESULT: shared-profile contention reproduced =', locked || 'no-hard-throw (see note)')
  return { locked, errMsg }
}

// ---------- TEST 2: ephemeral isolated browsers (MCP --isolated) → concurrent, no lock ----------
async function oneIsolatedShot(i) {
  const t = now()
  const browser = await chromium.launch({ headless: true })           // ephemeral, no shared dir
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const page = await ctx.newPage()
  await page.goto(TARGET, { waitUntil: 'load', timeout: 30000 })
  await page.screenshot({ path: `/tmp/pw-iso-${i}.png` })
  await browser.close()
  return now() - t
}
async function test2(N) {
  console.log(`\n=== TEST 2 — ${N} ephemeral isolated browsers (mirrors MCP --isolated) ===`)
  // CONCURRENT
  const tc = now()
  const conc = await Promise.allSettled(Array.from({ length: N }, (_, i) => oneIsolatedShot(i)))
  const concMs = now() - tc
  const ok = conc.filter(r => r.status === 'fulfilled').length
  const fail = conc.filter(r => r.status === 'rejected')
  console.log(`  CONCURRENT: ${ok}/${N} succeeded in ${concMs}ms wall-clock` + (fail.length ? ` | failures: ${fail.map(f => (f.reason.message||'').split('\n')[0]).join(' ; ')}` : ' | failures: 0'))
  // SEQUENTIAL (same work, one at a time) for the speedup ratio
  const ts = now(); let seqOk = 0
  for (let i = 0; i < N; i++) { try { await oneIsolatedShot(100 + i); seqOk++ } catch {} }
  const seqMs = now() - ts
  console.log(`  SEQUENTIAL: ${seqOk}/${N} succeeded in ${seqMs}ms wall-clock`)
  console.log(`  => concurrency speedup: ${(seqMs / concMs).toFixed(2)}x  (concurrent ${concMs}ms vs sequential ${seqMs}ms)`)
  return { N, ok, failCount: fail.length, concMs, seqMs, speedup: +(seqMs / concMs).toFixed(2) }
}

const r1 = await test1()
const r2 = await test2(6)
console.log('\n=== SUMMARY ===')
console.log('persistent-shared lock reproduced:', r1.locked, r1.errMsg ? `(“${r1.errMsg}”)` : '')
console.log(`isolated concurrency: ${r2.ok}/${r2.N} ok, ${r2.failCount} fail, ${r2.speedup}x speedup, all while round 44 runs its own browsers`)
try { fs.rmSync(SHARED_DIR, { recursive: true, force: true }) } catch {}
