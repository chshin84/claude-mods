import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'glossary',
  props: {
    title: '단어 사전',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as const

const answer = (text: string) => ({
  value: {
    isAnswered: true,
    text,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
})

test('the pane pops up with the first explained terms, not before', async ($, on) => {
  const opened: string[] = []
  let call = 0
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '커밋했습니다.', toolUses: [] }] }))
  on('model.complete', () => {
    call += 1
    return answer(call === 1 ? '{"terms":[]}' : '{"terms":[{"term":"커밋","desc":"변경 내용을 기록으로 남기는 작업이다."}]}')
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('turn.complete', () => ({ text: '' }))

  const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...turn, turnId: 't1' })
  const empty = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...PANE })
  expect(await empty.find({ text: /아직 풀이할 용어가 없습니다/ })).toBeDefined()
  expect(call).toBe(1)
  expect(opened).toEqual([])
  await empty.unmount()
  await $.turn.complete({ ...turn, turnId: 't2' })
  const pane = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'term-커밋' })).toBeDefined()
  expect(opened).toEqual(['glossary'])
})
