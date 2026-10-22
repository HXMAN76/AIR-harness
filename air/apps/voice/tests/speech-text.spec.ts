import { describe, expect, it } from 'vitest'
import { MORE_ON_SCREEN, NOTHING_TO_SAY, hasTamilScript, numberToWords, splitSentences, toSpokenText } from '../src/core/speech-text.ts'

const NOW = new Date('2026-10-22T10:00:00')
const say = (text: string): string => toSpokenText(text, NOW)

describe('toSpokenText: cleaning', () => {
  it.each([
    ['**Done.** See https://x.y', 'Done. See the link on screen.'],
    ['# Weather\nIt is [sunny](https://w.example) in `Chennai`.', 'Weather It is sunny in Chennai.'],
    ['> __Note__: here is the code:\n```\nx\n```', 'Note, here is the code.'],
    ['> Quoted\n>\n> on two lines', 'Quoted on two lines.'],
    ['Is that all?', 'Is that all?'],
    ['Great 🎉 news 👍🏽 today.', 'Great news today.'],
    ['Done → next ★ step • one ✓ ok.', 'Done next step one ok.'],
    ['Wait!!! Really?! Hmm... fine…', 'Wait! Really? Hmm. Fine.'],
    ['See <b>bold</b> text [1] here.', 'See bold text here.'],
    ['Write to me@example.com or visit example.com/page now.', 'Write to an email address or visit the link on screen now.'],
    ['Open C:\\Users\\Me\\notes.txt please.', 'Open a file path on screen please.'],
    ['Id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 and deadbeefdeadbeef12 done.', 'Id a long ID and a long ID done.'],
    ['It is (really) fine.', 'It is, really, fine.'],
    ['Note: this works; mostly.', 'Note, this works, mostly.'],
    ['a | b | c', 'A b c.'],
  ])('%j', (input, expected) => {
    expect(say(input)).toBe(expected)
  })

  it('falls back when nothing speakable is left', () => {
    expect(say('```powershell\nGet-Date\n```')).toBe(NOTHING_TO_SAY)
    expect(NOTHING_TO_SAY).toBe('Done. The details are on screen.')
    for (const empty of ['', '  \n ', '***', '🎉', '(x).'.slice(0, 0)]) expect(say(empty)).toBe(NOTHING_TO_SAY)
  })

  it('falls back when only punctuation survives expansion', () => {
    expect(say('1 ...')).not.toBe('')
    expect(say('- - -\n---')).toBe(NOTHING_TO_SAY)
  })
})

describe('toSpokenText: lists', () => {
  it('joins Markdown list items with commas', () => {
    expect(say('Your list:\n- buy milk\n- call Ravi')).toBe('Your list, buy milk, call Ravi.')
    expect(say('Steps:\n1. open Notepad\n2) type the text\n* save it\n\nAll set.')).toBe('Steps, open Notepad, type the text, save it. All set.')
  })

  it('speaks the first three items and counts the rest', () => {
    expect(say('Mail:\n- a one\n- b two\n- c three\n- d four\n- e five')).toBe('Mail, a one, b two, c three, and two more on screen.')
  })

  it('drops "Step 1:" numbering words', () => {
    expect(say('Step 1: open the app\nStep 2: press go')).toBe('Open the app press go.')
  })
})

describe('toSpokenText: expansion', () => {
  it.each([
    ['It is 50% off', 'It is fifty percent off.'],
    ['Pay ₹5,000 now', 'Pay five thousand rupees now.'],
    ['Pay Rs. 500 now', 'Pay five hundred rupees now.'],
    ['Worth ₹1.5 lakh', 'Worth one point five lakh rupees.'],
    ['Cost $5 or $2.5M or $3 billion or $4k', 'Cost five dollars or two point five million dollars or three billion dollars or four thousand dollars.'],
    ['It is 31°C or 88°F or 20°', 'It is thirty-one degrees Celsius or eighty-eight degrees Fahrenheit or twenty degrees.'],
    ['30 km/h, 1 km, 5 km, 2.5 kg, 1 GB, 2 GB, 20 ms, 3 m, 4 mph', 'Thirty kilometres per hour, one kilometre, five kilometres, two point five kilograms, one gigabyte, two gigabytes, twenty milliseconds, three metres, four miles per hour.'],
    ['At 14:30 or 09:00 or 10:05 or 9:05 am or 7pm or 12:00 AM or 3 p.m.', 'At two thirty PM or nine AM or ten oh five AM or nine oh five AM or seven PM or twelve AM or three PM.'],
    ['Use 25:99 as is', 'Use twenty-five:ninety-nine as is.'],
    ['Took 1h 30m or 2h 1m', 'Took one hour thirty minutes or two hours one minute.'],
    ['On 2026-10-25 and 2025-12-01 and 22/10/2024', 'On October twenty-fifth and December first, twenty twenty-five and October twenty-second, twenty twenty-four.'],
    ['Odd 2026-13-45 and 45/13/2024', 'Odd two thousand twenty-six-thirteen-forty-five and forty-five slash thirteen slash two thousand twenty-four.'],
    ['The 1st, 2nd, 3rd, 4th, 21st, 30th and 12th', 'The first, second, third, fourth, twenty-first, thirtieth and twelfth.'],
    ['Call 98765 43210 or +91 98765-43210', 'Call nine eight seven six five, four three two one zero or nine eight seven six five, four three two one zero.'],
    ['Account 123456789012345 here', 'Account a long number on screen here.'],
    ['In 1999 and since 2005 and in 2000 and by 1905 and in 1900 and March 2026', 'In nineteen ninety-nine and since two thousand five and in two thousand and by nineteen oh five and in nineteen hundred and March twenty twenty-six.'],
    ['3.5 and 1,234 and 1,00,000 and 7', 'Three point five and one thousand two hundred thirty-four and one hundred thousand and seven.'],
    ['Room A4 and qwen3 and 8b', 'Room A4 and qwen3 and 8b.'],
    ['It costs 2x3 = 6 or 4 × 5', 'It costs two times three equals six or four times five.'],
    ['About ~5 items, #3 first, Q & A, 2+2, cats/dogs, >= 5', 'About about five items, number three first, Q and A, two plus two, cats slash dogs, at least five.'],
    ['E.g. this, i.e. that, etc. and a vs b, approx. 5, Dr. Rao, Mr. Das, Mrs. Das, Ms. Das', 'For example this, that is that, and so on and a versus b, about five, Doctor Rao, Mister Das, Missus Das, Miss Das.'],
    ['Open report.pdf, notes.docx, data.json, a.txt and b.png', 'Open report dot P D F, notes dot dock X, data dot jason, a dot text and b dot P N G.'],
    ['Over 1000000000000 digits', 'Over a long number on screen digits.'],
    ['Over 1,000,000,000,000,000 digits', 'Over a long number on screen digits.'],
  ])('%j', (input, expected) => {
    expect(say(input)).toBe(expected)
  })

  it('speaks a date in another year with the year, and this year without', () => {
    expect(toSpokenText('On 2026-01-02.', new Date('2026-06-01'))).toBe('On January second.')
    expect(toSpokenText('On 2026-01-02.', new Date('2027-06-01'))).toBe('On January second, twenty twenty-six.')
  })

  it('uses the current date by default', () => {
    expect(toSpokenText('On 1999-01-02.')).toBe('On January second, nineteen ninety-nine.')
  })
})

describe('toSpokenText: length', () => {
  it('keeps whole sentences up to 40 words and then points to the screen', () => {
    const sentence = (n: number): string => `Word ${Array.from({ length: n - 1 }, () => 'word').join(' ')}.`
    const reply = `${sentence(15)} ${sentence(15)} ${sentence(15)}`
    expect(say(reply)).toBe(`${sentence(15)} ${sentence(15)} ${MORE_ON_SCREEN}`)
  })

  it('keeps a reply of 40 words or fewer whole', () => {
    const reply = `Word ${Array.from({ length: 37 }, () => 'word').join(' ')}. Last two.`
    expect(say(reply)).toBe(reply)
  })

  it('always speaks at least the first sentence', () => {
    const long = `Word ${Array.from({ length: 24 }, () => 'word').join(' ')}.`
    expect(say(`${long} ${long} ${long}`)).toBe(`${long} ${MORE_ON_SCREEN}`)
  })
})

describe('splitSentences', () => {
  it('splits on sentence ends and newlines and keeps abbreviations, initials and decimals together', () => {
    expect(splitSentences('Hello there friend. Dr. Who is here! Really? Yes it is.')).toEqual(['Hello there friend.', 'Dr. Who is here!', 'Really? Yes it is.'])
    expect(splitSentences('Meet J. Smith at three. Pi is 3.14 today.')).toEqual(['Meet J. Smith at three.', 'Pi is 3.14 today.'])
    expect(splitSentences('First line here now\nSecond line here now')).toEqual(['First line here now', 'Second line here now'])
    expect(splitSentences('Version one. is fine and so is two. Done here now.')).toEqual(['Version one. is fine and so is two.', 'Done here now.'])
  })

  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('She said "go now." Then left quickly.')).toEqual(['She said "go now."', 'Then left quickly.'])
  })

  it('merges fragments under three words into a neighbour', () => {
    expect(splitSentences('Ok. Fine now thanks.')).toEqual(['Ok. Fine now thanks.'])
    expect(splitSentences('Good night all. Bye.')).toEqual(['Good night all. Bye.'])
    expect(splitSentences('Hi.')).toEqual(['Hi.'])
  })

  it('splits a sentence over 30 words near its middle at a comma or conjunction', () => {
    const half = Array.from({ length: 17 }, (_, i) => `w${i}`).join(' ')
    expect(splitSentences(`${half}, ${half}.`)).toEqual([`${half}.`, `W${half.slice(1)}.`])
    expect(splitSentences(`${half} and ${half}.`)).toEqual([`${half}.`, `And ${half}.`])
  })

  it('splits at the break nearest the middle when there are several', () => {
    const run = (n: number, from: number): string => Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ')
    const early = `${run(5, 0)}, ${run(15, 5)}, ${run(20, 20)}.`
    expect(splitSentences(early)).toEqual([`${run(5, 0)}, ${run(15, 5)}.`, `${run(20, 20)}.`.replace('w20', 'W20')])
    const late = `${run(20, 0)}, ${run(15, 20)}, ${run(5, 35)}.`
    expect(splitSentences(late)).toEqual([`${run(20, 0)}.`, `${run(15, 20)}, ${run(5, 35)}.`.replace('w20', 'W20')])
  })

  it('leaves a long sentence with no break point whole', () => {
    const run = `${Array.from({ length: 35 }, () => 'word').join(' ')}.`
    expect(splitSentences(run)).toEqual([run])
  })

  it('returns nothing for text without words', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('... ?!')).toEqual([])
  })
})

describe('numberToWords', () => {
  it.each([
    [0, 'zero'], [7, 'seven'], [13, 'thirteen'], [20, 'twenty'], [42, 'forty-two'], [100, 'one hundred'], [101, 'one hundred one'],
    [999, 'nine hundred ninety-nine'], [1000, 'one thousand'], [1234, 'one thousand two hundred thirty-four'],
    [2_000_000, 'two million'], [5_000_100, 'five million one hundred'], [3_000_000_000, 'three billion'],
  ])('%d', (n, words) => {
    expect(numberToWords(n)).toBe(words)
  })
})

describe('hasTamilScript', () => {
  it('detects Tamil script and nothing else', () => {
    expect(hasTamilScript('வணக்கம் friend')).toBe(true)
    expect(hasTamilScript('Hello, vanakkam')).toBe(false)
  })
})
