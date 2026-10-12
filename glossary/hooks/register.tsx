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
- "detail": at most 250 Korean characters, a fuller explanation: what it is, why it is used, what it did in this conversation, and a concrete example of it in use starting with "예:" when one helps.
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
const DETAIL_WIDTH = 72
// The card's own colours, solid so nothing beneath shows through, and legible under a dark or a light theme.
const CARD = { background: '#2d2d2d', text: '#f0f0f0', title: '#7ab4ff' }

// The glossary's terms this text mentions outside code, in the order they first appear.
const mentioned = (text: string, list: Term[]) => {
  const prose = text.replace(CODE, ' ').toLowerCase()
  return list
    .map(one => ({ one, at: prose.indexOf(key(one.term)) }))
    .filter(({ one, at }) => at !== -1 && key(one.term) !== '')
    .sort((a, b) => a.at - b.at)
    .map(({ one }) => one)
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

// Shows or hides the term rows under replies; collecting goes on either way.
async function toggle($: EngineInterface) {
  const shown = !(await read($, isOn))
  await update($, isOn, () => shown)
  return shown ? '답변 아래 용어 줄을 켰습니다.' : '답변 아래 용어 줄을 껐습니다.'
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
    return { suggestions: [...rows.suggestions, { text: COMMAND, description: '답변 아래 용어 줄을 켜거나 끈다' }] }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) void collect($).catch(() => undefined)
    return done
  })

  // Under a reply, a row of the terms it mentions; the pointer on one lights it and shows its short explanation in a card above,
  // and a click opens the full explanation in a larger box under the row until it is clicked again.
  // Only the fullscreen layout follows the pointer and reports clicks.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== true || e.props.isSummary || !(await read($, isOn))) return next(e)
    const list = mentioned(e.props.text, await read($, terms))
    if (list.length === 0) return next(e)
    const open = await read($, opened)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const width = Math.max(20, Math.min(CARD_WIDTH, e.viewport.columns - 4))
    const wide = Math.max(20, Math.min(DETAIL_WIDTH, e.viewport.columns - 4))
    const flip = (name: string) => update($, opened, names => (names.includes(name) ? names.filter(one => one !== name) : [...names, name]))
    return (
      <Box flexDirection="row">
        <Text>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <Markdown text={e.props.text} />
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
            <Text color="inactive">용어</Text>
            {list.map(one => (
              <Box key={`chip-${key(one.term)}`}>
                <Button key={`press-${key(one.term)}`} label={one.term} plain onPress={() => void flip(key(one.term))}>
                  <Text color="suggestion" underline>
                    {one.term}
                  </Text>
                </Button>
                <Box
                  position="absolute"
                  bottom={1}
                  left={0}
                  width={width}
                  display="none"
                  hover={{ display: 'flex' }}
                  borderStyle="round"
                  borderColor={CARD.title}
                  backgroundColor={CARD.background}
                  paddingX={1}
                  flexDirection="column"
                >
                  <Text bold color={CARD.title} backgroundColor={CARD.background}>
                    {one.term}
                  </Text>
                  <Text color={CARD.text} backgroundColor={CARD.background}>
                    {one.desc}
                  </Text>
                  <Text dimColor backgroundColor={CARD.background}>
                    누르면 자세히 봅니다
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
          {list
            .filter(one => open.includes(key(one.term)))
            .map(one => (
              <Box
                key={`detail-${key(one.term)}`}
                width={wide}
                marginTop={1}
                borderStyle="round"
                borderColor={CARD.title}
                paddingX={1}
                flexDirection="column"
              >
                <Text bold color={CARD.title}>
                  {one.term}
                </Text>
                <Text>{one.detail ?? one.desc}</Text>
                <Text color="inactive">용어를 다시 누르면 닫힙니다</Text>
              </Box>
            ))}
        </Box>
      </Box>
    )
  })
}
