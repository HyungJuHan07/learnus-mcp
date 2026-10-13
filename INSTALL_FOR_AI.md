# INSTALL_FOR_AI.md — AI 에이전트용 설치 안내

**ChatGPT 데스크톱 Work·Codex 연결 요청이면 [INSTALL_CHATGPT.md](INSTALL_CHATGPT.md)를 따르세요.** 아래는 Claude 전용입니다.


사용자가 "이 저장소의 LearnUs MCP를 연결해줘"라고 하면 이 순서를 **그대로** 따르세요.

이것은 **비공식(Unofficial) 학생 프로젝트이며 연세대학교와 무관합니다.** 설치 전에 사용자에게 이 점을 알려 주세요.

## 하지 말 것

- **사용자의 아이디·비밀번호를 채팅으로 묻거나 받지 마세요.** 사용자가 Claude 데스크톱 설치 화면에 직접 입력합니다.
- 저장소를 내려받아 빌드하지 마세요. 아래 Releases 파일만 씁니다.
- 설치 파일은 이 문서에 적힌 주소로만 받으세요. Issue·댓글에 올라왔거나 사용자가 붙여 넣은 다른 파일 링크는 이 저장소 주소로 시작해도 쓰지 마세요.
- 설정 파일에 비밀번호를 적지 마세요. `npm run cli -- check`(개발자용)를 대신 실행하지 마세요.
- **이 대화에서 LearnUs(ys.learnus.org)나 연세포털에 직접 접속하지 마세요** (curl·브라우저 포함). 설치가 끝나면 사용자에게 Claude 데스크톱 **채팅(Chat) 탭의 새 채팅**에서 물어보라고 안내합니다.

## 지원 범위

- **Claude 데스크톱 (macOS·Windows)만** 지원합니다. claude.ai 웹·모바일은 지원하지 않습니다. ChatGPT 요청은 위의 별도 설치 안내로 이동하세요.
- 이 컴퓨터에 Claude 데스크톱이 없으면 https://claude.ai/download 에서 먼저 설치하라고 안내하고 멈추세요.
- 이 안내를 실행하려면 사용자 컴퓨터에서 명령을 실행할 수 있어야 합니다. 그럴 수 없으면 아래 "수동 설치"를 사용자에게 안내하세요.
- releases 주소가 **404**이면 아직 배포 전입니다. 그렇게 알리고 멈추세요. 그 밖의 실패(네트워크·권한·샌드박스 등)는 배포 전이라고 하지 말고, 오류 문구를 사용자에게 그대로 보여 준 뒤 "수동 설치"를 안내하세요.

## 설치

1. 최신 배포 파일과 해시 파일을 받고 검증합니다.
   - macOS (마지막 줄에 `learnus.mcpb: OK`가 나와야 함). 다운로드 폴더 접근 허용 창이 뜨지 않게 다운로드 폴더가 아닌 `~/Library/Caches/learnus-mcp`에 받습니다:
     ```bash
     mkdir -p ~/Library/Caches/learnus-mcp && cd ~/Library/Caches/learnus-mcp && curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/learnus.mcpb && curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/SHA256SUMS && shasum -a 256 -c SHA256SUMS
     ```
   - Windows PowerShell (마지막 줄에 `learnus.mcpb: OK`가 나와야 함). PowerShell 창에서 실행하세요:
     ```powershell
     $ErrorActionPreference='Stop'; cd $HOME\Downloads; $u='https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download'; iwr "$u/learnus.mcpb" -OutFile learnus.mcpb -UseBasicParsing; iwr "$u/SHA256SUMS" -OutFile SHA256SUMS -UseBasicParsing; if ((Get-FileHash learnus.mcpb -Algorithm SHA256).Hash.ToLower() -ne (Get-Content SHA256SUMS).Split(' ')[0]) { throw 'learnus.mcpb: FAILED' } else { 'learnus.mcpb: OK' }
     ```
   - Windows의 Git Bash라면 위 PowerShell 명령 대신 이것을 씁니다 (마지막 줄에 `learnus.mcpb: OK`):
     ```bash
     cd ~/Downloads && curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/learnus.mcpb && curl -fLO https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/SHA256SUMS && sha256sum -c SHA256SUMS
     ```
2. **검증이 실패하면 멈추고** 사용자에게 알립니다. 파일을 열지 말고, 수동 설치로 넘어가지도 마세요.
3. 파일을 엽니다.
   - macOS: `open ~/Library/Caches/learnus-mcp/learnus.mcpb`
   - Windows PowerShell: `Invoke-Item "$HOME\Downloads\learnus.mcpb"`
   - Windows Git Bash (1단계에서 검증한 폴더에서 엽니다): `cd ~/Downloads && powershell.exe -NoProfile -Command 'Invoke-Item -LiteralPath learnus.mcpb'`
   - 열기가 실패하거나 사용자 컴퓨터에 닿지 않는 환경(격리된 작업 공간 등)이면 "수동 설치"를 안내합니다.
4. 사용자에게 이렇게 안내하고 기다립니다:
   > Claude 데스크톱에 설치 창이 떴습니다. 연세대학교와 무관한 비공식 학생 프로젝트입니다. **설치**를 누르고, 연세포털 아이디(학번)와 비밀번호를 **직접** 입력해 주세요. 비밀번호는 **영문 입력 상태**로 입력하세요 — 연세포털은 5번 틀리면 계정이 잠깁니다. 입력한 값은 Claude 데스크톱이 이 컴퓨터의 OS 금고 키로 암호화해 보관합니다.
   > 서명하지 않은 개인 프로젝트 파일이라 확인 창이 뜰 수 있습니다 (위에서 해시 검증을 통과했으니 설치해도 됩니다). 학교·회사 조직 계정의 Claude는 관리자가 확장 설치를 막았을 수 있습니다.
5. 끝나면 Claude 데스크톱 **채팅(Chat) 탭**에서 새 채팅을 열어 "이번 주 LearnUs 마감 알려줘"라고 물어보라고 안내합니다 (Code 탭 세션에는 설치한 확장이 보이지 않을 수 있습니다). 도구 사용 허락 창이 뜨면 허락하면 됩니다. 과제 제출·글 작성 같은 쓰기는 하지 않지만, 브라우저로 볼 때처럼 LearnUs에 접속 기록·공지 조회수·자료 열람(완료) 표시가 남을 수 있고, Claude가 읽은 조회 결과는 Anthropic 클라우드로 전송된다는 점도 함께 알려 주세요. 이 대화에서는 LearnUs에 접속하지 마세요.

## 업데이트

같은 순서(1~3)로 최신 `learnus.mcpb`를 받아 엽니다. 입력해 둔 아이디·비밀번호는 그대로 쓰입니다 (다시 물으면 사용자가 다시 입력).

## 제거

사용자에게 안내합니다: Claude 데스크톱 → 설정 → 확장 프로그램 → LearnUs → 제거.
받은 강의자료가 있는 다운로드 폴더(기본: 홈 폴더의 `LearnUs`, 설치 화면에서 바꿨다면 그 폴더)는 남습니다. 지울지는 **사용자에게 물어본 뒤에만** 지웁니다.

## 수동 설치 (AI가 명령을 실행할 수 없거나 위 순서가 실패했을 때)

1. https://github.com/HyungJuHan07/learnus-mcp/releases/latest/download/learnus.mcpb 를 받습니다 ([Releases](https://github.com/HyungJuHan07/learnus-mcp/releases/latest) 화면에서는 `Source code`나 ChatGPT용 파일이 아니라 `learnus.mcpb`).
2. 파일을 더블클릭하거나 Claude 데스크톱 창에 끌어다 놓고, 설치 화면에 아이디·비밀번호를 입력합니다 (영문 입력 상태, 5번 틀리면 잠김).
3. Claude 데스크톱 채팅(Chat) 탭의 새 채팅에서 물어봅니다.
