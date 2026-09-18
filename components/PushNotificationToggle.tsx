"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { savePushSubscription, removePushSubscription } from "@/app/push/actions";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// pushManager.subscribe's applicationServerKey wants a Uint8Array, not the
// base64url string web-push's own key-generation CLI prints — this is the
// standard conversion every Web Push tutorial reaches for.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64Safe);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = "unsupported" | "checking" | "off" | "on";

// Renders nothing if the server has no VAPID key configured (push
// notifications are an opt-in feature, same as email alerts silently
// no-op without RESEND_API_KEY) or the browser doesn't support Push —
// notably Safari on iOS before 16.4, and only once the app is added to the
// home screen even on 16.4+.
export function PushNotificationToggle() {
  const { notify } = useToast();
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setStatus(sub ? "on" : "off");
      })
      .catch(() => {
        if (!cancelled) setStatus("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        notify("error", "Notifications were blocked — enable them for this site in your browser settings to turn this on.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
      });
      const json = subscription.toJSON();
      const res = await savePushSubscription({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        authKey: json.keys!.auth,
      });
      if (!res.ok) throw new Error(res.error ?? "Could not save subscription.");
      setStatus("on");
      notify("success", "Push notifications enabled on this device.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await removePushSubscription(endpoint);
      }
      setStatus("off");
      notify("success", "Push notifications turned off on this device.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "unsupported" || status === "checking") return null;

  return (
    <button className="btn-ghost" disabled={busy} onClick={status === "on" ? handleDisable : handleEnable}>
      {busy ? "Please wait…" : status === "on" ? "Notifications on" : "Enable notifications"}
    </button>
  );
}
