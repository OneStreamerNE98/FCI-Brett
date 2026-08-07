"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { AppNotification, Notify } from "../lib/record-types";

type QueuedNotification = AppNotification & { id: number };

const MAX_NOTIFICATION_QUEUE = 4;

function durationFor(notification: QueuedNotification) {
  if (notification.kind === "error") return null;
  if (notification.kind === "warning") return 8_000;
  if (notification.kind === "info") return 5_000;
  return 3_200;
}

export function useNotificationQueue(): {
  notifications: QueuedNotification[];
  notify: Notify;
  dismissNotification: (id: number) => void;
} {
  const [notificationQueue, setNotificationQueue] = useState<QueuedNotification[]>([]);
  const notificationQueueRef = useRef<QueuedNotification[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  const dismissNotification = useCallback((id: number) => {
    const current = notificationQueueRef.current;
    if (!current.some((notification) => notification.id === id)) return;
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    const next = current.filter((notification) => notification.id !== id);
    notificationQueueRef.current = next;
    setNotificationQueue(next);
  }, []);

  const notify = useCallback<Notify>((message, kind = "info", action) => {
    if (kind !== "error" && notificationQueueRef.current.some((notification) => (
      notification.kind === kind
      && notification.message === message
      && notification.action?.label === action?.label
    ))) return;
    const notification: QueuedNotification = {
      id: ++nextIdRef.current,
      message,
      kind,
      action,
    };

    const current = notificationQueueRef.current;
    let next = [...current, notification];
    if (next.length > MAX_NOTIFICATION_QUEUE) {
      const oldestOrdinaryIndex = current.findIndex((item) => item.kind !== "error");
      if (oldestOrdinaryIndex < 0 && notification.kind !== "error") return;
      const evictionIndex = oldestOrdinaryIndex < 0 ? 0 : oldestOrdinaryIndex;
      const evicted = current[evictionIndex];
      const evictedTimer = timersRef.current.get(evicted.id);
      if (evictedTimer !== undefined) window.clearTimeout(evictedTimer);
      timersRef.current.delete(evicted.id);
      next = [
        ...current.slice(0, evictionIndex),
        ...current.slice(evictionIndex + 1),
        notification,
      ];
    }
    notificationQueueRef.current = next;
    setNotificationQueue(next);

    const duration = durationFor(notification);
    if (duration !== null) {
      const timer = window.setTimeout(() => dismissNotification(notification.id), duration);
      timersRef.current.set(notification.id, timer);
    }
  }, [dismissNotification]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  return { notifications: notificationQueue, notify, dismissNotification };
}

export function AppNotifications({
  notifications,
  onDismiss,
}: {
  notifications: QueuedNotification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return <section className="toast-region" aria-label="Notifications">
    {notifications.map((notification) => <div
      className={`toast toast-${notification.kind}`}
      key={notification.id}
      role={notification.kind === "error" ? "alert" : "status"}
      aria-live={notification.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {notification.kind === "success"
        ? <CheckCircle2 size={18} aria-hidden="true" />
        : notification.kind === "info"
          ? <Info size={18} aria-hidden="true" />
          : <CircleAlert size={18} aria-hidden="true" />}
      <span>{notification.message}</span>
      {notification.action ? <button
        type="button"
        className="toast-action"
        onClick={() => {
          const action = notification.action;
          onDismiss(notification.id);
          action?.run();
        }}
      >{notification.action.label}</button> : null}
      <button type="button" className="toast-dismiss" onClick={() => onDismiss(notification.id)} aria-label="Dismiss notification">
        <X size={16} aria-hidden="true" />
      </button>
    </div>)}
  </section>;
}
