import { describe, expect, it } from 'vitest'
import {
  chooseContact, contactLabel, isYes, matchContacts, normaliseSpokenAddress, parseMailIntent, sentence, spokenAddress, subjectFor,
} from '../src/core/gmail/intent.ts'

const none = { hasList: false, hasOpen: false }
const both = { hasList: true, hasOpen: true }

describe('parseMailIntent', () => {
  it('reads the inbox', () => {
    for (const text of ['read my important mails', 'read my important emails', 'Check my inbox.', 'any new mail', 'do I have any new email', 'read my mail', 'check the unread mail please', 'read my gmail']) {
      expect(parseMailIntent(text, none)?.kind, text).toBe('list')
    }
    expect(parseMailIntent('open my inbox', none)).toBeNull()
  })

  it('connects, disconnects, and helps', () => {
    expect(parseMailIntent('connect gmail', none)).toEqual({ kind: 'connect' })
    expect(parseMailIntent('connect to email', none)).toEqual({ kind: 'connect' })
    expect(parseMailIntent('connect my gmail account', none)).toEqual({ kind: 'connect' })
    expect(parseMailIntent('set up email again', none)).toEqual({ kind: 'connect' })
    expect(parseMailIntent('disconnect from my email account', none)).toEqual({ kind: 'disconnect' })
    expect(parseMailIntent('Disconnect Gmail.', none)).toEqual({ kind: 'disconnect' })
    expect(parseMailIntent('send an email', none)).toEqual({ kind: 'compose-help' })
  })

  it('opens a listed mail only when there is a listing, and summarises only an open mail', () => {
    expect(parseMailIntent('read the first one', both)).toEqual({ kind: 'open', index: 1 })
    expect(parseMailIntent('read the second one', both)).toEqual({ kind: 'open', index: 2 })
    expect(parseMailIntent('open number 3', both)).toEqual({ kind: 'open', index: 3 })
    expect(parseMailIntent('read 5', both)).toEqual({ kind: 'open', index: 5 })
    expect(parseMailIntent('read the first one', none)).toBeNull()
    expect(parseMailIntent('summarize it', both)).toEqual({ kind: 'summarize' })
    expect(parseMailIntent('Summarise that.', both)).toEqual({ kind: 'summarize' })
    expect(parseMailIntent('summarize it', none)).toBeNull()
  })

  it('parses send requests in several phrasings', () => {
    expect(parseMailIntent('send a mail to Asha saying I will be late', none)).toEqual({ kind: 'send', name: 'Asha', body: 'I will be late.', subject: undefined, polish: false })
    expect(parseMailIntent('email Asha Rao that the report is ready!', none)).toMatchObject({ kind: 'send', name: 'Asha Rao', body: 'The report is ready!' })
    expect(parseMailIntent('write to Asha saying hello there', none)).toMatchObject({ name: 'Asha', body: 'Hello there.' })
    expect(parseMailIntent('send an email to Asha Menon subject lunch plan saying lets meet at noon', none)).toMatchObject({ name: 'Asha Menon', subject: 'lunch plan', body: 'Lets meet at noon.' })
    expect(parseMailIntent('mail Ravi saying call me', none)).toMatchObject({ name: 'Ravi' })
    expect(parseMailIntent('send gmail to Asha saying hi', none)).toMatchObject({ name: 'Asha' })
  })

  it('detects a request to word the body nicely, and strips that request from the body', () => {
    expect(parseMailIntent('send a mail to Asha saying I cannot come, write it politely', none)).toMatchObject({ body: 'I cannot come.', polish: true })
    expect(parseMailIntent('email Asha that I am late and make it nicely.', none)).toMatchObject({ body: 'I am late.', polish: true })
  })

  it('returns null for text that is not mail, or has no body', () => {
    expect(parseMailIntent('open notepad', none)).toBeNull()
    expect(parseMailIntent('email Asha saying   ', none)).toBeNull()
    expect(parseMailIntent('email Asha saying write it nicely', none)).toBeNull()
  })
})

describe('sentence and subject', () => {
  it('capitalises and ends a sentence', () => {
    expect(sentence('hello there')).toBe('Hello there.')
    expect(sentence('Are you coming?')).toBe('Are you coming?')
  })

  it('takes the first six words as the subject', () => {
    expect(subjectFor('the quarterly report is ready for review today.')).toBe('The quarterly report is ready for')
    expect(subjectFor('See you soon!')).toBe('See you soon')
  })
})

describe('normaliseSpokenAddress', () => {
  it('turns spoken words into an address', () => {
    expect(normaliseSpokenAddress('asha dot rao at gmail dot com')).toBe('asha.rao@gmail.com')
    expect(normaliseSpokenAddress('Asha Rao at Gmail dot com.')).toBe('asharao@gmail.com')
    expect(normaliseSpokenAddress('a underscore b dash c plus d at example dot co dot uk')).toBe('a_b-c+d@example.co.uk')
    expect(normaliseSpokenAddress('ravi one two three at mail dot in')).toBe('ravi123@mail.in')
    expect(normaliseSpokenAddress('asha.rao@gmail.com.')).toBe('asha.rao@gmail.com')
    expect(normaliseSpokenAddress('Asha@Gmail.com')).toBe('asha@gmail.com')
  })

  it('rejects text that is not an address', () => {
    expect(normaliseSpokenAddress('asha rao gmail dot com')).toBeNull()
    expect(normaliseSpokenAddress('asha at gmail')).toBeNull()
    expect(normaliseSpokenAddress('')).toBeNull()
  })
})

describe('contact matching', () => {
  const contacts = [
    { name: 'Asha Rao', address: 'asha.rao@gmail.com', count: 5 },
    { name: 'Asha Menon', address: 'am@example.com', count: 3 },
    { name: '', address: 'ravi.kumar@example.com', count: 2 },
    { name: 'Priya Natarajan', address: 'priya@example.com', count: 1 },
  ]

  it('matches names case-insensitively on display name or local part, with prefixes and one-letter slips', () => {
    expect(matchContacts(contacts, 'asha').map(contact => contact.address)).toEqual(['asha.rao@gmail.com', 'am@example.com'])
    expect(matchContacts(contacts, 'ASHA RAO')).toHaveLength(1)
    expect(matchContacts(contacts, 'ravi')[0]?.address).toBe('ravi.kumar@example.com')
    expect(matchContacts(contacts, 'aasha rao')).toHaveLength(1)
    expect(matchContacts(contacts, 'priyaa')).toHaveLength(1)
    expect(matchContacts(contacts, 'pria nataraja')).toHaveLength(1)
    expect(matchContacts(contacts, 'Ashaa')).toHaveLength(2)
    expect(matchContacts(contacts, 'kumar ravi')).toHaveLength(1)
  })

  it('finds nothing for an unknown or empty name', () => {
    expect(matchContacts(contacts, 'zed')).toEqual([])
    expect(matchContacts(contacts, 'ash')).toHaveLength(2)
    expect(matchContacts(contacts, 'asha ra')).toHaveLength(1)
    expect(matchContacts(contacts, '  ')).toEqual([])
    expect(matchContacts(contacts, 'Rao Asha Menon')).toEqual([])
  })

  it('labels a contact and chooses one from a spoken answer', () => {
    const offered = contacts.slice(0, 2)
    expect(contactLabel(contacts[2] as (typeof contacts)[number])).toBe('ravi.kumar')
    expect(contactLabel(offered[0] as (typeof contacts)[number])).toBe('Asha Rao')
    expect(chooseContact('the second one', offered)?.address).toBe('am@example.com')
    expect(chooseContact('first', offered)?.address).toBe('asha.rao@gmail.com')
    expect(chooseContact('third', offered)).toBeUndefined()
    expect(chooseContact('Asha Menon', offered)?.address).toBe('am@example.com')
    expect(chooseContact('asha', offered)).toBeUndefined()
    expect(chooseContact('someone else', offered)).toBeUndefined()
  })
})

describe('speech helpers', () => {
  it('spells an address and checks for an exact yes', () => {
    expect(spokenAddress('asha.rao@gmail.com')).toBe('asha dot rao at gmail dot com')
    for (const yes of ['yes', 'Yes.', 'yes please', 'yes, send it']) expect(isYes(yes), yes).toBe(true)
    for (const no of ['yeah', 'yes but no', 'no', '', 'yes send it now', 'confirm']) expect(isYes(no), no).toBe(false)
  })
})
