// Claude Code 상태 표시줄: [ 워크트리·폴더 | 개발 단계(있으면) | 5시간한도 | 주간한도 | 컨텍스트 | 모델 ]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');

// 사용률 구간: [상한(미만), ANSI 색, 날씨 아이콘]
const LEVELS = [
  [50, '\x1b[32m', '☀️'],         // 초록
  [70, '\x1b[33m', '⛅'],         // 노랑
  [85, '\x1b[38;5;208m', '🌧️'],  // 앰버
  [Infinity, '\x1b[31m', '⛈️'],  // 빨강
];
const RESET = '\x1b[0m';

function gauge(label, pct) {
  if (typeof pct !== 'number') return `${label} -`;
  const [, color, icon] = LEVELS.find(([max]) => pct < max);
  return `${color}${label} ${icon} ${Math.round(pct)}%${RESET}`;
}

// 작업 위치: 워크트리 이름, 없으면 저장소(없으면 폴더) 이름
function place(input) {
  const tree = input.worktree?.name ?? input.workspace?.git_worktree;
  if (tree) return `워크트리:${tree}`;
  return `폴더:${repoName(input.workspace?.current_dir ?? input.cwd)}`;
}

function repoName(dir) {
  if (!dir) return '';
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (top) return path.basename(top);
  } catch {}
  return path.basename(dir);
}

// 대화 기록에서 마지막으로 호출한 개발 스킬을 찾아 단계로 표시한다
const PHASES = {
  'disciplined-coder:lens-prior-art': '자료 조사',
  'anthropic-skills:deep-research': '자료 조사',
  'superpowers:brainstorming': '스펙 작성',
  'superpowers:writing-plans': '계획 작성',
  'disciplined-coder:nested-orchestration': '작업 분할',
  'superpowers:executing-plans': '구현',
  'superpowers:subagent-driven-development': '구현',
  'superpowers:test-driven-development': '구현',
  'superpowers:systematic-debugging': '디버깅',
  'superpowers:requesting-code-review': '코드 리뷰',
  'superpowers:receiving-code-review': '코드 리뷰',
  'code-review': '코드 리뷰',
  'superpowers:verification-before-completion': '완료 검증',
  'superpowers:finishing-a-development-branch': '병합 정리',
};
const REVIEW_SPECS = 'disciplined-coder:review-specs';

function phase(transcript) {
  if (!transcript) return '';
  let text;
  try { text = fs.readFileSync(transcript, 'utf8'); } catch { return ''; }
  const re = /"skill":"([^"]+)"|command-name>\/([^<]+)</g;
  let last = '', planSeen = false, m;
  while ((m = re.exec(text))) {
    const name = m[1] || m[2];
    if (!(name in PHASES) && name !== REVIEW_SPECS) continue;
    if (name === 'superpowers:writing-plans') planSeen = true;
    last = name === REVIEW_SPECS ? (planSeen ? '계획 검토' : '스펙 검토') : PHASES[name];
  }
  return last;
}

const rl = input.rate_limits || {};
const parts = [
  place(input),
  phase(input.transcript_path),
  gauge('5시간한도', rl.five_hour?.used_percentage),
  gauge('주간한도', rl.seven_day?.used_percentage),
  gauge('컨텍스트', input.context_window?.used_percentage),
  `모델:${input.model?.display_name ?? ''}`,
].filter(Boolean);
process.stdout.write(`[ ${parts.join(' | ')} ]`);
