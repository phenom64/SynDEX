# SynDEX minimal shell integration — emits OSC 7 cwd on each prompt (VS Code / Windows Terminal convention)
if ($global:__SynDEXShellIntegration) { return }
$global:__SynDEXShellIntegration = $true

if (-not $function:Prompt) { return }

$global:__SynDEXOriginalPrompt = $function:Prompt

function global:Prompt() {
    try {
        $loc = (Get-Location).ProviderPath
        if ($loc) {
            $uriPath = ($loc -replace '\\', '/')
            if ($uriPath -notmatch '^[A-Za-z]:/') {
                $uriPath = "/$uriPath"
            }
            $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "localhost" }
            [Console]::Write("$([char]0x1b)]7;file://${hostName}/${uriPath}$([char]0x07)")
        }
    } catch { }

    & $global:__SynDEXOriginalPrompt
}