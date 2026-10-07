/** DSH 0.2 native lifecycle -> Orca's existing ordered PTY status carrier. */
export const name = 'local-orca-terminal-status'
export const inject = ['agents', 'loader']

const TUI_PACKAGE = '@deepseek-harness-tui/dsh-tui'
const ACTIVE_FIBER = 2

function isRoot(agent) {
  const header = agent?.session?.header
  return !!header && !agent.parentAgent && !header.parentSession && header.origin !== 'subagent'
}

/** Separate output/env arguments allow behavioral tests without intercepting real stdout. */
export function installStatusHooks(ctx, output, environment) {
  let disposed = false
  let startupSent = false

  function rootAgent() {
    const roots = ctx.agents.roots()
    // A process hosting multiple roots needs a frontend-owner mapping. Fail closed.
    return roots.length === 1 && isRoot(roots[0]) ? roots[0] : undefined
  }

  function mountedTui() {
    const entries = [...ctx.loader.entries()].filter(entry =>
      entry.options.name === TUI_PACKAGE && entry.disabled !== true)
    if (entries.length !== 1 || entries[0].fiber?.state !== ACTIVE_FIBER) return false
    const parent = entries[0].fiber
    const implementation = ctx.fiber.store?.agents
    if (!implementation || parent.store?.agents !== implementation) return false
    // The package row schedules this child asynchronously; only the child awaits render.
    const runtimes = [...ctx.registry.values()].flatMap(runtime => [...runtime.fibers])
      .filter(fiber => fiber.runtime?.name === 'dsh-tui-runtime' &&
        fiber.parent?.fiber === parent && fiber.state === ACTIVE_FIBER)
    return runtimes.length === 1
  }

  function emit(agent, state, sessionBoundary = false) {
    if (disposed || output.isTTY !== true ||
        !(environment.ORCA_AGENT_PANE || environment.ORCA_PANE_KEY) ||
        !isRoot(agent) || rootAgent() !== agent) return
    if (state === 'done' && (!mountedTui() || agent.status !== 'idle' || agent.inbox?.hasPending !== false)) return
    const payload = { state, agentType: 'dsh', ...(sessionBoundary ? { sessionBoundary: true } : {}) }
    try {
      output.write(`\x1b]9999;${JSON.stringify(payload)}\x07`)
    } catch (error) {
      // A closed PTY must not fail the model turn or widen permissions.
      ctx.logger.warn(`Orca terminal status write failed: ${String(error)}`)
    }
  }

  function startup() {
    if (startupSent || disposed || !mountedTui()) return
    const agent = rootAgent()
    if (!agent || agent.status !== 'idle' || agent.inbox?.hasPending !== false) return
    startupSent = true
    // Child runtime ACTIVE follows awaited TUI apply/render, never just SessionStart.
    emit(agent, 'done', true)
  }

  ctx.effect(() => () => { disposed = true })
  ctx.on('agent/created', startup)
  ctx.on('internal/status', fiber => {
    if (fiber.runtime?.name === 'dsh-tui-runtime' && fiber.state === ACTIVE_FIBER) startup()
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (!isRoot(agent) || rootAgent() !== agent) return
    if (status === 'running') emit(agent, 'working')
    if (status === 'idle') emit(agent, 'done')
  })
  startup()
}

export function apply(ctx) {
  installStatusHooks(ctx, process.stdout, process.env)
}
