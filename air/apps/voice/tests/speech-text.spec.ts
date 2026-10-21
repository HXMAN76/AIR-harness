import { describe, expect, it } from 'vitest'
import { NOTHING_TO_SAY, hasTamilScript, toSpokenText } from '../src/core/speech-text.ts'

describe('toSpokenText', () => {
  it('drops Markdown emphasis and replaces a bare URL', () => {
    expect(toSpokenText('**Done.** See https://x.y')).toBe('Done. See the link on screen.')
  })

  it('falls back when the reply is only a fenced code block', () => {
    expect(toSpokenText('```powershell\nGet-Date\n```')).toBe('Done. The details are on screen.')
    expect(NOTHING_TO_SAY).toBe('Done. The details are on screen.')
  })

  it('falls back on an empty or blank reply', () => {
    expect(toSpokenText('')).toBe(NOTHING_TO_SAY)
    expect(toSpokenText('  \n ')).toBe(NOTHING_TO_SAY)
    expect(toSpokenText('***')).toBe(NOTHING_TO_SAY)
  })

  it('speaks the first two sentences of a reply longer than 60 words', () => {
    const filler = Array.from({ length: 70 }, () => 'word').join(' ')
    const reply = `First sentence here. Second one follows! ${filler}.`
    expect(toSpokenText(reply)).toBe('First sentence here. Second one follows!')
  })

  it('keeps a reply of 60 words or fewer whole', () => {
    const reply = `${Array.from({ length: 58 }, () => 'word').join(' ')}. Last two.`
    expect(toSpokenText(reply)).toBe(reply)
  })

  it('joins Markdown list items with commas', () => {
    expect(toSpokenText('Your list:\n- buy milk\n- call Ravi')).toBe('Your list: buy milk, call Ravi.')
    expect(toSpokenText('Steps:\n1. open Notepad\n2) type the text\n* save it\n\nAll set.')).toBe('Steps: open Notepad, type the text, save it. All set.')
  })

  it('keeps the text of links, inline code, and headings', () => {
    expect(toSpokenText('# Weather\nIt is [sunny](https://w.example) in `Chennai`.')).toBe('Weather It is sunny in Chennai.')
  })

  it('removes block quotes, underscores emphasis, and a trailing colon', () => {
    expect(toSpokenText('> __Note__: here is the code:\n```\nx\n```')).toBe('Note: here is the code.')
    expect(toSpokenText('> Quoted\n>\n> on two lines')).toBe('Quoted on two lines.')
  })

  it('leaves ending punctuation alone', () => {
    expect(toSpokenText('Is that all?')).toBe('Is that all?')
  })
})

describe('hasTamilScript', () => {
  it('detects Tamil script and nothing else', () => {
    expect(hasTamilScript('வணக்கம் friend')).toBe(true)
    expect(hasTamilScript('Hello, vanakkam')).toBe(false)
  })
})
