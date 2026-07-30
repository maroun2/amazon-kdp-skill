import {
  KDP_REQUEST_DELAY_MAX_MS,
  KDP_REQUEST_DELAY_MIN_MS,
} from './config.js'

let lastRequestAt = 0

/** Configured throttle window (ms) between outbound KDP requests. */
export function getKdpRequestDelayRangeMs(): { minMs: number; maxMs: number } {
  return { minMs: KDP_REQUEST_DELAY_MIN_MS, maxMs: KDP_REQUEST_DELAY_MAX_MS }
}

/**
 * Back-compat shim: the throttle is a random window now, so there is no single
 * delay. Returns the minimum — the floor every gap is guaranteed to clear.
 */
export function getKdpRequestDelayMs(): number {
  return KDP_REQUEST_DELAY_MIN_MS
}

/** Uniform draw from [min, max]. */
export function nextKdpDelayMs(): number {
  const { minMs, maxMs } = getKdpRequestDelayRangeMs()
  if (maxMs <= minMs) return minMs
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
}

/**
 * Wait until a freshly drawn delay (4-10s by default) has passed since the last
 * KDP request. Call before every page.goto, fetch, and page.request to Amazon
 * KDP domains.
 */
export async function kdpThrottle(): Promise<void> {
  const delayMs = nextKdpDelayMs()
  if (delayMs <= 0) return

  const now = Date.now()
  const elapsed = lastRequestAt > 0 ? now - lastRequestAt : delayMs
  if (elapsed < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed))
  }
  lastRequestAt = Date.now()
}

/** Reset throttle clock (e.g. after a long idle gap is unnecessary — skip for simplicity). */
export function resetKdpThrottle(): void {
  lastRequestAt = 0
}
