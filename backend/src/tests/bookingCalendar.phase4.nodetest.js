const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getColombiaDateParts,
  getColombiaDayRange,
  isValidColombiaDate,
  getWeekdayInColombia,
  getColombiaTime,
  buildAvailabilitySlots,
} = require('../utils/bookingCalendar');

test('booking calendar uses the Colombia wall clock and day boundaries', async (t) => {
  await t.test('maps UTC instants to the Colombia calendar day', () => {
    assert.equal(getColombiaDateParts('2026-11-23T04:59:59.999Z'), '2026-11-22');
    assert.equal(getColombiaDateParts('2026-11-23T05:00:00.000Z'), '2026-11-23');
  });

  await t.test('returns a 24-hour UTC range for a Colombia local day', () => {
    const range = getColombiaDayRange('2026-11-23T12:00:00.000Z');
    assert.equal(range.localDate, '2026-11-23');
    assert.equal(range.start.toISOString(), '2026-11-23T05:00:00.000Z');
    assert.equal(range.endExclusive.toISOString(), '2026-11-24T05:00:00.000Z');
  });

  await t.test('validates real calendar dates rather than only their shape', () => {
    assert.equal(isValidColombiaDate('2026-02-28'), true);
    assert.equal(isValidColombiaDate('2026-02-29'), false);
    assert.equal(isValidColombiaDate('2026-13-01'), false);
    assert.equal(isValidColombiaDate('2026-2-01'), false);
  });

  await t.test('formats weekday and slot time using Colombia local time', () => {
    assert.equal(getWeekdayInColombia('2026-11-23T12:00:00.000Z'), 1);
    assert.equal(getColombiaTime('2026-11-23T14:30:00.000Z'), '09:30');
    assert.equal(getColombiaTime(new Date('2026-11-23T09:00:00-05:00')), '09:00');
  });

  await t.test('rejects invalid instants', () => {
    assert.equal(getColombiaDateParts('not-a-date'), null);
    assert.equal(getColombiaDayRange('not-a-date'), null);
    assert.equal(getColombiaTime('not-a-date'), null);
  });

  await t.test('marks only full-duration, non-overlapping future slots as available', () => {
    const slots = buildAvailabilitySlots({
      date: '2026-11-23',
      startHour: 9,
      endHour: 11,
      durationMinutes: 60,
      now: new Date('2026-11-23T12:00:00.000Z'),
      activeBookings: [{
        start: new Date('2026-11-23T15:00:00.000Z'), // 10:00 en Colombia
        end: new Date('2026-11-23T16:00:00.000Z'),
      }],
    });

    assert.deepEqual(slots, [
      { time: '09:00', is_available: true },
      { time: '09:30', is_available: false },
      { time: '10:00', is_available: false },
      { time: '10:30', is_available: false },
    ]);
  });

  await t.test('rejects a slot that would run past closing time', () => {
    const slots = buildAvailabilitySlots({
      date: '2026-11-23',
      startHour: 9,
      endHour: 10,
      durationMinutes: 45,
      now: new Date('2026-11-23T12:00:00.000Z'),
    });
    assert.deepEqual(slots, [
      { time: '09:00', is_available: true },
      { time: '09:30', is_available: false },
    ]);
  });

  await t.test('supports midnight as the closing boundary', () => {
    const slots = buildAvailabilitySlots({
      date: '2026-11-23',
      startHour: 23,
      endHour: 24,
      durationMinutes: 30,
      now: new Date('2026-11-23T12:00:00.000Z'),
    });
    assert.deepEqual(slots, [
      { time: '23:00', is_available: true },
      { time: '23:30', is_available: true },
    ]);
  });

  await t.test('returns no slots for an impossible date', () => {
    assert.deepEqual(buildAvailabilitySlots({
      date: '2026-02-29',
      startHour: 9,
      endHour: 17,
      durationMinutes: 30,
    }), []);
  });
});
