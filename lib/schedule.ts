export type Rule = 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly' | 'custom'
export type Item = {
  id: string; list_id: string | null; title: string; type: 'task' | 'event' | 'assignment'
  due_at: string | null; ends_at: string | null; all_day: boolean; remind_at: string | null; done: boolean
  repeat_rule: Rule; repeat_days: number[] | null; source: string; notes: string | null
}
export const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Does this item show up on the given calendar day?
export function occursOn(it: Item, day: Date): boolean {
  if (!it.due_at) return false
  const s = midnight(new Date(it.due_at)); const d = midnight(day)
  if (d < s) return false
  if (+d === +s) return true
  const wd = d.getDay()
  switch (it.repeat_rule) {
    case 'daily': return true
    case 'weekdays': return wd >= 1 && wd <= 5
    case 'weekends': return wd === 0 || wd === 6
    case 'weekly': return wd === s.getDay()
    case 'monthly': return d.getDate() === s.getDate()
    case 'custom': return (it.repeat_days ?? []).includes(wd)
    default: return false
  }
}

// Next occurrence after today (used when you check off a repeating reminder)
export function nextDue(it: Item): string | null {
  if (!it.due_at || it.repeat_rule === 'none') return null
  const start = new Date(it.due_at)
  const from = midnight(new Date(Math.max(+start, Date.now())))
  for (let i = 1; i <= 366; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    if (occursOn(it, d)) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), start.getHours(), start.getMinutes()).toISOString()
  }
  return null
}

export const repeatLabel = (it: Item) => ({
  none: '', daily: 'every day', weekdays: 'weekdays', weekends: 'weekends', weekly: 'weekly', monthly: 'monthly',
  custom: (it.repeat_days ?? []).map(d => NAMES[d]).join(' '),
}[it.repeat_rule] ?? '')

const f = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s).toLocaleString([], o)
export function fmtWhen(it: Item) {
  if (!it.due_at) return ''
  if (it.all_day) return f(it.due_at, { month: 'short', day: 'numeric' }) + ', all day'
  const a = f(it.due_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return it.ends_at ? `${a} to ${f(it.ends_at, { hour: 'numeric', minute: '2-digit' })}` : a
}
