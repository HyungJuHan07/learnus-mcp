import Foundation
import Security
import AppKit
import Darwin

// 고정 항목의 암호화 데이터 안에 아이디까지 넣는다. 학번을 메타데이터에 저장하지 않는다.
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "learnus-mcp.chatgpt",
    kSecAttrAccount as String: "credentials",
    kSecAttrSynchronizable as String: false,
]

func reply(_ value: [String: Any], _ code: Int32 = 0) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data)
    }
    exit(code)
}
func fail() -> Never { reply(["status": "error"], 1) }
func check(_ code: OSStatus) {
    if code == errSecItemNotFound { reply(["status": "missing"]) }
    if code != errSecSuccess { fail() }
}

func store(_ data: Data) -> OSStatus {
    let update = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    guard status == errSecItemNotFound else { return status }
    var item = query
    item[kSecValueData as String] = data
    return SecItemAdd(item as CFDictionary, nil)
}

/// 금고를 바꾸는 동작(저장·지우기·실패 표시)을 사용자별 잠금 하나로 줄 세운다. 실패 표시의
/// 읽기→비교→쓰기 사이에 다른 프로세스의 저장·지우기가 끼어들어 새 값을 옛 값으로 덮지 않게.
/// 헬퍼가 중간에 죽어도 OS가 잠금을 풀어 준다.
func locked<T>(_ body: () -> T) -> T {
    var directory = [CChar](repeating: 0, count: Int(PATH_MAX))
    guard confstr(_CS_DARWIN_USER_TEMP_DIR, &directory, directory.count) > 0 else { fail() }
    let file = open(String(cString: directory) + "learnus-mcp.chatgpt.lock", O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
    guard file >= 0, flock(file, LOCK_EX) == 0 else { fail() }
    defer { close(file) }
    return body()
}

/// 저장된 값. 항목이 없으면 missing으로 끝낸다.
func load() -> [String: String] {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    check(SecItemCopyMatching(request as CFDictionary, &result))
    guard let data = result as? Data,
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { fail() }
    return value
}

// 값은 이 프로세스의 입력창과 OS 금고 사이에서만 이동한다.
func setup() -> Never {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let alert = NSAlert()
    alert.messageText = "비공식 LearnUs · 로그인 정보 등록"
    alert.informativeText = "본인이 직접 입력하세요. 이 컴퓨터의 키체인에 저장하며, 학교에 로그인하거나 AI에 전달하지 않습니다."
    alert.addButton(withTitle: "키체인에 저장")
    alert.addButton(withTitle: "취소")
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 150))
    // 아이디는 보이게 받는다: 학번 오타가 다른 학생 계정의 로그인 실패로 쌓이지 않게
    let fields = [NSTextField(), NSSecureTextField(), NSSecureTextField()]
    for (index, title) in ["연세포털 아이디(학번)", "비밀번호", "비밀번호 확인"].enumerated() {
        let y = CGFloat(110 - index * 50)
        let label = NSTextField(labelWithString: title)
        label.frame = NSRect(x: 0, y: y + 24, width: 360, height: 20)
        fields[index].frame = NSRect(x: 0, y: y, width: 360, height: 24)
        view.addSubview(label)
        view.addSubview(fields[index])
    }
    alert.accessoryView = view
    alert.window.initialFirstResponder = fields[0]
    fields[0].nextKeyView = fields[1]
    fields[1].nextKeyView = fields[2]
    app.activate(ignoringOtherApps: true)
    guard alert.runModal() == .alertFirstButtonReturn else { reply(["status": "cancelled"]) }
    let username = fields[0].stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let password = fields[1].stringValue
    guard !username.isEmpty, !password.isEmpty, password == fields[2].stringValue,
          let data = try? JSONSerialization.data(withJSONObject: ["username": username, "password": password]),
          data.count <= 2560 else {
        let warning = NSAlert()
        warning.messageText = "저장하지 않았습니다"
        warning.informativeText = "빈 입력이나 서로 다른 비밀번호입니다. 입력창을 다시 열어 확인해 주세요."
        warning.runModal()
        fail()
    }
    // 새로 저장하면 실패 표시(rejected)도 지워진다
    guard locked({ store(data) }) == errSecSuccess else {
        let warning = NSAlert()
        warning.messageText = "키체인에 저장하지 못했습니다"
        warning.informativeText = "키체인이 잠겨 있거나 접근을 거절했습니다. 키체인 접근을 확인한 뒤 입력창을 다시 열어 주세요."
        warning.runModal()
        fail()
    }
    let success = NSAlert()
    success.messageText = "키체인에 저장했습니다"
    success.informativeText = "ChatGPT에서 LearnUs MCP를 다시 시작하고 새 대화에서 도움말을 요청하세요. 학교에는 접속하지 않았습니다."
    success.runModal()
    reply(["status": "ok"])
}

/// 부모 프로세스의 실행 파일과 인자 (sysctl KERN_PROCARGS2). 읽지 못하면 nil.
func parentProcess() -> (path: String, arguments: [String])? {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, getppid()]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 4 else { return nil }
    var buffer = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0, size > 4 else { return nil }
    let count = buffer.withUnsafeBytes { Int($0.load(as: Int32.self)) }
    var index = 4
    func next() -> String? {
        let start = index
        while index < size, buffer[index] != 0 { index += 1 }
        guard index < size else { return nil }
        defer { index += 1 }
        return String(decoding: buffer[start..<index], as: UTF8.self)
    }
    guard let path = next() else { return nil }
    while index < size, buffer[index] == 0 { index += 1 }
    var arguments: [String] = []
    for _ in 0..<count {
        guard let argument = next() else { return nil }
        arguments.append(argument)
    }
    return (path, arguments)
}

func realPath(_ path: String) -> String? {
    guard let resolved = realpath(path, nil) else { return nil }
    defer { free(resolved) }
    return String(cString: resolved)
}

/// 부모가 `node <이 헬퍼 위 폴더>/index.cjs <mode>`일 때만 응답한다.
/// AI 에이전트가 셸에서 헬퍼를 바로 실행해 금고 값을 보는 일을 막는다. 같은 사용자 권한으로
/// 작정하고 우회하는 프로그램(헬퍼를 복사해 가짜 index.cjs 옆에서 부르기 등)까지 막지는 못한다.
func calledBy(_ modes: Set<String>) -> Bool {
    guard let parent = parentProcess(), parent.arguments.count == 3,
          (parent.path as NSString).lastPathComponent == "node",
          modes.contains(parent.arguments[2]),
          let me = Bundle.main.executablePath, let helper = realPath(me) else { return false }
    let folder = ((helper as NSString).deletingLastPathComponent as NSString).deletingLastPathComponent
    // node는 상대 경로를 시작할 때의 작업 폴더 기준으로 푼다. 헬퍼는 그 작업 폴더를 물려받는다.
    let script = parent.arguments[1]
    let absolute = script.hasPrefix("/") ? script : FileManager.default.currentDirectoryPath + "/" + script
    guard let expected = realPath(folder + "/index.cjs"), let actual = realPath(absolute) else { return false }
    return expected == actual
}

/// 서버 파이프로 받은 JSON (2,560바이트까지).
func input() -> [String: String] {
    var data = Data()
    do {
        while let chunk = try FileHandle.standardInput.read(upToCount: 2561), !chunk.isEmpty {
            data.append(chunk)
            if data.count > 2560 { fail() }
        }
    } catch { fail() }
    guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { fail() }
    return value
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "setup" { setup() }

// 서버 전용 파이프 프로토콜. 터미널·다른 프로그램에서 직접 실행하면 금고를 열기 전에 거절한다.
let callers: [String: Set<String>] = [
    "read": ["chatgpt"], "reject": ["chatgpt"], "write": ["credentials-set"], "delete": ["credentials-clear"],
]
guard isatty(STDIN_FILENO) == 0, isatty(STDOUT_FILENO) == 0, CommandLine.arguments.count == 2,
      let modes = callers[CommandLine.arguments[1]], calledBy(modes) else { fail() }

switch CommandLine.arguments[1] {
case "read":
    reply(["status": "ok", "credentials": load()])
case "write":
    let value = input()
    guard let username = value["username"], !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let password = value["password"], !password.isEmpty, value.count == 2,
          let data = try? JSONSerialization.data(withJSONObject: value) else { fail() }
    // 새로 저장하면 실패 표시(rejected)도 지워진다
    locked { check(store(data)) }
    reply(["status": "ok"])
case "reject":
    let value = input()
    guard let username = value["username"], let password = value["password"], let code = value["code"],
          value.count == 3, code.range(of: "^[A-Z_]{1,32}\\z", options: .regularExpression) != nil else { fail() }
    guard let data = try? JSONSerialization.data(
              withJSONObject: ["username": username, "password": password, "rejected": code]),
          data.count <= 2560 else { fail() }
    locked {
        // 실패한 값이 지금도 금고에 있을 때만 표시한다 (그사이 새로 저장했으면 그대로 둔다)
        let stored = load()
        guard stored["username"] == username, stored["password"] == password else { reply(["status": "stale"]) }
        // Update만 한다: 키체인 접근 앱 등에서 지웠으면 되살리지 않고 missing으로 끝낸다
        check(SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary))
    }
    reply(["status": "ok"])
case "delete":
    locked { check(SecItemDelete(query as CFDictionary)) }
    reply(["status": "ok"])
default:
    fail()
}
