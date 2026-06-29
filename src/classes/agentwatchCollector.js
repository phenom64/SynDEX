const fs = require("fs");
const path = require("path");
const os = require("os");
const childProcess = require("child_process");

const HOME = os.homedir();

const AGENT_PATHS = {
    claudeRoot: path.join(HOME, ".claude"),
    antigravity: path.join(HOME, ".gemini", "antigravity-cli", "brain"),
    opencode: path.join(HOME, ".config", "opencode"),
    codex: path.join(HOME, ".codex")
};

const AW_CTX_WINDOWS = {
    "claude-opus-4": 200000,
    "claude-opus-4-6": 200000,
    "claude-opus-4-8": 200000,
    "claude-sonnet-4-5": 200000,
    "claude-sonnet-4-6": 200000,
    "claude-haiku-3-5": 200000,
    "claude-haiku-4-5": 200000,
    "gpt-4o": 128000,
    "gpt-4.1": 1000000,
    "o3": 200000,
    "gemini-2.5-flash": 1048576,
    "gemini-2.5-pro": 1048576
};

const AW_MODEL_COSTS = {
    "claude-opus-4": [15.0, 75.0],
    "claude-opus-4-6": [15.0, 75.0],
    "claude-opus-4-8": [15.0, 75.0],
    "claude-sonnet-4-5": [3.0, 15.0],
    "claude-sonnet-4-6": [3.0, 15.0],
    "claude-haiku-3-5": [0.8, 4.0],
    "gpt-4o": [5.0, 15.0],
    "gpt-4.1": [2.0, 8.0],
    "gemini-2.5-flash": [0.3, 2.5],
    "gemini-2.5-pro": [1.25, 10.0]
};

let awSessions = {};
let awDailyHistory = new Array(30).fill(0);
let awCodexQuota = null;
let awTokenRateHistory = new Array(24).fill(0);
let awLastTotalTokens = 0;
let awGetWin = null;

function awNow() {
    return Date.now();
}

function awResolveCtxWindow(model) {
    if (!model) return null;
    const raw = String(model).replace(/\[.*\]/, "").split("/").pop();
    if (AW_CTX_WINDOWS[raw]) return AW_CTX_WINDOWS[raw];
    if (/opus-4|sonnet-4|haiku-4/i.test(raw)) return 200000;
    if (/1m/i.test(raw)) return 1000000;
    if (/flash|pro/i.test(raw)) return 1048576;
    return 200000;
}

function awCalcCost(model, tokensIn, tokensOut) {
    const key = String(model || "").replace(/\[.*\]/, "").split("/").pop();
    const costs = AW_MODEL_COSTS[key];
    if (!costs) return 0;
    return (tokensIn / 1e6) * costs[0] + (tokensOut / 1e6) * costs[1];
}

function awCtxPct(model, contextTokens) {
    const ctx = awResolveCtxWindow(model);
    if (!ctx || !contextTokens) return null;
    return Math.min(100, Math.round((contextTokens / ctx) * 100));
}

function awProjectName(cwd) {
    if (!cwd || typeof cwd !== "string") return "UNKNOWN";
    return path.basename(cwd.replace(/[\\\/]+$/, "")) || cwd;
}

function awShortId(value) {
    if (!value) return "";
    return String(value).slice(0, 8);
}

function awOpenCodeDbPaths() {
    const candidates = [
        path.join(HOME, ".local", "share", "opencode", "opencode.db"),
        path.join(process.env.LOCALAPPDATA || "", "opencode", "opencode.db"),
        path.join(process.env.APPDATA || "", "opencode", "opencode.db")
    ].filter(Boolean);
    return candidates.filter(p => fs.existsSync(p));
}

function awSqliteJson(dbPath, sql) {
    try {
        const out = childProcess.execFileSync("sqlite3", ["-readonly", "-json", dbPath, sql], {
            encoding: "utf-8",
            timeout: 2500,
            stdio: ["ignore", "pipe", "pipe"]
        });
        if (!out || !out.trim()) return null;
        return JSON.parse(out);
    } catch (_) {
        return null;
    }
}

function awSqliteColumns(dbPath, table) {
    const rows = awSqliteJson(dbPath, `PRAGMA table_info(${table});`);
    if (!rows) return [];
    return rows.map(r => r.name);
}

function awParseOpenCodeModel(row) {
    let model = row.model || "opencode";
    let provider = row.agent || "";
    try {
        if (typeof model === "string" && model.charAt(0) === "{") {
            const parsed = JSON.parse(model);
            provider = parsed.providerID || provider;
            model = parsed.id || parsed.variant || model;
        }
    } catch (_) {}
    return provider && model ? `${provider}/${model}` : String(model);
}

function awNormalizeSession(session) {
    const now = awNow();
    const tokensIn = Number(session.tokensIn || 0);
    const tokensOut = Number(session.tokensOut || 0);
    const cacheRead = Number(session.cacheRead || 0);
    const cacheCreate = Number(session.cacheCreate || 0);
    const startedAt = Number(session.startedAt || session.lastActivity || now);
    const lastActivity = Number(session.lastActivity || startedAt || 0);
    const ageMs = now - lastActivity;
    const state = session.state || (ageMs < 90000 ? "active" : "idle");
    const model = session.model || "unknown";
    const contextTokens = Number(session.contextTokens || tokensIn + cacheRead);
    const ctxUsedPct = typeof session.ctxUsedPct === "number"
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
        costUsd: Number(session.costUsd != null ? session.costUsd : awCalcCost(model, tokensIn + cacheRead + cacheCreate, tokensOut)),
        ctxUsedPct,
        state,
        status: session.status || (state === "active" ? "working" : "waiting"),
        startedAt,
        lastActivity,
        elapsedMs: Math.max(0, now - startedAt),
        turns: Number(session.turns || 0),
        currentTask: session.currentTask || (state === "active" ? "working" : "waiting"),
        gitBranch: session.gitBranch || "",
        pid: session.pid || null,
        ports: session.ports || []
    });
}

function awUpsertSession(key, session) {
    awSessions[key] = awNormalizeSession(session);
    const total = Object.values(awSessions).reduce((sum, s) => sum + (s.totalTokens || 0), 0);
    const delta = Math.max(0, total - awLastTotalTokens);
    awLastTotalTokens = total;
    awTokenRateHistory.push(delta);
    if (awTokenRateHistory.length > 24) awTokenRateHistory.shift();
    awDailyHistory[awDailyHistory.length - 1] = total;
}

function awWalkFiles(root, predicate, maxFiles) {
    maxFiles = maxFiles || 80;
    const out = [];
    const stack = [root];
    while (stack.length && out.length < maxFiles) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
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

function awRecentFiles(files, limit) {
    limit = limit || 24;
    return files.map(file => {
        try {
            return { file, mtime: fs.statSync(file).mtimeMs };
        } catch (_) {
            return { file, mtime: 0 };
        }
    }).sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(x => x.file);
}

function awClaudeConfigRoots() {
    const roots = [AGENT_PATHS.claudeRoot];
    try {
        fs.readdirSync(HOME, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.indexOf(".claude-") === 0)
            .forEach(d => roots.push(path.join(HOME, d.name)));
    } catch (_) {}
    return roots.filter(r => fs.existsSync(path.join(r, "projects")));
}

function awExtractClaudeTask(msg) {
    const content = (msg && msg.content) || [];
    if (!Array.isArray(content)) return "";
    for (let i = content.length - 1; i >= 0; i--) {
        const c = content[i];
        if (c.type === "tool_use") {
            const arg = c.input && (c.input.file_path || c.input.command || c.input.pattern || c.input.query || "");
            return (c.name || "tool") + (arg ? " " + String(arg).slice(0, 48) : "");
        }
    }
    return "";
}

function awParseClaudeLog(filePath) {
    try {
        const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
        let tokensIn = 0;
        let tokensOut = 0;
        let cacheRead = 0;
        let cacheCreate = 0;
        let model = "claude-sonnet-4-6";
        let lastActivity = 0;
        let startedAt = 0;
        let turns = 0;
        let currentTask = "";
        let sessionId = path.basename(filePath, ".jsonl");
        let cwd = "";
        let gitBranch = "";
        let lastCtxTokens = 0;
        let version = "";

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const msg = entry.message || {};
                const usage = entry.usage || msg.usage;
                const isAssistant = entry.type === "assistant" || (msg.role === "assistant" && usage);

                if (isAssistant && usage) {
                    tokensIn += usage.input_tokens || 0;
                    tokensOut += usage.output_tokens || 0;
                    cacheRead += usage.cache_read_input_tokens || 0;
                    cacheCreate += usage.cache_creation_input_tokens || 0;
                    turns++;
                    lastCtxTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
                    if (msg.model) model = msg.model;
                    const task = awExtractClaudeTask(msg);
                    if (task) currentTask = task;
                }

                if (entry.model) model = entry.model;
                if (entry.sessionId) sessionId = entry.sessionId;
                if (entry.cwd) cwd = entry.cwd;
                if (entry.gitBranch) gitBranch = entry.gitBranch;
                if (entry.version) version = entry.version;
                if (entry.timestamp) {
                    const ts = new Date(entry.timestamp).getTime();
                    if (!startedAt || ts < startedAt) startedAt = ts;
                    lastActivity = Math.max(lastActivity, ts);
                }
            } catch (_) {}
        }

        if (!cwd) {
            const parts = filePath.split(path.sep);
            const idx = parts.indexOf("projects");
            if (idx >= 0 && parts[idx + 1]) {
                cwd = parts[idx + 1].replace(/^([A-Za-z])--/, "$1:/").replace(/-/g, path.sep);
            }
        }

        const contextTokens = lastCtxTokens || tokensIn + cacheRead;
        const ageMs = awNow() - lastActivity;
        return {
            agent: "claude",
            sessionId,
            model,
            tokensIn,
            tokensOut,
            cacheRead,
            cacheCreate,
            contextTokens,
            ctxUsedPct: awCtxPct(model, contextTokens),
            cwd,
            gitBranch,
            version,
            state: ageMs < 60000 ? "active" : "idle",
            status: ageMs < 30000 ? "working" : ageMs < 120000 ? "waiting" : "idle",
            startedAt,
            lastActivity,
            turns,
            currentTask: currentTask || gitBranch || awProjectName(cwd)
        };
    } catch (_) {
        return null;
    }
}

function awParseClaudeSessions() {
    const roots = awClaudeConfigRoots();
    const files = [];
    roots.forEach(root => {
        const projectsDir = path.join(root, "projects");
        if (!fs.existsSync(projectsDir)) return;
        files.push.apply(files, awWalkFiles(projectsDir, f => f.endsWith(".jsonl"), 200));
    });
    awRecentFiles(files, 16).forEach(file => {
        const s = awParseClaudeLog(file);
        if (s && (s.tokensIn + s.tokensOut + s.turns > 0 || s.lastActivity > 0)) {
            awUpsertSession("claude:" + (s.sessionId || file), s);
        }
    });
}

function awParseRateLimits() {
    const quotas = { claude: null, codex: null };
    const rlPath = path.join(AGENT_PATHS.claudeRoot, "abtop-rate-limits.json");
    try {
        if (fs.existsSync(rlPath)) {
            const data = JSON.parse(fs.readFileSync(rlPath, "utf-8"));
            const ageSec = awNow() / 1000 - Number(data.updated_at || 0);
            if (ageSec < 86400) {
                quotas.claude = {
                    fiveHour: {
                        usedPct: Number(data.five_hour && data.five_hour.used_percentage != null ? data.five_hour.used_percentage : 0),
                        resetsAt: Number(data.five_hour && data.five_hour.resets_at || 0)
                    },
                    sevenDay: {
                        usedPct: Number(data.seven_day && data.seven_day.used_percentage != null ? data.seven_day.used_percentage : 0),
                        resetsAt: Number(data.seven_day && data.seven_day.resets_at || 0)
                    },
                    updatedAt: Number(data.updated_at || 0),
                    stale: ageSec >= 600
                };
            }
        }
    } catch (_) {}

    if (awCodexQuota) {
        quotas.codex = awCodexQuota;
    }
    return quotas;
}

function awParseOpenCodeDb() {
    const dbPaths = awOpenCodeDbPaths();
    if (!dbPaths.length) return null;

    for (const dbPath of dbPaths) {
        const cols = awSqliteColumns(dbPath, "session");
        if (!cols.length) continue;

        const select = ["id", "directory", "title", "time_created", "time_updated"];
        const map = {
            agent: "agent",
            model: "model",
            cost: "cost",
            tokens_input: "tokensIn",
            tokens_output: "tokensOut",
            tokens_cache_read: "cacheRead",
            tokens_cache_write: "cacheCreate",
            total_input: "tokensIn",
            total_output: "tokensOut",
            total_cache_read: "cacheRead",
            total_cache_write: "cacheCreate"
        };

        Object.keys(map).forEach(col => {
            if (cols.indexOf(col) >= 0 && select.indexOf(col) < 0) select.push(col);
        });

        const sql = `select ${select.join(", ")} from session order by time_updated desc limit 12;`;
        const rows = awSqliteJson(dbPath, sql);
        if (!rows || !rows.length) continue;

        return rows.map(row => ({
            agent: "opencode",
            sessionId: row.id,
            cwd: row.directory,
            projectName: awProjectName(row.directory),
            currentTask: row.title || "session",
            model: awParseOpenCodeModel(row),
            tokensIn: Number(row.tokens_input != null ? row.tokens_input : row.total_input || 0),
            tokensOut: Number(row.tokens_output != null ? row.tokens_output : row.total_output || 0),
            cacheRead: Number(row.tokens_cache_read != null ? row.tokens_cache_read : row.total_cache_read || 0),
            cacheCreate: Number(row.tokens_cache_write != null ? row.tokens_cache_write : row.total_cache_write || 0),
            costUsd: Number(row.cost || 0),
            startedAt: Number(row.time_created || 0),
            lastActivity: Number(row.time_updated || 0),
            state: awNow() - Number(row.time_updated || 0) < 120000 ? "active" : "idle",
            status: awNow() - Number(row.time_updated || 0) < 60000 ? "working" : "waiting"
        }));
    }
    return null;
}

function awParseOpenCodeFiles() {
    const dir = AGENT_PATHS.opencode;
    if (!fs.existsSync(dir)) return null;
    try {
        let tokensIn = 0;
        let tokensOut = 0;
        let model = "gpt-4o";
        let lastActivity = 0;
        fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).forEach(file => {
            try {
                const lines = fs.readFileSync(path.join(dir, file), "utf-8").trim().split("\n").filter(Boolean);
                lines.forEach(line => {
                    try {
                        const e = JSON.parse(line);
                        if (e.usage) {
                            tokensIn += e.usage.prompt_tokens || 0;
                            tokensOut += e.usage.completion_tokens || 0;
                        }
                        if (e.model) model = e.model;
                        if (e.time) lastActivity = Math.max(lastActivity, new Date(e.time).getTime());
                    } catch (_) {}
                });
            } catch (_) {}
        });
        if (!tokensIn && !tokensOut && !lastActivity) return null;
        return {
            agent: "opencode",
            model,
            tokensIn,
            tokensOut,
            contextTokens: tokensIn,
            state: awNow() - lastActivity < 60000 ? "active" : "idle",
            lastActivity
        };
    } catch (_) {
        return null;
    }
}

function awParseCodexFile(filePath) {
    let tokensIn = 0;
    let tokensOut = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let model = "gpt-4o";
    let lastActivity = 0;
    let startedAt = 0;
    let turns = 0;
    let effort = "";
    let cwd = "";
    let sessionId = path.basename(filePath, ".jsonl");
    let currentTask = "session";
    let rateLimits = null;

    try {
        const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
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
                const payload = e.payload || {};
                const msg = e.msg || e.event || e;
                if (msg.type === "token_count" || e.type === "token_count" || payload.type === "token_count") {
                    const usage = msg.info || msg.usage || payload.info || e.usage || {};
                    const total = usage.total_token_usage || usage;
                    tokensIn = total.input_tokens || usage.input_tokens || usage.prompt_tokens || tokensIn;
                    tokensOut = total.output_tokens || usage.output_tokens || usage.completion_tokens || tokensOut;
                    cacheRead = total.cached_input_tokens || usage.cache_read_input_tokens || cacheRead;
                    const rl = usage.rate_limits || payload.rate_limits || msg.rate_limits;
                    if (rl) rateLimits = rl;
                    turns++;
                }
                if (e.usage) {
                    tokensIn += e.usage.input_tokens || e.usage.prompt_tokens || 0;
                    tokensOut += e.usage.output_tokens || e.usage.completion_tokens || 0;
                    cacheRead += e.usage.cached_input_tokens || e.usage.cache_read_input_tokens || 0;
                    turns++;
                }
                if (e.model) model = e.model;
                if (msg.type === "agent_message" || e.type === "agent_message" || payload.type === "agent_message") {
                    currentTask = "responding";
                }
                if (e.created_at || e.timestamp || msg.timestamp) {
                    const ts = new Date(e.created_at || e.timestamp || msg.timestamp).getTime();
                    if (!startedAt || ts < startedAt) startedAt = ts;
                    lastActivity = Math.max(lastActivity, ts);
                }
            } catch (_) {}
        });
    } catch (_) {
        return null;
    }

    if (rateLimits) {
        awCodexQuota = {
            primary: {
                usedPct: Number(rateLimits.primary && rateLimits.primary.used_percent || 0),
                windowMinutes: Number(rateLimits.primary && rateLimits.primary.window_minutes || 300),
                resetsAt: Number(rateLimits.primary && rateLimits.primary.resets_at || 0)
            },
            secondary: {
                usedPct: Number(rateLimits.secondary && rateLimits.secondary.used_percent || 0),
                windowMinutes: Number(rateLimits.secondary && rateLimits.secondary.window_minutes || 10080),
                resetsAt: Number(rateLimits.secondary && rateLimits.secondary.resets_at || 0)
            },
            planType: rateLimits.plan_type || ""
        };
    }

    const contextTokens = tokensIn + cacheRead;
    const ageMs = awNow() - lastActivity;
    return {
        agent: "codex",
        sessionId,
        model,
        effort,
        cwd,
        projectName: awProjectName(cwd),
        tokensIn,
        tokensOut,
        cacheRead,
        cacheCreate,
        contextTokens,
        ctxUsedPct: awCtxPct(model, contextTokens),
        state: ageMs < 60000 ? "active" : "idle",
        status: ageMs < 30000 ? "working" : "waiting",
        startedAt,
        lastActivity,
        turns,
        currentTask
    };
}

function awParseCodex() {
    const dirs = [
        path.join(AGENT_PATHS.codex, "sessions"),
        path.join(AGENT_PATHS.codex, "archived_sessions")
    ].filter(d => fs.existsSync(d));
    if (!dirs.length) return null;

    const files = [];
    dirs.forEach(dir => {
        files.push.apply(files, awWalkFiles(dir, f => /rollout-.*\.jsonl$/i.test(path.basename(f)), 200));
    });
    const sessions = [];
    awRecentFiles(files, 12).forEach(filePath => {
        const s = awParseCodexFile(filePath);
        if (s && (s.tokensIn + s.tokensOut > 0 || s.lastActivity > 0)) sessions.push(s);
    });
    return sessions.length ? sessions : null;
}

function awParseAntigravity() {
    const brainDir = AGENT_PATHS.antigravity;
    if (!fs.existsSync(brainDir)) return null;
    try {
        let tokensIn = 0;
        let tokensOut = 0;
        let model = "gemini-2.5-flash";
        let lastActivity = 0;
        const dirs = fs.readdirSync(brainDir, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
        for (const convId of dirs) {
            const logPath = path.join(brainDir, convId, ".system_generated", "logs", "transcript.jsonl");
            if (!fs.existsSync(logPath)) continue;
            try {
                const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.usage_metadata) {
                            tokensIn += entry.usage_metadata.prompt_token_count || 0;
                            tokensOut += entry.usage_metadata.candidates_token_count || 0;
                        }
                        if (entry.model) model = entry.model;
                        if (entry.timestamp) lastActivity = Math.max(lastActivity, new Date(entry.timestamp).getTime());
                    } catch (_) {}
                }
            } catch (_) {}
        }
        if (!tokensIn && !tokensOut && !lastActivity) return null;
        return {
            agent: "antigravity",
            model,
            tokensIn,
            tokensOut,
            contextTokens: tokensIn,
            state: awNow() - lastActivity < 120000 ? "active" : "idle",
            lastActivity
        };
    } catch (_) {
        return null;
    }
}

function awScanListeningPorts() {
    const ports = [];
    try {
        if (process.platform === "win32") {
            const out = childProcess.execSync("netstat -ano -p tcp", { encoding: "utf-8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
            out.split("\n").forEach(line => {
                const m = line.match(/TCP\s+[^\s]+\:(\d+)\s+[^\s]+\:\S+\s+LISTENING\s+(\d+)/i);
                if (m) {
                    ports.push({ port: Number(m[1]), pid: Number(m[2]), command: "", orphan: false });
                }
            });
        } else {
            const out = childProcess.execSync("lsof -iTCP -sTCP:LISTEN -n -P", { encoding: "utf-8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
            out.split("\n").slice(1).forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 9) return;
                const name = parts[0];
                const pid = Number(parts[1]);
                const addr = parts[8] || "";
                const pm = addr.match(/:(\d+)$/);
                if (pm) ports.push({ port: Number(pm[1]), pid, command: name, orphan: false });
            });
        }
    } catch (_) {}
    return ports.slice(0, 8);
}

function awBuildPayload() {
    const sessions = Object.values(awSessions);
    const dailyCostUsd = sessions.reduce((s, x) => s + (x.costUsd || 0), 0);
    const totalTokens = sessions.reduce((s, x) => s + (x.totalTokens || 0), 0);
    const agents = {};
    sessions.forEach(s => {
        agents[s.agent] = (agents[s.agent] || 0) + 1;
    });
    return {
        sessions,
        dailyCostUsd,
        totalTokens,
        dailyHistory: awDailyHistory.slice(),
        tokenRate: awTokenRateHistory.slice(),
        quotas: awParseRateLimits(),
        ports: awScanListeningPorts(),
        agents
    };
}

function awBroadcast() {
    const win = awGetWin && awGetWin();
    if (win && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send("agentwatch-update", awBuildPayload());
    }
}

function awScanAll() {
    awParseClaudeSessions();
    const ag = awParseAntigravity();
    if (ag) awUpsertSession("antigravity", ag);

    const dbSessions = awParseOpenCodeDb();
    if (dbSessions && dbSessions.length) {
        dbSessions.forEach(s => awUpsertSession("opencode:" + s.sessionId, s));
    } else {
        const oc = awParseOpenCodeFiles();
        if (oc) awUpsertSession("opencode", oc);
    }

    const codexSessions = awParseCodex();
    if (codexSessions && codexSessions.length) {
        codexSessions.forEach(s => awUpsertSession("codex:" + s.sessionId, s));
    }

    awBroadcast();
}

function awWatchClaude() {
    if (!fs.existsSync(AGENT_PATHS.claudeRoot)) return;
    awParseClaudeSessions();
    awBroadcast();
    try {
        fs.watch(AGENT_PATHS.claudeRoot, { recursive: true }, (evt, filename) => {
            if (filename && filename.endsWith(".jsonl")) setTimeout(awScanAll, 300);
        });
    } catch (_) {}
    const rlPath = path.join(AGENT_PATHS.claudeRoot, "abtop-rate-limits.json");
    if (fs.existsSync(rlPath)) {
        try {
            fs.watch(rlPath, () => setTimeout(awBroadcast, 200));
        } catch (_) {}
    }
}

function awWatchAntigravity() {
    if (!fs.existsSync(AGENT_PATHS.antigravity)) return;
    const scan = () => {
        const s = awParseAntigravity();
        if (s) awUpsertSession("antigravity", s);
        awBroadcast();
    };
    scan();
    try {
        fs.watch(AGENT_PATHS.antigravity, { recursive: true }, (evt, filename) => {
            if (filename && filename.includes("transcript")) setTimeout(scan, 500);
        });
    } catch (_) {}
}

function awWatchOpenCode() {
    const hasDb = awOpenCodeDbPaths().length > 0;
    if (!fs.existsSync(AGENT_PATHS.opencode) && !hasDb) return;
    const scan = () => {
        const dbSessions = awParseOpenCodeDb();
        if (dbSessions && dbSessions.length) {
            dbSessions.forEach(s => awUpsertSession("opencode:" + s.sessionId, s));
        } else {
            const s = awParseOpenCodeFiles();
            if (s) awUpsertSession("opencode", s);
        }
        awBroadcast();
    };
    scan();
    try {
        if (fs.existsSync(AGENT_PATHS.opencode)) {
            fs.watch(AGENT_PATHS.opencode, { recursive: true }, () => setTimeout(scan, 300));
        }
    } catch (_) {}
    awOpenCodeDbPaths().forEach(dbPath => {
        try {
            fs.watch(dbPath, () => setTimeout(scan, 300));
        } catch (_) {}
    });
}

function awWatchCodex() {
    if (!fs.existsSync(AGENT_PATHS.codex)) return;
    const scan = () => {
        const sessions = awParseCodex();
        if (sessions && sessions.length) sessions.forEach(s => awUpsertSession("codex:" + s.sessionId, s));
        awBroadcast();
    };
    scan();
    try {
        fs.watch(AGENT_PATHS.codex, { recursive: true }, () => setTimeout(scan, 300));
    } catch (_) {}
}

function initAgentWatch(getWin) {
    awGetWin = getWin;
    awScanAll();
    awWatchClaude();
    awWatchAntigravity();
    awWatchOpenCode();
    awWatchCodex();
    setInterval(awScanAll, 15000);
    setInterval(awBroadcast, 30000);
}

module.exports = { initAgentWatch, awBuildPayload, awScanAll };