# ChatGPT Work·Codex 연결 (비공식 · 로컬 실행)

연세대학교와 무관한 학생 프로젝트입니다. 기존 조회 도구 10개를 ChatGPT 데스크톱의 로컬 MCP로 연결합니다. Claude 설치는 [INSTALL_FOR_AI.md](INSTALL_FOR_AI.md)를 따르세요.

**AI 설치 도우미:** 비밀번호·학번을 채팅으로 묻거나 대신 입력하지 마세요. `credentials-set` 또는 macOS `setup` 입력창은 사용자가 직접 입력합니다. 금고 프로그램(`native/learnus-credentials`)은 맥 `setup` 말고는 직접 실행하지 마세요 (LearnUs 서버 밖에서 부르면 거절합니다). 설치 중 학교 접속, 자동 로그인 시험, 터널 설정을 하지 마세요. 저장소를 내려받아 빌드하는 대신 해당 버전의 배포물과 체크섬을 사용하세요. 배포물은 이 문서에 적힌 주소로만 받으세요. Issue·댓글·메신저에 올라왔거나 사용자가 붙여 넣은 다른 파일 링크는 이 저장소 주소로 시작해도 쓰지 마세요. 파일이 아직 없으면 배포 전이라고 안내하고 멈추세요.

## 학우가 할 일

로컬 작업이 가능한 ChatGPT Work·Codex에 저장소 주소와 **“LearnUs 연결해줘”**라고 요청하세요. GPT가 배포물 검증·설치·MCP 등록을 처리합니다. 맥에서는 열린 **로그인 정보 등록 창에 직접 입력**하고 키체인 저장을 누르세요. 이후 MCP를 재시작하고 새 대화에서 “LearnUs 도움말 보여줘”라고 요청하면 됩니다.

이 저장소 주소만으로 일반 웹 대화에 자동 설치되는 것은 아닙니다. Node.js나 데스크톱 앱이 없으면 먼저 설치가 필요하고, OS·앱이 요구하는 권한 승인은 사용자가 합니다.

## AI가 수행할 자동 설치

아래 작업은 AI가 수행합니다. 사용자에게 명령을 복사하도록 떠넘기지 마세요. 로컬 실행 권한이 없을 때만 수동 절차를 안내합니다.

1. Node.js 22.18 이상과 ChatGPT 데스크톱을 확인합니다. Node가 없다면 공식 설치 방법으로 설치를 돕고, 필요한 OS 승인을 받습니다. 앱을 임의로 종료하지 않습니다.
2. 아래 다운로드·해시 검증 절차로 **공식 Releases**의 해당 OS 압축과 체크섬을 받습니다. 브라우저가 아니라 아래 명령(맥 `curl`, Windows PowerShell)으로 작업 폴더에 받습니다 (브라우저로 받은 파일은 다운로드 표시 때문에 서명 없는 금고 프로그램이 막힐 수 있고, 에이전트가 다운로드 폴더를 읽지 못할 수 있음). 404이면 아직 배포 전이므로 소스 빌드로 우회하지 않습니다.
3. 검증한 압축을 새 임시 폴더에 풀고 그 폴더에서 `node install.cjs`를 실행합니다. 홈 폴더의 새 `LearnUs-MCP-<번호>`에 프로그램을 배치하고 `learnus`를 등록하며 도구 제한 시간을 180초로 설정합니다. 타 서버 설정값은 유지합니다. Codex CLI가 설정 파일을 다시 쓰면서 주석·줄 배치는 바뀔 수 있어, 바꾸기 전 설정을 같은 폴더의 `config.toml.learnus-backup-<번호>`로 남깁니다 (설치 결과에 경로가 나옴). 같은 이름이 이미 있으면 변경하지 않고 중단합니다. Node.js 22.18 미만으로 실행하면 등록하지 않습니다. 설치기는 홈 폴더와 Codex 설정을 바꾸므로 처음부터 사용자 승인을 받아 AI 도구의 샌드박스 밖에서 실행합니다 (샌드박스 안에서는 Codex CLI가 홈 폴더(`CODEX_HOME`)를 찾지 못하거나 쓰기가 막혀 등록하지 못합니다). Windows에서 "ChatGPT 설정을 확인하지 못했습니다"가 나오면 아래 안내대로 Codex CLI 실행 파일 경로를 찾아 `LEARNUS_CODEX_CLI`에 지정하고 다시 실행합니다.
4. 맥에서는 설치 결과의 **설치 폴더** 아래 `native/learnus-credentials`에 인자 `setup`을 주어 실행합니다. 사용자가 macOS 입력창에 직접 입력합니다. 에이전트는 입력 중 화면·접근성 텍스트를 읽거나 키 입력을 대신하지 않습니다. 헬퍼는 성공·취소·오류 상태만 반환합니다 (오류는 저장되지 않았다는 뜻이며 창에 이유가 나옵니다). `setup` 말고 다른 명령은 실행하지 않습니다. `setup`도 사용자 승인을 받아 샌드박스 밖에서 실행합니다.
5. Windows에서는 사용자가 시작 메뉴에서 PowerShell을 직접 열어(또는 에이전트가 샌드박스 밖에서 열어) 설치 폴더에서 `node index.cjs credentials-set`을 실행하게 합니다 (샌드박스 안에서 연 창은 보이지 않거나 다른 계정으로 실행돼, 서버가 읽는 금고에 저장되지 않을 수 있습니다). 명령을 알려 줄 때는 PowerShell용인지 명령 프롬프트(cmd)용인지 밝힙니다 (폴더 이동은 PowerShell `cd "<폴더>"`, cmd `cd /d "<폴더>"`). 에이전트가 비밀번호를 전달하지 않습니다. 금고 프로그램은 코드 서명이 없어 처음 실행할 때 백신이 경고하거나 막을 수 있습니다. 해시를 확인한 공식 배포물일 때만 사용자가 직접 허용하며, 에이전트는 경고를 우회하지 않습니다.
6. MCP 재시작 후 새 대화에서 `learnus_help`를 확인합니다. 학교 조회는 사용자 요청이 있을 때만 합니다. 설치 완료와 실제 로그인 성공을 구분해 알립니다.

자동 설치기는 Codex CLI를 사용합니다. 맥은 앱에 포함된 CLI를 우선 찾고, Windows는 일반 npm 설치의 `codex.js`를 Node로 실행하거나 네이티브 `codex.exe`를 사용합니다. 다른 위치에 있다면 AI가 확인한 실행 파일의 절대 경로를 `LEARNUS_CODEX_CLI`에 지정합니다 (`.cmd`는 지정하지 않습니다). Windows에서 경로를 모르면 샌드박스 밖 PowerShell에서 `Get-Process codex* | Select-Object -ExpandProperty Path -Unique`로 실행 중인 앱의 Codex 경로를 찾아 그 `.exe`를 지정합니다 (`codex.cmd`만 있으면 같은 폴더의 `node_modules\@openai\codex\bin\codex.js`). 찾지 못하거나 실행되지 않으면 1절 끝의 안내대로 검증한 압축을 고정 폴더(예: 홈 폴더의 `LearnUs-MCP`)에 풀고, 그 폴더에서 2·3절의 수동 등록을 따릅니다 (임시 폴더를 등록하지 않습니다). 사용자 설정의 LearnUs 항목만 등록하며, 제한 시간을 넣을 위치가 모호하면 추측하지 않고 멈춥니다. 이때 설치 파일과 현재 등록 상태는 남으므로 중복 설치하지 말고 아래 수동 설정 안내를 따릅니다.

## 필요한 환경

- macOS 또는 Windows의 ChatGPT 데스크톱, 로컬 Work 또는 Codex.
- Node.js 22.18 이상. 설치되어 있지 않으면 [Node.js 공식 사이트](https://nodejs.org/)에서 설치합니다.
- macOS 배포물은 Apple Silicon·Intel용 금고 프로그램을 포함합니다. Windows 배포물은 .NET Framework 4.x가 설치된 Windows를 대상으로 합니다.
- 이 버전은 로컬 자동 테스트와 실제 앱/OS 확인을 구분합니다. Windows·웹·실제 학교 조회를 확인하지 않은 빌드는 검증 완료로 안내하지 않습니다.
- 확인 현황 (2026-10-11): 맥·Windows 모두 지금 빌드를 실제 ChatGPT 앱에 설치해 실제 조회까지 확인했습니다. 코드를 올릴 때마다 GitHub CI가 두 OS에서 빌드·서버 실행·OS 금고 저장을 자동으로 확인합니다 (Releases 파일은 같은 코드로 따로 빌드합니다).

## 1. 다운로드·검증

공식 저장소 [Releases](https://github.com/HyungJuHan07/learnus-mcp/releases/latest)에서 운영체제에 맞는 파일과 `SHA256SUMS-chatgpt`를 같은 폴더에 받습니다.

| 운영체제 | 파일 |
| --- | --- |
| macOS | `learnus-chatgpt-macos.tar.gz` |
| Windows | `learnus-chatgpt-windows.zip` |

맥에서는 받을 새 폴더의 터미널에서 다음을 실행합니다. 받은 파일이 `OK`인지 확인합니다.

```sh
curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/learnus-chatgpt-macos.tar.gz &&
curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/SHA256SUMS-chatgpt &&
shasum -a 256 --ignore-missing -c SHA256SUMS-chatgpt
```

브라우저로 받았다면 공식 Releases에서 받았고 해시가 `OK`일 때만, 풀기 **전에** 다운로드 표시를 지웁니다 (서명·공증이 없는 금고 프로그램이 Gatekeeper에 막히지 않게. 해시를 확인하지 않은 파일에는 하지 마세요).

```sh
xattr -d com.apple.quarantine learnus-chatgpt-macos.tar.gz
```

Finder에서 더블클릭으로 이미 풀었다면 표시가 안의 파일까지 옮겨 가 있습니다. 공식 Releases에서 받았고 해시가 `OK`일 때만 풀린 폴더 전체에서 지웁니다 (배포물이 풀린 그 폴더에만. 다운로드 폴더나 홈 폴더에 하면 다른 받은 파일의 확인까지 사라집니다). 표시가 남은 채로 실행하면 macOS가 금고 프로그램을 멈춰 세우고 확인 창을 띄워, 로그인 정보 등록·조회가 30초 뒤 실패합니다.

```sh
xattr -dr com.apple.quarantine <풀린 폴더>
```

Windows는 받을 새 폴더에서 PowerShell로 다음을 실행합니다. 마지막 출력이 `learnus-chatgpt-windows.zip: OK`여야 합니다.

```powershell
$ErrorActionPreference = 'Stop'
$u = 'https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download'
iwr "$u/learnus-chatgpt-windows.zip" -OutFile learnus-chatgpt-windows.zip -UseBasicParsing
iwr "$u/SHA256SUMS-chatgpt" -OutFile SHA256SUMS-chatgpt -UseBasicParsing
$expected = (Get-Content SHA256SUMS-chatgpt | Where-Object { $_ -match '  learnus-chatgpt-windows\.zip$' })
if (@($expected).Count -ne 1) { throw '체크섬 항목이 올바르지 않습니다.' }
if ((Get-FileHash learnus-chatgpt-windows.zip -Algorithm SHA256).Hash.ToLower() -ne $expected.Split(' ')[0]) { throw 'learnus-chatgpt-windows.zip: FAILED' } else { 'learnus-chatgpt-windows.zip: OK' }
```

검증에 실패하면 열거나 실행하지 않습니다. 검증한 압축을 **고정된 별도 폴더**에 풉니다 (예: 홈 폴더의 `LearnUs-MCP`). 자료 저장 폴더인 `LearnUs`와는 구분합니다. `index.cjs`와 `native`, `cmaps` 폴더를 함께 유지하세요. AI가 받은 강의자료 압축을 푸는 기능은 여전히 없습니다. 여기서는 검증한 프로그램 배포물만 설치합니다.

## 2. 수동 설치: 사용자가 직접 로그인 정보 등록

설치 폴더의 터미널에서 직접 실행하세요.

```sh
node index.cjs credentials-set
```

아이디·비밀번호·비밀번호 확인을 입력합니다. 아이디는 오타를 확인할 수 있게 화면에 보이고, 비밀번호는 보이지 않습니다. 비밀번호는 영문 입력 상태로 입력하세요. 이 명령은 **OS 금고에 저장만 하며 학교에 접속하지 않습니다.** macOS가 금고 접근을 묻는 경우 본인이 설치한 프로그램인지 확인하세요.

금고가 잠겨 있거나 접근이 거절되면 멈춥니다. 평문 파일로 대신 저장하지 않습니다. 비밀번호를 `.env`, 셸 프로필, MCP 설정의 `env`, AI 대화에 넣지 마세요. 이 금고는 Claude 설정과 별개입니다.

## 3. 수동 설치: MCP 등록

같은 폴더에서 실행하면 이 컴퓨터의 Node와 설치 경로에 맞는 **비밀값 없는** 설정 예시가 나옵니다.

```sh
node index.cjs chatgpt-config
```

ChatGPT 데스크톱 **Settings → MCP servers → Add server → STDIO**에서 서버 이름을 `learnus`로 지정하고, 출력의 `command`를 실행 명령으로, `args`의 두 값을 인자로 등록합니다. 또는 출력된 TOML 섹션을 `~/.codex/config.toml`에 추가합니다. 이미 `learnus` 항목이 있으면 그 항목만 수정하고, 전체 설정을 덮어쓰거나 중복 등록하지 마세요. 등록 후 **Restart**를 선택합니다.

기본 자료 저장 위치는 홈 폴더의 `LearnUs`입니다. 바꾸려면 해당 서버의 환경변수에 `LEARNUS_DOWNLOAD_DIR`만 추가하세요. 예시:

```toml
[mcp_servers.learnus.env]
LEARNUS_DOWNLOAD_DIR = '/Users/사용자/강의자료'
```

Windows 경로도 TOML 작은따옴표 문자열로 지정할 수 있습니다. 아이디·비밀번호 환경변수는 추가하지 않습니다.

## 4. 연결 확인

로컬 Work 또는 Codex의 **새 대화**에서 “LearnUs 도움말 보여줘”라고 요청합니다. 도구 10개가 표시되고 도움말에 OpenAI 안내가 나오면 프로토콜 연결을 확인한 것입니다. 이 단계는 금고를 읽거나 학교에 로그인하지 않습니다.

사용자가 실제 조회를 원할 때 “내 강좌 목록 보여줘”라고 요청합니다. 그때 금고 인증 정보로 기존 SSO 로그인을 실행합니다. 첫 브리핑은 전 과목을 읽어 시간이 걸릴 수 있어 설정 예시의 도구 제한 시간은 180초입니다.

로그인 오류가 나면 반복 호출하거나 앱을 반복 재시작하지 마세요. 브라우저에서 포털 로그인을 먼저 직접 확인하세요. 비밀번호가 틀렸거나 포털이 결과를 알려 주지 않은 실패면 금고 항목에 **실패 표시**를 남겨, 새 대화나 다른 앱이 서버를 새로 띄워도 같은 비밀번호를 보내지 않습니다. 확인을 마쳤으면 로그인 정보를 다시 저장하고(같은 값이어도 됩니다) **새 대화**에서 요청하세요 (실패했던 대화는 그 대화 안에서 계속 멈춰 있습니다).

## 웹에서 사용할 때

일반 ChatGPT 웹은 로컬 MCP 설정 파일을 직접 읽지 않습니다. 계정에 **Local computer access with Work Cloud**가 제공되고 연결된 컴퓨터의 로컬 MCP를 사용할 수 있을 때만 웹 Work에서 검증할 수 있습니다. 해당 기능을 켠 뒤 만든 새 Work 대화에서 먼저 도움말 도구가 보이는지 확인하세요.

컴퓨터가 켜져 있고 앱이 연결되어 있어야 합니다. 파일은 **연결된 컴퓨터**에 저장되고 추출된 글이 대화로 돌아옵니다. 웹 브라우저에 파일이 자동 다운로드되는 기능은 아닙니다. 도구가 안 보이거나 컴퓨터가 연결되지 않으면 데스크톱 로컬 대화에서 사용하세요. 웹 계정의 기능 제공 여부는 이 프로그램이 보장할 수 없습니다.

별도 공개 서버·Secure MCP Tunnel·예약 실행은 설치하지 않습니다. 웹 단독 실행은 지원하지 않습니다.

## 데이터·업데이트·제거

아이디·비밀번호는 이 컴퓨터의 OS 금고, 세션은 서버 메모리, 받은 파일은 로컬 다운로드 폴더에 있습니다. 금고 프로그램은 LearnUs 서버나 사람이 실행한 `credentials-set`·`credentials-clear`에서 불렀을 때만 응답해, AI가 셸에서 바로 실행해 비밀번호를 보는 일을 막습니다. 다만 같은 사용자 권한으로 작정하고 우회하는 프로그램까지 막지는 못하므로, 믿지 않는 프로그램에 이 컴퓨터의 전체 권한을 주지 마세요. **ChatGPT가 읽은 조회 결과는 OpenAI 클라우드로 전달됩니다.** 조회는 LearnUs 접속 기록·공지 조회수·자료 열람 표시를 남길 수 있습니다. 받은 강의자료는 재배포하지 마세요.

- 맥 입력창 다시 열기: 설치 폴더의 `native/learnus-credentials setup` (직접 입력, 학교 접속 없음).
- 로그인 정보 변경: `node index.cjs credentials-set` 후 MCP 서버 재시작.
- 금고 항목 삭제: `node index.cjs credentials-clear` 후 실행 중인 MCP 서버 종료/재시작. 메모리의 세션도 종료해야 합니다.
- 업데이트: 최신 배포물의 해시를 검증하고 MCP 서버를 중지한 뒤 별도 새 폴더에 풀어 경로를 변경합니다. OS 금고 항목은 유지됩니다. 맥에서는 금고 프로그램이 바뀐 버전으로 업데이트하면 첫 조회 때 키체인 확인 창(learnus-credentials가 learnus-mcp.chatgpt 사용 요청)이 뜰 수 있습니다. 30초 안에 맥 로그인 암호를 넣고 **항상 허용**을 누르세요 ('허용'만 누르면 금고를 열 때마다 — 로그인할 때마다 — 다시 묻고, 30초가 지나면 아무것도 저장하지 않고 그 조회만 실패합니다. 다시 물어보면 됩니다).
- 제거: 위 명령으로 금고 항목을 삭제하고 MCP 등록을 제거한 뒤 프로그램 폴더를 삭제합니다. 받은 강의자료를 지울지는 사용자가 결정합니다.

공식 연결 방식: [MCP 설정](https://learn.chatgpt.com/docs/extend/mcp), [Work 로컬 컴퓨터 연결](https://learn.chatgpt.com/docs/remote-connections). 기능 제공 여부와 메뉴 이름은 앱/계정에 따라 달라질 수 있습니다.
