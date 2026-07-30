#!/usr/bin/env node
/** Verify the randomized KDP request throttle: every gap lands inside [min, max]. */
import {
  kdpThrottle,
  getKdpRequestDelayRangeMs,
  nextKdpDelayMs,
  resetKdpThrottle,
} from '../server/src/kdpRateLimit.js'

const { minMs, maxMs } = getKdpRequestDelayRangeMs()
console.log(`Configured delay window: ${minMs}-${maxMs}ms`)

if (minMs <= 0 && maxMs <= 0) {
  console.log('Throttle disabled (window <= 0) — skip timing check.')
  process.exit(0)
}

// Draws must stay in range, and with a real window must actually vary.
const draws = Array.from({ length: 200 }, () => nextKdpDelayMs())
const outOfRange = draws.filter((d) => d < minMs || d > maxMs)
if (outOfRange.length > 0) {
  console.error(`FAIL: ${outOfRange.length} draw(s) outside [${minMs}, ${maxMs}], e.g. ${outOfRange[0]}ms`)
  process.exit(1)
}
const distinct = new Set(draws).size
if (maxMs > minMs && distinct < 2) {
  console.error('FAIL: delay never varied — randomization is not active')
  process.exit(1)
}
console.log(`Draws: ${draws.length} in range, ${distinct} distinct values`)

// Real timing: three sequential calls, each gap must clear the minimum.
resetKdpThrottle()
const marks = [Date.now()]
await kdpThrottle()
marks.push(Date.now())
await kdpThrottle()
marks.push(Date.now())
await kdpThrottle()
marks.push(Date.now())

const gaps = marks.slice(1).map((t, i) => t - marks[i])
console.log(`Observed gaps: ${gaps.map((g) => `${g}ms`).join(', ')}`)

const tolerance = 50
const tooShort = gaps.slice(1).filter((g) => g < minMs - tolerance)
if (tooShort.length > 0) {
  console.error(`FAIL: gap of ${tooShort[0]}ms is below the ${minMs}ms minimum`)
  process.exit(1)
}
const tooLong = gaps.slice(1).filter((g) => g > maxMs + 1000)
if (tooLong.length > 0) {
  console.error(`FAIL: gap of ${tooLong[0]}ms exceeds the ${maxMs}ms maximum`)
  process.exit(1)
}

console.log(`PASS: throttle enforces a random ${minMs}-${maxMs}ms gap`)
