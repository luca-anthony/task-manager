import { supabase } from './supabase'

const toBytes = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// Saves this device's subscription and its current time zone.
async function save(sub: PushSubscription) {
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { onConflict: 'endpoint' }
  )
  return error
}

// Must be called from a tap (iOS requirement).
export async function enablePush(): Promise<string> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined')
      return 'On iPhone, open the app from your Home Screen icon (Share, then Add to Home Screen) to enable notifications.'
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return 'Notifications are blocked. Allow them in Settings, then Notifications, then this app.'
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!key) return 'Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY. Add it in Vercel, then redeploy.'
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) as unknown as BufferSource }))
    const err = await save(sub)
    return err ? `Could not save subscription: ${err.message}` : 'Notifications are on for this device.'
  } catch (e) {
    return `Notification setup failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Runs on app open: keeps the saved time zone current when you travel.
export async function refreshPush() {
  try {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
    if (sub) await save(sub)
  } catch { /* ignore */ }
}
