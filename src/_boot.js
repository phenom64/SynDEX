const signale = require("signale");
const {app, BrowserWindow, dialog, shell} = require("electron");
const { enable } = require('@electron/remote/main');

process.on("uncaughtException", e => {
    signale.fatal(e);
    dialog.showErrorBox("SynDEX crashed", e.message || "Cannot retrieve error message.");
    if (tty) {
        tty.close();
    }
    if (extraTtys) {
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] !== null) {
                extraTtys[key].close();
            }
        });
    }
    process.exit(1);
});

signale.start(`Starting SynDEX v${app.getVersion()}`);
signale.info(`With Node ${process.versions.node} and Electron ${process.versions.electron}`);
signale.info(`Renderer is Chrome ${process.versions.chrome}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    signale.fatal("Error: Another instance of SynDEX is already running. Cannot proceed.");
    app.exit(1);
}

signale.time("Startup");

const electron = require("electron");
const remoteMain = require('@electron/remote/main')
remoteMain.initialize();
remoteMain.enable(electron.webContents);
const ipc = electron.ipcMain;
ipc.handle("get-cli-args", () => process.argv);
const path = require("path");
const url = require("url");
const fs = require("fs");
const which = require("which");
const Terminal = require("./classes/terminal.class.js").Terminal;

ipc.on("log", (e, type, content) => {
    signale[type](content);
});

var win, tty, extraTtys;
const settingsFile = path.join(electron.app.getPath("userData"), "settings.json");
const shortcutsFile = path.join(electron.app.getPath("userData"), "shortcuts.json");
const lastWindowStateFile = path.join(electron.app.getPath("userData"), "lastWindowState.json");
const themesDir = path.join(electron.app.getPath("userData"), "themes");
const innerThemesDir = path.join(__dirname, "assets/themes");
const kblayoutsDir = path.join(electron.app.getPath("userData"), "keyboards");
const innerKblayoutsDir = path.join(__dirname, "assets/kb_layouts");
const fontsDir = path.join(electron.app.getPath("userData"), "fonts");
const innerFontsDir = path.join(__dirname, "assets/fonts");

// Unset proxy env variables to avoid connection problems on the internal websockets
// See #222
if (process.env.http_proxy) delete process.env.http_proxy;
if (process.env.https_proxy) delete process.env.https_proxy;

// Bypass GPU acceleration blocklist, trading a bit of stability for a great deal of performance, mostly on Linux
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-video-decode");

// Fix userData folder not setup on Windows
try {
    fs.mkdirSync(electron.app.getPath("userData"));
    signale.info(`Created config dir at ${electron.app.getPath("userData")}`);
} catch(e) {
    signale.info(`Base config dir is ${electron.app.getPath("userData")}`);
}
// Create default settings file
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
        shell: (process.platform === "win32") ? "powershell.exe" : "bash",
        shellArgs: '',
        cwd: electron.app.getPath("userData"),
        keyboard: "en-US",
        theme: "tron",
        termFontSize: 15,
        audio: true,
        audioVolume: 1.0,
        disableFeedbackAudio: false,
        clockHours: 24,
        pingAddr: "1.1.1.1",
        port: 3000,
        nointro: false,
        nocursor: false,
        forceFullscreen: true,
        windowWidth: 1280,
        windowHeight: 720,
        openDevTools: false,
        allowWindowed: false,
        excludeThreadsFromToplist: true,
        hideDotfiles: false,
        fsListView: false,
        experimentalGlobeFeatures: false,
        experimentalFeatures: false,
        retroTerminalEffect: false,
        windowsTerminalColorScheme: "",
        applyTerminalSchemeToUI: false,
        panelToggles: {
            keyboard: true,
            leftColumn: true,
            rightColumn: true,
            filesystem: true,
            agentWatch: true
        },
        panelLayout: {
            agentWatchSlot: "bottom-left"
        }
    }, "", 4));
    signale.info(`Default settings written to ${settingsFile}`);
} else {
    // If settings.json exists, ensure all default keys exist
    try {
        let currentSettings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
        let updated = false;
        const defaults = {
            retroTerminalEffect: false,
            windowsTerminalColorScheme: "",
            applyTerminalSchemeToUI: false,
            panelToggles: { keyboard: true, leftColumn: true, rightColumn: true, filesystem: true, agentWatch: true },
            panelLayout: { agentWatchSlot: "bottom-left" }
        };
        for (const key in defaults) {
            if (!(key in currentSettings)) {
                currentSettings[key] = defaults[key];
                updated = true;
            } else if (typeof defaults[key] === "object" && defaults[key] !== null && !Array.isArray(defaults[key])) {
                for (const nestedKey in defaults[key]) {
                    if (!(nestedKey in currentSettings[key])) {
                        currentSettings[key][nestedKey] = defaults[key][nestedKey];
                        updated = true;
                    }
                }
            }
        }
        if (updated) {
            fs.writeFileSync(settingsFile, JSON.stringify(currentSettings, "", 4));
            signale.info(`Default settings keys initialized in existing settings.json`);
        }
    } catch(e) {
        signale.warn(`Could not check/initialize default keys in settings.json: ${e.message}`);
    }
}
// Create default shortcuts file
if (!fs.existsSync(shortcutsFile)) {
    fs.writeFileSync(shortcutsFile, JSON.stringify([
        { type: "app", trigger: "Ctrl+Shift+C", action: "COPY", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+V", action: "PASTE", enabled: true },
        { type: "app", trigger: "Ctrl+Tab", action: "NEXT_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+Tab", action: "PREVIOUS_TAB", enabled: true },
        { type: "app", trigger: "Ctrl+X", action: "TAB_X", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+S", action: "SETTINGS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+K", action: "SHORTCUTS", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+F", action: "FUZZY_SEARCH", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+L", action: "FS_LIST_VIEW", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+H", action: "FS_DOTFILES", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+P", action: "KB_PASSMODE", enabled: true },
        { type: "app", trigger: "Ctrl+Shift+I", action: "DEV_DEBUG", enabled: false },
        { type: "app", trigger: "Ctrl+Shift+F5", action: "DEV_RELOAD", enabled: true },
        { type: "shell", trigger: "Ctrl+Shift+Alt+Space", action: "neofetch", linebreak: true, enabled: false }
    ], "", 4));
    signale.info(`Default keymap written to ${shortcutsFile}`);
}
//Create default window state file
if(!fs.existsSync(lastWindowStateFile)) {
    fs.writeFileSync(lastWindowStateFile, JSON.stringify({
        useFullscreen: true
    }, "", 4));
    signale.info(`Default last window state written to ${lastWindowStateFile}`);
}

// Copy default themes & keyboard layouts & fonts
signale.pending("Mirroring internal assets...");
try {
    fs.mkdirSync(themesDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerThemesDir).forEach(e => {
    fs.writeFileSync(path.join(themesDir, e), fs.readFileSync(path.join(innerThemesDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(kblayoutsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerKblayoutsDir).forEach(e => {
    fs.writeFileSync(path.join(kblayoutsDir, e), fs.readFileSync(path.join(innerKblayoutsDir, e), {encoding:"utf-8"}));
});
try {
    fs.mkdirSync(fontsDir);
} catch(e) {
    // Folder already exists
}
fs.readdirSync(innerFontsDir).forEach(e => {
    fs.writeFileSync(path.join(fontsDir, e), fs.readFileSync(path.join(innerFontsDir, e)));
});

// Version history logging
const versionHistoryPath = path.join(electron.app.getPath("userData"), "versions_log.json");
var versionHistory = fs.existsSync(versionHistoryPath) ? require(versionHistoryPath) : {};
var version = app.getVersion();
if (typeof versionHistory[version] === "undefined") {
	versionHistory[version] = {
		firstSeen: Date.now(),
		lastSeen: Date.now()
	};
} else {
	versionHistory[version].lastSeen = Date.now();
}
fs.writeFileSync(versionHistoryPath, JSON.stringify(versionHistory, 0, 2), {encoding:"utf-8"});

// ============================================================
// AgentWatch — AI agent log file watchers
// ============================================================
const os = require('os');
const HOME = os.homedir();

const AGENT_PATHS = {
    claude: path.join(HOME, '.claude', 'projects'),
    claudeRoot: path.join(HOME, '.claude'),
    antigravity: path.join(HOME, '.gemini', 'antigravity-cli', 'brain'),
    opencode: path.join(HOME, '.config', 'opencode'),
    opencodeDb: path.join(HOME, '.local', 'share', 'opencode', 'opencode.db'),
    codex: path.join(HOME, '.codex')
};

// Context window sizes per model (tokens)
const AW_CTX_WINDOWS = {
    'claude-opus-4': 200000,
    'claude-sonnet-4-5': 200000,
    'claude-sonnet-4-6': 200000,
    'claude-haiku-3-5': 200000,
    'gpt-4o': 128000,
    'gpt-4.1': 1000000,
    'o3': 200000,
    'gemini-2.5-flash': 1048576,
    'gemini-2.5-pro': 1048576
};

// Cost per 1M tokens [inputCost, outputCost] in USD
const AW_MODEL_COSTS = {
    'claude-opus-4':     [15.00, 75.00],
    'claude-sonnet-4-5': [3.00,  15.00],
    'claude-sonnet-4-6': [3.00,  15.00],
    'claude-haiku-3-5':  [0.80,  4.00],
    'gpt-4o':            [5.00,  15.00],
    'gpt-4.1':           [2.00,  8.00],
    'gemini-2.5-flash':  [0.30,  2.50],
    'gemini-2.5-pro':    [1.25,  10.00]
};

function awCalcCost(model, tokensIn, tokensOut) {
    const costs = AW_MODEL_COSTS[model];
    if (!costs) return 0;
    return (tokensIn / 1e6) * costs[0] + (tokensOut / 1e6) * costs[1];
}

function awCtxPct(model, tokensIn) {
    const ctx = AW_CTX_WINDOWS[model];
    if (!ctx) return null;
    return Math.min(100, Math.round((tokensIn / ctx) * 100));
}

let awSessions = {};
let awDailyHistory = new Array(30).fill(0);

function awNow() {
    return Date.now();
}

function awProjectName(cwd) {
    if (!cwd || typeof cwd !== "string") return "UNKNOWN";
    return path.basename(cwd.replace(/[\\\/]+$/, "")) || cwd;
}

function awShortId(value) {
    if (!value) return "";
    return String(value).slice(0, 8);
}

function awNormalizeSession(session) {
    const now = awNow();
    const tokensIn = Number(session.tokensIn || 0);
    const tokensOut = Number(session.tokensOut || 0);
    const cacheRead = Number(session.cacheRead || 0);
    const cacheCreate = Number(session.cacheCreate || 0);
    const startedAt = Number(session.startedAt || session.lastActivity || now);
    const lastActivity = Number(session.lastActivity || startedAt || 0);
    const state = session.state || ((now - lastActivity < 90000) ? "active" : "idle");
    const model = session.model || "unknown";
    const contextTokens = Number(session.contextTokens || tokensIn + cacheRead);
    const ctxUsedPct = (typeof session.ctxUsedPct === "number")
        ? session.ctxUsedPct
        : awCtxPct(model, contextTokens);
    const agent = session.agent || "unknown";
    const id = session.id || session.sessionId || agent;
    return Object.assign({}, session, {
        id,
        sessionId: session.sessionId || id,
        shortId: awShortId(id),
        agent,
        model,
        projectName: session.projectName || awProjectName(session.cwd),
        cwd: session.cwd || "",
        tokensIn,
        tokensOut,
        cacheRead,
        cacheCreate,
        totalTokens: tokensIn + tokensOut + cacheRead + cacheCreate,
        contextTokens,
        costUsd: Number(session.costUsd || awCalcCost(model, tokensIn + cacheRead + cacheCreate, tokensOut)),
        ctxUsedPct,
        state,
        startedAt,
        lastActivity,
        elapsedMs: Math.max(0, now - startedAt),
        turns: Number(session.turns || 0),
        currentTask: session.currentTask || (state === "active" ? "working" : "waiting")
    });
}

function awUpsertSession(key, session) {
    const normalized = awNormalizeSession(session);
    awSessions[key] = normalized;
    awDailyHistory[awDailyHistory.length - 1] = Object.values(awSessions)
        .reduce((sum, s) => sum + (s.totalTokens || 0), 0);
}

function awWalkFiles(root, predicate, maxFiles = 80) {
    const out = [];
    const stack = [root];
    while (stack.length && out.length < maxFiles) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch(_) {
            continue;
        }
        for (const entry of entries) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(p);
            } else if (!predicate || predicate(p, entry)) {
                out.push(p);
                if (out.length >= maxFiles) break;
            }
        }
    }
    return out;
}

function awRecentFiles(files, limit = 24) {
    return files.map(file => {
        try {
            return { file, mtime: fs.statSync(file).mtimeMs };
        } catch(_) {
            return { file, mtime: 0 };
        }
    }).sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(x => x.file);
}

function awBuildPayload() {
    const sessions = Object.values(awSessions);
    const dailyCostUsd = sessions.reduce((s, x) => s + (x.costUsd || 0), 0);
    const totalTokens = sessions.reduce((s, x) => s + (x.tokensIn || 0) + (x.tokensOut || 0), 0);
    return { sessions, dailyCostUsd, totalTokens, dailyHistory: awDailyHistory };
}

function awBroadcast() {
    if (win && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('agentwatch-update', awBuildPayload());
    }
}

// --- Claude Code parser ---
function awParseClaudeLog(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
        let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheCreate = 0, model = 'claude-sonnet-4-6', lastActivity = 0, startedAt = 0, turns = 0, currentTask = "", sessionId = path.basename(filePath, ".jsonl");
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.usage) {
                    tokensIn += entry.usage.input_tokens || 0;
                    tokensOut += entry.usage.output_tokens || 0;
                    cacheRead += entry.usage.cache_read_input_tokens || 0;
                    cacheCreate += entry.usage.cache_creation_input_tokens || 0;
                    turns++;
                }
                if (entry.model) model = entry.model;
                if (entry.sessionId) sessionId = entry.sessionId;
                if (entry.cwd) currentTask = entry.cwd;
                if (entry.timestamp) {
                    const ts = new Date(entry.timestamp).getTime();
                    if (!startedAt || ts < startedAt) startedAt = ts;
                    lastActivity = Math.max(lastActivity, ts);
                }
            } catch(_) {}
        }
        return { agent: 'claude', sessionId, model, tokensIn, tokensOut, cacheRead, cacheCreate,
            contextTokens: tokensIn + cacheRead,
            state: (Date.now() - lastActivity < 60000) ? 'active' : 'idle',
            startedAt, lastActivity, turns, currentTask, cwd: currentTask };
    } catch(_) { return null; }
}

function awWatchClaude() {
    if (!fs.existsSync(AGENT_PATHS.claudeRoot)) return;
    function scanAll() {
        const roots = [AGENT_PATHS.claudeRoot];
        try {
            fs.readdirSync(HOME, { withFileTypes: true })
                .filter(d => d.isDirectory() && d.name.startsWith(".claude-"))
                .forEach(d => roots.push(path.join(HOME, d.name)));
        } catch(_) {}
        const seen = new Set();
        try {
            roots.forEach(root => {
                const projectsDir = path.join(root, "projects");
                if (!fs.existsSync(projectsDir)) return;
                const files = awRecentFiles(awWalkFiles(projectsDir, file => file.endsWith(".jsonl"), 140), 8);
                files.forEach(file => {
                    const s = awParseClaudeLog(file);
                    if (s) {
                        const key = "claude:" + (s.sessionId || file);
                        seen.add(key);
                        awUpsertSession(key, Object.assign(s, { configRoot: root }));
                    }
                });
            });
        } catch(_) {}
        awBroadcast();
    }
    scanAll();
    try {
        fs.watch(AGENT_PATHS.claudeRoot, { recursive: true }, (evt, filename) => {
            if (filename && filename.endsWith('.jsonl')) setTimeout(scanAll, 300);
        });
    } catch(_) {}
}

// --- Antigravity CLI parser ---
function awParseAntigravity() {
    const brainDir = AGENT_PATHS.antigravity;
    try {
        let tokensIn = 0, tokensOut = 0, model = 'gemini-2.5-flash', lastActivity = 0;
        const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
        for (const convId of dirs) {
            const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
            if (!fs.existsSync(logPath)) continue;
            try {
                const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.usage_metadata) {
                            tokensIn += entry.usage_metadata.prompt_token_count || 0;
                            tokensOut += entry.usage_metadata.candidates_token_count || 0;
                        }
                        if (entry.model) model = entry.model;
                        if (entry.timestamp) lastActivity = Math.max(lastActivity, new Date(entry.timestamp).getTime());
                    } catch(_) {}
                }
            } catch(_) {}
        }
        return { agent: 'antigravity', model, tokensIn, tokensOut,
            contextTokens: tokensIn,
            state: (Date.now() - lastActivity < 120000) ? 'active' : 'idle',
            lastActivity };
    } catch(_) { return null; }
}

function awWatchAntigravity() {
    if (!fs.existsSync(AGENT_PATHS.antigravity)) return;
    const scan = () => {
        const s = awParseAntigravity();
        if (s) { awUpsertSession('antigravity', s); awBroadcast(); }
    };
    scan();
    try {
        fs.watch(AGENT_PATHS.antigravity, { recursive: true }, (evt, filename) => {
            if (filename && filename.includes('transcript')) setTimeout(scan, 500);
        });
    } catch(_) {}
}

// --- OpenCode parser ---
function awParseOpenCode() {
    const dir = AGENT_PATHS.opencode;
    try {
        let tokensIn = 0, tokensOut = 0, model = 'gpt-4o', lastActivity = 0;
        fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).forEach(file => {
            try {
                const lines = fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n').filter(Boolean);
                lines.forEach(line => {
                    try {
                        const e = JSON.parse(line);
                        if (e.usage) { tokensIn += e.usage.prompt_tokens || 0; tokensOut += e.usage.completion_tokens || 0; }
                        if (e.model) model = e.model;
                        if (e.time) lastActivity = Math.max(lastActivity, new Date(e.time).getTime());
                    } catch(_) {}
                });
            } catch(_) {}
        });
        return { agent: 'opencode', model, tokensIn, tokensOut,
            contextTokens: tokensIn,
            state: (Date.now() - lastActivity < 60000) ? 'active' : 'idle',
            lastActivity };
    } catch(_) { return null; }
}

function awParseOpenCodeDb() {
    if (!fs.existsSync(AGENT_PATHS.opencodeDb)) return null;
    try {
        const childProcess = require("child_process");
        const sql = "select id, directory, title, provider, model, time_created, time_updated, total_input, total_output, total_cache_read, total_cache_write, version from session order by time_updated desc limit 8;";
        const out = childProcess.execFileSync("sqlite3", ["-readonly", "-json", AGENT_PATHS.opencodeDb, sql], { encoding: "utf-8", timeout: 2500 });
        return JSON.parse(out).map(row => ({
            agent: "opencode",
            sessionId: row.id,
            cwd: row.directory,
            projectName: awProjectName(row.directory),
            currentTask: row.title || "session",
            model: row.provider && row.model ? `${row.provider}/${row.model}` : (row.model || "opencode"),
            tokensIn: Number(row.total_input || 0),
            tokensOut: Number(row.total_output || 0),
            cacheRead: Number(row.total_cache_read || 0),
            cacheCreate: Number(row.total_cache_write || 0),
            startedAt: Number(row.time_created || 0),
            lastActivity: Number(row.time_updated || 0),
            state: (Date.now() - Number(row.time_updated || 0) < 120000) ? "active" : "idle",
            version: row.version || ""
        }));
    } catch(_) {
        return null;
    }
}

function awWatchOpenCode() {
    if (!fs.existsSync(AGENT_PATHS.opencode) && !fs.existsSync(AGENT_PATHS.opencodeDb)) return;
    const scan = () => {
        const dbSessions = awParseOpenCodeDb();
        if (dbSessions && dbSessions.length) {
            dbSessions.forEach(s => awUpsertSession("opencode:" + s.sessionId, s));
        } else {
            const s = awParseOpenCode();
            if (s) awUpsertSession('opencode', s);
        }
        awBroadcast();
    };
    scan();
    try { fs.watch(AGENT_PATHS.opencode, { recursive: true }, () => setTimeout(scan, 300)); } catch(_) {}
}

// --- Codex CLI parser ---
function awParseCodex() {
    const dir = path.join(AGENT_PATHS.codex, "sessions");
    try {
        const sessions = [];
        const files = awRecentFiles(awWalkFiles(dir, file => /rollout-.*\.jsonl$/i.test(path.basename(file)), 160), 10);
        files.forEach(filePath => {
            let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheCreate = 0, model = 'gpt-4o', lastActivity = 0, startedAt = 0, turns = 0, effort = "", cwd = "", sessionId = path.basename(filePath, ".jsonl"), currentTask = "session";
            try {
                const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
                lines.forEach(line => {
                    try {
                        const e = JSON.parse(line);
                        if (e.type === "session_meta") {
                            sessionId = e.session_id || e.id || sessionId;
                            cwd = e.cwd || cwd;
                            startedAt = e.timestamp ? new Date(e.timestamp).getTime() : startedAt;
                        }
                        if (e.type === "turn_context") {
                            model = e.model || model;
                            effort = e.effort || effort;
                            cwd = e.cwd || cwd;
                        }
                        const msg = e.msg || e.event || e;
                        if (msg.type === "token_count" || e.type === "token_count") {
                            const usage = msg.info || msg.usage || e.usage || {};
                            tokensIn = usage.total_token_usage?.input_tokens || usage.input_tokens || usage.prompt_tokens || tokensIn;
                            tokensOut = usage.total_token_usage?.output_tokens || usage.output_tokens || usage.completion_tokens || tokensOut;
                            cacheRead = usage.total_token_usage?.cached_input_tokens || usage.cache_read_input_tokens || cacheRead;
                            turns++;
                        }
                        if (e.usage) {
                            tokensIn += e.usage.input_tokens || e.usage.prompt_tokens || 0;
                            tokensOut += e.usage.output_tokens || e.usage.completion_tokens || 0;
                            cacheRead += e.usage.cached_input_tokens || e.usage.cache_read_input_tokens || 0;
                            turns++;
                        }
                        if (e.model) model = e.model;
                        if (msg.type === "agent_message" || e.type === "agent_message") currentTask = "responding";
                        if (e.created_at || e.timestamp || msg.timestamp) {
                            const ts = new Date(e.created_at || e.timestamp || msg.timestamp).getTime();
                            if (!startedAt || ts < startedAt) startedAt = ts;
                            lastActivity = Math.max(lastActivity, ts);
                        }
                    } catch(_) {}
                });
                sessions.push({ agent: 'codex', sessionId, model, effort, cwd, projectName: awProjectName(cwd),
                    tokensIn, tokensOut, cacheRead, cacheCreate, contextTokens: tokensIn + cacheRead,
                    state: (Date.now() - lastActivity < 60000) ? 'active' : 'idle',
                    startedAt, lastActivity, turns, currentTask });
            } catch(_) {}
        });
        return sessions;
    } catch(_) { return null; }
}

function awWatchCodex() {
    if (!fs.existsSync(AGENT_PATHS.codex)) return;
    const scan = () => {
        const sessions = awParseCodex();
        if (sessions && sessions.length) sessions.forEach(s => awUpsertSession("codex:" + s.sessionId, s));
        awBroadcast();
    };
    scan();
    try { fs.watch(AGENT_PATHS.codex, { recursive: true }, () => setTimeout(scan, 300)); } catch(_) {}
}

function createWindow(settings) {
    signale.info("Creating window...");

    let display;
    if (!isNaN(settings.monitor)) {
        display = electron.screen.getAllDisplays()[settings.monitor] || electron.screen.getPrimaryDisplay();
    } else {
        display = electron.screen.getPrimaryDisplay();
    }
    let {x, y, width: displayWidth, height: displayHeight} = display.bounds;

    let winWidth, winHeight, winX, winY;
    if (settings.forceFullscreen) {
        winWidth = displayWidth + 1;
        winHeight = displayHeight + 1;
        winX = x;
        winY = y;
    } else if (settings.allowWindowed) {
        winWidth = Number(settings.windowWidth) || 1280;
        winHeight = Number(settings.windowHeight) || 720;
        if (winWidth > displayWidth) winWidth = displayWidth;
        if (winHeight > displayHeight) winHeight = displayHeight;
        winX = x + Math.floor((displayWidth - winWidth) / 2);
        winY = y + Math.floor((displayHeight - winHeight) / 2);
    } else {
        winWidth = displayWidth + 1;
        winHeight = displayHeight + 1;
        winX = x;
        winY = y;
    }

    win = new BrowserWindow({
        title: "SynDEX",
        x: winX,
        y: winY,
        width: winWidth,
        height: winHeight,
        show: false,
        resizable: true,
        movable: settings.allowWindowed || false,
        fullscreen: settings.forceFullscreen || false,
        autoHideMenuBar: true,
        frame: settings.allowWindowed || false,
        backgroundColor: '#000000',
        webPreferences: {
            devTools: true,
	    	enableRemoteModule: true,
            contextIsolation: false,
            backgroundThrottling: false,
            webSecurity: true,
            nodeIntegration: true,
            nodeIntegrationInSubFrames: false,
            allowRunningInsecureContent: false,
            experimentalFeatures: settings.experimentalFeatures || false
        }
    });

    enable(win.webContents);

    win.loadURL(url.format({
        pathname: path.join(__dirname, 'ui.html'),
        protocol: 'file:',
        slashes: true
    }));

    signale.complete("Frontend window created!");
    win.show();
    if (settings.openDevTools) {
        try {
            win.webContents.openDevTools({ mode: 'detach' });
            signale.info('Browser devtools opened (detach mode)');
        } catch (e) {
            signale.warn('Could not open devtools:', e.message || e);
        }
    }
    if (!settings.allowWindowed) {
        win.setResizable(false);
    } else if (!require(lastWindowStateFile)["useFullscreen"]) {
        win.setFullScreen(false);
    }

    signale.watch("Waiting for frontend connection...");
}

app.on('ready', async () => {
    signale.pending(`Loading settings file...`);
    let settings = require(settingsFile);
    // CLI overrides: allow starting windowed with `--windowed` or `-w`
    const cliArgs = process.argv.slice(2);
    if (cliArgs.includes('--windowed') || cliArgs.includes('-w')) {
        signale.info('CLI: --windowed detected; launching windowed');
        settings.forceFullscreen = false;
        settings.allowWindowed = true;
    }
    if (cliArgs.includes('--devtools') || cliArgs.includes('-d')) {
        signale.info('CLI: --devtools detected; opening browser devtools');
        settings.openDevTools = true;
    }
    // Create the window immediately so the user sees something straight away.
    // Shell resolution and shell-env can hang (especially for WindowsApps pwsh)
    // so we decouple them from the window creation entirely.
    signale.pending("Starting multithreaded calls controller...");
    require("./_multithread.js");
    createWindow(settings);

    // Start AgentWatch watchers
    awWatchClaude();
    awWatchAntigravity();
    awWatchOpenCode();
    awWatchCodex();
    // Re-broadcast every 30s to update idle/active state even with no file changes
    setInterval(awBroadcast, 30000);

    signale.pending(`Resolving shell path...`);

    // On Windows, try to find the best available shell.
    // The WindowsApps execution alias for pwsh.exe is NOT on PATH, so which() will
    // fail for it. We try the known absolute path first, then fall back gracefully.
    if (process.platform === "win32") {
        try {
            const helper = require("./classes/terminalSettingsHelper");
            const wtShell = helper.getShell();
            if (wtShell) {
                settings.shell = wtShell;
                signale.info(`Shell resolved via Windows Terminal helper: ${settings.shell}`);
            }
        } catch (err) {
            signale.warn(`Failed to resolve shell from Windows Terminal profile: ${err.message}`);
        }
    }

    // which() resolves the absolute path — but if the shell IS already an absolute
    // path (e.g. from WindowsApps) and exists on disk, skip which() for it.
    const fsCheck = require("fs");
    const isAbsoluteExisting = path.isAbsolute(settings.shell) &&
        (() => { try { return fsCheck.readdirSync(path.dirname(settings.shell)).some(f => f.toLowerCase() === path.basename(settings.shell).toLowerCase()); } catch(e) { return false; } })();

    if (isAbsoluteExisting) {
        signale.info(`Shell found at ${settings.shell} (absolute path, skipped which)`);
    } else {
        settings.shell = await which(settings.shell).catch(e => {
            signale.warn(`which() failed for ${settings.shell}: ${e.message}. Falling back to powershell.exe`);
            return which("powershell.exe").catch(() => "powershell.exe");
        });
        signale.info(`Shell found at ${settings.shell}`);
    }
    signale.success(`Settings loaded!`);

    if (!require("fs").existsSync(settings.cwd)) throw new Error("Configured cwd path does not exist.");

    // See #366
    let shellEnvMod = require("shell-env");
    let cleanEnv = await (
        typeof shellEnvMod === "function" 
            ? shellEnvMod(settings.shell) 
            : (shellEnvMod.shellEnv ? shellEnvMod.shellEnv(settings.shell) : Promise.reject(new Error("shellEnv method not found in shell-env module")))
    ).catch(e => {
        signale.warn(`shell-env failed: ${e.message}. Using process.env as fallback.`);
        return Object.assign({}, process.env);
    });

    Object.assign(cleanEnv, {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "SynDEX",
        TERM_PROGRAM_VERSION: app.getVersion()
    }, settings.env);

    signale.pending(`Creating new terminal process on port ${settings.port || '3000'}`);
    tty = new Terminal({
        role: "server",
        shell: settings.shell,
        params: settings.shellArgs || '',
        cwd: settings.cwd,
        env: cleanEnv,
        port: settings.port || 3000
    });
    signale.success(`Terminal back-end initialized!`);
    tty.onclosed = (code, signal) => {
        tty.ondisconnected = () => {};
        signale.complete("Terminal exited", code, signal);
        app.quit();
    };
    tty.onopened = () => {
        signale.success("Connected to frontend!");
        signale.timeEnd("Startup");
    };
    tty.onresized = (cols, rows) => {
        signale.info("Resized TTY to ", cols, rows);
    };
    tty.ondisconnected = () => {
        signale.error("Lost connection to frontend");
        signale.watch("Waiting for frontend connection...");
    };

    // Support for more terminals, used for creating tabs (currently limited to 4 extra terms)
    extraTtys = {};
    let basePort = settings.port || 3000;
    basePort = Number(basePort) + 2;

    for (let i = 0; i < 4; i++) {
        extraTtys[basePort+i] = null;
    }

    ipc.on("ttyspawn", (e, arg) => {
        let port = null;
        Object.keys(extraTtys).forEach(key => {
            if (extraTtys[key] === null && port === null) {
                extraTtys[key] = {};
                port = key;
            }
        });

        if (port === null) {
            signale.error("TTY spawn denied (Reason: exceeded max TTYs number)");
            e.sender.send("ttyspawn-reply", "ERROR: max number of ttys reached");
        } else {
            signale.pending(`Creating new TTY process on port ${port}`);
            let term = new Terminal({
                role: "server",
                shell: settings.shell,
                params: settings.shellArgs || '',
                cwd: tty.tty._cwd || settings.cwd,
                env: cleanEnv,
                port: port
            });
            signale.success(`New terminal back-end initialized at ${port}`);
            term.onclosed = (code, signal) => {
                term.ondisconnected = () => {};
                term.wss.close();
                signale.complete(`TTY exited at ${port}`, code, signal);
                extraTtys[term.port] = null;
                term = null;
            };
            term.onopened = pid => {
                signale.success(`TTY ${port} connected to frontend (process PID ${pid})`);
            };
            term.onresized = () => {};
            term.ondisconnected = () => {
                term.onclosed = () => {};
                term.close();
                term.wss.close();
                extraTtys[term.port] = null;
                term = null;
            };

            extraTtys[port] = term;
            e.sender.send("ttyspawn-reply", "SUCCESS: "+port);
        }
    });

    // Backend support for theme and keyboard hotswitch
    let themeOverride = null;
    let kbOverride = null;
    ipc.on("getThemeOverride", (e, arg) => {
        e.sender.send("getThemeOverride", themeOverride);
    });
    ipc.on("getKbOverride", (e, arg) => {
        e.sender.send("getKbOverride", kbOverride);
    });
    ipc.on("setThemeOverride", (e, arg) => {
        themeOverride = arg;
    });
    ipc.on("setKbOverride", (e, arg) => {
        kbOverride = arg;
    });

    // Battery-aware power state broadcaster
    const { powerMonitor } = require('electron');
    const _sendPowerState = () => {
        if (win && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('power-state-change', { onBattery: powerMonitor.onBatteryPower });
        }
    };
    powerMonitor.on('on-battery', _sendPowerState);
    powerMonitor.on('on-ac', _sendPowerState);
    // Send initial state once app and window are ready (delay ensures renderer is loaded)
    setTimeout(_sendPowerState, 4000);
});

app.on('web-contents-created', (e, contents) => {
    // Prevent creating more than one window
    contents.on('new-window', (e, url) => {
        e.preventDefault();
        shell.openExternal(url);
    });

    // Prevent loading something else than the UI
    contents.on('will-navigate', (e, url) => {
        if (url !== contents.getURL()) e.preventDefault();
    });
});

app.on('window-all-closed', () => {
    signale.info("All windows closed");
    app.quit();
});

app.on('before-quit', () => {
    tty.close();
    Object.keys(extraTtys).forEach(key => {
        if (extraTtys[key] !== null) {
            extraTtys[key].close();
        }
    });
    signale.complete("Shutting down...");
});
