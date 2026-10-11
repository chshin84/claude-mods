# claude-mods

Claude Code 에서 쓰는 플러그인 두 개를 모은 마켓플레이스다. 마켓플레이스는 플러그인 목록을 둔 저장소로, Claude Code 가 이 목록을 읽어 플러그인을 설치한다.

- **glossary(단어 사전):** 대화에 나온 어려운 용어를 사무직 직원도 알 수 있게 4줄 이하로 풀어 오른쪽 패널에 보인다. 풀이는 Claude Haiku 5.5 가 만든다.
- **statusline(상태 표시줄):** 화면 아래에 `모델 | 저장소(없으면 폴더) | ctx | 5h | 7d | 개발 단계` 를 보인다. 사용률은 50% 미만 초록, 70% 미만 노랑, 85% 미만 앰버, 그 이상 빨강으로 표시한다.

## 설치

Claude Code 터미널 세션의 입력창에 아래 세 줄을 차례로 입력한다. 설치 범위를 물으면 `user` 를 고른다.

```
/plugin marketplace add chshin84/claude-mods
/plugin install glossary@chshin-mods
/plugin install statusline@chshin-mods
```

설치한 뒤 Claude Code 를 다시 시작한다.

## 단어 사전 사용법

- 세션을 시작하면 사전은 비어 있다. 첫 용어 풀이가 생기면 패널이 열린다.
- `/단어` 를 입력하면 패널을 숨기거나 다시 연다. 숨겨 둔 동안에도 용어는 계속 쌓인다.
- 이미 풀이한 용어가 다시 나오면 새로 풀이하지 않고 목록 맨 위로 올린다.
- Claude Code 는 사용자가 요청하지 않은 패널을 터미널 폭이 144칸 이상일 때만 연다. 폭이 좁으면 터미널을 넓히거나 `/단어` 를 입력한다.
- 응답이 끝날 때마다 Haiku 5.5 를 한 번 호출한다. 호출 한 번의 비용은 약 $0.001 이다.

## 상태 표시줄 동작

statusline 플러그인은 세션을 시작할 때마다 `statusline.js` 를 `~/.claude/statusline.js` 로 복사한다. `~/.claude/settings.json` 에 `statusLine` 설정이 없으면 이 파일을 가리키는 설정을 추가한다. 다른 `statusLine` 설정이 이미 있으면 설정을 바꾸지 않으므로, 이 상태 표시줄을 쓰려면 기존 `statusLine` 항목을 지운 뒤 Claude Code 를 다시 시작한다.

개발 단계는 그 세션에서 마지막으로 실행한 superpowers·disciplined-coder 스킬로 정한다.

## 요구 사항

- Node.js 가 설치되어 있어야 한다. 상태 표시줄 스크립트를 Node.js 로 실행한다.
- 단어 사전은 Claude Code 모드(hooks module) 기능을 쓴다. 이 기능을 지원하는 Claude Code 버전이 필요하다.
