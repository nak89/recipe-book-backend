// Keep this entry point dependency-free so Render can distinguish starting
// Node from loading the application and finally accepting HTTP requests.
const started = performance.now()
console.info('[startup] Node started', { node: process.version, pid: process.pid })

void import('./index.js').then(() => {
  console.info('[startup] Application loaded', { elapsedMs: Math.round(performance.now() - started) })
}).catch((error: unknown) => {
  console.error('[startup] Application failed to load', error)
  process.exitCode = 1
})
