export function friendlyFirstName(userName: string, userEmail: string) {
  const suppliedName = userName.trim();
  if (suppliedName && !suppliedName.includes("@")) return suppliedName.split(/\s+/)[0];
  const emailName = userEmail.split("@")[0]?.split(/[._-]+/)[0]?.trim();
  return emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1).toLowerCase() : null;
}

export function dashboardTimeContext(timestamp: number, timezone: string) {
  const date = new Date(timestamp);
  let safeTimezone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safeTimezone }).format(date);
  } catch {
    safeTimezone = "America/New_York";
  }
  const hourPart = new Intl.DateTimeFormat("en-US", { timeZone: safeTimezone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart ?? 12);
  const greeting = hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: safeTimezone, weekday: "long", month: "long", day: "numeric" }).format(date);
  return { greeting, dateLabel, timezone: safeTimezone };
}
