# claude-mods

Claude Code 에서 쓰는 플러그인 두 개를 모은 마켓플레이스다. 마켓플레이스는 플러그인 목록을 둔 저장소로, Claude Code 가 이 목록을 읽어 플러그인을 설치한다.

- **glossary(단어 사전):** 답변에 나온 어려운 용어를 답변 아래 줄에 모은다. 용어에 마우스를 올리면 사무직 직원도 알 수 있는 풀이를 카드로 보인다. 풀이는 Claude Haiku 5.5 가 만든다.
- **statusline(상태 표시줄):** 화면 아래에 `[ 워크트리·폴더 | 개발 단계(있으면) | 5시간한도 | 주간한도 | 컨텍스트 | 모델 ]` 를 보인다. 첫 칸은 워크트리 이름, 없으면 저장소(없으면 폴더) 이름이다. 사용률은 50% 미만 초록, 70% 미만 노랑, 85% 미만 앰버, 그 이상 빨강으로 표시한다.

## 설치

Claude Code 터미널 세션의 입력창에 아래 세 줄을 차례로 입력한다. 설치 범위를 물으면 `user` 를 고른다.

```
/plugin marketplace add chshin84/claude-mods
/plugin install glossary@chshin-mods
/plugin install statusline@chshin-mods
```

설치한 뒤 Claude Code 를 다시 시작한다.

## 단어 사전 사용법

- 응답이 끝나면 그 대화에서 어려운 용어를 골라 풀이한다. 답변 본문에 사전 용어가 나오면 답변 아래에 `용어  커밋  브랜치` 같은 줄이 생긴다. 줄의 용어는 파란 글씨에 밑줄로 표시된다.
- 용어에 마우스를 올리면 그 위에 100자 이내의 짧은 풀이 카드가 뜨고, 마우스를 치우면 사라진다. 코드 안에만 나온 용어는 줄에 넣지 않는다.
- 용어를 누르면 용어 줄 아래 큰 상자에 250자 이내의 자세한 풀이가 열린다. 자세한 풀이에는 쓰임새의 예시가 들어갈 수 있다. 같은 용어를 다시 누르면 닫힌다.
- 마우스 위치는 Claude Code 의 fullscreen 레이아웃(`/config` 의 tui 설정이 fullscreen)에서만 전달된다. 다른 레이아웃에서는 용어 줄을 그리지 않는다.
- `/단어` 를 입력하면 용어 줄을 끄거나 다시 켠다. 꺼 둔 동안에도 용어는 계속 쌓인다.
- 응답이 끝날 때마다 Haiku 5.5 를 한 번 호출한다. 호출 한 번의 비용은 약 $0.001 이다.

## 상태 표시줄 동작

statusline 플러그인은 세션을 시작할 때마다 `statusline.js` 를 `~/.claude/statusline.js` 로 복사한다. `~/.claude/settings.json` 에 `statusLine` 설정이 없으면 이 파일을 가리키는 설정을 추가한다. 다른 `statusLine` 설정이 이미 있으면 설정을 바꾸지 않으므로, 이 상태 표시줄을 쓰려면 기존 `statusLine` 항목을 지운 뒤 Claude Code 를 다시 시작한다.

개발 단계는 그 세션에서 마지막으로 실행한 superpowers·disciplined-coder 스킬로 정한다.

## 요구 사항

- Node.js 가 설치되어 있어야 한다. 상태 표시줄 스크립트를 Node.js 로 실행한다.
- 단어 사전은 Claude Code 모드(hooks module) 기능을 쓴다. 이 기능을 지원하는 Claude Code 버전이 필요하다.
