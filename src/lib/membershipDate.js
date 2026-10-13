
const TIME_ZONE = "Asia/Dhaka";
const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MONTH_CODES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function getDhakaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)])
  );

  return values;
}

function getDhakaDateStart(year, month, day) {
  return new Date(
    Date.UTC(year, month - 1, day) - DHAKA_OFFSET_MS
  );
}

export function getDhakaTodayString(date = new Date()) {
  const { year, month, day } = getDhakaDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getDhakaTodayStart(date = new Date()) {
  return getDhakaDateStart(...Object.values(getDhakaDateParts(date)));
}

export function getDhakaTodayEnd(date = new Date()) {
  return new Date(getDhakaTodayStart(date).getTime() + DAY_MS - 1);
}

export function addDhakaCalendarMonths(date, months) {
  const { year, month, day } = getDhakaDateParts(date);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth, 0)
  ).getUTCDate();

  return getDhakaDateStart(targetYear, targetMonth, Math.min(day, lastDay));
}

export function addDhakaCalendarDays(date, days) {
  const { year, month, day } = getDhakaDateParts(date);
  const target = new Date(Date.UTC(year, month - 1, day + days));

  return getDhakaDateStart(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate()
  );
}

export function getMembershipStatus(membership, now = new Date()) {
  if (!membership || membership.active === false) return "expired";

  const todayStart = getDhakaTodayStart(now);
  const todayEnd = getDhakaTodayEnd(now);
  const startDate = new Date(membership.startDate);
  const expiryDate = new Date(membership.expiryDate);

  if (startDate > todayEnd) return "upcoming";
  if (expiryDate < todayStart) return "expired";

  return "active";
}

export function getMembershipMonthCode(date = new Date()) {
  return MONTH_CODES[getDhakaDateParts(date).month - 1];
}
