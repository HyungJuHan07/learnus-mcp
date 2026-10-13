using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

// 아이디도 메타데이터 대신 전용 generic credential의 암호화 blob 안에 보관한다.
// 윈도우 기본 .NET Framework csc(C# 5)로 컴파일하므로 그 문법만 쓴다.
internal static class Credentials {
    private const string Target = "learnus-mcp.chatgpt";
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicInformation {
        public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority, UniqueProcessId, ParentProcessId;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Delete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
    [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")]
    private static extern int QueryBasic(IntPtr process, int infoClass, ref BasicInformation info, int size, out int returned);
    [DllImport("ntdll.dll", EntryPoint = "NtQueryInformationProcess")]
    private static extern int QueryBuffer(IntPtr process, int infoClass, IntPtr info, int size, out int returned);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", CharSet = CharSet.Unicode)]
    private static extern bool ImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode)]
    private static extern IntPtr OpenFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode)]
    private static extern int FinalPath(IntPtr file, StringBuilder path, int size, uint flags);
    [DllImport("shell32.dll", EntryPoint = "CommandLineToArgvW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SplitArguments(string commandLine, out int count);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static int Reply(object value) { Console.Write(Json.Serialize(value)); return 0; }
    private static int MissingOrFail() {
        if (Marshal.GetLastWin32Error() == 1168) return Reply(new { status = "missing" });
        throw new InvalidOperationException();
    }

    // 정션·심볼릭 링크·8.3 짧은 이름·대소문자를 모두 푼 실제 경로 (없으면 null).
    // node는 메인 모듈을 실제 경로로 풀어 헬퍼를 그 아래에서 실행하므로, 양쪽을 같은 방식으로 푼다.
    private static string RealPath(string path) {
        // FILE_READ_ATTRIBUTES, 모든 공유, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS
        var file = OpenFile(Path.GetFullPath(path), 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        if (file == new IntPtr(-1)) return null;
        try {
            var buffer = new StringBuilder(32768);
            var length = FinalPath(file, buffer, buffer.Capacity, 0);
            return length > 0 && length < buffer.Capacity ? buffer.ToString().ToLowerInvariant() : null;
        } finally { CloseHandle(file); }
    }

    // 부모가 `node.exe <이 헬퍼 위 폴더>\index.cjs <mode>`일 때만 응답한다.
    // AI 에이전트가 셸에서 헬퍼를 바로 실행해 금고 값을 보는 일을 막는다. 같은 사용자 권한으로
    // 작정하고 우회하는 프로그램(헬퍼를 복사해 가짜 index.cjs 옆에서 부르기 등)까지 막지는 못한다.
    private static bool CalledBy(string[] modes) {
        var basic = new BasicInformation();
        int returned;
        if (QueryBasic(GetCurrentProcess(), 0, ref basic, Marshal.SizeOf(basic), out returned) != 0) return false;
        // PROCESS_QUERY_LIMITED_INFORMATION: 같은 사용자의 프로세스 이름·명령줄만 읽는다
        var parent = OpenProcess(0x1000, false, basic.ParentProcessId.ToInt32());
        if (parent == IntPtr.Zero) return false;
        string image, commandLine;
        try {
            var name = new StringBuilder(32768);
            var size = name.Capacity;
            if (!ImageName(parent, 0, name, ref size)) return false;
            image = name.ToString();
            // ProcessCommandLineInformation(60): UNICODE_STRING 뒤에 글자가 붙어 온다
            int needed;
            QueryBuffer(parent, 60, IntPtr.Zero, 0, out needed);
            if (needed <= 0 || needed > 65536) return false;
            var buffer = Marshal.AllocHGlobal(needed);
            try {
                if (QueryBuffer(parent, 60, buffer, needed, out needed) != 0) return false;
                commandLine = Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer, IntPtr.Size), (ushort)Marshal.ReadInt16(buffer) / 2);
            } finally { Marshal.FreeHGlobal(buffer); }
        } finally { CloseHandle(parent); }
        if (!String.Equals(Path.GetFileName(image), "node.exe", StringComparison.OrdinalIgnoreCase)) return false;
        int count;
        var list = SplitArguments(commandLine, out count);
        if (list == IntPtr.Zero) return false;
        var arguments = new string[count];
        try {
            for (var i = 0; i < count; i++) arguments[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(list, i * IntPtr.Size));
        } finally { LocalFree(list); }
        if (count != 3 || Array.IndexOf(modes, arguments[2]) < 0) return false;
        var folder = Path.GetDirectoryName(Path.GetDirectoryName(Assembly.GetEntryAssembly().Location));
        var expected = RealPath(Path.Combine(folder, "index.cjs"));
        // node는 상대 경로를 시작할 때의 작업 폴더 기준으로 푼다. 헬퍼는 그 작업 폴더를 물려받는다.
        var actual = RealPath(Path.Combine(Environment.CurrentDirectory, arguments[1]));
        return expected != null && expected == actual;
    }

    // 서버 파이프로 받은 JSON (2,560바이트까지)
    private static Dictionary<string, string> Input() {
        byte[] data;
        using (var buffer = new MemoryStream()) {
            var input = Console.OpenStandardInput();
            var chunk = new byte[2561];
            int count;
            while ((count = input.Read(chunk, 0, chunk.Length)) > 0) {
                if (buffer.Length + count > 2560) throw new InvalidOperationException();
                buffer.Write(chunk, 0, count);
            }
            data = buffer.ToArray();
        }
        try {
            return Json.Deserialize<Dictionary<string, string>>(new UTF8Encoding(false, true).GetString(data));
        } finally { Array.Clear(data, 0, data.Length); }
    }

    // 저장된 값. 항목이 없으면 null (GetLastWin32Error로 구분).
    private static Dictionary<string, string> Load() {
        IntPtr ptr;
        if (!Read(Target, 1, 0, out ptr)) return null;
        try {
            var c = (Credential)Marshal.PtrToStructure(ptr, typeof(Credential));
            if (c.CredentialBlobSize > 2560) throw new InvalidOperationException();
            var data = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, data, 0, data.Length);
            try {
                return Json.Deserialize<Dictionary<string, string>>(Encoding.UTF8.GetString(data));
            } finally { Array.Clear(data, 0, data.Length); }
        } finally { CredFree(ptr); }
    }

    private static void Store(Dictionary<string, string> value) {
        var data = Encoding.UTF8.GetBytes(Json.Serialize(value));
        if (data.Length > 2560) throw new InvalidOperationException();
        var blob = Marshal.AllocHGlobal(data.Length);
        try {
            Marshal.Copy(data, 0, blob, data.Length);
            var c = new Credential { Type = 1, TargetName = Target, UserName = "credentials",
                CredentialBlobSize = (uint)data.Length, CredentialBlob = blob, Persist = 2 };
            if (!Write(ref c, 0)) throw new InvalidOperationException();
        } finally {
            for (int i = 0; i < data.Length; i++) Marshal.WriteByte(blob, i, 0);
            Marshal.FreeHGlobal(blob);
            Array.Clear(data, 0, data.Length);
        }
    }

    // 금고를 바꾸는 동작(저장·지우기·실패 표시)을 사용자 세션의 잠금 하나로 줄 세운다. 실패 표시의
    // 읽기→비교→쓰기 사이에 다른 프로세스가 지우거나 저장하면 CredWrite가 지운 값을 되살리거나
    // 새 값을 옛 값으로 덮기 때문. 헬퍼가 중간에 죽으면 OS가 잠금을 버려진 상태로 넘겨준다.
    private static int Locked(Func<int> body) {
        using (var mutex = new Mutex(false, @"Local\learnus-mcp.chatgpt")) {
            try { mutex.WaitOne(); } catch (AbandonedMutexException) { }
            try { return body(); } finally { mutex.ReleaseMutex(); }
        }
    }

    private static int Main(string[] args) {
        try {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (!Console.IsInputRedirected || !Console.IsOutputRedirected || args.Length != 1)
                throw new InvalidOperationException();
            // 서버 전용 파이프 프로토콜. 터미널·다른 프로그램에서 직접 실행하면 금고를 열기 전에 거절한다.
            var callers = new Dictionary<string, string[]> {
                { "read", new[] { "chatgpt" } }, { "reject", new[] { "chatgpt" } },
                { "write", new[] { "credentials-set" } }, { "delete", new[] { "credentials-clear" } },
            };
            string[] modes;
            if (!callers.TryGetValue(args[0], out modes) || !CalledBy(modes)) throw new InvalidOperationException();
            switch (args[0]) {
                case "read": {
                    var stored = Load();
                    if (stored == null) return MissingOrFail();
                    return Reply(new { status = "ok", credentials = stored });
                }
                case "write": {
                    var value = Input();
                    if (value == null || value.Count != 2 || !value.ContainsKey("username") ||
                        !value.ContainsKey("password") || String.IsNullOrWhiteSpace(value["username"]) ||
                        String.IsNullOrEmpty(value["password"])) throw new InvalidOperationException();
                    // 새로 저장하면 실패 표시(rejected)도 지워진다
                    return Locked(() => { Store(value); return Reply(new { status = "ok" }); });
                }
                case "reject": {
                    var value = Input();
                    if (value == null || value.Count != 3 || !value.ContainsKey("username") ||
                        !value.ContainsKey("password") || !value.ContainsKey("code") ||
                        !Regex.IsMatch(value["code"], "^[A-Z_]{1,32}\\z")) throw new InvalidOperationException();
                    return Locked(() => {
                        var stored = Load();
                        if (stored == null) return MissingOrFail();
                        string username, password;
                        // 실패한 값이 지금도 금고에 있을 때만 표시한다 (그사이 새로 저장했으면 그대로 둔다)
                        if (!stored.TryGetValue("username", out username) || !stored.TryGetValue("password", out password) ||
                            username != value["username"] || password != value["password"])
                            return Reply(new { status = "stale" });
                        Store(new Dictionary<string, string> {
                            { "username", username }, { "password", password }, { "rejected", value["code"] },
                        });
                        return Reply(new { status = "ok" });
                    });
                }
                case "delete":
                    return Locked(() => Delete(Target, 1, 0) ? Reply(new { status = "ok" }) : MissingOrFail());
                default: throw new InvalidOperationException();
            }
        } catch {
            Console.Write("{\"status\":\"error\"}");
            return 1;
        }
    }
}
