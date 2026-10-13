// 커밋 전 검사 (원칙 11): 학번 형태 숫자, 이메일, sesskey, 쿠키·토큰 값, 실제 저장본 폴더, 바이너리 파일.
// 파일 내용과 파일 경로를 모두 본다.
// 사용: node scripts/check-secrets.ts          → 추적 중인 모든 파일 (CI)
//       node scripts/check-secrets.ts --staged → 커밋하려는 내용 (pre-commit 훅)
// 걸린 값 자체는 출력하지 않는다. 의도한 가짜 값이면 그 줄에 "check-secrets: allow"를 적는다.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RULES: [string, RegExp][] = [
  // 앞뒤가 숫자·영문이 아니면 잡는다 (\b는 '<학번>_이름.pdf'의 '_'에서 놓친다)
  ['학번 형태 숫자', /(?<![0-9A-Za-z])(?:19|20)\d{8}(?![0-9])/],
  // "sesskey":"…", sesskey=…, name="sesskey" value="…"
  ['sesskey 값', /sesskey["']?\s*(?:value\s*)?[:=]\s*["']?[A-Za-z0-9]{10}\b/i],
  // MoodleSession=… 과 {"name":"MoodleSession","value":"…"}
  ['Moodle 세션 쿠키', /MoodleSession\w*(?:=|"\s*,\s*"value"\s*:\s*")[A-Za-z0-9%]{16,}/],
  ['iCal 토큰', /authtoken=[A-Za-z0-9]{16,}/i],
  // password = "…", "password": "…" (따옴표 안 공백 허용, 패키지 이름·${…} 자리표시는 제외)
  ['비밀번호 대입', /(?<![/.@-])pass(?:word|wd)?(?:["']:|\s*[:=])\s*["'](?!\$\{)[^"']{4,}["']/i],
  // LEARNUS_PASSWORD=값 (따옴표 없는 env 형식. 대문자만 봐서 코드의 password = 변수는 통과)
  ['비밀번호 대입', /(?<![A-Za-z])PASS(?:WORD)?\s*=\s*[^\s"'$]{4,}/],
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const PUBLIC_EMAIL =
  /^(?:learnus@yonsei\.ac\.kr|noreply@anthropic\.com|git@github\.com|.+@example\.(?:com|org))$/i
const ALLOW = 'check-secrets: allow'
const PRIVATE_DIR = 'tests/fixtures/private/'
// 바이너리(받은 강의자료·화면 캡처일 수 있음)는 막는다. 공개 파일만 경로로 허용.
// 한글 PDF용 Adobe CMap (.bcmap만 — 같은 폴더의 다른 파일은 검사한다)
const BINARY_OK = [/^packaging\/cmaps\/[\w-]+\.bcmap$/]
const BINARY_EXT = /\.(?:pdf|hwpx?|docx?|pptx?|xlsx?|png|jpe?g|gif|zip)$/i

export function scan(text: string): { line: number; rule: string }[] {
  const hits: { line: number; rule: string }[] = []
  text.split('\n').forEach((line, i) => {
    if (line.includes(ALLOW)) return
    for (const [rule, re] of RULES) if (re.test(line)) hits.push({ line: i + 1, rule })
    if ((line.match(EMAIL) ?? []).some((m) => !PUBLIC_EMAIL.test(m))) {
      hits.push({ line: i + 1, rule: '이메일 주소' })
    }
  })
  return hits
}

// 경로에 든 걸린 값은 ***로 가려서 출력한다
const mask = (s: string) =>
  [...RULES.map(([, re]) => re), EMAIL].reduce(
    (t, re) => t.replace(new RegExp(re.source, re.flags.replace('g', '') + 'g'), '***'),
    s,
  )

function main() {
  const staged = process.argv.includes('--staged')
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
  // -z: 한글 이름을 따옴표·8진수로 바꾸지 않고 그대로 받는다 (core.quotePath)
  const files = (
    staged
      ? git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')
      : git('ls-files', '-z')
  )
    .split('\0')
    .filter((f) => f && f !== 'package-lock.json')
  let failed = false
  const fail = (msg: string) => {
    console.error(msg)
    failed = true
  }
  for (const file of files) {
    const name = mask(file)
    if (file.startsWith(PRIVATE_DIR)) {
      fail(`${name}: 실제 저장본 폴더는 커밋할 수 없습니다`)
      continue
    }
    for (const { rule } of scan(file)) fail(`${name}: 파일 이름에 ${rule}`)
    const buf = staged
      ? execFileSync('git', ['show', `:${file}`], { maxBuffer: 1 << 28 })
      : readFileSync(file)
    if (buf.includes(0) || BINARY_EXT.test(file)) {
      if (!BINARY_OK.some((ok) => ok.test(file))) fail(`${name}: 바이너리 파일`)
      continue
    }
    for (const { line, rule } of scan(buf.toString('utf8'))) fail(`${name}:${line}: ${rule}`)
  }
  if (failed) {
    console.error(
      '\n비밀값·개인정보로 보이는 내용이 있습니다. 합성 값으로 바꾸거나, 가짜 값이면 그 줄에 "check-secrets: allow"를 적으세요.' +
        '\n바이너리 파일은 실제 자료일 수 있어 막습니다. 공개 파일이면 scripts/check-secrets.ts의 BINARY_OK에 경로를 더하세요.',
    )
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
