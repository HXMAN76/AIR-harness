/** Process streams used by the air-mcp command line; tests substitute them. @module */

/** Replaceable process facts. */
export const internals: {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
} = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}
