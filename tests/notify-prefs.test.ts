import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, inQuietHours, parsePrefs, planNotice, type NotifyPrefs } from "../src/lib/notifyPrefs.ts";

const prefs = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ ...DEFAULT_PREFS, ...over });

test("saved preferences: bad data falls back field by field", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("{not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("[1,2]"), DEFAULT_PREFS);
  const p = parsePrefs(JSON.stringify({ system: false, kinds: { done: false, error: "yes" }, quietFrom: 99, quietTo: 7, quiet: true }));
  assert.equal(p.system, false);
  assert.equal(p.kinds.done, false);
  assert.equal(p.kinds.error, true); // not a boolean: default
  assert.equal(p.quietFrom, DEFAULT_PREFS.quietFrom); // out of range: default
  assert.equal(p.quietTo, 7);
  assert.equal(p.quiet, true);
});

test("quiet hours, including a range that wraps past midnight", () => {
  const night = { quiet: true, quietFrom: 22, quietTo: 8 };
  for (const h of [22, 23, 0, 3, 7]) assert.equal(inQuietHours(night, h), true, String(h));
  for (const h of [8, 12, 21]) assert.equal(inQuietHours(night, h), false, String(h));
  const day = { quiet: true, quietFrom: 13, quietTo: 15 };
  assert.deepEqual([12, 13, 14, 15].map((h) => inQuietHours(day, h)), [false, true, true, false]);
  assert.equal(inQuietHours({ quiet: true, quietFrom: 5, quietTo: 5 }, 17), true);
  assert.equal(inQuietHours({ ...night, quiet: false }, 23), false);
});

test("what happens for an event", () => {
  // In the window: only the toast
  assert.deepEqual(planNotice(prefs(), "done", 12, true), { toast: true, system: false, sound: false });
  // Away: system notification and sound
  assert.deepEqual(planNotice(prefs(), "error", 12, false), { toast: true, system: true, sound: true });
  // Away but quiet hours: toast only
  assert.deepEqual(planNotice(prefs({ quiet: true }), "error", 23, false), { toast: true, system: false, sound: false });
  // Switches
  assert.deepEqual(planNotice(prefs({ system: false }), "done", 12, false), { toast: true, system: false, sound: true });
  assert.deepEqual(planNotice(prefs({ sound: false }), "done", 12, false), { toast: true, system: true, sound: false });
  // A muted kind does nothing at all
  const muted = prefs({ kinds: { ...DEFAULT_PREFS.kinds, done: false } });
  assert.deepEqual(planNotice(muted, "done", 12, false), { toast: false, system: false, sound: false });
  assert.equal(planNotice(muted, "permission", 12, false).system, true);
});
