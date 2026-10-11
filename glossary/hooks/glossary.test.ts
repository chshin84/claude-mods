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

test('the command toggles the glossary and turning it on lists the terms the model gives', async ($, on) => {
  const closed: string[] = []
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '로컬 커밋 뒤 원격 브랜치로 푸시했습니다.', toolUses: [] }] }))
  on('model.complete', () =>
    answer('{"terms":[{"term":"커밋","desc":"파일의 변경 내용을 기록으로 남기는 작업이다."},{"term":"브랜치","desc":"x"},{"term":"브랜치","desc":"중복"},{"desc":"이름 없음"}]}'),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))

  const off = await $.prompt.submit({ text: '/단어', wait: false })
  expect(off.drop).toBe('단어 사전을 숨겼습니다.')
  expect(closed).toEqual(['glossary'])

  const back = await $.prompt.submit({ text: '/단어', wait: false })
  expect(back.drop).toBe('단어 사전을 열었습니다.')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't1' })

  const pane = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...PANE })
  expect(await pane.find({ text: /기록으로 남기는 작업이다/ })).toBeDefined()
  expect(await pane.find({ key: 'term-커밋' })).toBeDefined()
  expect(await pane.find({ key: 'term-브랜치' })).toBeDefined()
  expect(await pane.find({ text: /중복/ })).toBeUndefined()
})

test('terms keep piling up while the glossary is off', async ($, on) => {
  let call = 0
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '훅과 플러그인을 고쳤습니다.', toolUses: [] }] }))
  on('model.complete', () => {
    call += 1
    return answer(call === 1 ? '{"terms":[{"term":"훅","desc":"정해진 시점에 자동으로 실행되는 코드다."}]}' : '{"terms":[{"term":"플러그인","desc":"프로그램에 기능을 추가하는 묶음이다."}]}')
  })
  on('ui.close', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))

  await $.prompt.submit({ text: '/단어', wait: false })
  const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...turn, turnId: 't1' })
  await $.turn.complete({ ...turn, turnId: 't2' })

  const pane = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...PANE })
  expect(await pane.find({ key: 'term-훅' })).toBeDefined()
  expect(await pane.find({ key: 'term-플러그인' })).toBeDefined()
})

test('a held term the latest turn mentions again moves up without a new explanation', async ($, on) => {
  let call = 0
  on('session.messages', () => ({
    value: call < 2
      ? [{ role: 'user', text: '시작', toolUses: [] }]
      : [
          { role: 'user', text: '커밋은 언제 해?', toolUses: [] },
          { role: 'assistant', text: '작업이 끝나면 커밋합니다.', toolUses: [] },
        ],
  }))
  on('model.complete', () => {
    call += 1
    if (call === 1) return answer('{"terms":[{"term":"커밋","desc":"변경 내용을 기록으로 남기는 작업이다."},{"term":"푸시","desc":"기록을 원격 저장소로 올리는 작업이다."}]}')
    if (call === 2) return answer('{"terms":[{"term":"브랜치","desc":"작업을 따로 진행하는 갈래다."}]}')
    return answer('{"terms":[{"term":"커밋","desc":"다시 쓴 풀이"}]}')
  })
  on('turn.complete', () => ({ text: '' }))

  const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...turn, turnId: 't1' })
  await $.turn.complete({ ...turn, turnId: 't2' })
  await $.turn.complete({ ...turn, turnId: 't3' })

  const pane = await $.ui.mount({ plugin: 'glossary', surface: 'terminal', ...PANE })
  const order = (await pane.findAll({ type: 'Box' })).map(box => box.key).filter(name => name?.startsWith('term-'))
  expect(order).toEqual(['term-커밋', 'term-브랜치', 'term-푸시'])
  expect(await pane.find({ text: /변경 내용을 기록으로 남기는 작업이다/ })).toBeDefined()
  expect(await pane.find({ text: /다시 쓴 풀이/ })).toBeUndefined()
})

test('typing /단 offers /단어 in the typeahead', async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  const typed = await $.prompt.autocomplete({ text: '/단', cursor: 2, token: '/단', start: 0 })
  expect(typed.suggestions.map(row => row.text)).toEqual(['/단어'])
  const other = await $.prompt.autocomplete({ text: '/co', cursor: 3, token: '/co', start: 0 })
  expect(other.suggestions).toEqual([])
})
