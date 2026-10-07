'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

import { occursOn, nextDue, repeatLabel, fmtWhen, DAYS, type Item, type Rule } from '../lib/schedule'
import { syncClassroom, CLASSROOM_SCOPES } from '../lib/classroom'
import { enablePush, refreshPush } from '../lib/push'

type List = { id: string; name: string; color: string; grp: string | null }
type Tab = 'reminders' | 'calendar'
type ListOf = (id: string | null) => List | undefined
const opts = () => ({ scopes: CLASSROOM_SCOPES, redirectTo: window.location.origin, queryParams: { prompt: 'consent' } })
const keep = (s: Session | null) => { if (s?.provider_token) localStorage.setItem('gtoken', JSON.stringify({ t: s.provider_token, at: Date.now() })) }

const DEFAULT_LISTS = [
  { name: 'School', color: '#3b82f6' }, { name: 'Music', color: '#a855f7' },
  { name: 'Work', color: '#f59e0b' }, { name: 'Personal', color: '#10b981' },
]
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const fmt = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const field = 'w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 py-3 text-base outline-none focus:border-accent'
const GREY = '#9ca3af'

export default function Page() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { keep(data.session); setSession(data.session); setReady(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { keep(s); setSession(s) })
    return () => subscription.unsubscribe()
  }, [])
  if (!ready) return null
  return session ? <App /> : <Auth />
}

function Auth() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [signup, setSignup] = useState(false); const [msg, setMsg] = useState('')
  const submit = async () => {
    setMsg('')
    const { error, data } = signup ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg(error.message)
    else if (signup && !data.session) setMsg('Check your email to confirm your account, then sign in.')
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-card p-7 shadow-xl ring-1 ring-line">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Task Manager</h1>
          <p className="mt-1 text-sm text-muted">Schoolwork, calendar and reminders in one place.</p>
        </div>
        <input className={field} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className={field} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <button onClick={submit} className="w-full rounded-xl bg-accent py-3 font-medium text-white">{signup ? 'Create account' : 'Sign in'}</button>
        <button onClick={() => setSignup(!signup)} className="w-full text-sm text-muted">{signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
        <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: opts() })} className="w-full rounded-xl bg-bg py-3 font-medium ring-1 ring-line">Continue with Google</button>
      </div>
    </main>
  )
}

function App() {
  const [lists, setLists] = useState<List[]>([]); const [items, setItems] = useState<Item[]>([])
  const [tab, setTab] = useState<Tab>('reminders'); const [hidden, setHidden] = useState<string[]>(() => JSON.parse(localStorage.getItem('hidden') ?? '[]'))
  const [adding, setAdding] = useState(false); const [showDone, setShowDone] = useState(false)
  const [syncing, setSyncing] = useState(false); const [note, setNote] = useState('')
  const [menu, setMenu] = useState<Item | null>(null); const [editing, setEditing] = useState<Item | null>(null)
  const [listEdit, setListEdit] = useState<List | 'new' | null>(null); const [panel, setPanel] = useState(false)
  useEffect(() => { localStorage.setItem('hidden', JSON.stringify(hidden)) }, [hidden])

  const load = useCallback(async () => {
    const getLists = () => supabase.from('lists').select('*').order('created_at')
    let { data: l } = await getLists()
    if (!l?.length) { await supabase.from('lists').insert(DEFAULT_LISTS); l = (await getLists()).data }
    const { data: i } = await supabase.from('items').select('*').order('due_at', { nullsFirst: false })
    setLists(l ?? []); setItems(i ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { // keep devices in sync: live changes + refresh when the app comes to the front
    refreshPush()
    const ch = supabase.channel('items-sync').on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => load()).subscribe()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const toggle = async (it: Item) => {
    const nxt = it.done || it.type === 'event' ? null : nextDue(it)
    const patch: Partial<Item> = nxt && it.due_at
      ? { due_at: nxt, remind_at: it.remind_at ? new Date(+new Date(nxt) - (+new Date(it.due_at) - +new Date(it.remind_at))).toISOString() : null }
      : { done: !it.done }
    setItems(p => p.map(x => (x.id === it.id ? { ...x, ...patch } : x)))
    await supabase.from('items').update(patch).eq('id', it.id)
  }
  const remove = async (id: string) => {
    setItems(p => p.filter(x => x.id !== id))
    await supabase.from('items').delete().eq('id', id)
  }
  const add = async (row: Partial<Item>) => {
    const { data } = await supabase.from('items').insert(row).select().single()
    if (data) setItems(p => [...p, data])
    setAdding(false)
  }

  const update = async (id: string, row: Partial<Item>) => {
    setItems(p => p.map(x => (x.id === id ? { ...x, ...row } : x))); setEditing(null)
    await supabase.from('items').update(row).eq('id', id)
  }
  const alerts = async () => setNote(await enablePush())
  const syncNow = async () => {
    setSyncing(true); setNote('')
    try {
      const { data } = await supabase.auth.getUser(); const user = data.user
      if (!user) return
      const saved = JSON.parse(localStorage.getItem('gtoken') ?? 'null')
      if (!saved || Date.now() - saved.at > 55 * 6e4) {
        const hasGoogle = user.identities?.some(i => i.provider === 'google')
        await (hasGoogle ? supabase.auth.signInWithOAuth({ provider: 'google', options: opts() }) : supabase.auth.linkIdentity({ provider: 'google', options: opts() }))
        return
      }
      const n = await syncClassroom(saved.t, user.id)
      await load(); setNote(`Synced ${n} assignments from Classroom.`)
    } catch (e) { setNote(e instanceof Error ? e.message : 'Sync failed.') }
    finally { setSyncing(false) }
  }
  useEffect(() => { // auto-sync right after coming back from Google sign-in
    const g = JSON.parse(localStorage.getItem('gtoken') ?? 'null')
    if (g && Date.now() - g.at < 55 * 6e4 && localStorage.getItem('gsynced') !== String(g.at)) { localStorage.setItem('gsynced', String(g.at)); syncNow() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const listOf: ListOf = id => lists.find(l => l.id === id)
  const visible = items.filter(i => !hidden.includes(i.list_id ?? 'none'))
  const open = visible.filter(i => !i.done); const done = visible.filter(i => i.done)
  const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const eod = new Date(+sod + 864e5)
  const at = (i: Item) => (i.due_at ? new Date(i.due_at) : null)
  const groups: [string, Item[]][] = [
    ['Overdue', open.filter(i => at(i) && at(i)! < sod)],
    ['Today', open.filter(i => at(i) && at(i)! >= sod && at(i)! < eod)],
    ['Upcoming', open.filter(i => at(i) && at(i)! >= eod)],
    ['No date', open.filter(i => !i.due_at)],
  ]
  const tabs: [Tab, string, string][] = [['reminders', 'Reminders', '✓'], ['calendar', 'Calendar', '▦']]
  const flip = (id: string) => setHidden(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]))
  const signOut = () => supabase.auth.signOut()
  const saveList = async (row: Partial<List>, id?: string) => {
    if (id) { setLists(p => p.map(l => (l.id === id ? { ...l, ...row } : l))); await supabase.from('lists').update(row).eq('id', id) }
    else {
      const { data, error } = await supabase.from('lists').insert(row).select().single()
      if (error) setNote(error.message.includes('duplicate') ? 'You already have a list with that name.' : error.message)
      else if (data) setLists(p => [...p, data])
    }
    setListEdit(null)
  }
  const deleteList = async (id: string) => {
    setLists(p => p.filter(l => l.id !== id)); setItems(p => p.map(i => (i.list_id === id ? { ...i, list_id: null } : i))); setListEdit(null)
    await supabase.from('lists').delete().eq('id', id)
  }
  const listPanel = <ListPanel lists={lists} items={items} hidden={hidden} setHidden={setHidden} onEdit={setListEdit} />
  const row = (it: Item) => <Row key={it.id} it={it} list={listOf(it.list_id)} onToggle={toggle} onMenu={setMenu} />

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-7 border-r border-line p-6 md:flex">
        <h1 className="text-xl font-semibold tracking-tight">Task Manager</h1>
        <nav className="space-y-1">
          {tabs.map(([t, label, icon]) => (
            <button key={t} onClick={() => setTab(t)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${tab === t ? 'bg-accent text-white' : 'text-muted hover:bg-card'}`}>
              <span className="w-5 text-center">{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">{listPanel}</div>
        <button onClick={alerts} className="rounded-xl bg-card py-3 font-medium ring-1 ring-line">Enable notifications</button>
        <button onClick={syncNow} disabled={syncing} className="rounded-xl bg-card py-3 font-medium ring-1 ring-line">{syncing ? 'Syncing...' : 'Sync Classroom'}</button>
        <button onClick={() => setAdding(true)} className="rounded-xl bg-accent py-3 font-medium text-white">New item</button>
        <button onClick={signOut} className="mt-auto text-left text-sm text-muted">Sign out</button>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] md:px-10 md:pb-10 md:pt-8">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-semibold tracking-tight">{tab === 'reminders' ? 'Reminders' : 'Calendar'}</h2>
          <div className="flex gap-3 md:hidden"><button onClick={alerts} className="text-sm text-accent">Alerts</button><button onClick={syncNow} disabled={syncing} className="text-sm text-accent">{syncing ? '...' : 'Sync'}</button><button onClick={signOut} className="text-sm text-muted">Sign out</button></div>
        </header>
        {note && <p className="mb-4 text-sm text-muted">{note}</p>}
        <button onClick={() => setPanel(true)} className="mb-6 flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm ring-1 ring-line md:hidden">Lists{hidden.length > 0 && <span className="text-muted">({hidden.length} hidden)</span>}</button>

        {tab === 'reminders' ? (
          <div className="max-w-2xl">
            {groups.map(([name, rows]) => rows.length > 0 && (
              <section key={name} className="mb-7">
                <h3 className={`mb-2 text-sm font-semibold ${name === 'Overdue' ? 'text-red-500' : 'text-muted'}`}>{name} ({rows.length})</h3>
                <div className="space-y-2">{rows.map(row)}</div>
              </section>
            ))}
            {open.length === 0 && <p className="py-16 text-center text-muted">Nothing due. Tap + to add something.</p>}
            {done.length > 0 && (
              <section>
                <button onClick={() => setShowDone(!showDone)} className="mb-2 text-sm font-semibold text-muted">{showDone ? 'Hide' : 'Show'} completed ({done.length})</button>
                {showDone && <div className="space-y-2">{done.map(row)}</div>}
              </section>
            )}
          </div>
        ) : (
          <Calendar items={visible} listOf={listOf} row={row} />
        )}
      </main>

      <button onClick={() => setAdding(true)} aria-label="New item" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 flex size-14 items-center justify-center rounded-full bg-accent text-3xl text-white shadow-lg md:hidden">+</button>
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-line bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {tabs.map(([t, label, icon]) => (
          <button key={t} onClick={() => setTab(t)} className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs ${tab === t ? 'text-accent' : 'text-muted'}`}>
            <span className="text-lg leading-none">{icon}</span>{label}
          </button>
        ))}
      </nav>
      {panel && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden" onClick={() => setPanel(false)}>
          <div onClick={e => e.stopPropagation()} className="max-h-[80dvh] w-full overflow-y-auto rounded-t-3xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{listPanel}</div>
        </div>
      )}
      {listEdit && <ListSheet key={listEdit === 'new' ? 'new' : listEdit.id} list={listEdit === 'new' ? undefined : listEdit} groups={[...new Set(lists.flatMap(l => (l.grp ? [l.grp] : [])))]} onClose={() => setListEdit(null)} onSave={saveList} onDelete={deleteList} />}
      {menu && <Menu it={menu} onClose={() => setMenu(null)} onEdit={() => { setEditing(menu); setMenu(null) }} onDelete={() => { remove(menu.id); setMenu(null) }} />}
      {(adding || editing) && <Sheet key={editing?.id ?? 'new'} lists={lists} item={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null) }} onSave={editing ? (r => update(editing.id, r)) : add} />}
    </div>
  )
}

function Row({ it, list, onToggle, onMenu }: { it: Item; list?: List; onToggle: (i: Item) => void; onMenu: (i: Item) => void }) {
  const late = !it.done && it.due_at && new Date(it.due_at) < new Date()
  const color = list?.color ?? GREY
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stop = () => clearTimeout(hold.current)
  return (
    <div className="group flex select-none items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-line" style={{ WebkitTouchCallout: 'none' }} onContextMenu={e => { e.preventDefault(); onMenu(it) }} onTouchStart={() => { hold.current = setTimeout(() => onMenu(it), 500) }} onTouchEnd={stop} onTouchMove={stop}>
      <button aria-label="Mark done" onClick={() => onToggle(it)} className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs text-white" style={{ borderColor: color, background: it.done ? color : 'transparent' }}>{it.done && '✓'}</button>
      <div className="min-w-0 flex-1">
        <p className={`truncate ${it.done ? 'text-muted line-through' : ''}`}>{it.title}</p>
        <p className={`truncate text-xs ${late ? 'text-red-500' : 'text-muted'}`}>
          {[list?.name, it.type === 'event' && 'event', fmtWhen(it), repeatLabel(it), it.remind_at && !it.done && 'alert set'].filter(Boolean).join(', ')}
        </p>
      </div>
      {it.source === 'classroom' && it.notes && <a href={it.notes} target="_blank" rel="noreferrer" className="text-sm text-accent">Open</a>}
      <button onClick={() => onMenu(it)} aria-label="More options" className="px-1 text-xl leading-none text-muted md:opacity-0 md:group-hover:opacity-100">⋯</button>
    </div>
  )
}

function Calendar({ items, listOf, row }: { items: Item[]; listOf: ListOf; row: (i: Item) => React.ReactNode }) {
  const [cur, setCur] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const [sel, setSel] = useState(new Date())
  const on = (d: Date) => items.filter(i => occursOn(i, d))
  
  const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(cur.getDay()).fill(null), ...Array.from({ length: days }, (_, d) => new Date(cur.getFullYear(), cur.getMonth(), d + 1))]
  const move = (n: number) => setCur(new Date(cur.getFullYear(), cur.getMonth() + n, 1))
  const today = key(new Date()); const picked = on(sel)
  const nav = 'size-10 rounded-full bg-card text-lg ring-1 ring-line'
  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{cur.toLocaleString([], { month: 'long', year: 'numeric' })}</h3>
        <div className="flex gap-2"><button aria-label="Previous month" onClick={() => move(-1)} className={nav}>‹</button><button aria-label="Next month" onClick={() => move(1)} className={nav}>›</button></div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{'SMTWTFS'.split('').map((d, i) => <div key={i} className="py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => d ? (
          <button key={i} onClick={() => setSel(d)} className={`flex aspect-square flex-col items-center justify-between rounded-xl p-1.5 text-sm ring-1 ${key(d) === key(sel) ? 'bg-accent text-white ring-accent' : 'bg-card ring-line'} ${key(d) === today && key(d) !== key(sel) ? 'font-bold text-accent' : ''}`}>
            {d.getDate()}
            <span className="flex h-1.5 gap-0.5">{on(d).slice(0, 3).map(it => <i key={it.id} className="size-1.5 rounded-full" style={{ background: listOf(it.list_id)?.color ?? GREY }} />)}</span>
          </button>
        ) : <div key={i} />)}
      </div>
      <h3 className="mb-2 mt-7 text-sm font-semibold text-muted">{sel.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
      <div className="space-y-2">{picked.map(row)}{!picked.length && <p className="text-sm text-muted">Nothing scheduled for this day.</p>}</div>
    </div>
  )
}

function Menu({ it, onClose, onEdit, onDelete }: { it: Item; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const t0 = useRef(Date.now()) // ignore the tap that ends a long-press
  const btn = 'w-full rounded-xl px-3 py-3 text-left hover:bg-bg'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => { if (Date.now() - t0.current > 400) onClose() }}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-xs space-y-1 rounded-t-3xl bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-3xl">
        <p className="truncate px-3 py-2 text-sm text-muted">{it.title}</p>
        <button onClick={onEdit} className={btn}>{it.source === 'classroom' ? 'Edit alert' : 'Edit'}</button>
        <button onClick={onDelete} className={`${btn} text-red-500`}>Delete</button>
        <button onClick={onClose} className={`${btn} text-muted md:hidden`}>Cancel</button>
      </div>
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (iso: string | null, dateOnly = false) => {
  if (!iso) return ''
  const d = new Date(iso); const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return dateOnly ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const PRESETS = ['0', '10', '60', '1440', '2880']

function Sheet({ lists, item, onClose, onSave }: { lists: List[]; item?: Item; onClose: () => void; onSave: (r: Partial<Item>) => void }) {
  const locked = item?.source === 'classroom' // title and due date come from Classroom; only the alert is editable
  const [title, setTitle] = useState(item?.title ?? ''); const [list, setList] = useState(item?.list_id ?? lists[0]?.id ?? '')
  const [type, setType] = useState<'task' | 'event'>(item?.type === 'event' ? 'event' : 'task'); const [allDay, setAllDay] = useState(item?.all_day ?? false)
  const [start, setStart] = useState(toLocal(item?.due_at ?? null, item?.all_day))
  const [end, setEnd] = useState(toLocal(item?.ends_at ?? null))
  const [rule, setRule] = useState<Rule>(item?.repeat_rule ?? 'none'); const [days, setDays] = useState<number[]>(item?.repeat_days ?? [])
  const offset = item?.due_at && item.remind_at ? String(Math.round((+new Date(item.due_at) - +new Date(item.remind_at)) / 6e4)) : ''
  const [rem, setRem] = useState(!item ? '0' : !item.remind_at ? '' : PRESETS.includes(offset) ? offset : 'custom')
  const [remAt, setRemAt] = useState(toLocal(item?.remind_at ?? null))
  const save = () => {
    const s = start ? new Date(allDay ? start + 'T00:00' : start) : null
    const remind_at = rem === 'custom' ? (remAt ? new Date(remAt).toISOString() : null) : s && rem !== '' ? new Date(+s - Number(rem) * 6e4).toISOString() : null
    if (locked) return onSave({ remind_at })
    if (!title.trim() || (type === 'event' && !start)) return
    const e = end && !allDay && type === 'event' ? new Date(end) : null
    onSave({
      title: title.trim(), list_id: list || null, type, all_day: allDay, due_at: s ? s.toISOString() : null, ends_at: e ? e.toISOString() : null,
      repeat_rule: s ? rule : 'none', repeat_days: rule === 'custom' ? days : null, remind_at,
    })
  }
  const seg = (on: boolean) => `flex-1 rounded-lg py-2 text-sm font-medium ${on ? 'bg-card shadow-sm' : 'text-muted'}`
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-3xl">
        {locked ? (
          <div><p className="font-medium">{item?.title}</p><p className="text-sm text-muted">{item && fmtWhen(item)}. Title and due date come from Classroom.</p></div>
        ) : (<>
          <div className="flex rounded-xl bg-bg p-1">
            <button className={seg(type === 'task')} onClick={() => setType('task')}>Reminder</button>
            <button className={seg(type === 'event')} onClick={() => setType('event')}>Event</button>
          </div>
          <input autoFocus className={field} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
          <select className={field} value={list} onChange={e => setList(e.target.value)}>
            {[...new Set(lists.map(l => l.grp ?? ''))].map(g => <optgroup key={g} label={g || 'Lists'}>{lists.filter(l => (l.grp ?? '') === g).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>)}
          </select>
          <label className="flex items-center justify-between py-1"><span>All day</span><input type="checkbox" className="size-5" checked={allDay} onChange={e => { setAllDay(e.target.checked); setStart(''); setEnd('') }} /></label>
          <div><p className="mb-1 text-sm text-muted">{type === 'event' ? 'Starts' : 'Due'}</p><input type={allDay ? 'date' : 'datetime-local'} className={field} value={start} onChange={e => setStart(e.target.value)} /></div>
          {type === 'event' && !allDay && <div><p className="mb-1 text-sm text-muted">Ends</p><input type="datetime-local" className={field} value={end} onChange={e => setEnd(e.target.value)} /></div>}
          <select className={field} value={rule} onChange={e => setRule(e.target.value as Rule)} disabled={!start}>
            <option value="none">Never repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekends">Weekends</option>
            <option value="weekly">Every week</option><option value="monthly">Every month</option><option value="custom">Custom days</option>
          </select>
          {rule === 'custom' && <div className="flex justify-between">{DAYS.map((d, i) => (
            <button key={i} onClick={() => setDays(p => (p.includes(i) ? p.filter(x => x !== i) : [...p, i]))} className={`size-10 rounded-full text-sm ring-1 ${days.includes(i) ? 'bg-accent text-white ring-accent' : 'ring-line'}`}>{d}</button>
          ))}</div>}
        </>)}
        <div>
          <p className="mb-1 text-sm text-muted">Alert</p>
          <select className={field} value={rem} onChange={e => setRem(e.target.value)}>
            <option value="0">At time of {locked ? 'due date' : type === 'event' ? 'event' : 'reminder'}</option><option value="">No alert</option>
            <option value="10">10 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option><option value="2880">2 days before</option>
            <option value="custom">Custom time...</option>
          </select>
        </div>
        {rem === 'custom' && <input type="datetime-local" className={field} value={remAt} onChange={e => setRemAt(e.target.value)} />}
        <button onClick={save} className="w-full rounded-xl bg-accent py-3 font-medium text-white">{item ? 'Save changes' : `Add ${type === 'event' ? 'event' : 'reminder'}`}</button>
      </div>
    </div>
  )
}

function ListPanel({ lists, items, hidden, setHidden, onEdit }: { lists: List[]; items: Item[]; hidden: string[]; setHidden: React.Dispatch<React.SetStateAction<string[]>>; onEdit: (l: List | 'new') => void }) {
  const [shut, setShut] = useState<string[]>([])
  const flip = (ids: string[]) => setHidden(h => (ids.every(i => h.includes(i)) ? h.filter(x => !ids.includes(x)) : [...new Set([...h, ...ids])]))
  const count = (id: string) => items.filter(i => i.list_id === id && !i.done).length || ''
  const rowOf = (l: List) => (
    <div key={l.id} className={`group flex items-center rounded-xl hover:bg-card ${hidden.includes(l.id) ? 'opacity-40' : ''}`}>
      <button onClick={() => flip([l.id])} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
        <i className="size-3 shrink-0 rounded-full" style={{ background: l.color }} /><span className="truncate">{l.name}</span><span className="ml-auto text-xs text-muted">{count(l.id)}</span>
      </button>
      <button onClick={() => onEdit(l)} aria-label={`Edit ${l.name}`} className="px-3 py-2 text-muted md:opacity-0 md:group-hover:opacity-100">✎</button>
    </div>
  )
  const groups = [...new Set(lists.flatMap(l => (l.grp ? [l.grp] : [])))]
  return (
    <div className="space-y-4">
      <div className="space-y-0.5">{lists.filter(l => !l.grp).map(rowOf)}</div>
      {groups.map(g => {
        const ls = lists.filter(l => l.grp === g); const ids = ls.map(l => l.id)
        const off = ids.every(i => hidden.includes(i)); const open = !shut.includes(g)
        return (
          <div key={g}>
            <div className="flex items-center justify-between px-3 pb-1">
              <button onClick={() => setShut(p => (open ? [...p, g] : p.filter(x => x !== g)))} className="flex items-center gap-1.5 text-sm font-medium text-muted"><span className="w-3 text-xs">{open ? '▾' : '▸'}</span>{g}</button>
              <button onClick={() => flip(ids)} className="text-xs text-accent">{off ? 'Show all' : 'Hide all'}</button>
            </div>
            {open && <div className="space-y-0.5">{ls.map(rowOf)}</div>}
          </div>
        )
      })}
      <button onClick={() => onEdit('new')} className="w-full rounded-xl px-3 py-2 text-left text-sm text-accent hover:bg-card">+ New list</button>
    </div>
  )
}

const SWATCH = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']

function ListSheet({ list, groups, onClose, onSave, onDelete }: { list?: List; groups: string[]; onClose: () => void; onSave: (r: Partial<List>, id?: string) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState(list?.name ?? ''); const [color, setColor] = useState(list?.color ?? SWATCH[0]); const [grp, setGrp] = useState(list?.grp ?? '')
  const save = () => { if (name.trim()) onSave({ name: name.trim(), color, grp: grp.trim() || null }, list?.id) }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-t-3xl bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-3xl">
        <h2 className="text-lg font-semibold">{list ? 'Edit list' : 'New list'}</h2>
        <input autoFocus className={field} placeholder="List name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
        <div className="flex flex-wrap gap-3">
          {SWATCH.map(c => <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} className="flex size-9 items-center justify-center rounded-full text-white" style={{ background: c }}>{color === c && '✓'}</button>)}
        </div>
        <input className={field} list="group-options" placeholder="Group (optional), like Classes" value={grp} onChange={e => setGrp(e.target.value)} />
        <datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
        <button onClick={save} className="w-full rounded-xl bg-accent py-3 font-medium text-white">{list ? 'Save changes' : 'Create list'}</button>
        {list && <button onClick={() => { if (confirm(`Delete "${list.name}"? Its items stay, but lose their list.`)) onDelete(list.id) }} className="w-full py-2 text-sm text-red-500">Delete list</button>}
      </div>
    </div>
  )
}
