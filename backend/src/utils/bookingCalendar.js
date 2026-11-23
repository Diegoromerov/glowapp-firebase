const TIME_ZONE = 'America/Bogota';

function getColombiaDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function getColombiaDayRange(value) {
  const localDate = getColombiaDateParts(value);
  if (!localDate) return null;
  const [year, month, day] = localDate.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day) return null;
  const start = new Date(`${localDate}T05:00:00.000Z`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { localDate, start, endExclusive };
}

function isValidColombiaDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const range = getColombiaDayRange(`${value}T12:00:00.000Z`);
  return range !== null && range.localDate === value;
}

function getWeekdayInColombia(value) {
  const localDate = getColombiaDateParts(value);
  if (!localDate) return null;
  return new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
}

function getColombiaTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function getColombiaSchedule({ date, weeklySchedule, activeStartHour, activeEndHour }) {
  if (!isValidColombiaDate(date)) return null;
  if (typeof weeklySchedule === 'string') {
    try {
      weeklySchedule = JSON.parse(weeklySchedule);
    } catch (_) {
      return null;
    }
  }
  const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const dayName = dayNames[getWeekdayInColombia(`${date}T12:00:00.000Z`)];
  const dayConfig = weeklySchedule && weeklySchedule[dayName];
  if (dayConfig) {
    return {
      isActive: dayConfig.activo !== false,
      startHour: dayConfig.inicio !== undefined ? Number.parseInt(dayConfig.inicio, 10) : 6,
      endHour: dayConfig.fin !== undefined ? Number.parseInt(dayConfig.fin, 10) : 20,
    };
  }
  return {
    isActive: true,
    startHour: activeStartHour == null ? 6 : Number.parseInt(activeStartHour, 10),
    endHour: activeEndHour == null ? 20 : Number.parseInt(activeEndHour, 10),
  };
}

function isWithinColombiaSchedule({ scheduledAt, durationMinutes, schedule, now = new Date(), intervalMinutes = 30 }) {
  const start = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  const currentTime = now instanceof Date ? now : new Date(now);
  if (!schedule?.isActive || Number.isNaN(start.getTime()) || Number.isNaN(currentTime.getTime()) || start < currentTime) return false;

  const startHour = Number(schedule.startHour);
  const endHour = Number(schedule.endHour);
  const duration = Number(durationMinutes);
  const interval = Number(intervalMinutes);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23 ||
      !Number.isInteger(endHour) || endHour < 1 || endHour > 24 || endHour <= startHour ||
      !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(interval) || interval <= 0) return false;

  const [hour, minute] = getColombiaTime(start).split(':').map(Number);
  const [utcClock, millisecondsWithZone] = start.toISOString().split('T')[1].split('.');
  const secondsValue = Number(utcClock.split(':')[2]);
  const millis = Number(millisecondsWithZone.replace('Z', ''));
  const startMinutes = hour * 60 + minute;
  const openMinutes = startHour * 60;
  const closeMinutes = endHour * 60;
  return secondsValue === 0 && millis === 0 && startMinutes >= openMinutes &&
    startMinutes + duration <= closeMinutes && (startMinutes - openMinutes) % interval === 0;
}

function buildAvailabilitySlots({ date, startHour, endHour, durationMinutes, activeBookings = [], now = new Date(), intervalMinutes = 30 }) {
  if (!isValidColombiaDate(date) ||
      !Number.isInteger(Number(startHour)) || Number(startHour) < 0 || Number(startHour) > 23 ||
      !Number.isInteger(Number(endHour)) || Number(endHour) < 1 || Number(endHour) > 24 ||
      Number(endHour) <= Number(startHour) || !Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0 ||
      !Number.isFinite(Number(intervalMinutes)) || Number(intervalMinutes) <= 0) return [];

  const startTime = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00-05:00`);
  const endTime = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00-05:00`);
  const nowDate = now instanceof Date ? now : new Date(now);
  if ([startTime, endTime, nowDate].some((value) => Number.isNaN(value.getTime()))) return [];

  const slots = [];
  for (let slotStart = startTime; slotStart < endTime; slotStart = new Date(slotStart.getTime() + Number(intervalMinutes) * 60_000)) {
    const slotEnd = new Date(slotStart.getTime() + Number(durationMinutes) * 60_000);
    const isAvailable = slotStart >= nowDate && slotEnd <= endTime && !activeBookings.some((booking) =>
      slotStart < new Date(booking.end).getTime() && slotEnd > new Date(booking.start).getTime()
    );
    slots.push({ time: getColombiaTime(slotStart), is_available: isAvailable });
  }
  return slots;
}

module.exports = { TIME_ZONE, getColombiaDateParts, getColombiaDayRange, isValidColombiaDate, getWeekdayInColombia, getColombiaTime, getColombiaSchedule, isWithinColombiaSchedule, buildAvailabilitySlots };
