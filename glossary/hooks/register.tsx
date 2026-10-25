import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Term } from '../types'

const COMMAND = '/단어'

// Two tracks: the terms the model chose, and the terms the person asked about.
const terms = atom({ plugin: 'glossary', key: 'terms' } as const, [])
const asked = atom({ plugin: 'glossary', key: 'asked' } as const, [])
const isOn = atom({ plugin: 'glossary', key: 'isOn' } as const, true)
const opened = atom({ plugin: 'glossary', key: 'opened' } as const, [])

const SYSTEM = `You keep a glossary for an office worker in finance who does not write software. They read reports daily but do not know developer vocabulary: even "commit", "push", "branch", "repository", "local", "remote", "hook", "plugin", "JSON" are unfamiliar to them.
From the recent conversation, pick the terms this reader would not understand:
- developer and tool vocabulary (git, shells, file formats, APIs, Claude Code features);
- names that only mean something inside this project or session: file, folder, function, skill, command and mod names, and labels or abbreviations the assistant coined;
- English words or acronyms left untranslated.
Skip terms already in the glossary and everyday business words.
Pick only terms that stand in the assistant's own prose: not only in the user's messages, inside code (\`...\` or fenced blocks), tables or headings, where they cannot be marked.
One exception: a term the user asked about in their own message (what it means, what it does) is always picked, marked "asked": true, even when only their message holds it or it is listed under "Already in the glossary"; skip a term listed under "Already asked about".
Write for someone who has never seen this vocabulary: plain everyday Korean words, short sentences, no other jargon inside the explanation (if one is unavoidable, explain it on the spot). Use Korean formal written style (~다 체). Do not use analogies.
For each term write two explanations:
- "desc": at most 100 Korean characters, what it is and what it does here.
- "detail": at most 250 Korean characters, a fuller explanation: what it is, why it is used, and what it did in this conversation.
  Add a concrete example of it in use, starting with "예:", only for a general concept the reader will meet again elsewhere (such as "plugin", "commit", "branch").
  Give no example for a proper noun or a name (a product, service, company, file, folder, function, skill, command or mod name), nor for a setting, mode or option value (such as "fullscreen").
Answer with a JSON object only, no prose:
{"terms": [{"term": "<the term as it appeared>", "desc": "<the short explanation>", "detail": "<the full explanation>", "asked": <true only for a term the user asked about>}]}
At most 6 terms, the most important first. If none qualifies, answer an empty terms array.`

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size)}…` : text)

const key = (term: string) => term.trim().toLowerCase()

const LETTER = /[\p{L}\p{N}_]/u
// What joins a file name, a path or a hyphenated name into one word: `SKILL.md`, `origin/main`, `claude-mods`.
const JOINER = /[./\\\-_:#@]/
// What a term may carry glued after it: a Korean particle, the copula 이다, the ending of 하다 or 되다, or the suffix
// 들, 별, 당 or 용.
const TAIL = /^(?:은|는|이|입|인|일|임|였|가|을|를|의|에|에서|에게|으로|로|와|과|도|만|까지|부터|보다|처럼|마다|나|란|라|하|합|했|한|할|해|되|됩|됐|된|될|돼|들|별|당|용)/

// Where a term first stands in a text as a whole word, -1 when nowhere: no letter or joiner right before it, and right
// after it no letter but one of the tails above, and no joiner leading on to more of the name. A term written in
// capitals, such as READ, skips the word spelled all in lower case, such as the verb read.
// A caller placing many terms in one text passes its lower case once.
const place = (text: string, term: Term, lower = text.toLowerCase()) => {
  const name = key(term.term)
  if (name === '') return -1
  const isCapital = term.term.trim() === term.term.trim().toUpperCase() && /[A-Z]/.test(term.term)
  for (let at = lower.indexOf(name); at !== -1; at = lower.indexOf(name, at + 1)) {
    const before = text[at - 1] ?? ''
    const after = text.slice(at + name.length)
    const written = text.slice(at, at + name.length)
    if (LETTER.test(before) || JOINER.test(before)) continue
    if (JOINER.test(after[0] ?? '') && LETTER.test(after[1] ?? '')) continue
    if (isCapital && written === written.toLowerCase()) continue
    if (!LETTER.test(after[0] ?? '') || (/^[가-힣]/.test(after) && TAIL.test(after))) return at
  }
  return -1
}

type Found = Term & { isAsked: boolean }

// The model's reply as well-formed terms, each once, with whether the person asked about it; undefined when the reply is
// not the JSON asked for.
const parse = (reply: string): Found[] | undefined => {
  try {
    const list: unknown = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))?.terms
    if (!Array.isArray(list)) return undefined
    const seen = new Set<string>()
    return list
      .filter((one): one is Term & { asked?: unknown } => typeof one?.term === 'string' && typeof one?.desc === 'string')
      .map(one => ({
        term: one.term.trim(),
        desc: one.desc.trim(),
        ...(typeof one.detail === 'string' && one.detail.trim() !== '' && { detail: one.detail.trim() }),
        isAsked: one.asked === true,
      }))
      .filter(one => {
        const name = key(one.term)
        if (name === '' || seen.has(name)) return false
        seen.add(name)
        return true
      })
  } catch {
    return undefined
  }
}

const bare = ({ isAsked: _, ...one }: Found): Term => one

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
  const prose = text.replace(CODE, ' ')
  const lower = prose.toLowerCase()
  return list
    .map(one => ({ one, at: place(prose, one, lower) }))
    .filter(({ at }) => at !== -1)
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
type Piece = { text: string; bold?: boolean; code?: boolean; href?: string; term?: Term }

// Lines only the engine's markdown draws well: fences, headings, tables, quotes and rules.
const STRUCTURED = /^\s*(```|#|\||>|---|\*\*\*)/
const INLINE = /`[^`\n]*`|\*\*[^*\n]+\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|https?:\/\/[^\s)]+/g
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
    // Bold code, **`name`**, is code drawn bold.
    else if (/^\*\*`[^`]*`\*\*$/.test(found)) out.push({ text: found.slice(3, -3), bold: true, code: true })
    else if (found.startsWith('**')) out.push({ text: found.slice(2, -2), bold: true })
    else out.push({ text: match[1] ?? found, href: match[2] ?? found })
    at = match.index + found.length
  }
  if (at < line.length) out.push({ text: line.slice(at) })
  return out
}

// A run cut around the glossary's terms in it, earliest first and the longer of two at one place; code and links stay whole.
const marked = (piece: Piece, list: Term[]): Piece[] => {
  if (piece.text === '') return []
  if (piece.code || piece.href !== undefined) return [piece]
  const lower = piece.text.toLowerCase()
  const hit = list
    .map(one => ({ one, at: place(piece.text, one, lower) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => a.at - b.at || key(b.one.term).length - key(a.one.term).length)[0]
  if (hit === undefined) return [piece]
  const end = hit.at + key(hit.one.term).length
  return [
    ...(hit.at > 0 ? [{ ...piece, text: piece.text.slice(0, hit.at) }] : []),
    { ...piece, text: piece.text.slice(hit.at, end), term: hit.one },
    ...marked({ ...piece, text: piece.text.slice(end) }, list),
  ]
}

// Runs regrouped into the words a space separates, so a line wraps between words; a term of several words stays one
// word, its underline running across its spaces.
const words = (pieces: Piece[]) => {
  const out: Piece[][] = []
  let current: Piece[] = []
  for (const piece of pieces) {
    ;(piece.term === undefined ? piece.text.split(' ') : [piece.text]).forEach((part, index) => {
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

// The reply's room: most of it goes to the model's thinking. Explaining six terms alone took up to 13,535 tokens, and
// this call picks them as well; only what is written is paid for.
const MAX_TOKENS = 32_000

// The longest a call may take: the slowest measured took 55 seconds, and a call that never answers holds up the queue.
const TIMEOUT_MS = 120_000

type Message = { role: string; text: string }

// A user-role message the person did not type: a skill's body, a hook's or another session's message, an interruption
// notice, or a tagged system block.
const NOT_THEIRS = /^\s*(?:<|\[Request interrupted|Base directory for this skill|Another Claude session|Stop hook feedback|Caveat:|This session is being continued from a previous conversation)/

// The person's message as the call sees it: its start and its end, where a question after a long paste stands.
const theirsClipped = (text: string) => (text.length > 2000 ? `${text.slice(0, 1000)}…${text.slice(-1000)}` : text)

const holds = (list: Term[]) => new Set(list.map(one => key(one.term)))

// Whether the person's lower-cased words hold the term, as they type it: anywhere for a term with Hangul, and for an
// English one only as a word of its own, so PR is not found inside "prompt".
const asksAbout = (theirs: string, term: Term) => {
  const name = key(term.term)
  if (name === '') return false
  if (/[^\x00-\x7f]/.test(name)) return theirs.includes(name)
  for (let at = theirs.indexOf(name); at !== -1; at = theirs.indexOf(name, at + 1)) {
    if (!/[a-z0-9]/.test(theirs[at - 1] ?? '') && !/[a-z0-9]/.test(theirs[at + name.length] ?? '')) return true
  }
  return false
}

// Both tracks as one glossary, an asked term first and once.
async function glossary($: EngineInterface) {
  const askedHeld = await read($, asked)
  const askedNames = holds(askedHeld)
  return { askedHeld, chosen: (await read($, terms)).filter(one => !askedNames.has(key(one.term))) }
}

// Whether a reply would underline the term: the drawing's own path, blocks the engine draws itself left out.
const shows = (text: string, term: Term) =>
  blocks(text)
    .filter(lines => !lines.some(line => STRUCTURED.test(line)))
    .some(lines => lines.some(line => lineOf(line, [term]).words.some(word => word.some(piece => piece.term !== undefined))))

// One collection, on the conversation as it stood when its turn ended. Held terms are never let go: the call names only
// those its conversation mentions, so it stays a few thousand tokens long however many the session holds, far inside
// Claude Haiku 5.5's lowest price tier (100K input tokens).
async function collect($: EngineInterface, recent: Message[]) {
  const transcript = recent.map(message => `${message.role}: ${message.role === 'user' ? theirsClipped(message.text) : clip(message.text, 2000)}`).join('\n')
  const { askedHeld, chosen } = await glossary($)
  const lower = transcript.toLowerCase()
  const named = (list: Term[], isIn: (one: Term) => boolean) => list.filter(isIn).map(one => one.term).join(', ') || '(none)'
  const reply = await $.model.complete({
    model: 'claude-haiku-5-5',
    system: SYSTEM,
    prompt: `Already asked about: ${named(askedHeld, one => asksAbout(lower, one))}\nAlready in the glossary: ${named(chosen, one => place(transcript, one, lower) !== -1)}\n\nRecent conversation:\n${transcript}`,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
  })
  if (!reply.isAnswered) return $.ui.status(`단어 사전: 용어를 받지 못했습니다(${reply.reason}).`)
  if (reply.usage.output_tokens >= MAX_TOKENS) return $.ui.status('단어 사전: 응답이 잘려 용어를 저장하지 못했습니다.')
  const found = parse(reply.text)
  if (found === undefined) return $.ui.status('단어 사전: 응답을 읽지 못했습니다.')
  $.ui.status(undefined)
  // An asked term counts where the person's own words hold it, loosely, as they type; a chosen one, only where a reply
  // underlines it.
  const theirs = recent
    .filter(message => message.role === 'user')
    .map(message => theirsClipped(message.text).toLowerCase())
    .join('\n')
  const replies = recent.filter(message => message.role === 'assistant')
  const askedNew = found.filter(one => one.isAsked && asksAbout(theirs, one) && !holds(askedHeld).has(key(one.term))).map(bare)
  const moved = holds(askedNew)
  const known = holds([...askedHeld, ...chosen])
  const chosenNew = found
    .filter(one => !moved.has(key(one.term)) && !known.has(key(one.term)) && replies.some(message => shows(message.text, one)))
    .map(bare)
  // Collections run one at a time, so the lists read above are the lists now; nothing new, nothing written or redrawn.
  if (askedNew.length > 0) {
    await update($, asked, list => [...list, ...askedNew])
    if (chosen.some(one => moved.has(key(one.term)))) await update($, terms, list => list.filter(one => !moved.has(key(one.term))))
  }
  if (chosenNew.length > 0) await update($, terms, list => [...list, ...chosenNew])
}

// Collections waiting their turn, run one after another, and the session they belong to: a /clear moves on to the next,
// and the collections of the one before are let go.
let queue: Promise<unknown> = Promise.resolve()
let era = 0

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
    if (e.agentId === undefined && !e.isAborted) {
      // The conversation is taken now, as this turn ended, though its collection may wait behind earlier ones; only the
      // last six messages the person or the assistant wrote are kept.
      const written = (await $.session.messages())
        .filter(message => message.text !== '' && !(message.role === 'user' && NOT_THEIRS.test(message.text)))
        .map(({ role, text }) => ({ role, text }))
      // A turn of many tool steps fills six messages with the assistant's own; the person's last message stays first.
      const asking = written.findLast(message => message.role === 'user')
      const last = written.slice(-6)
      const recent = asking === undefined || last.includes(asking) ? last : [asking, ...written.slice(-5)]
      const mine = era
      queue = queue
        .then(() => (mine === era ? collect($, recent) : undefined))
        .catch(() => $.ui.status('단어 사전: 용어 수집 중 오류가 났습니다.'))
        .catch(() => undefined)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') era += 1
    return next(e)
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
    const { askedHeld, chosen } = await glossary($)
    const list = mentioned(e.props.text, [...askedHeld, ...chosen])
    if (list.length === 0) return next(e)
    const open = await read($, opened)
    const id = tag(e.props.text)
    const { Box, Text, Markdown, Client, Link } = $.ui.resolve(e)
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
        <Text bold={one.bold} color={one.code ? 'permission' : undefined}>
          {one.href === undefined ? one.text : <Link href={one.href}>{one.text}</Link>}
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
