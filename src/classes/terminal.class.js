class Terminal {
    constructor(opts) {
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = require("xterm").Terminal;
            const {AttachAddon} = require("xterm-addon-attach");
            const {FitAddon} = require("xterm-addon-fit");
            const {LigaturesAddon} = require("xterm-addon-ligatures");
            const {WebglAddon} = require("xterm-addon-webgl");
            this.Ipc = require("electron").ipcRenderer;

            this.port = opts.port || 3000;
            this.cwd = "";
            this.oncwdchange = () => {};

            this._sendSizeToServer = () => {
                let cols = this.term.cols.toString();
                let rows = this.term.rows.toString();
                while (cols.length < 3) {
                    cols = "0"+cols;
                }
                while (rows.length < 3) {
                    rows = "0"+rows;
                }
                this.Ipc.send("terminal_channel-"+this.port, "Resize", cols, rows);
            };

            // Support for custom color filters on the terminal - see #483
            let doCustomFilter = (window.isTermFilterValidated) ? true : false;

            // Parse & validate color filter
            if (window.isTermFilterValidated !== true && typeof window.theme.terminal.colorFilter === "object" && window.theme.terminal.colorFilter.length > 0) {
                doCustomFilter = window.theme.terminal.colorFilter.every((step, i, a) => {
                    let func = step.slice(0, step.indexOf("("));

                    switch(func) {
                        case "negate":
                        case "grayscale":
                            a[i] = {
                                func,
                                arg: []
                            };
                            return true;
                        case "lighten":
                        case "darken":
                        case "saturate":
                        case "desaturate":
                        case "whiten":
                        case "blacken":
                        case "fade":
                        case "opaquer":
                        case "rotate":
                        case "mix":
                            break;
                        default:
                            return false;
                    }

                    let arg = step.slice(step.indexOf("(")+1, step.indexOf(")"));

                    if (typeof Number(arg) === "number") {
                        a[i] = {
                            func,
                            arg: [Number(arg)]
                        };
                        window.isTermFilterValidated = true;
                        return true;
                    }

                    return false;
                });
            }

            let ColorClass = require("color");
            let color = typeof ColorClass === "function" ? ColorClass : ColorClass.default;
            let colorify;
            if (doCustomFilter) {
                colorify = (base, target) => {
                    let newColor = color(base);
                    target = color(target);

                    for (let i = 0; i < window.theme.terminal.colorFilter.length; i++) {
                        if (window.theme.terminal.colorFilter[i].func === "mix") {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](target, ...window.theme.terminal.colorFilter[i].arg);
                        } else {
                            newColor = newColor[window.theme.terminal.colorFilter[i].func](...window.theme.terminal.colorFilter[i].arg);
                        }
                    }

                    return newColor.hex();
                };
            } else {
                colorify = (base, target) => {
                    return color(base).grayscale().mix(color(target), 0.3).hex();
                };
            }

            let themeColor = `rgb(${window.theme.r}, ${window.theme.g}, ${window.theme.b})`;

            this.term = new this.xTerm({
                allowProposedApi: true,
                rendererType: "canvas",
                cols: 80,
                rows: 24,
                cursorBlink: window.theme.terminal.cursorBlink || true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: window.theme.terminal.allowTransparency || false,
                fontFamily: window.theme.terminal.fontFamily || "Fira Mono",
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 15,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: window.theme.terminal.background,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || colorify("#2e3436", themeColor),
                    red: window.theme.colors.red || colorify("#cc0000", themeColor),
                    green: window.theme.colors.green || colorify("#4e9a06", themeColor),
                    yellow: window.theme.colors.yellow || colorify("#c4a000", themeColor),
                    blue: window.theme.colors.blue || colorify("#3465a4", themeColor),
                    magenta: window.theme.colors.magenta || colorify("#75507b", themeColor),
                    cyan: window.theme.colors.cyan || colorify("#06989a", themeColor),
                    white: window.theme.colors.white || colorify("#d3d7cf", themeColor),
                    brightBlack: window.theme.colors.brightBlack || colorify("#555753", themeColor),
                    brightRed: window.theme.colors.brightRed || colorify("#ef2929", themeColor),
                    brightGreen: window.theme.colors.brightGreen || colorify("#8ae234", themeColor),
                    brightYellow: window.theme.colors.brightYellow || colorify("#fce94f", themeColor),
                    brightBlue: window.theme.colors.brightBlue || colorify("#729fcf", themeColor),
                    brightMagenta: window.theme.colors.brightMagenta || colorify("#ad7fa8", themeColor),
                    brightCyan: window.theme.colors.brightCyan || colorify("#34e2e2", themeColor),
                    brightWhite: window.theme.colors.brightWhite || colorify("#eeeeec", themeColor)
                }
            });
            let fitAddon = new FitAddon();
            this.term.loadAddon(fitAddon);
            this.term.open(document.getElementById(opts.parentId));
            if (!(window.settings && window.settings.retroTerminalEffect)) {
                this.term.loadAddon(new WebglAddon());
            }
            let ligaturesAddon = new LigaturesAddon();
            this.term.loadAddon(ligaturesAddon);
            this.term.attachCustomKeyEventHandler(e => {
                if (e.type === "keydown" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyC" && this.term.hasSelection()) {
                    e.preventDefault();
                    this.clipboard.copy();
                    return false;
                }
                if (e.type === "keydown" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyV") {
                    e.preventDefault();
                    this.clipboard.paste();
                    return false;
                }
                window.keyboard.keydownHandler(e);
                return true;
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'));
            this.term.focus();

            // --- Phosphor Glow Overlay (mimics Windows Terminal retro effect) ---
            // xterm renders via WebGL/Canvas2D, so CSS text-shadow has no effect.
            // We create a Canvas2D overlay that reads from the xterm canvas each frame
            // and blends a blurred copy back with "screen" compositing — this is the
            // same principle Windows Terminal uses for its phosphor glow effect.
            this._glowCanvas = null;
            this._glowRaf = null;

            this._startGlowOverlay = () => {
                const parent = document.getElementById(opts.parentId);
                if (!parent || this._glowCanvas) return;

                // Find the xterm rendering canvas (WebGL or Canvas2D)
                const canvases = Array.from(parent.querySelectorAll('.xterm-screen canvas, canvas'))
                    .filter(canvas => canvas.width > 0 && canvas.height > 0)
                    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
                const srcCanvas = canvases[0];
                if (!srcCanvas) {
                    setTimeout(() => this._startGlowOverlay(), 250);
                    return;
                }

                const overlay = document.createElement('canvas');
                overlay.style.cssText = `
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    pointer-events: none;
                    z-index: 10;
                    opacity: 1;
                    mix-blend-mode: screen;
                `;
                // Match the source canvas dimensions exactly
                overlay.width = srcCanvas.width;
                overlay.height = srcCanvas.height;

                // Insert into the xterm-screen container so it sits right on top
                const screen = parent.querySelector('.xterm-screen') || parent;
                screen.style.position = 'relative';
                screen.appendChild(overlay);
                this._glowCanvas = overlay;

                const ctx = overlay.getContext('2d');
                const themeR = window.theme ? window.theme.r : 0;
                const themeG = window.theme ? window.theme.g : 255;
                const themeB = window.theme ? window.theme.b : 0;

                const drawGlow = () => {
                    if (!this._glowCanvas) return;

                    // Sync size if terminal was resized
                    if (overlay.width !== srcCanvas.width || overlay.height !== srcCanvas.height) {
                        overlay.width = srcCanvas.width;
                        overlay.height = srcCanvas.height;
                    }

                    ctx.clearRect(0, 0, overlay.width, overlay.height);

                    // Only draw when retro effect is enabled
                    if (window.settings && window.settings.retroTerminalEffect && document.visibilityState !== "hidden") {
                        // Pass 1: subtle wide bloom (screen blend via CSS mix-blend-mode)
                        ctx.save();
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.globalAlpha = 0.75;
                        ctx.filter = 'blur(4px) brightness(1.9)';
                        ctx.drawImage(srcCanvas, 0, 0);
                        ctx.restore();

                        // Pass 2: tight bright core glow
                        ctx.save();
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.globalAlpha = 0.45;
                        ctx.filter = 'blur(1.5px) brightness(1.6)';
                        ctx.drawImage(srcCanvas, 0, 0);
                        ctx.restore();
                    }

                    this._glowRaf = requestAnimationFrame(drawGlow);
                };

                this._glowRaf = requestAnimationFrame(drawGlow);
            };

            this._stopGlowOverlay = () => {
                if (this._glowRaf) {
                    cancelAnimationFrame(this._glowRaf);
                    this._glowRaf = null;
                }
                if (this._glowCanvas) {
                    this._glowCanvas.remove();
                    this._glowCanvas = null;
                }
            };

            // Start after a short delay to let WebGL initialise and paint first
            if (window.settings && window.settings.retroTerminalEffect) {
                setTimeout(() => this._startGlowOverlay(), 500);
            }

            this.Ipc.send("terminal_channel-"+this.port, "Renderer startup");
            this.Ipc.on("terminal_channel-"+this.port, (e, ...args) => {
                switch(args[0]) {
                    case "New cwd":
                        this.cwd = args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- "+args[1];
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        if (this.onprocesschange) {
                            this.onprocesschange(args[1]);
                        }
                        break;
                    default:
                        return;
                }
            });
            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            let sockHost = opts.host || "127.0.0.1";
            let sockPort = this.port;

            this.socket = new WebSocket("ws://"+sockHost+":"+sockPort);
            this.socket.onopen = () => {
                let attachAddon = new AttachAddon(this.socket);
                this.term.loadAddon(attachAddon);
                this.fit();
            };
            this.socket.onerror = e => {throw JSON.stringify(e)};
            this.socket.onclose = e => {
                if (this.onclose) {
                    this.onclose(e);
                }
            };

            this.lastSoundFX = Date.now();
            this.socket.addEventListener("message", e => {
                let d = Date.now();

                if (d - this.lastSoundFX > 30) {
                    if(window.passwordMode == "false")
                        window.audioManager.stdout.play();
                    this.lastSoundFX = d;
                }
                if (d - this.lastRefit > 10000) {
                    this.fit();
                }

                // See #397
                if (!window.settings.experimentalGlobeFeatures) return;
                let ips = e.data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                if (ips !== null && ips.length >= 1) {
                    ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                    ips.forEach(ip => {
                        window.mods.globe.addTemporaryConnectedMarker(ip);
                    });
                }
            });

            let parent = document.getElementById(opts.parentId);
            parent.addEventListener("mousedown", () => {
                this.term.focus();
            });
            parent.addEventListener("click", () => {
                this.term.focus();
            });
            parent.addEventListener("wheel", e => {
                const xtermElement = parent.querySelector(".xterm");
                if (xtermElement && xtermElement.classList.contains("enable-mouse-events")) return;
                this.term.scrollLines(Math.round(e.deltaY/10));
            });
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            });
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            });
            parent.addEventListener("touchend", e => {
                this._lastTouch = null;
            });
            parent.addEventListener("touchcancel", e => {
                this._lastTouch = null;
            });

            document.querySelector(".xterm-helper-textarea").addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            });

            this.fit = () => {
                this.lastRefit = Date.now();
                let {cols, rows} = fitAddon.proposeDimensions();

                // Apply custom fixes based on screen ratio, see #302
                let w = screen.width;
                let h = screen.height;
                let x = 1;
                let y = 0;

                function gcd(a, b) {
                    return (b == 0) ? a : gcd(b, a%b);
                }
                let d = gcd(w, h);

                if (d === 100) { y = 1; x = 3;}
                // if (d === 120) y = 1;
                if (d === 256) x = 2;

                if (window.settings.termFontSize < 15) y = y - 1;

                cols = cols+x;
                rows = rows+y;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                this._sendSizeToServer();
            };

            this.write = cmd => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(cmd);
                }
            };

            this.writelr = cmd => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(cmd+"\r");
                }
            };

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    remote.clipboard.writeText(this.term.getSelection());
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                    return true;
                },
                paste: () => {
                    const text = remote.clipboard.readText();
                    if (!text) return false;
                    const normalized = text.replace(/\r?\n/g, "\r");
                    const bracketed = this.term.modes && this.term.modes.bracketedPasteMode;
                    const payload = bracketed ? `\x1b[200~${normalized}\x1b[201~` : normalized;
                    this.write(payload);
                    this.clipboard.didCopy = false;
                    return true;
                },
                didCopy: false
            };

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Websocket = require("ws").Server;
            this.Ipc = require("electron").ipcMain;
            this._winTerm = process.platform === "win32"
                ? require("./terminalWindowsHelper.js")
                : null;

            this.renderer = null;
            this.port = opts.port || 3000;

            this._closed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresize = () => {};
            this.ondisconnected = () => {};

            this._disableCWDtracking = false;
            this._disableProcessTracking = false;
            this._oscBuffer = "";
            this._cwdFailCount = 0;
            this._processFailCount = 0;
            this._pushCwd = cwd => {
                if (!cwd || this.tty._cwd === cwd) return;
                this.tty._cwd = cwd;
                if (this.renderer) {
                    this.renderer.send("terminal_channel-"+this.port, "New cwd", cwd);
                }
            };
            this._parseOscFromData = data => {
                if (!this._winTerm || !data) return;
                const parsed = this._winTerm.parseOscCwd(data, this._oscBuffer);
                this._oscBuffer = parsed.buffer;
                if (parsed.cwd) {
                    this.tty._oscCwd = parsed.cwd;
                    this._pushCwd(parsed.cwd);
                    this._cwdFailCount = 0;
                }
            };
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    if (process.platform === "win32" && this._winTerm) {
                        if (tty._oscCwd) {
                            resolve(tty._oscCwd);
                            return;
                        }
                        if (tty._cwd) {
                            resolve(tty._cwd);
                            return;
                        }
                        reject(new Error("CWD pending (awaiting shell prompt)"));
                        return;
                    }
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    if (process.platform === "win32" && this._winTerm) {
                        this._winTerm.getWindowsChildProcess(pid).then(resolve).catch(reject);
                        return;
                    }
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        this._cwdFailCount = 0;
                        this._pushCwd(cwd);
                    }).catch(e => {
                        if (!this._closed) {
                            this._cwdFailCount++;
                            if (this._cwdFailCount === 1) {
                                console.log("Error while tracking TTY working directory: ", e);
                            }
                            if (process.platform !== "win32" || this._cwdFailCount >= 5) {
                                this._disableCWDtracking = true;
                                try {
                                    this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD || process.env.USERPROFILE);
                                } catch(err) {
                                    // renderer closed
                                }
                            }
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess && this._disableProcessTracking === false) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        if (this.renderer) {
                            this.renderer.send("terminal_channel-"+this.port, "New process", process);
                        }
                    }).catch(e => {
                        if (!this._closed) {
                            this._processFailCount++;
                            if (this._processFailCount === 1) {
                                console.log("Error while retrieving TTY subprocess: ", e);
                            }
                            if (process.platform !== "win32" || this._processFailCount >= 5) {
                                this._disableProcessTracking = true;
                                try {
                                    this.renderer.send("terminal_channel-"+this.port, "New process", "");
                                } catch(err) {
                                    // renderer closed
                                }
                            }
                        }
                    });
                }
            }, 1000);

            const spawnArgs = this._winTerm
                ? this._winTerm.normalizeShellArgs(opts.shell || "bash", opts.params)
                : ((Array.isArray(opts.params) ? opts.params.length : (opts.params || "").length) > 0
                    ? opts.params
                    : (process.platform === "win32" ? [] : ["--login"]));

            this.tty = this.Pty.spawn(opts.shell || "bash", spawnArgs, {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            this.tty.onExit((code, signal) => {
                this._closed = true;
                this.onclosed(code, signal);
            });

            this.wss = new this.Websocket({
                port: this.port,
                clientTracking: true,
                verifyClient: info => {
                    // Security fix for CVE-2023-30856: Verify Origin header to prevent cross-site websocket hijacking
                    // Only allow connections from local file:// protocol (Electron app) or null origin
                    const origin = info.origin;
                    const isLocalOrigin = origin === "null" || (typeof origin === "string" && origin.startsWith("file://"));
                    const remoteAddress = (info.req && info.req.socket) ? info.req.socket.remoteAddress : null;
                    const isLoopbackClient = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
                    
                    // Also check that only one client is connected at a time
                    if (this.wss.clients.size >= 1) {
                        return false;
                    }
                    
                    // Reject connections from web origins (http://, https://)
                    if (!isLocalOrigin) {
                        return false;
                    }

                    // Reject remote clients even when origin is omitted or spoofed
                    if (!isLoopbackClient) {
                        return false;
                    }
                    
                    return true;
                }
            });
            this.Ipc.on("terminal_channel-"+this.port, (e, ...args) => {
                switch(args[0]) {
                    case "Renderer startup":
                        this.renderer = e.sender;
                        if (!this._disableCWDtracking && this.tty._cwd) {
                            this.renderer.send("terminal_channel-"+this.port, "New cwd", this.tty._cwd);
                        }
                        if (this._disableCWDtracking) {
                            this.renderer.send("terminal_channel-"+this.port, "Fallback cwd", opts.cwd || process.env.PWD);
                        }
                        break;
                    case "Resize":
                        let cols = args[1];
                        let rows = args[2];
                        try {
                            this.tty.resize(Number(cols), Number(rows));
                        } catch (error) {
                            //Keep going, it'll work anyways.
                        }
                        this.onresized(cols, rows);
                        break;
                    default:
                        return;
                }
            });
            this.wss.on("connection", ws => {
                this.onopened(this.tty._pid);
                ws.on("close", (code, reason) => {
                    this.ondisconnected(code, reason);
                });
                ws.on("message", msg => {
                    this.tty.write(msg);
                });
                this.tty.onData(data => {
                    this._parseOscFromData(data);
                    this._nextTickUpdateTtyCWD = true;
                    this._nextTickUpdateProcess = true;
                    try {
                        ws.send(data);
                    } catch (e) {
                        // Websocket closed
                    }
                });
            });

            this.close = () => {
                this.tty.kill();
                this._closed = true;
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

module.exports = {
    Terminal
};
