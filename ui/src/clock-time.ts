const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The local time of `at` on a 24-hour clock, whatever the locale: `14:02` on the same day as `now`, else
 * `1 Nov 14:02`. A time that is not a real date is `—`.
 */
export function clockTime(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  if (!Number.isFinite(date.getTime())) return "—";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? time : `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""} ${time}`;
}
