import { expect, test } from 'claude-code/testing'

// The term words a drawing holds whose text is the one given.
const termWords = async (ui: { findAll: (query: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }, text: string) =>
  (await ui.findAll({ type: 'Client' })).filter(one => (one.props.props as { text?: string } | undefined)?.text === text)

const REPLY = {
  component: 'AssistantMessage',
  props: { text: '커밋을 마쳤고 `git commit` 과 [커밋 안내](https://example.com) 는 그대로 둡니다. 다시 커밋합니다.', isFirstOfReply: true },
} as const

// Collecting runs unawaited after the turn, so a test waits for it before drawing.
const settle = () => new Promise(done => setTimeout(done, 50))

const answer = (text: string) => ({
  value: {
    isAnswered: true,
    text,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
})

const seed = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '커밋했습니다.', toolUses: [] }] }))
  on('model.complete', () => answer('{"terms":[{"term":"커밋","desc":"변경 내용을 기록으로 남기는 작업이다.","detail":"파일을 고친 내용을 저장소에 한 건의 기록으로 남기는 작업이다. 예: 보고서 표를 고친 뒤 커밋하면 언제 무엇을 고쳤는지 남는다."}]}'))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
  await settle()
}

test('a reply mentioning a term gets its terms marked in the prose, each card waiting for the pointer', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...REPLY, viewport: { columns: 120, rows: 40, isFullscreen: true } })

  expect(await reply.find({ type: 'Markdown' })).toBeUndefined()
  expect(await reply.find({ text: '용어' })).toBeUndefined()
  expect(await termWords(reply, '커밋')).not.toHaveLength(0)
  expect(await reply.find({ text: '을' })).toBeDefined()
  expect(await reply.find({ text: 'git' })).toBeDefined()
  expect(await reply.find({ text: /`/ })).toBeUndefined()
  const cards = (await reply.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
  expect(cards.length).toBeGreaterThan(0)
  expect(cards.every(box => box.props.display === 'none')).toBe(true)
  expect(await reply.find({ text: /변경 내용을 기록으로 남기는 작업이다/ })).toBeDefined()
})

test('a block without a term, and a table, keep the engine markdown beside a hand-drawn paragraph', async ($, on) => {
  await seed($, on)
  const text = '평범한 문단입니다.\n\n**커밋**을 마쳤습니다.\n- 다시 커밋합니다.\n\n| 커밋 | 날짜 |\n|---|---|\n| a | b |'
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
  const markdown = (await reply.findAll({ type: 'Markdown' })).map(one => one.props.text)
  expect(markdown).toEqual(['평범한 문단입니다.', '| 커밋 | 날짜 |\n|---|---|\n| a | b |'])
  expect(await termWords(reply, '커밋')).toHaveLength(2)
  expect(await reply.find({ text: '• ' })).toBeDefined()
  expect(await reply.find({ text: /\*\*/ })).toBeUndefined()
})

test("a click widens that word's card to the full explanation, and the pointer leaving the word narrows it again", async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '커밋을 마쳤습니다.\n\n다시 커밋합니다.', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
  const [first] = await termWords(reply, '커밋')
  const at = { in: first?.key ?? '' }
  const full = /예:/

  expect(await reply.find({ text: full })).toBeUndefined()
  await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', ...at })
  expect(await reply.findAll({ type: 'Text', text: full })).toHaveLength(1)
  expect(await reply.find({ text: /변경 내용을 기록으로 남기는 작업이다/ })).toBeDefined()
  expect((await reply.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute').every(box => box.props.display === 'none')).toBe(true)
  await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', ...at })
  expect(await reply.find({ text: full })).toBeUndefined()
  await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', ...at })
  expect(await reply.find({ text: full })).toBeDefined()
  await reply.pointer({ type: 'leave', x: 0, y: 0, ...at })
  expect(await reply.find({ text: full })).toBeUndefined()
})

test("a card keeps inside the reply's right edge and fills every row of its width", async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '가나다라마바사아자차카타파하 가나다라마바사 커밋', isFirstOfReply: true },
    viewport: { columns: 60, rows: 40, isFullscreen: true },
  })
  const [card] = (await reply.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
  const width = Number(card?.props.width)
  expect(Number(card?.props.left) + width).toBeLessThanOrEqual(58)
  const rows = (await reply.findAll({ type: 'Text' })).filter(one => one.props.backgroundColor !== undefined)
  expect(rows.length).toBeGreaterThan(2)
  expect(rows.every(one => [...one.text].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0) === width - 2)).toBe(true)
})

test('two replies drawn side by side never share a term key', async ($, on) => {
  await seed($, on)
  const mount = (text: string) =>
    $.ui.mount({ plugin: 'glossary', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns: 120, rows: 40, isFullscreen: true } })
  const [one] = await termWords(await mount('커밋을 마쳤습니다.'), '커밋')
  const [two] = await termWords(await mount('커밋을 다시 했습니다.'), '커밋')
  expect(one?.key).toBeDefined()
  expect(one?.key).not.toBe(two?.key)
})

test('a reply that mentions a term only in code keeps the engine drawing', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '`커밋` 명령만 적었습니다.', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
  expect(await reply.find({ key: 'engine' })).toBeDefined()
})

test('the main screen keeps the engine reply untouched', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...REPLY, viewport: { columns: 120, rows: 40, isFullscreen: false } })
  expect(await termWords(reply, '커밋')).toHaveLength(0)
  expect(await reply.find({ key: 'engine' })).toBeDefined()
})

test('with rows to spare above, the card rises over the word to its right', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: {
      text: ['첫 줄입니다.', '둘째 줄입니다.', '셋째 줄입니다.', '넷째 줄입니다.', '다섯째 줄입니다.', '여섯째 줄에서 커밋을 마쳤습니다.'].join('\n\n'),
      isFirstOfReply: true,
      onScreen: { first: 0, last: 11, of: 12 },
    },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
  const [card] = (await reply.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
  expect(card?.props).toMatchObject({ bottom: 1, left: 0, display: 'none' })
})
