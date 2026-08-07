import type { NotificationAction, Notify } from "./record-types";

type RecoverableErrorNotification = {
  message: string;
  cause: unknown;
  action: NotificationAction;
  actionlessReason?: never;
};

type ExplainedErrorNotification = {
  message: string;
  cause: unknown;
  action?: never;
  actionlessReason: string;
};

export type ErrorNotification = RecoverableErrorNotification | ExplainedErrorNotification;

/**
 * Keeps raw service and parser errors in developer diagnostics while requiring every
 * user-facing error toast to carry either a recovery action or an explicit census reason.
 */
export function notifyError(notify: Notify, notification: ErrorNotification) {
  console.error(notification.message, notification.cause);
  notify(notification.message, "error", notification.action);
}
