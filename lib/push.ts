import { supabase } from './supabase'

const toBytes = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// Must be called from a tap (iOS requirement).
export async function enablePush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    return 'On iPhone, open the app from your Home Screen icon (Share, then Add to Home Screen) to enable notifications.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'Notifications are blocked. Allow them in Settings, then Notifications, then this app.'
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as unknown as BufferSource }))
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }, { onConflict: 'endpoint' })
  return error ? error.message : 'Notifications are on for this device.'
}
