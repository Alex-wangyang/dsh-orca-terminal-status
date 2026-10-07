import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installStatusHooks } from './index.mjs'

function harness({ tty = true, pane = 'test-pane', mounted = false, roots } = {}) {
  const lead = { status: 'idle', inbox: { hasPending: false }, session: { header: { id: 'lead' } } }
  const agents = roots ?? [lead]
  const frames = []
  const listeners = new Map()
  const implementation = {}
  const entry = { options: { name: '@deepseek-harness-tui/dsh-tui' }, fiber: { state: 2, store: { agents: implementation } } }
  const frontend = { runtime: { name: 'dsh-tui-runtime' }, state: mounted ? 2 : 1, parent: { fiber: entry.fiber } }
  let dispose
  const ctx = {
    fiber: { store: { agents: implementation } }, registry: { values: () => [{ fibers: new Set([frontend]) }] },
    agents: { roots: () => agents.filter(agent => !agent.session.header.parentSession && agent.session.header.origin !== 'subagent') }, loader: { entries: () => [entry] },
    on: (event, callback) => listeners.set(event, callback),
    effect: callback => { dispose = callback() }, logger: { warn: () => {} }
  }
  installStatusHooks(ctx, { isTTY: tty, write: data => frames.push(JSON.parse(data.slice(7, -1))) }, { ORCA_AGENT_PANE: pane })
  return { ctx, frontend, lead, agents, entry, frames, emit: (name, payload) => listeners.get(name)?.(payload), dispose: () => dispose() }
}

test('startup requires awaited frontend activation and an empty idle root', () => {
  const h = harness()
  h.emit('agent/created', { agent: h.lead })
  assert.deepEqual(h.frames, [])
  h.frontend.state = 2
  h.emit('internal/status', h.frontend)
  assert.deepEqual(h.frames, [{ state: 'done', agentType: 'dsh', sessionBoundary: true }])
  h.emit('internal/status', h.frontend)
  assert.equal(h.frames.length, 1)
})

test('startup fails closed while running, queued, or frontend initialization failed', () => {
  for (const reason of ['running', 'queued', 'failed']) {
    const h = harness()
    if (reason === 'running') h.lead.status = 'running'
    if (reason === 'queued') h.lead.inbox.hasPending = true
    h.frontend.state = reason === 'failed' ? 3 : 2
    h.emit('internal/status', h.frontend)
    assert.deepEqual(h.frames, [])
  }
})

test('running and finalized idle publish synchronous ordered states, including immediate wake', () => {
  const h = harness({ mounted: true })
  h.frames.length = 0
  h.lead.status = 'running'
  h.emit('agent/status', { agent: h.lead, status: 'running' })
  h.lead.status = 'idle'
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  h.lead.status = 'running'
  h.emit('agent/status', { agent: h.lead, status: 'running' })
  assert.deepEqual(h.frames.map(frame => frame.state), ['working', 'done', 'working'])
})

test('Stop continuation and pending inbox cannot publish completion', () => {
  const h = harness({ mounted: true })
  h.frames.length = 0
  h.lead.status = 'running'
  h.emit('agent/turn-stopping', { agent: h.lead })
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  h.lead.status = 'idle'
  h.lead.inbox.hasPending = true
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  assert.deepEqual(h.frames, [])
})

test('children and ambiguous multiple roots cannot finish the parent pane', () => {
  const h = harness({ mounted: true })
  h.frames.length = 0
  for (const header of [{ parentSession: 'lead' }, { origin: 'subagent' }]) {
    const child = { ...h.lead, session: { header } }
    h.agents.push(child)
    h.emit('agent/status', { agent: child, status: 'idle' })
  }
  assert.deepEqual(h.frames, [])
  h.agents.push({ ...h.lead, session: { header: { id: 'other-root' } } })
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  assert.deepEqual(h.frames, [])
})

test('SDK/headless pipes, unrelated terminals, and disposed plugins produce no frames', () => {
  for (const options of [{ tty: false }, { pane: '' }]) {
    const h = harness({ ...options, mounted: true })
    h.emit('agent/status', { agent: h.lead, status: 'idle' })
    assert.deepEqual(h.frames, [])
  }
  const h = harness()
  h.dispose()
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  assert.deepEqual(h.frames, [])
})


test('an active package wrapper does not prove delayed frontend render or completed initial prompt is ready', () => {
  const h = harness()
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  assert.deepEqual(h.frames, [])
  h.frontend.state = 3
  h.emit('internal/status', h.frontend)
  h.emit('agent/status', { agent: h.lead, status: 'idle' })
  assert.deepEqual(h.frames, [])
})

test('mismatched registry, disabled/duplicate frontend entries, or a foreign runtime cannot prove readiness', () => {
  for (const reason of ['registry', 'disabled', 'duplicate', 'foreign']) {
    const h = harness()
    h.frontend.state = 2
    if (reason === 'registry') h.ctx.fiber.store.agents = {}
    if (reason === 'disabled') h.entry.disabled = true
    if (reason === 'duplicate') h.ctx.loader.entries = () => [h.entry, { ...h.entry }]
    if (reason === 'foreign') h.frontend.parent.fiber = { state: 2 }
    h.emit('internal/status', h.frontend)
    h.emit('agent/status', { agent: h.lead, status: 'idle' })
    assert.deepEqual(h.frames, [])
  }
})
