import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Term } from '../types'

const COMMAND = '/단어'

const terms = atom({ plugin: 'glossary', key: 'terms' } as const, [])
const isOn = atom({ plugin: 'glossary', key: 'isOn' } as const, true)
const opened = atom({ plugin: 'glossary', key: 'opened' } as const, [])

const SYSTEM = `You keep a glossary for an office worker in finance who does not write software. They read reports daily but do not know developer vocabulary: even "commit", "push", "branch", "repository", "local", "remote", "hook", "plugin", "JSON" are unfamiliar to them.
From the recent conversation, pick the terms this reader would not understand:
- developer and tool vocabulary (git, shells, file formats, APIs, Claude Code features);
- names that only mean something inside this project or session: file, folder, function, skill, command and mod names, and labels or abbreviations the assistant coined;
- English words or acronyms left untranslated.
Skip terms already in the glossary and everyday business words.
Write for someone who has never seen this vocabulary: plain everyday Korean words, short sentences, no other jargon inside the explanation (if one is unavoidable, explain it on the spot). Use Korean formal written style (~다 체). Do not use analogies.
For each term write two explanations:
- "desc": at most 100 Korean characters, what it is and what it does here.
- "detail": at most 250 Korean characters, a fuller explanation: what it is, why it is used, and what it did in this conversation.
  Add a concrete example of it in use, starting with "예:", only for a general concept the reader will meet again elsewhere (such as "plugin", "commit", "branch").
  Give no example for a proper noun or a name (a product, service, company, file, folder, function, skill, command or mod name), nor for a setting, mode or option value (such as "fullscreen").
Answer with a JSON object only, no prose:
{"terms": [{"term": "<the term as it appeared>", "desc": "<the short explanation>", "detail": "<the full explanation>"}]}
At most 6 terms, the most important first. If none qualifies, answer an empty terms array.`

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size)}…` : text)

const key = (term: string) => term.trim().toLowerCase()

// The model's reply as new terms: only well-formed ones the glossary does not hold yet.
const parse = (reply: string, known: Set<string>): Term[] => {
  try {
    const list: unknown = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))?.terms
    if (!Array.isArray(list)) return []
    return list
      .filter((one): one is Term => typeof one?.term === 'string' && typeof one?.desc === 'string')
      .map(one => ({ term: one.term.trim(), desc: one.desc.trim(), ...(typeof one.detail === 'string' && one.detail.trim() !== '' && { detail: one.detail.trim() }) }))
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

// Code and inline code, whose words are not the reader's prose.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g
const CARD_WIDTH = 44
// The rows a card rising above a word keeps clear of the viewport's top edge.
const MARGIN = 2
const DETAIL_WIDTH = 72
// A term's word in the prose: the theme's violet, apart from the blue of links, and following a dark or a light theme.
const TERM = 'merged'
// The card's own colours, solid so nothing beneath shows through, and legible under a dark or a light theme.
const CARD = { background: '#1e2128', border: '#4a5060', title: '#c4a7f5', text: '#dcdfe4', hint: '#828997' }

// Characters the terminal draws two columns wide: Hangul, CJK, full-width forms and emoji.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦🌀-🫿]/u

// The columns a text takes on the terminal, a wide character such as Hangul counting two.
const cells = (text: string) => {
  let columns = 0
  for (const one of text) columns += WIDE.test(one) ? 2 : 1
  return columns
}

// The rows a block the engine draws as markdown takes: a table its rows boxed and ruled apart, a fenced block its lines
// without the fences, other lines as they wrap.
const drawnRows = (lines: string[], width: number) => {
  if (lines[0]?.trim().startsWith('|')) return lines.filter(line => !/^\s*\|[\s:|-]+\|\s*$/.test(line)).length * 2 + 1
  return lines.filter(line => !line.trim().startsWith('```')).reduce((sum, line) => sum + rows(line, width), 0)
}

// The rows a text takes at a width.
const rows = (text: string, width: number) => Math.max(1, Math.ceil(cells(text) / Math.max(1, width)))

// A text broken into rows of at most a width, between words where it can and inside a word too long for a row.
const wrap = (text: string, width: number) => {
  const out: string[] = []
  let current = ''
  for (const part of text.split(/\s+/).filter(one => one !== '')) {
    const joined = current === '' ? part : `${current} ${part}`
    if (cells(joined) <= width) {
      current = joined
      continue
    }
    if (current !== '') out.push(current)
    current = ''
    for (const one of part) {
      if (cells(current + one) > width) {
        out.push(current)
        current = ''
      }
      current += one
    }
  }
  if (current !== '') out.push(current)
  return out
}

// The glossary's terms this text mentions outside code, in the order they first appear.
const mentioned = (text: string, list: Term[]) => {
  const prose = text.replace(CODE, ' ').toLowerCase()
  return list
    .map(one => ({ one, at: prose.indexOf(key(one.term)) }))
    .filter(({ one, at }) => at !== -1 && key(one.term) !== '')
    .sort((a, b) => a.at - b.at)
    .map(({ one }) => one)
}

// A short stable tag for a text, so the keys of one block never meet those of another block drawn alongside it.
const tag = (text: string) => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(36)
}

// A run of a line's text with its inline style, and the term it spells if it spells one.
type Piece = { text: string; bold?: boolean; code?: boolean; link?: boolean; term?: Term }

// Lines only the engine's markdown draws well: fences, headings, tables, quotes and rules.
const STRUCTURED = /^\s*(```|#|\||>|---|\*\*\*)/
const INLINE = /`[^`\n]*`|\*\*[^*\n]+\*\*|\[([^\]\n]+)\]\([^)\s]+\)/g
const BULLET = /^(\s*)[-*+]\s+/

// The reply's lines cut at blank lines, a fenced block kept whole.
const blocks = (text: string) => {
  const out: string[][] = []
  let current: string[] = []
  let isFenced = false
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) isFenced = !isFenced
    if (!isFenced && line.trim() === '') {
      if (current.length > 0) out.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) out.push(current)
  return out
}

// A line's inline code, bold and links as styled runs, the markup itself dropped.
const styled = (line: string): Piece[] => {
  const out: Piece[] = []
  let at = 0
  for (const match of line.matchAll(INLINE)) {
    if (match.index > at) out.push({ text: line.slice(at, match.index) })
    const found = match[0]
    if (found.startsWith('`')) out.push({ text: found.slice(1, -1), code: true })
    else if (found.startsWith('**')) out.push({ text: found.slice(2, -2), bold: true })
    else out.push({ text: match[1] ?? found, link: true })
    at = match.index + found.length
  }
  if (at < line.length) out.push({ text: line.slice(at) })
  return out
}

// A run cut around the glossary's terms in it, earliest first and the longer of two at one place; code stays whole.
const marked = (piece: Piece, list: Term[]): Piece[] => {
  if (piece.text === '') return []
  if (piece.code) return [piece]
  const lower = piece.text.toLowerCase()
  const hit = list
    .map(one => ({ one, at: lower.indexOf(key(one.term)) }))
    .filter(({ one, at }) => at !== -1 && key(one.term) !== '')
    .sort((a, b) => a.at - b.at || key(b.one.term).length - key(a.one.term).length)[0]
  if (hit === undefined) return [piece]
  const end = hit.at + key(hit.one.term).length
  return [
    ...(hit.at > 0 ? [{ ...piece, text: piece.text.slice(0, hit.at) }] : []),
    { ...piece, text: piece.text.slice(hit.at, end), term: hit.one },
    ...marked({ ...piece, text: piece.text.slice(end) }, list),
  ]
}

// Runs regrouped into the words a space separates, so a line wraps between words.
const words = (pieces: Piece[]) => {
  const out: Piece[][] = []
  let current: Piece[] = []
  for (const piece of pieces) {
    piece.text.split(' ').forEach((part, index) => {
      if (index > 0 && current.length > 0) {
        out.push(current)
        current = []
      }
      if (part !== '') current.push({ ...piece, text: part })
    })
  }
  if (current.length > 0) out.push(current)
  return out
}

// A prose or list line as its indent and bullet, then its words.
const lineOf = (line: string, list: Term[]) => {
  const bullet = BULLET.exec(line)
  const indent = bullet?.[1] ?? /^\s*/.exec(line)?.[0] ?? ''
  const body = bullet ? line.slice(bullet[0].length) : line.trim()
  return { prefix: `${indent}${bullet ? '• ' : ''}`, words: words(styled(body).flatMap(piece => marked(piece, list))) }
}

async function collect($: EngineInterface) {
  const held = await read($, terms)
  const recent = (await $.session.messages()).slice(-6)
  const transcript = recent.map(message => `${message.role}: ${clip(message.text, 2000)}`).join('\n')
  const reply = await $.model.complete({
    model: 'claude-haiku-5-5',
    system: SYSTEM,
    prompt: `Already in the glossary: ${held.map(one => one.term).join(', ') || '(none)'}\n\nRecent conversation:\n${transcript}`,
    maxTokens: 3000,
  })
  if (!reply.isAnswered) return
  const found = parse(reply.text, new Set(held.map(one => key(one.term))))
  if (found.length > 0) await update($, terms, list => [...list, ...found])
}

// Shows or hides the terms marked in replies; collecting goes on either way.
async function toggle($: EngineInterface) {
  const shown = !(await read($, isOn))
  await update($, isOn, () => shown)
  return shown ? '답변 본문의 용어 표시를 켰습니다.' : '답변 본문의 용어 표시를 껐습니다.'
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
    return { suggestions: [...rows.suggestions, { text: COMMAND, description: '답변 본문의 용어 표시를 켜거나 끈다' }] }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) void collect($).catch(() => undefined)
    return done
  })

  // A click on a term's word widens its card to the full explanation and a second click narrows it;
  // the pointer leaving the word narrows it too.
  on('ui.message', async ($, e, next) => {
    if (e.data === 'toggle') await update($, opened, names => (names.includes(e.element) ? [] : [e.element]))
    else if (e.data === 'close') await update($, opened, names => names.filter(one => one !== e.element))
    return next(e)
  })

  // A reply's blocks that mention a term are drawn by hand, word by word, each term underlined in the prose itself:
  // the pointer on its word shows the short explanation in a card, and a click turns that card into the full explanation.
  // Other blocks keep the engine's markdown. Only the fullscreen layout follows the pointer and reports clicks.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Only the terminal draws a `Client`, which reports the click and the pointer leaving a word.
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary || !(await read($, isOn))) return next(e)
    const list = mentioned(e.props.text, await read($, terms))
    if (list.length === 0) return next(e)
    const open = await read($, opened)
    const id = tag(e.props.text)
    const { Box, Text, Markdown, Client } = $.ui.resolve(e)
    // The columns the reply's text takes, past the bullet gutter.
    const columns = Math.max(20, e.viewport.columns - 2)
    // Which of the message's rows the viewport shows; absent, the whole message is taken as shown.
    const shown = e.props.onScreen
    // The viewport rows above the message's first shown row: none when the message's top is scrolled away, else unknown
    // but at least those a message cut at the bottom leaves above it (the prompt's rows, about eight, set aside).
    const before = shown === undefined || shown === null || shown.first > 0 || shown.last + 1 >= shown.of ? 0 : Math.max(0, e.viewport.rows - 8 - (shown.last + 1))
    // A card for a term's word: above and to the right of the word by default, flipped below when the rows above
    // are too few and to the left when the columns to the right are, never over the word.
    // Every row is padded to the card's width so its solid background hides the text beneath.
    const card = (one: Term, isWide: boolean, row: number, column: number, size: number, scope: string) => {
      const body = isWide ? (one.detail ?? one.desc) : one.desc
      const height = (inner: number) => wrap(body, inner).length + 4
      // Rows are estimated, and the viewport's top row may hold the pinned prompt, so a card rising past them is kept
      // a margin away: the terminal pushes a card that crosses the top edge back down over the word.
      const roomAbove = row - (shown?.first ?? 0) + before - MARGIN
      // Below, only the message's rows the viewport shows count: the prompt is drawn over whatever lies past them.
      const roomBelow = (shown?.last ?? Number.POSITIVE_INFINITY) - row - MARGIN
      // A fixed width, so one term's card keeps its shape wherever the word sits.
      const inner = Math.min(isWide ? DETAIL_WIDTH : CARD_WIDTH, columns) - 4
      const isBelow = height(inner) > roomAbove && (height(inner) <= roomBelow || roomBelow > roomAbove)
      const width = inner + 4
      const isRight = column + width <= columns
      // The card's left edge from the word's.
      const shift = isRight ? 0 : Math.max(0, column + size - width) - column
      const box = (
        <Box width={width} borderStyle="round" borderColor={CARD.border} backgroundColor={CARD.background} flexDirection="column">
          {[
            { text: one.term, color: CARD.title, bold: true },
            ...wrap(body, inner).map(text => ({ text, color: CARD.text, bold: false })),
            { text: isWide ? '다시 누르면 접힙니다' : '누르면 자세히 봅니다', color: CARD.hint, bold: false },
          ].map(line => (
            <Text bold={line.bold} color={line.color} backgroundColor={CARD.background} wrap="truncate">
              {` ${line.text}${' '.repeat(Math.max(0, inner - cells(line.text)))} `}
            </Text>
          ))}
        </Box>
      )
      // A card above stays in the word's Box, painted over the earlier lines and messages it rises into.
      if (!isBelow) {
        return (
          <Box position="absolute" bottom={1} left={shift} width={width} display="none" hover={{ display: 'flex' }} flexDirection="column">
            {box}
          </Box>
        )
      }
      // A card below is drawn last in the message, placed by the word's row and column, so the lines after the word
      // cannot paint over it; the word's hover group reveals it.
      floating.push(
        <Box position="absolute" top={row + 1} left={column + shift} width={width} display="none" hover={{ display: 'flex', scope }} flexDirection="column">
          {box}
        </Box>,
      )
      return undefined
    }
    const floating: JSX.Element[] = []
    const piece = (one: Piece, place: string) =>
      one.term === undefined ? (
        <Text bold={one.bold} underline={one.link} color={one.code ? 'permission' : undefined}>
          {one.text}
        </Text>
      ) : (
        <Client key={`term-${place}`} module="./term.tsx" props={{ text: one.text, bold: one.bold === true, color: TERM }} />
      )
    // Each word is its own keyed Box, so the pointer on a term's word lights that word's card alone.
    const word = (pieces: Piece[], place: string, row: number, column: number) => {
      const size = cells(pieces.map(one => one.text).join(''))
      const index = pieces.findIndex(one => one.term !== undefined)
      const term = pieces[index]?.term
      return (
        <Box key={`word-${place}`} flexDirection="row" hover={{ scope: `g-${place}` }}>
          {pieces.map((one, at) => piece(one, `${place}-${at}`))}
          {term !== undefined && card(term, open.includes(`term-${place}-${index}`), row, column, size, `g-${place}`)}
        </Box>
      )
    }
    let row = 0
    const drawn = (lines: string[], block: string) => {
      const text = lines.join('\n')
      if (lines.some(line => STRUCTURED.test(line)) || mentioned(text, list).length === 0) {
        row += drawnRows(lines, columns) + 1
        return <Markdown text={text} />
      }
      const drawnLines = lines.map((line, at) => {
        const { prefix, words: all } = lineOf(line, list)
        const room = columns - cells(prefix)
        // Where each word lands as the row wraps between words, one column apart.
        let column = 0
        const placed = all.map(pieces => {
          const width = cells(pieces.map(one => one.text).join(''))
          if (column > 0 && column + width > room) {
            row += 1
            column = 0
          }
          const at = { row, column: column + cells(prefix) }
          column += width + 1
          return at
        })
        row += 1
        return (
          <Box key={`line-${block}-${at}`} flexDirection="row">
            {prefix !== '' && <Text>{prefix}</Text>}
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1}>
              {all.map((pieces, index) => word(pieces, `${block}-${at}-${index}`, placed[index]?.row ?? row, placed[index]?.column ?? 0))}
            </Box>
          </Box>
        )
      })
      row += 1
      return drawnLines
    }
    return (
      <Box flexDirection="row">
        <Text>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column" flexShrink={1}>
          {blocks(e.props.text).map((lines, at) => (
            <Box key={`block-${id}-${at}`} flexDirection="column" marginTop={at > 0 ? 1 : 0}>
              {drawn(lines, `${id}-${at}`)}
            </Box>
          ))}
          {floating}
        </Box>
      </Box>
    )
  })
}
