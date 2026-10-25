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
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
  await settle()
}

test('a reply mentioning a term gets its terms marked in the prose, each card waiting for the pointer', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...REPLY, viewport: { columns: 120, rows: 40, isFullscreen: true } })

  expect(await reply.find({ type: 'Markdown' })).toBeUndefined()
  expect(await termWords(reply, '커밋')).not.toHaveLength(0)
  expect(await reply.find({ text: '을' })).toBeDefined()
  expect(await reply.find({ text: 'git' })).toBeDefined()
  expect(await reply.find({ text: /`/ })).toBeUndefined()
  const cards = (await reply.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')
  expect(cards.length).toBeGreaterThan(0)
  expect(cards.every(box => box.props.display === 'none')).toBe(true)
  expect(await reply.find({ text: /변경 내용을 기록으로 남기는 작업이다/ })).toBeDefined()
})

test('a hand-drawn block keeps its links, a markdown one and a bare one, as links', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '커밋은 [커밋 안내](https://example.com/a) 와 https://example.com/b 에 있습니다.', isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
  const links = (await reply.findAll({ type: 'Link' })).map(one => one.props.href)
  expect(links).toContain('https://example.com/a')
  expect(links).toContain('https://example.com/b')
  expect(await termWords(reply, '커밋')).toHaveLength(1)
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

// One case per kind of place a term may stand, against one glossary; the expected marks follow the reading order.
const TABLE: { kind: string; text: string; marks: string[] }[] = [
  { kind: 'an English term inside a longer word', text: 'README 와 readme 를 봤습니다.', marks: ['README'] },
  { kind: 'a term standing twice', text: 'READ 권한과 READ는 같습니다.', marks: ['READ', 'READ'] },
  { kind: 'an English term with a particle', text: 'PR을 열고 main에 병합했습니다.', marks: ['PR', 'main'] },
  { kind: 'a Korean term with a particle', text: '커밋을 마치고 세션에서 확인했습니다.', marks: ['커밋', '세션'] },
  { kind: 'a Korean term with 하다', text: '커밋했고 테스트합니다.', marks: ['커밋', '테스트'] },
  { kind: 'a Korean term inside a compound', text: '백테스트와 에이전트원칙은 다르고 에이전트는 같습니다.', marks: ['에이전트'] },
  { kind: 'a Korean term with a suffix or the copula', text: '세션별 스킬입니다.', marks: ['세션', '스킬'] },
  { kind: 'a Korean plural', text: '플러그인들로 줄였습니다.', marks: ['플러그인'] },
  { kind: 'a noun phrase', text: '단어 사전을 열었습니다.', marks: ['단어 사전'] },
  { kind: 'the longer of two terms at one place', text: 'Claude Code 와 Claude 를 씁니다. 서브에이전트가 일했습니다.', marks: ['Claude Code', 'Claude', '서브에이전트'] },
  { kind: 'a term inside a path, a file name or a hyphenated name', text: 'hooks/register.tsx 와 origin/main 과 pre-commit 을 봤고 main 은 둡니다.', marks: ['main'] },
  { kind: 'an English plural', text: 'hook 과 hooks 와 commits 를 봤습니다.', marks: ['hook'] },
  { kind: 'a term in bold', text: '**커밋**을 마쳤습니다.', marks: ['커밋'] },
  { kind: 'a capital term against the lower-case word', text: 'The panel read it, and READ stays.', marks: ['READ'] },
]

const GLOSSARY = ['README', 'READ', 'hook', 'commit', 'PR', 'main', 'Claude', 'Claude Code', '커밋', '세션', '스킬', '플러그인', '에이전트', '서브에이전트', '단어 사전', '테스트']

for (const one of TABLE) {
  test(`${one.kind} is marked as a reader expects`, async ($, on) => {
    on('session.messages', () => ({ value: [{ role: 'assistant', text: GLOSSARY.join(' 와 '), toolUses: [] }] }))
    on('model.complete', () => answer(JSON.stringify({ terms: GLOSSARY.map(term => ({ term, desc: `${term} 풀이다.` })) })))
    on('turn.complete', () => ({ text: '' }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })
    await settle()
    const shown = await $.ui.mount({
      plugin: 'glossary',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: one.text, isFirstOfReply: true },
      viewport: { columns: 120, rows: 40, isFullscreen: true },
    })
    expect((await shown.findAll({ type: 'Client' })).map(word => (word.props.props as { text: string }).text)).toEqual(one.marks)
  })
}
