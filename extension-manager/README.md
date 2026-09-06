# extension-manager

A global Pi extension that lets you enable or disable global extensions without leaving the active Pi TUI.

## Usage

Run:

```text
/extension-manager
```

- **Up/Down, Page Up/Page Down**: navigate
- **Space or Enter**: toggle the selected extension
- **Type**: filter by name, source, or path
- **Escape**: close, flush settings, and reload when anything changed

Changes are written to `~/.pi/agent/settings.json` using Pi's native extension and package filters, so they apply to every project. Both auto-discovered extensions and extensions supplied by globally configured Pi packages are shown, including currently disabled ones.

Disabling `extension-manager` requires a second confirmation keystroke because it removes the `/extension-manager` command after reload. Re-enable it with `pi config` or by editing the global settings file.

Project-local extensions are intentionally excluded; this manager changes global state only.
