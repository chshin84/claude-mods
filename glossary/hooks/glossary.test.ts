import { expect, test } from 'claude-code/testing'

// The term words a drawing holds whose text is the one given.
const termWords = async (ui: { findAll: (query: { type: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]> }, text: string) =>
  (await ui.findAll({ type: 'Client' })).filter(one => (one.props.props as { text?: string } | undefined)?.text === text)

const reply = (text: string) =>
  ({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  }) as const

// Collecting runs unawaited after the turn, so a test waits for it before drawing.
const settle = () => new Promise(done => setTimeout(done, 50))

const answer = (text: string) => ({
  value: {
    isAnswered: true,
    text,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
})

const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const

test("the model's well-formed new terms are marked in the reply, and /단어 hides and shows it", async ($, on) => {
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '로컬 커밋 뒤 원격 브랜치로 푸시했습니다.', toolUses: [] }] }))
  on('model.complete', () =>
    answer('{"terms":[{"term":"커밋","desc":"파일의 변경 내용을 기록으로 남기는 작업이다."},{"term":"브랜치","desc":"x"},{"term":"브랜치","desc":"중복"},{"desc":"이름 없음"}]}'),
  )
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  const [TERM_A, TERM_B] = ['커밋', '브랜치']
  const shown = await $.ui.mount(reply('커밋하고 브랜치를 옮겼습니다.'))
  expect(await termWords(shown, TERM_A)).not.toHaveLength(0)
  expect(await termWords(shown, TERM_B)).not.toHaveLength(0)
  expect(await shown.find({ text: /중복/ })).toBeUndefined()
  await shown.unmount()

  expect((await $.prompt.submit({ text: '/단어', wait: false })).drop).toBe('답변 본문의 용어 표시를 껐습니다.')
  const hidden = await $.ui.mount(reply('커밋하고 브랜치를 옮겼습니다.'))
  expect(await termWords(hidden, TERM_A)).toHaveLength(0)
  await hidden.unmount()

  expect((await $.prompt.submit({ text: '/단어', wait: false })).drop).toBe('답변 본문의 용어 표시를 켰습니다.')
})

test('terms keep piling up while the term marks are off', async ($, on) => {
  let call = 0
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '훅과 플러그인을 고쳤습니다.', toolUses: [] }] }))
  on('model.complete', () => {
    call += 1
    return answer(call === 1 ? '{"terms":[{"term":"훅","desc":"정해진 시점에 자동으로 실행되는 코드다."}]}' : '{"terms":[{"term":"플러그인","desc":"프로그램에 기능을 추가하는 묶음이다."}]}')
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))

  await $.prompt.submit({ text: '/단어', wait: false })
  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()
  await $.prompt.submit({ text: '/단어', wait: false })

  const [TERM_A, TERM_B] = ['훅', '플러그인']
  const shown = await $.ui.mount(reply('훅과 플러그인을 고쳤습니다.'))
  expect(await termWords(shown, TERM_A)).not.toHaveLength(0)
  expect(await termWords(shown, TERM_B)).not.toHaveLength(0)
})

test('typing /단 offers /단어 in the typeahead', async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  const typed = await $.prompt.autocomplete({ text: '/단', cursor: 2, token: '/단', start: 0 })
  expect(typed.suggestions.map(row => row.text)).toEqual(['/단어'])
  const other = await $.prompt.autocomplete({ text: '/co', cursor: 3, token: '/co', start: 0 })
  expect(other.suggestions).toEqual([])
})
