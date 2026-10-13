// 강의자료: 목록 → (사용자가 요청할 때만) 내려받기 → 글 추출.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import * as cheerio from 'cheerio/slim'
import { type Client, LearnUsError } from './client.ts'
import { BASE_URL, env } from './config.ts'
import { coursePage, fileLinks, languageNote, param, untrusted } from './learnus.ts'

const CHUNK = 8000
// PDF 글 추출 상한: 이걸 넘는 PDF는 앞부분만 읽는다 (일부러 만든 거대한 PDF로 확장이 멈추지 않게).
const MAX_PAGES = 2000
const MAX_CHARS = 2_000_000
const EXTENSIONS = new Set(
  '.pdf .ppt .pptx .doc .docx .hwp .hwpx .xls .xlsx .txt .csv .md .zip .jpg .jpeg .png'.split(' '),
)
// 도구는 URL이 아니라 material_id만 받는다. id가 가리킬 수 있는 곳은 LearnUs의 파일 경로와 폴더 페이지뿐이다.
const FILE_PATH =
  /^\/(pluginfile\.php\/\d+\/[^?#]+(\?forcedownload=1)?|mod\/(ubfile|resource|folder)\/view\.php\?id=\d+)$/

/** u: LearnUs 안의 파일 경로, c: 과목명, w: 주차, n: 활동 이름 (ubfile은 받기 전엔 파일 이름을 모른다) */
type Ref = { u: string; c: string; w: number | null; n?: string }

const normalized = (path: string) => {
  const u = new URL(BASE_URL + path)
  return u.origin === BASE_URL ? u.pathname + u.search : ''
}

export const encodeId = (r: Ref) => Buffer.from(JSON.stringify(r)).toString('base64url')

export function decodeId(id: string): Ref {
  let r: Partial<Ref> = {}
  try {
    r = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as Partial<Ref>
  } catch {
    // 아래에서 거부
  }
  if (
    typeof r.u !== 'string' ||
    !FILE_PATH.test(r.u) ||
    // ../·%2e%2e·역슬래시 등으로 다른 페이지(동영상 플레이어 등)를 가리키지 못하게, 정규화해도 그대로인 경로만
    normalized(r.u) !== r.u ||
    /%2f|%5c/i.test(r.u) ||
    typeof r.c !== 'string' ||
    !(r.w === null || Number.isInteger(r.w)) ||
    !(r.n === undefined || typeof r.n === 'string')
  ) {
    throw new LearnUsError(
      '알 수 없는 material_id입니다. list_materials로 받은 id를 그대로 써 주세요.',
    )
  }
  return r as Ref
}

const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

// 이름 한 칸의 한도: 맥·윈도우는 255글자지만 리눅스 등은 255바이트(UTF-8, 한글 한 자 3바이트)다.
// "(이전 날짜-시각)" 꼬리(30바이트 안팎)가 붙어도 넘지 않게 200바이트로 자른다.
const MAX_NAME_BYTES = 200

/** 앞에서부터 글자 단위로(서로게이트 쌍을 가르지 않게) chars글자·bytes바이트(UTF-8)까지. */
function fit(s: string, chars: number, bytes: number): string {
  let out = ''
  let n = 0
  let used = 0
  for (const ch of s) {
    used += Buffer.byteLength(ch)
    if (++n > chars || used > bytes) break
    out += ch
  }
  return out
}

/** 파일·폴더 이름 정리: 경로 문자, 윈도우 금지 문자·예약 이름, 끝의 점·공백을 없앤다. */
export function safeName(name: string): string {
  let s = name
    .normalize('NFC') // 맥에서 올린 이름(NFD)도 한글 한 자를 한 글자로 센다 (자를 때 자모가 갈리지 않게)
    // eslint-disable-next-line no-control-regex -- 파일 이름에서 제어 문자를 지운다
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
  if (Array.from(s).length > 120 || Buffer.byteLength(s) > MAX_NAME_BYTES) {
    // 확장자가 10자를 넘으면 확장자가 아닌 것으로 보고 그냥 자른다
    const ext = extname(s).length <= 10 ? extname(s) : ''
    const body = s.slice(0, s.length - ext.length)
    s = fit(body, 120 - ext.length, MAX_NAME_BYTES - Buffer.byteLength(ext)) + ext
  }
  s = s.replace(/[.\s]+$/, '')
  if (!s || /^\.+$/.test(s)) s = '_'
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

const downloadDir = () => resolve(env('LEARNUS_DOWNLOAD_DIR') ?? join(homedir(), 'LearnUs'))

/** 실제 경로 (아직 없는 끝부분은 있는 조상의 실제 경로에 이어 붙인다). */
function realPath(path: string): string {
  let cur = resolve(path)
  const rest: string[] = []
  while (!existsSync(cur) && dirname(cur) !== cur) {
    rest.unshift(basename(cur))
    cur = dirname(cur)
  }
  return join(realpathSync(cur), ...rest)
}

/** 다운로드 폴더 밖(심볼릭 링크로 빠져나가는 경우 포함)이면 거부. */
function inside(path: string) {
  const real = realPath(path)
  const root = realPath(downloadDir())
  const prefix = root.endsWith(sep) ? root : root + sep
  if (real !== root && !real.startsWith(prefix)) {
    throw new LearnUsError('다운로드 폴더 밖의 파일은 다루지 않습니다.')
  }
  return path
}

const folderOf = (r: Ref) => inside(join(downloadDir(), safeName(r.c), r.w ? `${r.w}주차` : '기타'))

/** LearnUs 파일 경로(퍼센트 인코딩) → 파일 이름. */
const fileNameOf = (urlPath: string) =>
  safeName(decodeURIComponent(basename(urlPath.split('?')[0])))

/**
 * 저장 이름(확장자 빼고). 받을 때와 찾을 때 이 함수 하나만 쓴다.
 * ubfile은 받기 전엔 파일 이름을 몰라 "활동 이름_id", 폴더 파일·첨부는 "파일 이름_주소 해시"
 * (다른 과목·폴더의 같은 이름 파일끼리 겹치지 않게).
 */
function stem(r: Ref) {
  // 글자 단위로 자른다 (이모지 같은 서로게이트 쌍이 갈리면 저장된 이름과 달라져 다시 찾지 못한다).
  // 150바이트: 뒤에 붙는 _id·_해시가 safeName에서 잘리지 않고, 확장자·"(이전 …)"까지 255바이트 안에 들게
  const cut = (t: string) => fit(t.normalize('NFC'), 100, 150)
  if (r.n !== undefined) return safeName(`${cut(r.n)}_${param(r.u, 'id')}`)
  const name = fileNameOf(r.u)
  const hash = createHash('sha1').update(r.u.split('?')[0]).digest('hex').slice(0, 6)
  return safeName(`${cut(name.slice(0, name.length - extname(name).length))}_${hash}`)
}

/** 이미 받은 파일 경로 (없으면 undefined). 확장자는 받은 뒤에야 알 수 있어 이름만 맞춘다. */
function existing(r: Ref): string | undefined {
  const dir = folderOf(r)
  return existsSync(dir) ? sameStem(dir, stem(r))[0] : undefined
}

/** 폴더 안에서 저장 이름(확장자 빼고)이 같은 파일들. 폴더·허용 밖 형식(사용자가 만든 것)은 빼고 본다. */
function sameStem(dir: string, want: string): string[] {
  return readdirSync(dir)
    .filter((f) => same(f.slice(0, f.length - extname(f).length), want))
    .filter((f) => EXTENSIONS.has(extname(f).toLowerCase()))
    .map((f) => inside(join(dir, f)))
    .filter((p) => statSync(p).isFile())
}

// 맥·윈도우 파일 시스템은 대소문자·한글 조합 방식(NFC/NFD)이 달라도 같은 파일로 본다
const same = (a: string, b: string) =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

/** 옛 파일은 지우지 않고 "(이전 날짜-시각)"(한국 시간)을 붙여 남긴다 (같은 이름으로 저장한 필기본일 수 있다). */
function keepOld(path: string) {
  const at = new Date(Date.now() + 9 * 3600_000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const ext = extname(path)
  // 사용자가 만든 긴 이름(NFD 등)에 붙여도 이름 한 칸이 255바이트를 넘지 않게 앞부분만 남긴다
  const room = 255 - Buffer.byteLength(` (이전 ${at} 999)${ext}`)
  const base = `${join(dirname(path), fit(basename(path, ext), Infinity, room))} (이전 ${at}`
  let to = `${base})${ext}`
  for (let i = 2; existsSync(to); i++) to = `${base} ${i})${ext}`
  renameSync(path, inside(to))
}

/** 저장할 자리에 같은 이름의 폴더가 있으면 받기 전에 멈춘다. */
function folderInTheWay(path: string) {
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new LearnUsError(
      '같은 이름의 폴더가 있어 저장하지 못했습니다. 그 폴더 이름을 바꾼 뒤 다시 받아 주세요.',
    )
  }
}

// ── 목록 ──

export function parseFolder(html: string) {
  const $ = cheerio.load(html)
  return fileLinks($, $('.fp-filename-icon')).map((f) => ({
    ...f,
    path: `${f.path}?forcedownload=1`,
  }))
}

/** 강의자료 목록. 다운로드는 하지 않고, 폴더도 열지 않는다 (폴더 안은 download_material로). */
export async function listMaterials(client: Client, courseId: string, week?: number) {
  const page = await coursePage(client, courseId)
  const items = page.activities.filter(
    (a) =>
      ['ubfile', 'resource', 'folder', 'url'].includes(a.type) &&
      (week === undefined || a.week === week),
  )
  const out = []
  for (const a of items) {
    const base = { course: page.name, week: a.week }
    if (a.type === 'url') {
      out.push({ ...base, name: a.name, kind: '외부 링크', url: a.url })
      continue
    }
    // 주소는 HTML의 href가 아니라 종류와 id로 만든다 (다른 화면이 열리지 않게).
    const ref: Ref = {
      u: `/mod/${a.type}/view.php?id=${a.cmid}`,
      c: page.name,
      w: a.week,
      n: a.name,
    }
    if (a.type === 'folder') {
      // 열면 LearnUs에 열람 기록이 남을 수 있어, 사용자가 그 폴더를 원할 때만 연다.
      out.push({ ...base, name: a.name, kind: '폴더', material_id: encodeId(ref) })
    } else {
      out.push({
        ...base,
        name: a.name,
        kind: '파일',
        info: a.info,
        material_id: encodeId(ref),
        downloaded: !!existing(ref),
      })
    }
  }
  const note = languageNote(page)
  if (note) out.push({ note })
  return out
}

/** 폴더 안 파일 목록 (파일은 받지 않는다). */
async function openFolder(client: Client, ref: Ref) {
  // 주소는 받은 id로 새로 만든다 (HTML의 href를 따라가지 않는다)
  const page = await client.get(`${BASE_URL}/mod/folder/view.php?id=${param(ref.u, 'id')}`)
  const files = parseFolder(page.text).map((f) => {
    const r: Ref = { u: f.path, c: ref.c, w: ref.w }
    return { name: f.name, material_id: encodeId(r), downloaded: !!existing(r) }
  })
  return {
    folder: ref.n ?? '',
    files,
    note: files.length
      ? '폴더 안 파일 목록입니다 (아직 받지 않음). 필요한 파일의 material_id로 download_material을 부르세요.'
      : '폴더에서 파일을 찾지 못했습니다. LearnUs에서 직접 확인해 주세요.',
  }
}

// ── 받기·읽기 ──

// 한글 표준 CMap (설치본은 server/cmaps, 저장소는 packaging/cmaps). 없으면 그런 PDF는 글이 비어 나온다.
// 번들(CJS)에서는 build의 --define이 import.meta.dirname을 __dirname으로 바꾼다. 빠져 있으면 CMap 없이 읽는다.
function cmapDir() {
  const here = import.meta.dirname as string | undefined
  return here
    ? [join(here, 'cmaps'), join(here, '..', 'packaging', 'cmaps')].find((d) => existsSync(d))
    : undefined
}

// ponytail: 쪽 수·글자 수만 막는다. 압축 폭탄 같은 쪽 하나의 메모리·시간은 worker_threads 제한이 있어야 막힌다.
async function pdfText(data: Uint8Array) {
  const { getDocumentProxy } = await import('unpdf')
  const cmaps = cmapDir()
  // pdf.js는 '/'로 끝나는 주소만 받는다 → 윈도우 경로의 '\\'도 '/'로 (Node에서 C:/… 경로는 그대로 읽힌다)
  const cMapUrl = cmaps && `${cmaps.split(sep).join('/')}/`
  const pdf = await getDocumentProxy(data, cMapUrl ? { cMapUrl, cMapPacked: true } : {})
  try {
    const pages: string[] = []
    let chars = 0
    // 한 쪽씩 차례로 (unpdf extractText는 모든 쪽을 한꺼번에 연다)
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES) && chars <= MAX_CHARS; i++) {
      const page = await pdf.getPage(i)
      const { items } = await page.getTextContent()
      const t = items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('')
      page.cleanup()
      pages.push(t)
      chars += t.length
    }
    // 쪽 잇기·공백 정리는 unpdf extractText(mergePages: true)와 같게
    const text = pages
      .join('\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
    const cut = pages.length < pdf.numPages || text.length > MAX_CHARS
    return {
      text: text.slice(0, MAX_CHARS),
      note: cut
        ? `PDF가 너무 커서 앞부분만 읽었습니다 (${pdf.numPages}쪽 중 ${pages.length}쪽, 최대 ${MAX_PAGES.toLocaleString('ko-KR')}쪽·${MAX_CHARS.toLocaleString('ko-KR')}자). 나머지는 파일을 직접 열어 주세요.`
        : undefined,
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/** UTF-16(BOM 있는 엑셀 '유니코드 텍스트'), UTF-8, 그 밖은 EUC-KR(한국어 엑셀 CSV 등)로 읽는다. */
function plainText(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

async function extractText(path: string): Promise<{ text: string; note?: string } | undefined> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return pdfText(new Uint8Array(readFileSync(path)))
  if (['.txt', '.csv', '.md'].includes(ext)) return { text: plainText(readFileSync(path)) }
  return undefined
}

// ponytail: 마지막 1개만 기억 — 한 자료를 8,000자씩 이어 읽는 동안 PDF를 매번 다시 뽑지 않게.
let lastText: { key: string; got: Awaited<ReturnType<typeof extractText>> | null } | undefined

async function textOf(path: string) {
  const key = `${path}:${statSync(path).mtimeMs}`
  if (lastText?.key !== key) lastText = { key, got: await extractText(path).catch(() => null) }
  return lastText.got
}

function allowedExt(name: string) {
  const ext = extname(name).toLowerCase()
  if (!EXTENSIONS.has(ext)) {
    throw new LearnUsError(
      `이 형식(${ext || '확장자 없음'})은 받지 않습니다. LearnUs에서 직접 받아 주세요.`,
    )
  }
  return ext
}

/** LearnUs에서 받아 저장하고 저장한 경로와 "(이전 …)"으로 남긴 옛 파일 수를 돌려준다. 받은 파일은 절대 실행하지 않는다. */
async function save(client: Client, ref: Ref): Promise<{ path: string; kept: number }> {
  // pluginfile은 주소에 파일 이름이 있다 → 받기 전에 형식·자리를 본다 (버릴 큰 파일을 받지 않게)
  if (ref.u.startsWith('/pluginfile.php/')) {
    const known = allowedExt(fileNameOf(ref.u))
    if (existsSync(folderOf(ref))) folderInTheWay(inside(join(folderOf(ref), stem(ref) + known)))
  }
  const res = await client.getFile(`${BASE_URL}${ref.u}`)
  if (res.contentType.includes('text/html')) {
    throw new LearnUsError('파일 대신 웹 페이지가 왔습니다. LearnUs에서 직접 열어 주세요.')
  }
  const ext = allowedExt(fileNameOf(new URL(res.url).pathname))
  const dir = folderOf(ref)
  // 오류 문구에 로컬 경로(계정 이름이 든 폴더)를 넣지 않는다
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    throw new LearnUsError(
      '다운로드 폴더 안에 자료 폴더를 만들지 못했습니다 (폴더 권한·남은 공간을 확인해 주세요).',
    )
  }
  const path = inside(join(dir, stem(ref) + ext))
  folderInTheWay(path)
  let kept = 0
  try {
    // 같은 이름의 옛 파일(대소문자·조합 방식만 다른 것 포함)은 이름을 바꿔 남긴다.
    // 내용이 똑같은 같은 파일이면 사본을 쌓지 않는다.
    const unchanged = (p: string) =>
      statSync(p).size === res.bytes.length && readFileSync(p).equals(res.bytes)
    for (const old of sameStem(dir, stem(ref))) {
      if (same(basename(old), basename(path)) && unchanged(old)) continue
      keepOld(old)
      kept++
    }
    // 안전망: 이름 비교로 못 찾았어도 파일 시스템이 같은 파일로 보면 덮어쓰지 않는다
    if (existsSync(path) && !unchanged(path)) {
      keepOld(path)
      kept++
    }
    writeFileSync(path, res.bytes)
  } catch {
    throw new LearnUsError(
      '파일을 저장하지 못했습니다 (다운로드 폴더 권한·남은 공간을 확인해 주세요).',
    )
  }
  // 윈도우: '인터넷에서 받은 파일' 표시 (Office 보호된 보기·매크로 차단이 적용되게). 실패해도 그냥 둔다.
  if (process.platform === 'win32') {
    try {
      writeFileSync(`${path}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
    } catch {
      // 무시
    }
  }
  return { path, kept }
}

// 같은 자료를 동시에 두 번 받지 않게, 진행 중인 받기를 하나로 합친다 (키: 주소 + refresh).
const inflight = new Map<string, Promise<{ path: string; kept: number }>>()

function saveOnce(client: Client, ref: Ref, refresh: boolean) {
  const key = `${refresh}:${ref.u}`
  let p = inflight.get(key)
  if (!p) {
    p = save(client, ref).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/**
 * 받아서(이미 있으면 그대로, refresh면 다시) 글을 start부터 8,000자씩 돌려준다.
 * 폴더 id면 폴더 안 파일 목록만 돌려준다.
 */
export async function downloadMaterial(
  client: Client,
  materialId: string,
  start = 0,
  refresh = false,
) {
  const ref = decodeId(materialId)
  if (ref.u.startsWith('/mod/folder/')) return { ...(await openFolder(client, ref)) }
  // 이어 읽기(start > 0)에서는 refresh를 무시한다 (8,000자마다 다시 받지 않게)
  const old = refresh && start === 0 ? undefined : existing(ref)
  const saved = old ? undefined : await saveOnce(client, ref, refresh)
  const path = old ?? saved!.path
  const notes =
    old && start === 0
      ? ['예전에 받은 파일입니다. LearnUs에 수정본이 올라왔다면 refresh로 다시 받으세요.']
      : []
  if (saved?.kept) {
    notes.push(
      '같은 이름의 예전 파일은 지우지 않고 "(이전 날짜-시각)"을 붙여 같은 폴더에 남겨 두었습니다.',
    )
  }
  const got = await textOf(path)
  if (!got) {
    const why =
      got === null
        ? '글을 뽑아내지 못했습니다 (암호가 걸렸거나 손상된 파일일 수 있음)'
        : `${extname(path)} 파일은 아직 글을 뽑아내지 못합니다 (PDF·txt·csv·md만)`
    notes.push(`${why}. 파일은 저장돼 있습니다.`)
    return { saved_path: path, reused: !!old, note: notes.join(' ') }
  }
  const { text } = got
  if (got.note) notes.push(got.note)
  if (!text.trim() && extname(path).toLowerCase() === '.pdf') {
    notes.push('뽑아낸 글이 없습니다. 글 층이 없는 스캔본이거나 지원하지 않는 글꼴일 수 있습니다.')
  }
  const from = Math.max(0, Math.min(start, text.length))
  return {
    saved_path: path,
    reused: !!old,
    total_chars: text.length,
    start: from,
    next_start: from + CHUNK < text.length ? from + CHUNK : undefined,
    untrusted_content: untrusted(text.slice(from, from + CHUNK)),
    note: notes.length ? notes.join(' ') : undefined,
  }
}

/** 과제·공지 첨부를 download_material로 받을 수 있게 material_id를 붙인다. */
export function withMaterialIds<
  T extends { title: string; attachments: { name: string; path: string }[] },
>(r: T) {
  return {
    ...r,
    attachments: r.attachments.map((f) => ({
      name: f.name,
      // 첨부는 "첨부 <제목>" 폴더에 따로 둔다 (공지 제목으로 과목 자료 폴더를 덮어쓰지 못하게)
      material_id: encodeId({ u: f.path, c: `첨부 ${r.title}`, w: null }),
    })),
  }
}
