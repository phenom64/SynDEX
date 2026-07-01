const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OSC_BUFFER_MAX = 4096;

function isInsideAsarArchive(filePath) {
    return /app\.asar([\\/]|$)/i.test(filePath) && !/app\.asar\.unpacked/i.test(filePath);
}

function getShellIntegrationPath() {
    const relativeParts = ["assets", "scripts", "shellIntegration.ps1"];
    const localPath = path.join(__dirname, "..", ...relativeParts);

    if (process.resourcesPath) {
        const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked", ...relativeParts);
        if (fs.existsSync(unpackedPath)) {
            return unpackedPath;
        }
    }
    if (fs.existsSync(localPath) && !isInsideAsarArchive(localPath)) {
        return localPath;
    }

    try {
        const content = fs.readFileSync(localPath, "utf-8");
        const tmp = path.join(os.tmpdir(), "syndex-shell-integration.ps1");
        fs.writeFileSync(tmp, content, "utf-8");
        return tmp;
    } catch (_) {
        return localPath;
    }
}

function isPowerShell(shellPath) {
    const base = path.basename(String(shellPath || "")).toLowerCase();
    return base.indexOf("pwsh") >= 0 || base.indexOf("powershell") >= 0;
}

function normalizeShellArgs(shell, params) {
    let args = [];
    if (Array.isArray(params)) {
        args = params.slice();
    } else if (typeof params === "string" && params.trim().length > 0) {
        args = params.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        args = args.map(s => s.replace(/^"|"$/g, ""));
    }

    if (process.platform !== "win32" || !isPowerShell(shell)) {
        if (args.length > 0) return args;
        return process.platform === "win32" ? [] : ["--login"];
    }

    const integration = getShellIntegrationPath();
    if (!fs.existsSync(integration)) {
        return args.length > 0 ? args : [];
    }

    const escaped = integration.replace(/'/g, "''");
    const inject = `. '${escaped}'`;

    if (args.length === 0) {
        return ["-NoLogo", "-NoExit", "-Command", inject];
    }

    const hasNoExit = args.some(a => /^-noexit$/i.test(a));
    const loadFirst = ["-NoLogo"];
    if (!hasNoExit) loadFirst.push("-NoExit");
    return loadFirst.concat(["-Command", inject], args);
}

function decodeOscPath(rawPath) {
    if (!rawPath) return null;
    let decoded = rawPath;
    try {
        decoded = decodeURIComponent(rawPath.replace(/\\/g, "/"));
    } catch (_) {
        decoded = rawPath.replace(/\\/g, "/");
    }
    if (/^\/[A-Za-z]:\//.test(decoded)) {
        decoded = decoded.slice(1);
    }
    return decoded.replace(/\//g, path.sep);
}

function unescapeOsc633(value) {
    return String(value || "").replace(/\\x([0-9a-f]{2})/gi, (_, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
}

function parseOscCwd(chunk, buffer) {
    const combined = (buffer || "") + chunk;
    const trimmed = combined.length > OSC_BUFFER_MAX
        ? combined.slice(combined.length - OSC_BUFFER_MAX)
        : combined;

    let cwd = null;

    const osc633 = trimmed.match(/\x1b\]633;P;Cwd=((?:\\x[0-9a-f]{2}|[^\x07\x1b])+)\x07/i);
    if (osc633) {
        cwd = unescapeOsc633(osc633[1]);
    }

    if (!cwd) {
        const osc7 = trimmed.match(/\x1b\]7;file:\/\/[^/]*\/([^\x07\x1b]+)\x07/i);
        if (osc7) {
            cwd = decodeOscPath(osc7[1]);
        }
    }

    if (!cwd) {
        const osc7b = trimmed.match(/\x1b\]7;file:\/\/([^\x07\x1b]+)\x07/i);
        if (osc7b) {
            const full = osc7b[1];
            const slash = full.indexOf("/");
            cwd = decodeOscPath(slash >= 0 ? full.slice(slash + 1) : full);
        }
    }

    return { cwd, buffer: trimmed };
}

function getWindowsChildProcess(pid) {
    return new Promise((resolve, reject) => {
        const script = [
            "$ErrorActionPreference='SilentlyContinue'",
            "function G([int]$p) {",
            "  $kids = Get-CimInstance Win32_Process -Filter \"ParentProcessId=$p\"",
            "  if (-not $kids) { return $null }",
            "  $best = $null",
            "  foreach ($k in $kids) {",
            "    if ($k.Name -match '^(conhost|csrss|fontdrvhost|dwm|sihost)\\.exe$') { continue }",
            "    $sub = G $k.ProcessId",
            "    if ($sub) { $best = $sub } else { $best = $k.Name }",
            "  }",
            "  return $best",
            "}",
            "G " + Number(pid)
        ].join("; ");

        childProcess.execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script],
            { encoding: "utf-8", timeout: 5000, windowsHide: true },
            (err, stdout) => {
                if (err) return reject(err);
                const lines = (stdout || "").trim().split(/\r?\n/).filter(Boolean);
                resolve(lines.length ? lines[lines.length - 1].trim() : "");
            }
        );
    });
}

function getWindowsProcessCwd(pid) {
    return new Promise((resolve, reject) => {
        const script = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            "Add-Type @'",
            "using System;",
            "using System.Runtime.InteropServices;",
            "using System.Text;",
            "public class SynDexCwd {",
            "  [StructLayout(LayoutKind.Sequential)] public struct UnicodeString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }",
            "  [StructLayout(LayoutKind.Sequential)] public struct RtlUserProcessParameters {",
            "    [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] Reserved1;",
            "    [MarshalAs(UnmanagedType.ByValArray, SizeConst=10)] public IntPtr[] Reserved2;",
            "    public UnicodeString CurrentDirectory;",
            "  }",
            "  [StructLayout(LayoutKind.Sequential)] public struct Peb {",
            "    [MarshalAs(UnmanagedType.ByValArray, SizeConst=4)] public byte[] Reserved1;",
            "    public IntPtr Reserved3_0; public IntPtr Reserved3_1; public IntPtr Ldr; public IntPtr ProcessParameters;",
            "  }",
            "  [StructLayout(LayoutKind.Sequential)] public struct ProcessBasicInformation {",
            "    public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2_0; public IntPtr Reserved2_1; public IntPtr UniqueProcessId; public IntPtr Reserved3;",
            "  }",
            "  [DllImport(\"ntdll.dll\")] public static extern int NtQueryInformationProcess(IntPtr h, int cls, ref ProcessBasicInformation pbi, int len, out int ret);",
            "  [DllImport(\"kernel32.dll\")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);",
            "  [DllImport(\"kernel32.dll\")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);",
            "  [DllImport(\"kernel32.dll\")] public static extern bool CloseHandle(IntPtr h);",
            "  public static string Get(int pid) {",
            "    var pbi = new ProcessBasicInformation(); int ret;",
            "    var h = OpenProcess(0x0410, false, pid);",
            "    if (h == IntPtr.Zero) return null;",
            "    if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) { CloseHandle(h); return null; }",
            "    var peb = new Peb(); var buf = new byte[Marshal.SizeOf(peb)]; int read;",
            "    if (!ReadProcessMemory(h, pbi.PebBaseAddress, buf, buf.Length, out read)) { CloseHandle(h); return null; }",
            "    var handle = GCHandle.Alloc(buf, GCHandleType.Pinned);",
            "    try { peb = (Peb)Marshal.PtrToStructure(handle.AddrOfPinnedObject(), typeof(Peb)); }",
            "    finally { handle.Free(); }",
            "    var pp = new RtlUserProcessParameters(); buf = new byte[Marshal.SizeOf(pp)];",
            "    if (!ReadProcessMemory(h, peb.ProcessParameters, buf, buf.Length, out read)) { CloseHandle(h); return null; }",
            "    handle = GCHandle.Alloc(buf, GCHandleType.Pinned);",
            "    try { pp = (RtlUserProcessParameters)Marshal.PtrToStructure(handle.AddrOfPinnedObject(), typeof(RtlUserProcessParameters)); }",
            "    finally { handle.Free(); }",
            "    var u = pp.CurrentDirectory; buf = new byte[u.Length];",
            "    if (!ReadProcessMemory(h, u.Buffer, buf, buf.Length, out read)) { CloseHandle(h); return null; }",
            "    CloseHandle(h);",
            "    return Encoding.Unicode.GetString(buf);",
            "  }",
            "}",
            "'@",
            "[SynDexCwd]::Get(" + Number(pid) + ")"
        ].join("\n");

        const tmp = path.join(os.tmpdir(), "syndex-cwd-" + process.pid + ".ps1");
        try {
            fs.writeFileSync(tmp, script, "utf-8");
        } catch (e) {
            reject(e);
            return;
        }

        childProcess.execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmp],
            { encoding: "utf-8", timeout: 8000, windowsHide: true },
            (err, stdout) => {
                try { fs.unlinkSync(tmp); } catch (_) {}
                if (err) return reject(err);
                const cwd = (stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
                if (!cwd) return reject(new Error("No cwd"));
                resolve(cwd);
            }
        );
    });
}

module.exports = {
    getShellIntegrationPath,
    isPowerShell,
    normalizeShellArgs,
    parseOscCwd,
    getWindowsChildProcess,
    getWindowsProcessCwd
};