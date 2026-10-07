import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Called every minute by Supabase pg_cron. Sends alerts whose time has come.
export async function POST(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 })
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

  const now = new Date(); const since = new Date(+now - 6 * 36e5).toISOString()
  const { data } = await db.from('items').select('id,user_id,title,due_at,all_day,remind_at,notified_at')
    .eq('done', false).lte('remind_at', now.toISOString()).gte('remind_at', since)
  const fresh = (data ?? []).filter(i => !i.notified_at || new Date(i.notified_at) < new Date(i.remind_at))
  if (!fresh.length) return Response.json({ sent: 0 })

  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', [...new Set(fresh.map(i => i.user_id))])
  const tz = process.env.APP_TIMEZONE ?? 'America/Chicago'
  let sent = 0
  for (const it of fresh) {
    const when = it.due_at ? new Date(it.due_at).toLocaleString('en-US', it.all_day ? { timeZone: tz, month: 'short', day: 'numeric' } : { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
    for (const s of (subs ?? []).filter(s => s.user_id === it.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: it.title, body: when && `Due ${when}`, url: '/' }))
        sent++
      } catch (e) {
        if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) await db.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
    await db.from('items').update({ notified_at: now.toISOString() }).eq('id', it.id)
  }
  return Response.json({ sent })
}
