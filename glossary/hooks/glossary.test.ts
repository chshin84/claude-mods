import { expect, test } from 'claude-code/testing'

type On = Parameters<Parameters<typeof test>[1]>[1]

// The term words a drawing holds, in reading order.
const marks = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Client' })).map(one => (one.props.props as { text: string }).text)

const reply = (text: string) =>
  ({
    plugin: 'glossary',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  }) as const

// Collecting runs unawaited after the turn, so a test waits for it before looking.
const settle = () => new Promise(done => setTimeout(done, 50))

const answer = (text: string, outputTokens = 1) => ({
  value: {
    isAnswered: true,
    text,
    usage: { input_tokens: 1, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
})

const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const

const user = (text: string) => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string) => ({ role: 'assistant', text, toolUses: [] })

// What the engine answers beneath every test: the status line, the turn's end and the engine's own drawing; and the
// two tracks as last stored, the terms the model chose and the terms the person asked about.
const engine = (on: On) => {
  const lines: (string | undefined)[] = []
  const writes = { terms: 0, asked: 0 }
  const last: Record<'terms' | 'asked', { term: string; desc: string }[]> = { terms: [], asked: [] }
  on('ui.status', (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('state.set', (_$, e, next) => {
    if (e.key === 'terms' || e.key === 'asked') {
      writes[e.key] += 1
      last[e.key] = e.value as { term: string; desc: string }[]
    }
    return next(e)
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  const tracks = () => ({ chosen: last.terms.map(one => one.term), asked: last.asked.map(one => one.term) })
  return { lines, writes, last, tracks }
}

test("the model's well-formed terms are stored once each and marked in the reply; /단어 hides them", async ($, on) => {
  const seen = engine(on)
  on('session.messages', () => ({ value: [assistant('로컬 커밋 뒤 원격 브랜치로 푸시했습니다.')] }))
  on('model.complete', () =>
    answer('{"terms":[{"term":"커밋","desc":"변경을 남기는 작업이다."},{"term":"브랜치","desc":"x"},{"term":"브랜치","desc":"중복"},{"desc":"이름 없음"}]}'),
  )
  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  expect(seen.tracks().chosen).toEqual(['커밋', '브랜치'])
  expect(await marks(await $.ui.mount(reply('커밋하고 브랜치를 옮겼습니다.')))).toEqual(['커밋', '브랜치'])
  await $.prompt.submit({ text: '/단어', wait: false })
  expect(await marks(await $.ui.mount(reply('커밋하고 브랜치를 옮겼습니다.')))).toEqual([])
})

test('terms keep piling up while the term marks are off', async ($, on) => {
  engine(on)
  let call = 0
  on('session.messages', () => ({ value: [assistant('훅과 플러그인을 고쳤습니다.')] }))
  on('model.complete', () => {
    call += 1
    return answer(call === 1 ? '{"terms":[{"term":"훅","desc":"a"}]}' : '{"terms":[{"term":"플러그인","desc":"b"}]}')
  })

  await $.prompt.submit({ text: '/단어', wait: false })
  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()
  await $.prompt.submit({ text: '/단어', wait: false })

  expect(await marks(await $.ui.mount(reply('훅과 플러그인을 고쳤습니다.')))).toEqual(['훅', '플러그인'])
})

test('a reply drawn before its collection gains the new marks in place once the collection ends', async ($, on) => {
  engine(on)
  on('session.messages', () => ({ value: [assistant('커밋했습니다.')] }))
  on('model.complete', async () => {
    await settle()
    return answer('{"terms":[{"term":"커밋","desc":"a"}]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  const shown = await $.ui.mount(reply('커밋했습니다.'))
  expect(await marks(shown)).toEqual([])
  await settle()
  await settle()
  expect(await marks(shown)).toEqual(['커밋'])
})

test('collections queue up and run one at a time, each on the conversation as its turn ended, past a failed one', async ($, on) => {
  engine(on)
  const prompts: string[] = []
  let turnNo = 0
  let inFlight = 0
  let most = 0
  on('session.messages', () => ({ value: [assistant(`턴${turnNo} 에서 커밋했습니다.`)] }))
  on('model.complete', async (_$, e) => {
    inFlight += 1
    most = Math.max(most, inFlight)
    prompts.push(String(e.prompt))
    await settle()
    inFlight -= 1
    if (prompts.length === 2) throw new Error('boom')
    return answer('{"terms":[]}')
  })

  for (const id of ['t1', 't2', 't3']) {
    turnNo += 1
    await $.turn.complete({ ...turn, turnId: id })
  }
  for (let wait = 0; wait < 8; wait += 1) await settle()

  expect(prompts.map(one => /턴(\d)/.exec(one)?.[1])).toEqual(['1', '2', '3'])
  expect(most).toBe(1)
})

test('a /clear lets go of the collections still waiting', async ($, on) => {
  engine(on)
  const prompts: string[] = []
  on('session.messages', () => ({ value: [assistant('커밋했습니다.')] }))
  on('model.complete', async (_$, e) => {
    prompts.push(String(e.prompt))
    await settle()
    return answer('{"terms":[]}')
  })
  on('session.end', () => ({ sessionId: 's1' }))

  await $.turn.complete({ ...turn, turnId: 't1' })
  await $.turn.complete({ ...turn, turnId: 't2' })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  for (let wait = 0; wait < 4; wait += 1) await settle()

  expect(prompts).toHaveLength(1)
})

test('a collection that adds nothing new writes neither track, so nothing is redrawn', async ($, on) => {
  const seen = engine(on)
  let calls = 0
  on('session.messages', () => ({ value: [user('커밋이 뭔가요?'), assistant('커밋했습니다.')] }))
  on('model.complete', () => {
    calls += 1
    return answer('{"terms":[{"term":"커밋","desc":"a","asked":true}]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()

  expect(calls).toBe(2)
  expect(seen.writes).toEqual({ terms: 0, asked: 1 })
})

test('only a term a reply underlines is kept from the model: not one only in code, a table, a link label or bold code', async ($, on) => {
  const seen = engine(on)
  const text = ['커밋을 마쳤고 `plugin.json` 과 **`스킬`** 과 [훅 안내](https://example.com) 를 고쳤습니다.', '', '| 브랜치 | 날짜 |', '|---|---|', '| a | b |'].join('\n')
  on('session.messages', () => ({ value: [user('워크트리도 봐 주세요.'), assistant(text)] }))
  on('model.complete', () =>
    answer(JSON.stringify({ terms: ['커밋', 'plugin.json', '스킬', '훅', '브랜치', '워크트리'].map(term => ({ term, desc: 'a' })) })),
  )

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  expect(seen.tracks()).toEqual({ chosen: ['커밋'], asked: [] })
})

test('the call is Haiku, bounded in length, names the held terms its conversation mentions on two lists, and leaves room', async ($, on) => {
  engine(on)
  const calls: { model: string; prompt: string; maxTokens?: number; timeoutMs?: number }[] = []
  on('session.messages', () => ({
    value:
      calls.length === 0
        ? [user('커밋이 뭔가요?'), assistant('커밋과 브랜치와 훅을 봤습니다.')]
        : [...Array.from({ length: 9 }, () => assistant('가'.repeat(5000))), user('커밋은요?'), assistant('다시 커밋하고 훅을 고쳤습니다.')],
  }))
  on('model.complete', (_$, e) => {
    calls.push({ model: e.model, prompt: String(e.prompt), maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
    return answer(
      calls.length === 1 ? '{"terms":[{"term":"커밋","desc":"a","asked":true},{"term":"브랜치","desc":"b"},{"term":"훅","desc":"c"}]}' : '{"terms":[]}',
    )
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()

  const second = calls[1]?.prompt ?? ''
  expect(second).toMatch(/Already asked about: 커밋\n/)
  expect(second).toMatch(/Already in the glossary: 훅\n/)
  expect(second).not.toContain('브랜치')
  // Six messages of at most 2,000 characters each, and the two lists.
  expect(second.length).toBeLessThan(6 * 2100)
  expect(calls.every(one => one.model === 'claude-haiku-5-5' && (one.maxTokens ?? 0) >= 32000 && (one.timeoutMs ?? 0) > 0)).toBe(true)
})

test('a cut-off, failed or unreadable reply is said in the status line, and a good one clears it', async ($, on) => {
  const seen = engine(on)
  let call = 0
  on('session.messages', () => ({ value: [assistant('커밋했습니다.')] }))
  on('model.complete', (_$, e) => {
    call += 1
    if (call === 1) return answer('{"terms":[]}', e.maxTokens)
    if (call === 2) return { value: { isAnswered: false, reason: 'api-error', status: 529, message: 'overloaded' } }
    if (call === 3) return answer('not json')
    return answer('{"terms":[]}')
  })

  for (const id of ['t1', 't2', 't3', 't4']) {
    await $.turn.complete({ ...turn, turnId: id })
    await settle()
  }

  expect(seen.lines).toEqual([expect.stringMatching(/^단어 사전: .*잘려/), expect.stringMatching(/^단어 사전: .*받지 못했/), expect.stringMatching(/^단어 사전: .*읽지 못했/), undefined])
})

test('a term the person asked about is kept on its own track, though only their words hold it, loosely matched', async ($, on) => {
  const seen = engine(on)
  on('session.messages', () => ({
    value: [user('워크트리랑 브랜치 차이가 뭐야? 그리고 pr이 뭐야?'), assistant('작업 폴더를 하나 더 만드는 기능입니다. 커밋은 따로 합니다.')],
  }))
  on('model.complete', () =>
    answer(
      '{"terms":[{"term":"워크트리","desc":"a","asked":true},{"term":"PR","desc":"p","asked":true},{"term":"커밋","desc":"b"},{"term":"리베이스","desc":"c","asked":true}]}',
    ),
  )

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  // 리베이스 is called asked, yet no message of the person holds it, so it is not kept.
  expect(seen.tracks()).toEqual({ chosen: ['커밋'], asked: ['워크트리', 'PR'] })
  expect(await marks(await $.ui.mount(reply('워크트리와 커밋을 봤습니다.')))).toEqual(['워크트리', '커밋'])
})

test('words the person did not write, such as a skill body or a hook message, are not asked; a question after a long paste is', async ($, on) => {
  const seen = engine(on)
  on('session.messages', () => ({
    value: [
      user('Base directory for this skill: … 워크트리 를 쓴다.'),
      user('Stop hook feedback: 브랜치 를 확인하라.'),
      user(`${'붙여 넣은 글. '.repeat(400)}마지막으로 리베이스가 뭐야?`),
      assistant('설명했습니다.'),
    ],
  }))
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(String(e.prompt))
    return answer('{"terms":[{"term":"워크트리","desc":"a","asked":true},{"term":"브랜치","desc":"b","asked":true},{"term":"리베이스","desc":"c","asked":true}]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  expect(prompts[0]).toContain('리베이스가 뭐야?')
  expect(prompts[0]).not.toContain('Base directory for this skill')
  expect(seen.tracks()).toEqual({ chosen: [], asked: ['리베이스'] })
})

test('a term the model chose moves to the asked track once the person asks about it, drawn once with its new explanation', async ($, on) => {
  const seen = engine(on)
  let call = 0
  on('session.messages', () => ({ value: call === 0 ? [assistant('커밋했습니다.')] : [user('커밋이 뭔가요?'), assistant('변경을 기록하는 일입니다.')] }))
  on('model.complete', () => {
    call += 1
    return answer(call === 1 ? '{"terms":[{"term":"커밋","desc":"a"}]}' : '{"terms":[{"term":"커밋","desc":"물어본 풀이","asked":true}]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()

  expect(seen.tracks()).toEqual({ chosen: [], asked: ['커밋'] })
  expect(seen.last.asked[0]?.desc).toBe('물어본 풀이')
  const shown = await $.ui.mount(reply('커밋했습니다.'))
  expect(await marks(shown)).toEqual(['커밋'])
  expect(await shown.find({ text: /물어본 풀이/ })).toBeDefined()
})

test('the question of a turn with many tool steps stays in the call, and a short English term matches only as a word', async ($, on) => {
  const seen = engine(on)
  on('session.messages', () => ({
    value: [user('prompt 를 고치고 main 브랜치에 올려 주세요. 워크트리가 뭐예요?'), ...Array.from({ length: 7 }, (_, at) => assistant(`단계 ${at} 를 마쳤습니다.`))],
  }))
  const prompts: string[] = []
  on('model.complete', (_$, e) => {
    prompts.push(String(e.prompt))
    return answer('{"terms":[{"term":"워크트리","desc":"a","asked":true},{"term":"PR","desc":"b","asked":true},{"term":"main","desc":"c","asked":true}]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  expect(prompts[0]).toContain('워크트리가 뭐예요?')
  // PR stands only inside "prompt", so the person did not ask about it.
  expect(seen.tracks().asked).toEqual(['워크트리', 'main'])
})

test('a compaction summary is not the person asking', async ($, on) => {
  const seen = engine(on)
  on('session.messages', () => ({
    value: [user('This session is being continued from a previous conversation. 워크트리 를 썼다.'), assistant('이어서 합니다.')],
  }))
  on('model.complete', () => answer('{"terms":[{"term":"워크트리","desc":"a","asked":true}]}'))

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()

  expect(seen.tracks().asked).toEqual([])
})

test('only a /clear lets go of the waiting collections; a resume does not', async ($, on) => {
  engine(on)
  const prompts: string[] = []
  on('session.messages', () => ({ value: [assistant('커밋했습니다.')] }))
  on('model.complete', async (_$, e) => {
    prompts.push(String(e.prompt))
    await settle()
    return answer('{"terms":[]}')
  })
  on('session.end', () => ({ sessionId: 's1' }))

  await $.turn.complete({ ...turn, turnId: 't1' })
  await $.turn.complete({ ...turn, turnId: 't2' })
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } } as never)
  for (let wait = 0; wait < 4; wait += 1) await settle()

  expect(prompts).toHaveLength(2)
})

test('collecting goes on after even the failure notice fails', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', (_$, e) => {
    if (e.text?.includes('오류')) throw new Error('no status line')
    return { value: undefined }
  })
  let calls = 0
  on('session.messages', () => ({ value: [assistant('커밋했습니다.')] }))
  on('model.complete', () => {
    calls += 1
    if (calls === 1) throw new Error('boom')
    return answer('{"terms":[]}')
  })

  await $.turn.complete({ ...turn, turnId: 't1' })
  await settle()
  await $.turn.complete({ ...turn, turnId: 't2' })
  await settle()

  expect(calls).toBe(2)
})

test('typing /단 offers /단어 in the typeahead', async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  const typed = await $.prompt.autocomplete({ text: '/단', cursor: 2, token: '/단', start: 0 })
  expect(typed.suggestions.map(row => row.text)).toEqual(['/단어'])
  const other = await $.prompt.autocomplete({ text: '/co', cursor: 3, token: '/co', start: 0 })
  expect(other.suggestions).toEqual([])
})
