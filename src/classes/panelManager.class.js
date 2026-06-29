class PanelManager {
    constructor(ipc, settingsFile, fs) {
        this._ipc = ipc;
        this._settingsFile = settingsFile;
        this._fs = fs;
        this._panels = {};
        this._fitTimer = null;
        this._kbFitTimer = null;
        this._state = (window.settings && window.settings.panelToggles)
            ? Object.assign({}, window.settings.panelToggles)
            : {};
        this._layout = Object.assign({
            agentWatchSlot: "bottom-left"
        }, (window.settings && window.settings.panelLayout) ? window.settings.panelLayout : {});
        this._agentWatchSlots = ["bottom-left", "bottom-right", "right-rail"];
        this._layout.agentWatchSlot = this._normalizeSlot(this._layout.agentWatchSlot || "bottom-left");
    }

    _normalizeSlot(slot) {
        if (this._agentWatchSlots.indexOf(slot) === -1) return "bottom-left";
        return slot;
    }

    register(name, containerEl, module) {
        this._panels[name] = { el: containerEl, module: module || null };
        const visible = (this._state[name] !== undefined) ? this._state[name] : true;
        if (!visible) this._applyHide(name);
    }

    initLayout() {
        if (!this._resizeBound) {
            this._resizeBound = true;
            window.addEventListener("resize", () => this.applyLayout());
        }
        this.applyLayout();
    }

    toggle(name) {
        if (!this._panels[name]) return;
        const currentlyVisible = !this._panels[name].el.classList.contains('panel-hidden');
        if (currentlyVisible) {
            this._applyHide(name);
            this._state[name] = false;
        } else {
            this._applyShow(name);
            this._state[name] = true;
        }
        this._persist();
        this.applyLayout();
        if (window.audioManager && window.audioManager.panels) window.audioManager.panels.play();
    }

    isVisible(name) {
        if (!this._panels[name]) return true;
        return !this._panels[name].el.classList.contains('panel-hidden');
    }

    _applyHide(name) {
        const { el, module } = this._panels[name];
        el.classList.add('panel-hidden');
        if (module && typeof module.pause === 'function') module.pause();
    }

    _applyShow(name) {
        const { el, module } = this._panels[name];
        el.classList.remove('panel-hidden');
        if (module && typeof module.resume === 'function') module.resume();
        this._fitActiveTerminalSoon();
    }

    cycleAgentWatchSlot() {
        const current = this._normalizeSlot(this._layout.agentWatchSlot || "bottom-left");
        const idx = this._agentWatchSlots.indexOf(current);
        this._layout.agentWatchSlot = this._agentWatchSlots[(idx + 1) % this._agentWatchSlots.length];
        this._persist();
        this.applyLayout();
        if (window.audioManager && window.audioManager.panels) window.audioManager.panels.play();
        return this._layout.agentWatchSlot;
    }

    _dualColumnSpan(leftVis, rightVis, G, COL_W, MAIN_LEFT_BOTH) {
        if (leftVis && rightVis) return `calc(${MAIN_LEFT_BOTH}vw - ${G}vh)`;
        if (leftVis || rightVis) return `${COL_W}vw`;
        return `calc(${MAIN_LEFT_BOTH}vw - ${G}vh)`;
    }

    _keyboardAfterDual(metrics, kbVis, leftVis, rightVis, G, GAP_VW, COL_W, MAIN_LEFT_BOTH) {
        if (!kbVis) return;
        if (leftVis && rightVis) {
            metrics.kbLeft = `calc(${MAIN_LEFT_BOTH}vw + ${GAP_VW}vw)`;
        } else {
            metrics.kbLeft = `calc(${G}vh + ${COL_W}vw + ${GAP_VW}vw)`;
        }
        metrics.kbRight = `${G}vh`;
    }

    _placeLoneBottomPanel(metrics, kind, slot, dualColW, G) {
        if (kind === "fs") {
            metrics.fsLeft = `${G}vh`;
            metrics.fsW = dualColW;
            metrics.awLeft = "auto";
            metrics.awRight = "auto";
            metrics.awW = "0";
            return;
        }
        metrics.fsW = "0";
        if (slot === "bottom-right") {
            metrics.awLeft = "auto";
            metrics.awRight = `${G}vh`;
            metrics.awW = "24vw";
        } else {
            metrics.awLeft = `${G}vh`;
            metrics.awRight = "auto";
            metrics.awW = dualColW;
        }
    }

    _layoutBottomRow(metrics, bottomPanels, widths, G, GAP_VW) {
        let offsetVw = 0;
        bottomPanels.forEach((key, idx) => {
            const w = widths[key];
            const isLast = idx === bottomPanels.length - 1;
            const isFirst = idx === 0;

            if (key === "fs") {
                metrics.fsLeft = `${G}vh`;
                metrics.fsW = `${w}vw`;
                offsetVw += w;
            } else if (key === "kb") {
                if (isFirst) {
                    metrics.kbLeft = `${G}vh`;
                } else {
                    metrics.kbLeft = `calc(${G}vh + ${offsetVw}vw + ${GAP_VW}vw)`;
                }
                if (isLast) {
                    metrics.kbRight = `${G}vh`;
                } else if (bottomPanels.indexOf("aw") > idx) {
                    metrics.kbRight = `calc(${G}vh + ${widths.aw}vw + ${GAP_VW}vw)`;
                }
                offsetVw += w;
            } else if (key === "aw") {
                metrics.awW = `${w}vw`;
                if (isFirst) {
                    metrics.awLeft = `${G}vh`;
                    metrics.awRight = "auto";
                } else {
                    metrics.awLeft = "auto";
                    metrics.awRight = `${G}vh`;
                }
            }
        });
    }

    _computeLayoutMetrics() {
        const G = 0.8;
        const COL_W = 16.3;
        const COL_RIGHT = 17.15;
        const MAIN_LEFT_BOTH = 33.55;
        const MAIN_W_BOTH = 65.6;
        const BOTTOM_H = 30;
        const PACK_VW = 98.4;
        const GAP_VW = 0.5;
        const WEIGHTS = { fs: 1.35, kb: 1.65, aw: 1.0 };

        const leftVis = this.isVisible("leftColumn");
        const rightVis = this.isVisible("rightColumn");
        const fsVis = this.isVisible("filesystem");
        const kbVis = this.isVisible("keyboard");
        const awVis = this.isVisible("agentWatch");
        const slot = this._normalizeSlot(this._layout.agentWatchSlot || "bottom-left");
        const awInBottom = awVis && slot !== "right-rail";
        const awInRail = awVis && slot === "right-rail";

        let mainLeft, mainW, colRightLeft;

        if (!leftVis && !rightVis) {
            mainLeft = `${G}vh`;
            mainW = `calc(100vw - ${G * 2}vh)`;
            colRightLeft = `${G}vh`;
        } else if (!leftVis) {
            colRightLeft = `${G}vh`;
            mainLeft = `calc(${G}vh + ${COL_W}vw + 0.25vw)`;
            mainW = `calc(100vw - ${G}vh - ${COL_W}vw - 0.25vw - ${G}vh)`;
        } else if (!rightVis) {
            colRightLeft = `${COL_RIGHT}vw`;
            mainLeft = `${COL_RIGHT}vw`;
            mainW = `calc(100vw - ${COL_RIGHT}vw - ${G}vh)`;
        } else {
            colRightLeft = `${COL_RIGHT}vw`;
            mainLeft = `${MAIN_LEFT_BOTH}vw`;
            mainW = `${MAIN_W_BOTH}vw`;
        }

        const bottomCount = (fsVis ? 1 : 0) + (kbVis ? 1 : 0) + (awInBottom ? 1 : 0);
        const shellTop = 3.7;
        const bottomMargin = 0.925;
        const bottomRow = 30;
        const aboveBottomRow = `calc(100vh - ${shellTop + bottomMargin + bottomRow}vh)`;
        const fullUpper = "calc(100vh - 6vh)";
        const colAboveBottom = "calc(100vh - 34.5vh)";
        const loneFs = fsVis && !kbVis && !awInBottom;
        const loneAw = awInBottom && !fsVis && !kbVis;
        const loneKb = kbVis && !fsVis && !awInBottom;
        let mainH, colH;

        if (bottomCount === 0 && !awInRail) {
            mainH = fullUpper;
            colH = "calc(100vh - 3.5vh)";
        } else if (loneKb) {
            mainH = fullUpper;
            colH = colAboveBottom;
        } else if (loneFs || loneAw) {
            mainH = fullUpper;
            colH = colAboveBottom;
        } else if (bottomCount >= 3) {
            mainH = "62vh";
            colH = awInRail ? "49vh" : "calc(100vh - 34.5vh)";
        } else {
            mainH = aboveBottomRow;
            colH = awInRail ? "49vh" : `calc(100vh - ${bottomMargin + bottomRow + 2.5}vh)`;
        }

        const metrics = {
            mainLeft,
            mainW,
            mainH,
            colH,
            colRightLeft,
            fsLeft: `${G}vh`,
            fsW: "0",
            kbLeft: `${G}vh`,
            kbRight: `${G}vh`,
            awLeft: "auto",
            awRight: `${G}vh`,
            awW: "0",
            awTop: "auto",
            awBottom: "0.925vh",
            awH: `${BOTTOM_H}vh`,
            kbH: "32vh"
        };

        if (awInRail) {
            metrics.awLeft = `${COL_RIGHT}vw`;
            metrics.awRight = "auto";
            metrics.awTop = "54vh";
            metrics.awBottom = "auto";
            metrics.awW = `${COL_W}vw`;
            metrics.awH = "43vh";
        }

        const dualColW = this._dualColumnSpan(leftVis, rightVis, G, COL_W, MAIN_LEFT_BOTH);

        if (fsVis && !awInBottom) {
            if (!kbVis) {
                metrics.mainH = fullUpper;
                metrics.colH = colAboveBottom;
                this._placeLoneBottomPanel(metrics, "fs", slot, dualColW, G);
            } else {
                metrics.fsLeft = `${G}vh`;
                metrics.fsW = dualColW;
            }
            this._keyboardAfterDual(metrics, kbVis, leftVis, rightVis, G, GAP_VW, COL_W, MAIN_LEFT_BOTH);
            return metrics;
        }

        if (awInBottom && !fsVis) {
            if (!kbVis) {
                metrics.mainH = fullUpper;
                metrics.colH = colAboveBottom;
                this._placeLoneBottomPanel(metrics, "aw", slot, dualColW, G);
            } else {
                if (slot === "bottom-right") {
                    metrics.awLeft = "auto";
                    metrics.awRight = `${G}vh`;
                    metrics.awW = "24vw";
                } else {
                    metrics.awLeft = `${G}vh`;
                    metrics.awRight = "auto";
                    metrics.awW = dualColW;
                }
            }
            this._keyboardAfterDual(metrics, kbVis, leftVis, rightVis, G, GAP_VW, COL_W, MAIN_LEFT_BOTH);
            return metrics;
        }

        const bottomPanels = [];
        if (fsVis) bottomPanels.push("fs");
        if (kbVis) bottomPanels.push("kb");
        if (awInBottom) bottomPanels.push("aw");

        if (bottomPanels.length === 0) return metrics;

        if (loneKb) {
            metrics.kbLeft = `${G}vh`;
            metrics.kbRight = `${G}vh`;
            return metrics;
        }

        const totalWeight = bottomPanels.reduce((s, key) => s + WEIGHTS[key], 0);
        const widths = {};
        bottomPanels.forEach(key => {
            widths[key] = (WEIGHTS[key] / totalWeight) * PACK_VW;
        });

        this._layoutBottomRow(metrics, bottomPanels, widths, G, GAP_VW);

        return metrics;
    }

    _applyLayoutMetrics(metrics) {
        const body = document.body;
        const set = (name, val) => body.style.setProperty(name, val);

        set("--syndex-main-left", metrics.mainLeft);
        set("--syndex-main-w", metrics.mainW);
        set("--syndex-main-h", metrics.mainH);
        set("--syndex-col-h", metrics.colH);
        set("--syndex-col-right-left", metrics.colRightLeft);
        set("--syndex-fs-left", metrics.fsLeft);
        set("--syndex-fs-w", metrics.fsW);
        set("--syndex-kb-left", metrics.kbLeft);
        set("--syndex-kb-right", metrics.kbRight);
        set("--syndex-aw-left", metrics.awLeft);
        set("--syndex-aw-right", metrics.awRight);
        set("--syndex-aw-w", metrics.awW);
        set("--syndex-aw-top", metrics.awTop);
        set("--syndex-aw-bottom", metrics.awBottom);
        set("--syndex-aw-h", metrics.awH);
        set("--syndex-kb-h", metrics.kbH || "32vh");

        const shell = document.getElementById("main_shell");
        if (shell) {
            shell.style.left = metrics.mainLeft;
            shell.style.width = metrics.mainW;
            shell.style.height = metrics.mainH;
            const title = shell.querySelector("h3.title");
            if (title) {
                title.style.left = metrics.mainLeft;
                title.style.width = metrics.mainW;
            }
        }

        const colH = metrics.colH;
        ["mod_column_left", "mod_column_right"].forEach(id => {
            const col = document.getElementById(id);
            if (col) col.style.height = colH;
        });
    }

    applyLayout() {
        if (!document || !document.body) return;
        const body = document.body;
        const toggleClass = (klass, enabled) => {
            if (enabled) body.classList.add(klass);
            else body.classList.remove(klass);
        };

        toggleClass("panel-keyboard-hidden", !this.isVisible("keyboard"));
        toggleClass("panel-filesystem-hidden", !this.isVisible("filesystem"));
        toggleClass("panel-agentwatch-hidden", !this.isVisible("agentWatch"));
        toggleClass("panel-left-hidden", !this.isVisible("leftColumn"));
        toggleClass("panel-network-hidden", !this.isVisible("rightColumn"));

        const slot = this._normalizeSlot(this._layout.agentWatchSlot || "bottom-left");
        this._layout.agentWatchSlot = slot;
        this._agentWatchSlots.forEach(s => body.classList.remove("agent-watch-" + s));
        body.classList.add("agent-watch-" + slot);

        this._applyLayoutMetrics(this._computeLayoutMetrics());

        const slotBtn = document.getElementById("agent_watch_slot");
        if (slotBtn) slotBtn.title = "Move Agent Watch (" + slot.replace(/-/g, " ") + ")";
        this._fitActiveTerminalSoon();
        this._fitKeyboardSoon();
    }

    _fitKeyboardSoon() {
        if (this._kbFitTimer) clearTimeout(this._kbFitTimer);
        this._kbFitTimer = setTimeout(() => {
            this._kbFitTimer = null;
            this._applyKeyboardFit();
            setTimeout(() => this._applyKeyboardFit(), 280);
        }, 80);
    }

    _applyKeyboardFit() {
        const kb = document.getElementById("keyboard");
        const inner = document.getElementById("keyboard_scale_inner");
        const fitBox = document.getElementById("keyboard_fit_box");
        if (!kb || !inner || !this.isVisible("keyboard")) {
            if (inner) inner.style.transform = "";
            return;
        }
        inner.style.transform = "none";
        inner.style.width = "max-content";
        const box = fitBox || kb;
        const pad = 10;
        const availW = Math.max(0, box.clientWidth - pad);
        const availH = Math.max(0, box.clientHeight - pad);
        const naturalW = inner.offsetWidth || inner.scrollWidth;
        const naturalH = inner.offsetHeight || inner.scrollHeight;
        if (naturalW <= 0 || naturalH <= 0 || availW <= 0 || availH <= 0) return;
        const scale = Math.min(availW / naturalW, availH / naturalH);
        const clamped = Math.max(0.4, Math.min(scale, 1.45));
        inner.style.transform = "scale(" + clamped.toFixed(4) + ")";
        inner.style.transformOrigin = "center center";
    }

    _fitActiveTerminalSoon() {
        if (this._fitTimer) clearTimeout(this._fitTimer);
        this._fitTimer = setTimeout(() => {
            this._fitTimer = null;
            if (window.term && window.currentTerm !== undefined && window.term[window.currentTerm]) {
                window.term[window.currentTerm].fit();
            }
        }, 350);
    }

    reloadFromSettings(settings) {
        settings = settings || window.settings || {};
        this._state = Object.assign({}, settings.panelToggles || {});
        this._layout = Object.assign({ agentWatchSlot: "bottom-left" }, settings.panelLayout || {});
        this._layout.agentWatchSlot = this._normalizeSlot(this._layout.agentWatchSlot);

        Object.keys(this._panels).forEach(name => {
            const visible = this._state[name] !== undefined ? this._state[name] : true;
            if (visible) this._applyShow(name);
            else this._applyHide(name);
        });
        this.applyLayout();
    }

    syncSettings(settings) {
        if (!settings) return;
        settings.panelToggles = Object.assign({}, this._state);
        settings.panelLayout = Object.assign({}, this._layout);
    }

    _persist(mergedSettings) {
        try {
            const settings = mergedSettings || JSON.parse(this._fs.readFileSync(this._settingsFile, 'utf-8'));
            settings.panelToggles = this._state;
            settings.panelLayout = this._layout;
            this._fs.writeFileSync(this._settingsFile, JSON.stringify(settings, '', 4));
            if (window.settings) {
                window.settings.panelToggles = Object.assign({}, this._state);
                window.settings.panelLayout = Object.assign({}, this._layout);
            }
        } catch(e) {
            console.error('PanelManager: could not persist toggle state', e);
        }
    }
}

module.exports = { PanelManager };