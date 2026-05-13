// utils.js — date helpers

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateJP(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}月${d}日（${DAY_NAMES[date.getDay()]}）`;
}

export function formatDateTimeJP(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 `
    + `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function getDaysInMonth(year, month) {
  // month is 1-indexed; new Date(year, month, 0) gives last day of that month
  return new Date(year, month, 0).getDate();
}

export function getHolidayName(dateStr, holidays) {
  return holidays[dateStr] || null;
}

export function localDate(year, month1, day) {
  // Returns a Date object in local time (avoids UTC midnight issues)
  return new Date(year, month1 - 1, day);
}

export function parseDateStr(dateStr) {
  // 'YYYY-MM-DD' → local Date (not UTC)
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
