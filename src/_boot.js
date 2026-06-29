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

const agentWatchCollector = require("./classes/agentwatchCollector.js");

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

    agentWatchCollector.initAgentWatch(() => win);

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
