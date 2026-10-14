// 세션 시작 때 statusline.js 를 ~/.claude 로 복사하고, statusLine 설정이 비어 있으면 그 파일을 가리키게 한다.
// 다른 statusLine 이 이미 설정되어 있으면 건드리지 않는다. 이 파일을 가리키는 설정에는 아이콘을 움직이도록 1초 간격 갱신을 추가한다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = path.join(os.homedir(), '.claude');
const target = path.join(home, 'statusline.js');
const settingsPath = path.join(home, 'settings.json');
const command = `node "${target.split(path.sep).join('/')}"`;

fs.mkdirSync(home, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'statusline.js'), target);

let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (err) {
  if (err.code !== 'ENOENT') process.exit(0); // 읽을 수 없는 설정 파일은 고치지 않는다
}
if (settings.statusLine && (settings.statusLine.command !== command || settings.statusLine.refreshInterval)) process.exit(0);

const isNew = !settings.statusLine;
settings.statusLine = { type: 'command', command, refreshInterval: 1 };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
if (isNew) process.stdout.write(JSON.stringify({ systemMessage: '상태 표시줄을 설정했습니다. 다음 응답부터 표시됩니다.' }));
