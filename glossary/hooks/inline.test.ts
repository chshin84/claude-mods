import { expect, test } from 'claude-code/testing'

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

test('a reply mentioning a term gets a term row whose card waits for the pointer', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...REPLY, viewport: { columns: 120, rows: 40, isFullscreen: true } })

  expect(await reply.find({ type: 'Markdown' })).toMatchObject({ props: { text: REPLY.props.text } })
  const chip = await reply.find({ key: 'chip-커밋' })
  expect(chip).toBeDefined()
  const card = (await reply.findAll({ type: 'Box' })).find(box => box.props.position === 'absolute')
  expect(card?.props).toMatchObject({ display: 'none' })
  expect(await reply.find({ text: /변경 내용을 기록으로 남기는 작업이다/ })).toBeDefined()
})

test('a click on a term opens its full explanation under the row and a second click closes it', async ($, on) => {
  await seed($, on)
  const reply = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...REPLY, viewport: { columns: 120, rows: 40, isFullscreen: true } })

  expect(await reply.find({ key: 'detail-커밋' })).toBeUndefined()
  await reply.press({ key: 'press-커밋' })
  expect(await reply.find({ key: 'detail-커밋' })).toBeDefined()
  expect(await reply.find({ text: /예: 보고서 표를 고친 뒤 커밋하면/ })).toBeDefined()
  await reply.press({ key: 'press-커밋' })
  expect(await reply.find({ key: 'detail-커밋' })).toBeUndefined()
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
  expect(await reply.find({ key: 'chip-커밋' })).toBeUndefined()
  expect(await reply.find({ key: 'engine' })).toBeDefined()
})
