/**
 * Orb preview: drives the real window through idle, listening, thinking and speaking, speaks a sentence through
 * the real SAPI-to-renderer pipeline, saves a PNG per state, a contact sheet, and the measured frame rate.
 * Started by `scripts/orb-preview.ts` through `AIR_VOICE_PREVIEW=<output dir>`.
 */
import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Speaker } from './core/speaker.ts'

const SENTENCE = 'Opened Notepad. Anything else I can help you with today?'
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

interface Stats {
  frames: number
  fps: number
  worstMs: number
  backend: string
}

/** Run the preview and return the saved file paths and frame-rate stats per shot. */
export async function runPreview(win: BrowserWindow, speaker: Speaker, outDir: string): Promise<{ shots: string[]; sheet: string; stats: Record<string, Stats> }> {
  mkdirSync(outDir, { recursive: true })
  const view = win.webContents
  const send = (state: object): void => {
    view.send('state', { route: 'local', memoryShared: false, lang: 'en', ...state })
  }
  const stats = async (): Promise<Stats> => (await view.executeJavaScript('window.__orb.stats()')) as Stats
  const shots: string[] = []
  const all: Record<string, Stats> = {}
  const shoot = async (name: string): Promise<void> => {
    const image = await view.capturePage()
    const file = join(outDir, `${name}.png`)
    writeFileSync(file, image.toPNG())
    shots.push(file)
  }
  const phase = async (name: string, state: object, settle: number, shootNames: string[]): Promise<void> => {
    send(state)
    await wait(settle)
    await stats()
    for (const shot of shootNames) {
      await wait(700)
      await shoot(shot)
    }
    await wait(500)
    all[name] = await stats()
  }

  await wait(1200)
  await phase('idle', { phase: 'idle' }, 800, ['1-idle'])
  await phase('listening', { phase: 'awake', transcript: undefined }, 600, ['2-listening-a', '2-listening-b'])
  await phase('thinking', { phase: 'thinking', transcript: 'Open Notepad' }, 600, ['3-thinking'])

  send({ phase: 'speaking', transcript: 'Open Notepad', reply: SENTENCE })
  await stats()
  const spoken = speaker.speak(SENTENCE)
  await wait(1100)
  await shoot('4-speaking-a')
  await wait(450)
  await shoot('4-speaking-b')
  await spoken
  all['speaking'] = await stats()
  send({ phase: 'idle', transcript: 'Open Notepad', reply: SENTENCE })
  await wait(1200)
  await view.executeJavaScript('window.__orb.openPanel()')
  await wait(500)
  await shoot('5-settings')

  const sheet = join(outDir, 'contact-sheet.png')
  await contactSheet(shots, sheet)
  return { shots, sheet, stats: all }
}

/** Lay the shots side by side in a hidden window and capture it. */
async function contactSheet(files: string[], out: string): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const cells = files.map(file => `<img src="data:image/png;base64,${readFileSync(file).toString('base64')}">`).join('')
  const html = `<style>body{margin:0;overflow:hidden;background:#000;display:flex;flex-wrap:wrap;gap:6px;padding:6px}img{width:300px;display:block}</style>${cells}`
  const columns = 4
  const rows = Math.ceil(files.length / columns)
  const sheet = new BrowserWindow({ show: false, width: columns * 306 + 12, height: rows * 410 + 12, useContentSize: true, webPreferences: { offscreen: false } })
  await sheet.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await wait(500)
  writeFileSync(out, (await sheet.webContents.capturePage()).toPNG())
  sheet.destroy()
}
