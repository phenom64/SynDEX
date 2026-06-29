class AgentWatch {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        const container = document.createElement("div");
        container.id = "mod_agentwatch";
        container.innerHTML = `
            <div id="mod_agentwatch_inner">
                <button id="agent_watch_slot" title="Move Agent Watch panel" aria-label="Move Agent Watch panel">↘</button>
                <div id="aw_stats_grid">
                    <div><h2>ACTIVE</h2><strong id="aw_active">0</strong></div>
                    <div><h2>TOKENS</h2><strong id="aw_tokens">0</strong></div>
                    <div><h2>COST</h2><strong id="aw_cost">$0.00</strong></div>
                    <div><h2>CTX AVG</h2><strong id="aw_ctx_avg">--</strong></div>
                </div>
                <div id="aw_sparkline" title="30-day token activity"></div>
                <div id="aw_sessions"></div>
                <div class="aw-empty" id="aw_empty">NO AGENT SESSIONS DETECTED</div>
                <div class="aw-footer">
                    <span id="aw_tier">TYPE 0: DIGITAL WANDERER</span>
                    <span id="aw_updated">LOCAL</span>
                </div>
            </div>`;
        this.parent.appendChild(container);

        this._sessions = container.querySelector("#aw_sessions");
        this._sparkline = container.querySelector("#aw_sparkline");
        this._cost = container.querySelector("#aw_cost");
        this._tokens = container.querySelector("#aw_tokens");
        this._active = container.querySelector("#aw_active");
        this._ctxAvg = container.querySelector("#aw_ctx_avg");
        this._tier = container.querySelector("#aw_tier");
        this._updated = container.querySelector("#aw_updated");
        this._empty = container.querySelector("#aw_empty");
        this._slotButton = container.querySelector("#agent_watch_slot");

        this._data = { sessions: [], dailyCostUsd: 0, totalTokens: 0, dailyHistory: new Array(30).fill(0) };
        this._slotButton.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            if (window.panelMgr && typeof window.panelMgr.cycleAgentWatchSlot === "function") {
                window.panelMgr.cycleAgentWatchSlot();
            }
        });

        const ipc = require("electron").ipcRenderer;
        ipc.on("agentwatch-update", (e, payload) => {
            this._data = payload;
            this._render();
        });
        this._render();
    }

    _render() {
        const { sessions, dailyCostUsd, totalTokens, dailyHistory } = this._data;
        const sortedSessions = (sessions || []).slice()
            .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
            .slice(0, 5);
        const activeCount = sortedSessions.filter(s => s.state === "active").length;
        const AGENT_LABELS = { claude: "CLAUDE", antigravity: "ANTIGRAVITY", opencode: "OPENCODE", codex: "CODEX" };

        this._sessions.innerHTML = "";
        sortedSessions.forEach(s => {
            const ctxPct = typeof s.ctxUsedPct === "number" ? s.ctxUsedPct : null;
            const barClass = ctxPct === null ? "" : ctxPct >= 90 ? "danger" : ctxPct >= 65 ? "warn" : "";
            const barWidth = ctxPct !== null ? ctxPct : 0;
            const totalFmt = this._fmtTokens(s.totalTokens || ((s.tokensIn || 0) + (s.tokensOut || 0)));
            const modelShort = this._modelShort(s.model || "");
            const project = this._escape((s.projectName || s.cwd || "UNKNOWN").toString().slice(0, 20));
            const elapsed = this._elapsed(s.elapsedMs);
            const agent = AGENT_LABELS[s.agent] || String(s.agent || "AGENT").toUpperCase();

            const card = document.createElement("div");
            card.className = "aw-card " + (s.state === "active" ? "aw-card-active" : "aw-card-idle");
            card.innerHTML = `
                <div class="aw-card-head">
                    <span class="aw-agent-tag">${agent}</span>
                    <span class="aw-state ${s.state}">${String(s.state || "idle").toUpperCase()}</span>
                </div>
                <div class="aw-card-project">${project}</div>
                <div class="aw-card-row">
                    <span class="aw-card-model">${modelShort}</span>
                    <span class="aw-card-tokens">${totalFmt}</span>
                    <span class="aw-card-time">${elapsed}</span>
                </div>
                <div class="aw-ctx-gauge">
                    <div class="aw-ctx-track"><div class="aw-ctx-fill ${barClass}" style="width:${barWidth}%"></div></div>
                    <span class="aw-ctx-pct">${ctxPct === null ? "--" : ctxPct + "%"}</span>
                </div>`;
            this._sessions.appendChild(card);
        });

        this._renderSparkline(dailyHistory || []);

        const ctxValues = sortedSessions
            .map(s => s.ctxUsedPct)
            .filter(v => typeof v === "number");
        const ctxAvg = ctxValues.length
            ? Math.round(ctxValues.reduce((a, b) => a + b, 0) / ctxValues.length) + "%"
            : "--";

        this._active.textContent = activeCount.toString();
        this._cost.textContent = "$" + dailyCostUsd.toFixed(2);
        this._tokens.textContent = this._fmtTokens(totalTokens);
        this._ctxAvg.textContent = ctxAvg;
        this._empty.style.display = sortedSessions.length ? "none" : "flex";
        this._sessions.style.display = sortedSessions.length ? "flex" : "none";
        this._sparkline.style.display = sortedSessions.length ? "flex" : "none";
        this._tier.textContent = this._kardashevTier(totalTokens);
        this._updated.textContent = new Date().toLocaleTimeString([], { hour12: false });
    }

    _renderSparkline(history) {
        const data = (history || []).slice(-30);
        const max = Math.max.apply(null, data.concat([1]));
        this._sparkline.innerHTML = "";
        data.forEach(val => {
            const bar = document.createElement("i");
            const h = Math.max(8, Math.round((val / max) * 100));
            bar.style.height = h + "%";
            this._sparkline.appendChild(bar);
        });
    }

    _fmtTokens(n) {
        if (!n || n === 0) return "--";
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
        return n.toString();
    }

    _modelShort(model) {
        return String(model || "")
            .replace("claude-", "")
            .replace("openai/", "")
            .replace("gpt-", "")
            .replace("gemini-", "")
            .slice(0, 12) || "--";
    }

    _elapsed(ms) {
        if (!ms) return "--";
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return seconds + "s";
        if (seconds < 3600) return Math.floor(seconds / 60) + "m";
        return Math.floor(seconds / 3600) + "h";
    }

    _escape(text) {
        if (window._escapeHtml) return window._escapeHtml(String(text || ""));
        return String(text || "").replace(/[&<>"']/g, "");
    }

    _kardashevTier(totalTokens) {
        if (totalTokens >= 100e9) return "TYPE III: GALACTIC ARCHITECT";
        if (totalTokens >= 1e9)   return "TYPE II: SYSTEM ENGINEER";
        if (totalTokens >= 100e6) return "TYPE I: PLANETARY CODER";
        if (totalTokens >= 10e6)  return "TYPE 0.5: REGIONAL DEVELOPER";
        if (totalTokens >= 1e6)   return "TYPE 0.2: LOCAL HACKER";
        return "TYPE 0: DIGITAL WANDERER";
    }

    pause() {}
    resume() {}
}

module.exports = { AgentWatch };
window.AgentWatch = AgentWatch;