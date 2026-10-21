import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessLike, HarnessOptions } from './core/agent.ts'

/**
 * Create an SDK harness (the runtime subprocess starts on first use).
 * @param options - launch options.
 * @returns the harness.
 */
export function sdkHarness(options: HarnessOptions): HarnessLike {
  const { env, ...rest } = options
  return new DeepSeekHarness({ ...rest, ...env === undefined ? {} : { env: { ...env } } })
}
