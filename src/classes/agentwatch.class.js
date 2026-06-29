class AgentWatch {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        const container = document.createElement("div");
        container.id = "mod_agentwatch";
        container.innerHTML = `
            <div id="mod_agentwatch_inner">
                <button id="agent_watch_slot" title="Move Agent Watch panel" aria-label="Move Agent Watch panel">↘</button>
                <div id="aw_quota_panel">
                    <div class="aw-quota-block" id="aw_quota_claude">
                        <span class="aw-quota-label">CLAUDE QUOTA</span>
                        <div class="aw-quota-row">
                            <span>5H</span>
                            <div class="aw-quota-track"><div class="aw-quota-fill" id="aw_claude_5h"></div></div>
                            <span class="aw-quota-pct" id="aw_claude_5h_pct">--</span>
                        </div>
                        <div class="aw-quota-row">
                            <span>7D</span>
                            <div class="aw-quota-track"><div class="aw-quota-fill" id="aw_claude_7d"></div></div>
                            <span class="aw-quota-pct" id="aw_claude_7d_pct">--</span>
                        </div>
                    </div>
                    <div class="aw-quota-block" id="aw_quota_codex">
                        <span class="aw-quota-label">CODEX QUOTA</span>
                        <div class="aw-quota-row">
                            <span>5H</span>
                            <div class="aw-quota-track"><div class="aw-quota-fill" id="aw_codex_5h"></div></div>
                            <span class="aw-quota-pct" id="aw_codex_5h_pct">--</span>
                        </div>
                        <div class="aw-quota-row">
                            <span>7D</span>
                            <div class="aw-quota-track"><div class="aw-quota-fill" id="aw_codex_7d"></div></div>
                            <span class="aw-quota-pct" id="aw_codex_7d_pct">--</span>
                        </div>
                    </div>
                </div>
                <div id="aw_stats_grid">
                    <div><h2>ACTIVE</h2><strong id="aw_active">0</strong></div>
                    <div><h2>TOKENS</h2><strong id="aw_tokens">0</strong></div>
                    <div><h2>COST</h2><strong id="aw_cost">$0.00</strong></div>
                    <div><h2>CTX AVG</h2><strong id="aw_ctx_avg">--</strong></div>
                </div>
                <div id="aw_sparkline" title="Token activity"></div>
                <div id="aw_sessions"></div>
                <div id="aw_ports" class="aw-ports"></div>
                <div class="aw-empty" id="aw_empty">NO AGENT SESSIONS DETECTED</div>
                <div class="aw-footer">
                    <span id="aw_tier">TYPE 0: DIGITAL WANDERER</span>
                    <span id="aw_updated">LOCAL</span>
                </div>
            </div>`;
        this.parent.appendChild(container);

        this._sessions = container.querySelector("#aw_sessions");
        this._sparkline = container.querySelector("#aw_sparkline");
        this._ports = container.querySelector("#aw_ports");
        this._cost = container.querySelector("#aw_cost");
        this._tokens = container.querySelector("#aw_tokens");
        this._active = container.querySelector("#aw_active");
        this._ctxAvg = container.querySelector("#aw_ctx_avg");
        this._tier = container.querySelector("#aw_tier");
        this._updated = container.querySelector("#aw_updated");
        this._empty = container.querySelector("#aw_empty");
        this._slotButton = container.querySelector("#agent_watch_slot");
        this._quotaClaude = container.querySelector("#aw_quota_claude");
        this._quotaCodex = container.querySelector("#aw_quota_codex");

        this._data = {
            sessions: [],
            dailyCostUsd: 0,
            totalTokens: 0,
            dailyHistory: new Array(30).fill(0),
            tokenRate: [],
            quotas: {},
            ports: []
        };

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
        const { sessions, dailyCostUsd, totalTokens, dailyHistory, tokenRate, quotas, ports } = this._data;
        const sortedSessions = (sessions || []).slice()
            .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
            .slice(0, 6);
        const activeCount = sortedSessions.filter(s => s.state === "active" || s.status === "working").length;
        const AGENT_LABELS = { claude: "CC", antigravity: "AG", opencode: "OC", codex: "CD" };
        const STATUS_GLYPH = { working: "●", waiting: "◌", idle: "○", active: "●" };

        this._renderQuotas(quotas || {});
        this._sessions.innerHTML = "";
        sortedSessions.forEach(s => {
            const ctxPct = typeof s.ctxUsedPct === "number" ? s.ctxUsedPct : null;
            const barClass = ctxPct === null ? "" : ctxPct >= 90 ? "danger" : ctxPct >= 65 ? "warn" : "";
            const barWidth = ctxPct !== null ? ctxPct : 0;
            const totalFmt = this._fmtTokens(s.totalTokens || ((s.tokensIn || 0) + (s.tokensOut || 0)));
            const modelShort = this._modelShort(s.model || "");
            const project = this._escape((s.projectName || s.cwd || "UNKNOWN").toString().slice(0, 22));
            const task = this._escape((s.currentTask || "").toString().slice(0, 36));
            const elapsed = this._elapsed(s.elapsedMs);
            const agent = AGENT_LABELS[s.agent] || String(s.agent || "??").slice(0, 2).toUpperCase();
            const status = s.status || s.state || "idle";
            const glyph = STATUS_GLYPH[status] || STATUS_GLYPH[s.state] || "○";

            const card = document.createElement("div");
            card.className = "aw-card " + (s.state === "active" || status === "working" ? "aw-card-active" : "aw-card-idle");
            card.innerHTML = `
                <div class="aw-card-head">
                    <span class="aw-agent-tag">${agent} <i class="aw-glyph">${glyph}</i></span>
                    <span class="aw-state ${status}">${String(status).toUpperCase()}</span>
                </div>
                <div class="aw-card-project">${project}</div>
                <div class="aw-card-task">${task || "&nbsp;"}</div>
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

        this._renderSparkline(tokenRate && tokenRate.length ? tokenRate : (dailyHistory || []));

        const ctxValues = sortedSessions.map(s => s.ctxUsedPct).filter(v => typeof v === "number");
        const ctxAvg = ctxValues.length
            ? Math.round(ctxValues.reduce((a, b) => a + b, 0) / ctxValues.length) + "%"
            : "--";

        this._active.textContent = activeCount.toString();
        this._cost.textContent = "$" + (dailyCostUsd || 0).toFixed(2);
        this._tokens.textContent = this._fmtTokens(totalTokens);
        this._ctxAvg.textContent = ctxAvg;
        this._empty.style.display = sortedSessions.length ? "none" : "flex";
        this._sessions.style.display = sortedSessions.length ? "flex" : "none";
        this._sparkline.style.display = sortedSessions.length ? "flex" : "none";
        this._tier.textContent = this._kardashevTier(totalTokens);
        this._updated.textContent = new Date().toLocaleTimeString([], { hour12: false });

        this._renderPorts(ports || []);
    }

    _renderQuotas(quotas) {
        const claude = quotas.claude;
        const codex = quotas.codex;
        this._quotaClaude.style.display = claude ? "flex" : "none";
        this._quotaCodex.style.display = codex ? "flex" : "none";
        const clLabel = this._quotaClaude.querySelector(".aw-quota-label");
        const cdLabel = this._quotaCodex.querySelector(".aw-quota-label");
        if (clLabel) clLabel.textContent = claude && claude.stale ? "CLAUDE QUOTA · STALE" : "CLAUDE QUOTA";
        if (cdLabel) cdLabel.textContent = "CODEX QUOTA" + (codex && codex.planType ? " · " + String(codex.planType).toUpperCase() : "");
        this._setQuotaBar("aw_claude_5h", "aw_claude_5h_pct", claude && claude.fiveHour);
        this._setQuotaBar("aw_claude_7d", "aw_claude_7d_pct", claude && claude.sevenDay);
        this._setQuotaBar("aw_codex_5h", "aw_codex_5h_pct", codex && codex.primary);
        this._setQuotaBar("aw_codex_7d", "aw_codex_7d_pct", codex && codex.secondary);
    }

    _setQuotaBar(fillId, pctId, window) {
        const fill = document.getElementById(fillId);
        const pct = document.getElementById(pctId);
        if (!fill || !pct) return;
        const used = window && window.usedPct != null ? Number(window.usedPct) : null;
        if (used === null || isNaN(used)) {
            fill.style.width = "0%";
            fill.className = "aw-quota-fill";
            pct.textContent = "--";
            return;
        }
        fill.style.width = Math.min(100, used) + "%";
        fill.className = "aw-quota-fill" + (used >= 90 ? " danger" : used >= 70 ? " warn" : "");
        pct.textContent = Math.round(used) + "%";
    }

    _renderPorts(ports) {
        if (!ports.length) {
            this._ports.style.display = "none";
            this._ports.innerHTML = "";
            return;
        }
        this._ports.style.display = "flex";
        const labels = ports.slice(0, 4).map(p => `:${p.port}`).join(" ");
        this._ports.innerHTML = `<span class="aw-ports-label">PORTS</span><span class="aw-ports-list">${this._escape(labels)}</span>`;
    }

    _renderSparkline(history) {
        const data = (history || []).slice(-24);
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
            .replace("xai/", "")
            .replace("gpt-", "")
            .replace("gemini-", "")
            .replace("grok-", "")
            .replace("deepseek-", "")
            .slice(0, 14) || "--";
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
        if (totalTokens >= 1e9) return "TYPE II: SYSTEM ENGINEER";
        if (totalTokens >= 100e6) return "TYPE I: PLANETARY CODER";
        if (totalTokens >= 10e6) return "TYPE 0.5: REGIONAL DEVELOPER";
        if (totalTokens >= 1e6) return "TYPE 0.2: LOCAL HACKER";
        return "TYPE 0: DIGITAL WANDERER";
    }

    pause() {}
    resume() {}
}

module.exports = { AgentWatch };
window.AgentWatch = AgentWatch;