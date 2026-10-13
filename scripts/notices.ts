// 제3자 라이선스 고지: dist/meta.json(esbuild --metafile)에서 번들에 들어간 node_modules 패키지를 모아
// 각 LICENSE 전문을 dist/THIRD_PARTY_NOTICES.txt로 잇는다. npm run build가 부른다.
// 자동으로 못 모으는 것(LICENSE 파일이 없는 패키지, PDF.js·CMap·PSL)은 packaging/notices/*.txt에 손으로 둔다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NOTICES = 'packaging/notices'
const LINE = '='.repeat(72)
const read = (f: string) => readFileSync(f, 'utf8').trim()
const section = (title: string, body: string) => `${LINE}\n${title}\n${LINE}\n\n${body.trim()}\n`

const { inputs } = JSON.parse(read('dist/meta.json')) as { inputs: Record<string, unknown> }
// 'node_modules/a/node_modules/b/x.js' → 'node_modules/a/node_modules/b' (중첩된 다른 버전도 따로 센다)
const dirs = new Set(
  Object.keys(inputs).flatMap(
    (f) => /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(f.replaceAll('\\', '/'))?.[1] ?? [],
  ),
)

const used = new Set<string>()
const packages = [...dirs].map((dir) => {
  const { name, version, license } = JSON.parse(read(join(dir, 'package.json')))
  const files = readdirSync(dir).filter((f) => /^(?:licen[cs]e|copying|notice)/i.test(f))
  let text = files
    .sort()
    .map((f) => read(join(dir, f)))
    .join('\n\n')
  if (!text) {
    const own = `${name}.txt`
    if (!existsSync(join(NOTICES, own))) {
      throw new Error(
        `${name}: LICENSE 파일이 없습니다. ${NOTICES}/${own}에 라이선스 전문을 넣으세요.`,
      )
    }
    text = read(join(NOTICES, own))
    used.add(own)
  }
  return { title: `${name} ${version} (${license})`, text }
})
packages.sort((a, b) => a.title.localeCompare(b.title))

const extras = readdirSync(NOTICES)
  .filter((f) => f.endsWith('.txt') && !used.has(f))
  .sort()
  .map((f) => {
    const [title, ...body] = read(join(NOTICES, f)).split('\n')
    return { title, text: body.join('\n') }
  })

writeFileSync(
  'dist/THIRD_PARTY_NOTICES.txt',
  [
    'learnus-mcp — 제3자 라이선스 고지 (Third-party notices)\n\n' +
      'Claude·ChatGPT 배포물의 index.cjs에 함께 묶인 오픈소스 패키지와 cmaps/의 CMap 파일,\n' +
      '그 안에 들어 있는 구성 요소의 라이선스 전문입니다. learnus-mcp 자체의 라이선스는 LICENSE 파일을 보세요.\n',
    ...[...packages, ...extras].map((p) => section(p.title, p.text)),
  ].join('\n'),
)
