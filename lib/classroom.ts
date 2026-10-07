/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabase'

export const CLASSROOM_SCOPES = ['courses.readonly', 'coursework.me.readonly', 'student-submissions.me.readonly']
  .map(s => `https://www.googleapis.com/auth/classroom.${s}`).join(' ')
const COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

async function api(token: string, path: string) {
  const r = await fetch(`https://classroom.googleapis.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 401) { localStorage.removeItem('gtoken'); throw new Error('Google session expired. Tap Sync Classroom again.') }
  if (r.status === 403) throw new Error('Google blocked access. Your school may not allow this app.')
  if (!r.ok) throw new Error(`Classroom error ${r.status}`)
  return r.json()
}

const dueOf = (w: any) => {
  const d = w.dueDate; if (!d) return null
  const t = w.dueTime
  return t ? new Date(Date.UTC(d.year, d.month - 1, d.day, t.hours ?? 0, t.minutes ?? 0)) : new Date(d.year, d.month - 1, d.day, 23, 59)
}

export async function syncClassroom(token: string, uid: string) {
  const { courses = [] } = await api(token, 'courses?studentId=me&courseStates=ACTIVE&pageSize=50')
  let total = 0
  for (const [n, c] of courses.entries()) {
    await supabase.from('lists').upsert({ user_id: uid, name: c.name, color: COLORS[n % COLORS.length] }, { onConflict: 'user_id,name', ignoreDuplicates: true })
    const { data: l } = await supabase.from('lists').select('id').eq('name', c.name).single()
    const { courseWork = [] } = await api(token, `courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`)
    const { studentSubmissions = [] } = await api(token, `courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`)
    const turnedIn = studentSubmissions.filter((s: any) => ['TURNED_IN', 'RETURNED'].includes(s.state)).map((s: any) => `${c.id}:${s.courseWorkId}`)
    const rows = courseWork.map((w: any) => ({
      user_id: uid, list_id: l?.id ?? null, title: w.title, type: 'assignment', source: 'classroom',
      external_id: `${c.id}:${w.id}`, due_at: dueOf(w)?.toISOString() ?? null, notes: w.alternateLink ?? null,
    }))
    if (rows.length) await supabase.from('items').upsert(rows, { onConflict: 'user_id,source,external_id' })
    // Only ever sets done to true, so your own checkmarks are never undone.
    if (turnedIn.length) await supabase.from('items').update({ done: true }).eq('source', 'classroom').in('external_id', turnedIn)
    total += rows.length
  }
  return total
}
