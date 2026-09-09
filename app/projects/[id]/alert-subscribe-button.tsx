"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { subscribeToAlerts, unsubscribeFromAlerts } from "@/app/projects/[id]/alerts-actions";

export function AlertSubscribeButton({ projectId, initialSubscribed }: { projectId: string; initialSubscribed: boolean }) {
  const { notify } = useToast();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = !subscribed;
    startTransition(async () => {
      const res = next ? await subscribeToAlerts(projectId) : await unsubscribeFromAlerts(projectId);
      if (!res.ok) {
        notify("error", res.error ?? "Could not update your alert subscription.");
        return;
      }
      setSubscribed(next);
      notify("success", next ? "You'll get an email when this construction updates." : "Alerts turned off.");
    });
  }

  return (
    <button
      className="btn-outline shrink-0 text-xs"
      onClick={handleToggle}
      disabled={pending}
      title={
        subscribed
          ? "You'll get an email for chat messages, checklist changes, and warranty updates on this construction"
          : "Get an email when this construction gets a chat message, checklist change, or warranty update"
      }
    >
      {subscribed ? "🔔 Alerts on" : "🔕 Get alerts"}
    </button>
  );
}
