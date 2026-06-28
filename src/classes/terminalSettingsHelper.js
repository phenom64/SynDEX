const fs = require("fs");
const path = require("path");
const which = require("which");

// Helper to strip comments and trailing commas from JSON safely
function parseJsonc(content) {
    if (!content) return null;
    try {
        // Match string literals first, and keep them. Only strip comments outside of strings.
        let cleaned = content.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|(\/\*[\s\S]*?\/|\/\/.*)/g, (match, g1) => {
            return g1 ? g1 : "";
        });
        // Strip trailing commas
        cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
        return JSON.parse(cleaned);
    } catch (e) {
        // Fallback to raw JSON.parse
        try {
            return JSON.parse(content);
        } catch (err) {
            return null;
        }
    }
}

// Get the local app data path on Windows
function getLocalAppDataPath() {
    return process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : null);
}

// Read and parse Windows Terminal settings.json
function readSettings() {
    if (process.platform !== "win32") return null;
    const localAppData = getLocalAppDataPath();
    if (!localAppData) return null;
    
    // Check multiple potential paths: Stable Store version, Preview version, and Unpackaged/Portable version
    const paths = [
        path.join(localAppData, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState", "settings.json"),
        path.join(localAppData, "Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState", "settings.json"),
        path.join(localAppData, "Microsoft", "Windows Terminal", "settings.json")
    ];
    
    for (const settingsPath of paths) {
        if (fs.existsSync(settingsPath)) {
            try {
                const content = fs.readFileSync(settingsPath, "utf-8");
                const parsed = parseJsonc(content);
                if (parsed) return parsed;
            } catch (e) {
                // Try next path
            }
        }
    }
    return null;
}

// Safe resolution of executables
function resolveExecutable(name) {
    try {
        return which.sync(name);
    } catch (e) {
        return null;
    }
}

// Extract the executable from commandline string (e.g. remove arguments and quotes)
function extractExecutable(cmdline) {
    if (!cmdline) return null;
    cmdline = cmdline.trim();
    if (cmdline.startsWith('"')) {
        const nextQuote = cmdline.indexOf('"', 1);
        if (nextQuote !== -1) {
            return cmdline.substring(1, nextQuote);
        }
    }
    return cmdline.split(/\s+/)[0];
}

// Expand environment variables
function expandEnvVars(str) {
    if (!str) return str;
    return str.replace(/%([^%]+)%/g, (_, n) => process.env[n] || `%${n}%`);
}

function getProfilesList(settings) {
    if (!settings) return [];
    const profilesObj = settings.profiles;
    if (!profilesObj) return [];
    if (Array.isArray(profilesObj)) {
        return profilesObj;
    }
    if (Array.isArray(profilesObj.list)) {
        return profilesObj.list;
    }
    return [];
}

// Expose methods
function getDefaultProfile(settings) {
    if (!settings) {
        settings = readSettings();
    }
    if (!settings) return null;

    let defaultProfileId = settings.defaultProfile;
    const list = getProfilesList(settings);

    if (!defaultProfileId) {
        return list.length > 0 ? list[0] : null;
    }

    defaultProfileId = defaultProfileId.trim().toLowerCase();

    // Match by guid (with or without braces) or name
    let matched = list.find(p => {
        if (p.guid && typeof p.guid === 'string') {
            const guid = p.guid.trim().toLowerCase();
            if (guid === defaultProfileId || guid.replace(/[{}]/g, "") === defaultProfileId.replace(/[{}]/g, "")) {
                return true;
            }
        }
        if (p.name && typeof p.name === 'string') {
            if (p.name.trim().toLowerCase() === defaultProfileId) {
                return true;
            }
        }
        return false;
    });

    if (!matched && list.length > 0) {
        matched = list[0];
    }

    return matched || null;
}

function getShell() {
    if (process.platform !== "win32") {
        return null;
    }

    const settings = readSettings();
    let shellPath = null;

    if (settings) {
        const defaultProfile = getDefaultProfile(settings);
        if (defaultProfile) {
            let cmdline = defaultProfile.commandline || defaultProfile.commandLine;
            
            // If commandline is not explicitly set, but source is
            if (!cmdline && defaultProfile.source) {
                const srcLower = defaultProfile.source.toLowerCase();
                if (srcLower.includes("powershellcore") || srcLower.includes("pwsh")) {
                    cmdline = "pwsh.exe";
                } else if (srcLower.includes("powershell")) {
                    cmdline = "powershell.exe";
                } else if (srcLower.includes("cmd")) {
                    cmdline = "cmd.exe";
                }
            }

            if (cmdline) {
                const exe = expandEnvVars(extractExecutable(cmdline));
                if (exe) {
                    const exeLower = exe.toLowerCase();
                    if (exeLower.endsWith("pwsh") || exeLower.endsWith("pwsh.exe")) {
                        // Check if pwsh exists
                        const resolvedPwsh = resolveExecutable(exe) || resolveExecutable("pwsh.exe") || resolveExecutable("pwsh");
                        if (resolvedPwsh) {
                            shellPath = resolvedPwsh;
                        } else {
                            // Fallback to powershell.exe
                            shellPath = resolveExecutable("powershell.exe") || resolveExecutable("powershell") || "powershell.exe";
                        }
                    } else {
                        shellPath = resolveExecutable(exe) || exe;
                    }
                }
            }
        }
    }

    // Default fallback if settings are missing or not resolved
    if (!shellPath) {
        const resolvedPwsh = resolveExecutable("pwsh.exe") || resolveExecutable("pwsh");
        if (resolvedPwsh) {
            shellPath = resolvedPwsh;
        } else {
            shellPath = resolveExecutable("powershell.exe") || resolveExecutable("powershell") || "powershell.exe";
        }
    }

    return shellPath;
}

function getFontFamily() {
    if (process.platform !== "win32") {
        return "Consolas";
    }

    const settings = readSettings();
    if (settings) {
        const defaultProfile = getDefaultProfile(settings);
        const getFromProfile = (prof) => {
            if (!prof) return null;
            if (prof.font && typeof prof.font === 'object' && prof.font.face) {
                return prof.font.face;
            }
            if (prof.fontFace) {
                return prof.fontFace;
            }
            return null;
        };

        let font = getFromProfile(defaultProfile);
        if (font) return font;

        if (settings.profiles && settings.profiles.defaults) {
            font = getFromProfile(settings.profiles.defaults);
            if (font) return font;
        }
    }

    return "Consolas";
}

function getColorScheme(schemeName) {
    if (process.platform !== "win32") {
        return null;
    }

    const settings = readSettings();
    let targetSchemeName = schemeName;

    if (targetSchemeName === "default" || !targetSchemeName) {
        targetSchemeName = null;
        if (settings) {
            const defaultProfile = getDefaultProfile(settings);
            if (defaultProfile && defaultProfile.colorScheme) {
                targetSchemeName = defaultProfile.colorScheme;
            } else if (settings.profiles && settings.profiles.defaults && settings.profiles.defaults.colorScheme) {
                targetSchemeName = settings.profiles.defaults.colorScheme;
            }
        }
        if (!targetSchemeName) {
            targetSchemeName = "Campbell";
        }
    }

    if (settings && Array.isArray(settings.schemes)) {
        const matchedScheme = settings.schemes.find(s => s && s.name && s.name.toLowerCase() === targetSchemeName.toLowerCase());
        if (matchedScheme) {
            return matchedScheme;
        }
    }

    // Standard Campbell scheme fallback
    if (targetSchemeName.toLowerCase() === "campbell") {
        return {
            name: "Campbell",
            background: "#0C0C0C",
            foreground: "#CCCCCC",
            cursorColor: "#FFFFFF",
            black: "#0C0C0C",
            red: "#C50F1F",
            green: "#13A10E",
            yellow: "#C19C00",
            blue: "#0037DA",
            purple: "#881798",
            cyan: "#3A96DD",
            white: "#CCCCCC",
            brightBlack: "#767676",
            brightRed: "#E74856",
            brightGreen: "#16C60C",
            brightYellow: "#F9F1A5",
            brightBlue: "#3B78FF",
            brightPurple: "#B4009E",
            brightCyan: "#61D6D6",
            brightWhite: "#F2F2F2"
        };
    }

    return null;
}

module.exports = {
    getDefaultProfile,
    getShell,
    getFontFamily,
    getColorScheme
};
