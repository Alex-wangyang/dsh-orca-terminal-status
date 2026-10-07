# DSH Orca Terminal Status

An unofficial, independent DeepSeek Harness plugin that reports real DSH TUI
readiness and completion to Orca's existing terminal status channel. MIT licensed.
No modified Orca application is required.

## Why

With Orca 1.4.220, DSH can finish a request while Orca still waits for `tui-idle`:
DSH's Claude-compatible hooks report HTTP events, whereas that readiness check
expects terminal status. See [Orca issue #25257](https://github.com/stablyai/orca/issues/25257)
and [the upstream PR](https://github.com/stablyai/orca/pull/26074).

This plugin listens directly to DSH lifecycle events; it does not translate an
HTTP `Stop` into completion. `Stop` can still enqueue continuation work.

- Reports startup readiness only after the TUI's actual child runtime finishes
  activation and the single root agent is idle with an empty inbox.
- Reports `working` for a running root and `done` for finalized idle, using
  ordered OSC 9999 writes to the existing PTY.
- Ignores subagents, ambiguous multiple roots, non-TTY SDK output, and terminals
  without Orca's pane environment. Requires matching frontend/service ownership.
- Leaves Orca's existing HTTP hooks in place for their existing purposes.

## Tested versions

| Component | Version |
| --- | --- |
| Official Orca | 1.4.220 |
| Official DSH / dsh-agent | 0.2.0-rc.2 |
| Community `@deepseek-harness-tui/dsh-tui` | 0.13.0 |
| `@deepseek-ai/cordis` | 4.0.4 |
| `@deepseek-ai/cordis-plugin-loader` | 1.0.5 |
| Real integration platform | macOS, Apple Silicon |

This implementation depends on TUI/Cordis internals (`internal/status`, fiber
state/parent/store and `dsh-tui-runtime`), in addition to DSH's plugin loader.
Plugin-loader compatibility alone does not guarantee those internals remain
compatible. The manifest declares the tested peer versions; optional peers avoid
automatically installing another DSH or TUI copy. Missing TUI does not provide
readiness. Revalidate upgrades; compatibility with other versions, Windows,
Linux, SSH and multi-root frontend routing has not been established.

## Install

Use Node.js `^22.19.0 || >=24` and an existing DSH TUI profile. Install exactly
once: do not combine this bundle with a manually inserted copy of the plugin or
an Orca release that already emits the same DSH PTY status. Installing a bundle
changes every session using that profile; schedule installation between sessions.

Through DSH's official package-management CLI (replace `dsh-tui` with your profile):

```sh
dsh plugin --profile dsh-tui add https://github.com/Alex-wangyang/dsh-orca-terminal-status/releases/download/v0.1.0/dsh-orca-terminal-status-0.1.0.tgz
```

Alternatively, download and extract that release, then ask DSH's native
`plugin_manager` to use `action: install_bundle` with `target` set to the absolute
extracted package directory. This package contains `dsh.bundle.patch`, no runtime
dependencies, no build step and no install/prepare scripts. npm registry publication
is not required. Do not run `npm install` inside DSH's profile yourself.

Restart DSH after package replacement and launch it inside Orca. Verify the
composed plugin row and native `tui-idle` readiness, then run a harmless task and
verify completion. A saved bundle selection alone does not prove runtime health.

Remove the bundle using the same profile:

```sh
dsh plugin --profile dsh-tui remove dsh-orca-terminal-status
```

This removes the bundle-managed plugin, not an older manually installed home
patch. Preserve Orca-managed hook rows when removing a manual installation.

## Verification

```sh
npm test
npm pack --dry-run
```

Eight behavioral tests cover delayed/failed frontend activation, root and inbox
guards, child events, Stop continuations, ordered immediate wake, SDK isolation,
disposal and frontend ownership. They need no model credentials or DSH installation.

The same runtime source was exercised against the tested real stack: cold worker
launch and same-process worker reuse both admitted successfully, wrote independently
verified task marker files, and reported native worker completion. Orca's native
`tui-idle` check also passed after completion and on a fresh final-source launch.
The official Orca application bytes were unchanged. These are bounded integration
results, not a guarantee for later releases. Release packaging is separately tested
with DSH's native installer in an isolated profile.

## 中文

这是独立维护的非官方插件。它监听 DSH 的真实状态，把就绪、工作中和完成状态
写入 Orca 已有的终端通路，使官方 Orca 也能正确识别 DSH worker。
它不会把 HTTP `Stop` 直接当作任务完成，也不需要修改 Orca 本体。

安装命令见上方；`dsh-tui` 应替换为实际使用的 profile。请勿重复安装手工副本
和 bundle。已实测的版本组合见表格；插件加载机制保持兼容，并不代表 TUI
内部生命周期永远保持兼容，因此 DSH/TUI 升级后仍需验证。

## License

[MIT](LICENSE). Independently maintained; not affiliated with or endorsed by
DeepSeek AI, the DSH TUI maintainers, or Stably/Orca.
