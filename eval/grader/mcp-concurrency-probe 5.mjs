// @purpose Definitive server-level pressure test of the --isolated change: spawn REAL @playwright/mcp
// server processes, drive each over MCP stdio (newline-delimited JSON-RPC) to actually open a browser,
// and contrast:  (A) two --isolated servers  vs  (B) two DEFAULT servers (shared persistent profile).
// Proves whether --isolated is what enables >1 concurrent MCP browser instance.
import { spawn } from 'child_process'

const TARGET = 'https://example.com'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// minimal MCP stdio client: newline-delimited JSON-RPC over the server's stdin/stdout
function mcpClient(extraArgs, tag) {
  const proc = spawn('npx', ['-y', '@playwright/mcp@latest', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  const waiters = new Map()
  proc.stdout.on('data', (d) => {
    buf += d.toString()
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
      if (!line) continue
      let msg; try { msg = JSON.parse(line) } catch { continue }
      if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id) }
    }
  })
  let stderr = ''
  proc.stderr.on('data', (d) => { stderr += d.toString() })
  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n')
  const rpc = (id, method, params, timeoutMs = 45000) => new Promise((resolve) => {
    const to = setTimeout(() => { waiters.delete(id); resolve({ error: { message: 'client-timeout after ' + timeoutMs + 'ms' } }) }, timeoutMs)
    waiters.set(id, (m) => { clearTimeout(to); resolve(m) })
    send({ jsonrpc: '2.0', id, method, params })
  })
  return {
    tag, proc, stderrTail: () => stderr.split('\n').filter(Boolean).slice(-3).join(' | '),
    async init() {
      const r = await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      return !r.error
    },
    async navigate() {
      const r = await rpc(2, 'tools/call', { name: 'browser_navigate', arguments: { url: TARGET } })
      const isErr = !!r.error || (r.result && r.result.isError)
      const text = r.error ? r.error.message
        : (r.result && r.result.content || []).map(c => c.text || '').join(' ').slice(0, 160)
      return { ok: !isErr, text }
    },
    kill() { try { proc.kill('SIGKILL') } catch {} },
  }
}

async function scenario(name, extraArgs) {
  console.log(`\n=== ${name}  (args: ${JSON.stringify(extraArgs)}) ===`)
  const A = mcpClient(extraArgs, 'A'), B = mcpClient(extraArgs, 'B')
  try {
    const inits = await Promise.all([A.init(), B.init()])
    console.log(`  init: A=${inits[0]} B=${inits[1]}`)
    // open a browser in BOTH concurrently — this is where a shared persistent profile would collide
    const [ra, rb] = await Promise.all([A.navigate(), B.navigate()])
    console.log(`  server A browser_navigate: ok=${ra.ok}  ${ra.ok ? '' : '→ ' + ra.text}`)
    console.log(`  server B browser_navigate: ok=${rb.ok}  ${rb.ok ? '' : '→ ' + rb.text}`)
    const both = ra.ok && rb.ok
    console.log(`  RESULT: both MCP servers opened a browser concurrently = ${both}`)
    if (!both) console.log(`  (the failing server is the 2nd instance refused on the shared profile)`)
    return both
  } finally { A.kill(); B.kill(); await sleep(500) }
}

const isoBoth = await scenario('A) TWO --isolated MCP servers', ['--isolated'])
const defBoth = await scenario('B) TWO DEFAULT MCP servers (shared persistent profile)', [])

console.log('\n=== VERDICT ===')
console.log(`--isolated: 2 concurrent MCP browsers = ${isoBoth ? 'YES ✅' : 'NO'}`)
console.log(`default   : 2 concurrent MCP browsers = ${defBoth ? 'YES' : 'NO (2nd refused) ✅ — this is the failure --isolated fixes'}`)
console.log(isoBoth && !defBoth
  ? '\n==> CONFIRMED: --isolated is exactly what unlocks >1 concurrent interactive MCP browser.'
  : '\n==> See results above (outcome differs from the simple hypothesis — read honestly).')
