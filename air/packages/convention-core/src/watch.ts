/** Polling change detection for convention files and directories, grouped by project. */
import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'

/**
 * File systems and the clock used for `listedAt` can disagree by a few milliseconds; a file whose
 * modification time is within this margin of the listing counts as modified after it.
 */
const CLOCK_SLACK_MS = 50

/** Settings for one {@link PollWatcher}. */
export interface PollWatcherOptions {
  /** Milliseconds between polls. */
  readonly intervalMs: number
  /** Maximum number of retained groups; the least recently retained group is released first. */
  readonly maxGroups: number
  /** Called once per poll in which a retained path was created, modified, or removed, and once after a group was released. */
  readonly onChange: () => void
  /** Receives an error thrown by `onChange` during a timer-driven poll. */
  readonly onError: (error: unknown) => void
}

interface Group {
  /** Millisecond timestamp taken before the group's files were listed. */
  readonly listedAt: number
  /** Path to its last fingerprint; undefined until the first poll. */
  readonly paths: Map<string, string | undefined>
}

interface Fingerprint {
  readonly key: string
  readonly modifiedMs: number
}

async function fingerprint(path: string): Promise<Fingerprint> {
  let info: Stats | undefined
  let code: unknown
  try {
    info = await stat(path)
  } catch (error: unknown) {
    // Absence is a normal state; any other failure is a state that must not look like a change.
    code = (error as NodeJS.ErrnoException).code
  }
  if (info !== undefined) return { key: `${info.mtimeMs}:${info.size}`, modifiedMs: info.mtimeMs }
  return { key: code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'unreadable', modifiedMs: 0 }
}

/**
 * Watches the paths of a bounded number of project groups with one timer. A path that does not exist
 * yet is reported when it appears. The timer does not keep the process alive, and each poll costs one
 * `stat` per retained path.
 */
export class PollWatcher {
  private readonly retained = new Map<string, Group>()
  private timer: NodeJS.Timeout | undefined
  private closed = false

  /** @param options - poll interval, group limit, and callbacks. */
  constructor(private readonly options: PollWatcherOptions) {}

  /**
   * Replace the paths of one group and mark the group as the most recently used. Releasing the oldest
   * group when the limit is exceeded schedules one `onChange`, because a catalog built from a released
   * group is no longer watched.
   * @param group - key of the project the paths belong to.
   * @param paths - absolute paths of files or directories, existing or not.
   * @param listedAt - `Date.now()` taken before the files were listed; a path modified after it counts as changed.
   */
  retain(group: string, paths: Iterable<string>, listedAt: number): void {
    if (this.closed) return
    this.retained.delete(group)
    this.retained.set(group, { listedAt, paths: new Map([...paths].map(path => [path, undefined])) })
    let released = false
    for (const key of this.retained.keys()) {
      if (this.retained.size <= this.options.maxGroups) break
      this.retained.delete(key)
      released = true
    }
    if (released) queueMicrotask(() => { if (!this.closed) this.options.onChange() })
    this.schedule()
  }

  /** Keys of the retained groups, least recently retained first. */
  get groups(): string[] {
    return [...this.retained.keys()]
  }

  /**
   * Compare every retained path with its last fingerprint and call `onChange` once when any differs.
   * The timer calls this method; tests call it directly.
   */
  async pollOnce(): Promise<void> {
    let changed = false
    for (const group of [...this.retained.values()]) {
      for (const [path, previous] of [...group.paths]) {
        const current = await fingerprint(path)
        const differs = previous === undefined
          ? current.key !== 'absent' && current.key !== 'unreadable' && current.modifiedMs > group.listedAt - CLOCK_SLACK_MS
          : previous !== current.key
        if (differs) changed = true
        group.paths.set(path, current.key)
      }
    }
    if (changed && !this.closed) this.options.onChange()
  }

  /** Stop the timer and release every group. Later `retain` calls do nothing. */
  close(): void {
    this.closed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.retained.clear()
  }

  private schedule(): void {
    if (this.timer !== undefined || this.closed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.pollOnce()
        .catch((error: unknown) => { this.options.onError(error) })
        .finally(() => { this.schedule() })
    }, this.options.intervalMs)
    this.timer.unref()
  }
}
