import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Term } from '../types'

const PANE = 'glossary'
const COMMAND = '/단어'
const TITLE = '단어 사전'
const MAX_LINES = 4

const terms = atom({ plugin: 'glossary', key: 'terms' } as const, [])
const isOn = atom({ plugin: 'glossary', key: 'isOn' } as const, true)
const status = atom({ plugin: 'glossary', key: 'status' } as const, '')

const SYSTEM = `You keep a glossary for an office worker in finance who does not write software. They read reports daily but do not know developer vocabulary: even "commit", "push", "branch", "repository", "local", "remote", "hook", "plugin", "JSON" are unfamiliar to them.
From the recent conversation, pick the terms this reader would not understand:
- developer and tool vocabulary (git, shells, file formats, APIs, Claude Code features);
- names that only mean something inside this project or session: file, folder, function, skill, command and mod names, and labels or abbreviations the assistant coined;
- English words or acronyms left untranslated.
Skip terms already in the glossary and everyday business words.
Explain each in Korean formal written style (~다 체), at most two short sentences and 80 Korean characters, saying what it is and what it does here. Do not use analogies.
Answer with a JSON object only, no prose:
{"terms": [{"term": "<the term as it appeared>", "desc": "<the explanation>"}]}
At most 6 terms, the most important first. If none qualifies, answer an empty terms array.`

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size)}…` : text)

// Cuts text to what `lines` rows of `columns` cells hold, a wide (Hangul, CJK) character taking two cells.
const fit = (text: string, columns: number, lines: number) => {
  const room = Math.max(1, columns) * lines
  let used = 0
  let out = ''
  for (const char of text) {
    const width = /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char) ? 2 : 1
    if (used + width > room - 1) return `${out}…`
    used += width
    out += char
  }
  return out
}

const key = (term: string) => term.trim().toLowerCase()

// The model's reply as new terms: only well-formed ones the glossary does not hold yet.
const parse = (reply: string, known: Set<string>): Term[] => {
  try {
    const list: unknown = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))?.terms
    if (!Array.isArray(list)) return []
    return list
      .filter((one): one is Term => typeof one?.term === 'string' && typeof one?.desc === 'string')
      .map(one => ({ term: one.term.trim(), desc: one.desc.trim() }))
      .filter(one => {
        const name = key(one.term)
        if (name === '' || known.has(name)) return false
        known.add(name)
        return true
      })
  } catch {
    return []
  }
}

// Puts the new terms first, then the held terms the latest turn mentions again, then the rest.
const reorder = (list: Term[], found: Term[], turn: string) => {
  const text = turn.toLowerCase()
  const seen = list.filter(one => text.includes(key(one.term)))
  return [...found, ...seen, ...list.filter(one => !seen.includes(one))]
}

async function collect($: EngineInterface) {
  const held = await read($, terms)
  const messages = await $.session.messages()
  const recent = messages.slice(-6)
  const asked = messages.map(message => message.role).lastIndexOf('user')
  const turn = messages.slice(Math.max(0, asked)).map(message => message.text).join('\n')
  const transcript = recent.map(message => `${message.role}: ${clip(message.text, 2000)}`).join('\n')
  const reply = await $.model.complete({
    model: 'claude-haiku-5-5',
    system: SYSTEM,
    prompt: `Already in the glossary: ${held.map(one => one.term).join(', ') || '(none)'}\n\nRecent conversation:\n${transcript}`,
    maxTokens: 1200,
  })
  if (!reply.isAnswered) {
    await update($, status, () => `용어를 받지 못했습니다(${reply.reason}).`)
    return
  }
  const found = parse(reply.text, new Set(held.map(one => key(one.term))))
  await update($, terms, list => reorder(list, found, turn))
  // The pane pops up with the session's first explained terms, not at session start.
  if (held.length === 0 && found.length > 0 && (await read($, isOn))) await open($)
  await update($, status, () => '')
}

const open = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE }).catch(() => ({ isPlaced: false }))

// Shows or hides the pane; collecting goes on either way.
async function toggle($: EngineInterface) {
  if (await read($, isOn)) {
    await update($, isOn, () => false)
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return '단어 사전을 숨겼습니다.'
  }
  await update($, isOn, () => true)
  const opened = await open($)
  return opened.isPlaced ? '단어 사전을 열었습니다.' : '단어 사전을 켰지만 터미널이 좁아 패널을 놓지 못했습니다.'
}

export const register: Register = on => {
  // A slash command name takes no Hangul, so `/단어` is caught as the prompt it arrives as and kept from the model.
  on('prompt.submit', async ($, e, next) => {
    if (e.text.trim() !== COMMAND) return next(e)
    return { drop: await toggle($) }
  })

  // Puts `/단어` in the typeahead, which lists only registered commands.
  on('prompt.autocomplete', { token: /^\// }, async ($, e, next) => {
    const rows = await next(e)
    if (e.start !== 0 || !COMMAND.startsWith(e.token)) return rows
    return { suggestions: [...rows.suggestions, { text: COMMAND, description: '단어 사전 패널을 열거나 숨긴다' }] }
  })

  // Closing the pane by hand turns the glossary off; collecting goes on regardless.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isOn, () => false).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) void collect($).catch(() => undefined)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, terms)
    const note = await read($, status)
    const columns = e.props.bodyColumns

    return (
      <Box flexDirection="column">
        {note !== '' && (
          <Box marginBottom={1}>
            <Text color="inactive" italic>
              {note}
            </Text>
          </Box>
        )}
        {list.length === 0 && note === '' && <Text color="inactive">아직 풀이할 용어가 없습니다.</Text>}
        {list.map(one => (
          <Box key={`term-${key(one.term)}`} flexDirection="column" marginBottom={1}>
            <Text bold wrap="truncate-end">
              {one.term}
            </Text>
            <Text color="inactive">{fit(one.desc, columns, MAX_LINES)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
