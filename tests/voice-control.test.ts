import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VOICE_PREFS, HOLD_MS, MAX_COMMAND, cleanCommand, hotkeyAction, parseVoicePrefs } from "../src/lib/voiceControl.ts";

test("saved preferences accept only listed hotkeys", () => {
  assert.deepEqual(parseVoicePrefs(null), DEFAULT_VOICE_PREFS);
  assert.deepEqual(parseVoicePrefs("{not json"), DEFAULT_VOICE_PREFS);
  assert.deepEqual(parseVoicePrefs("[1]"), DEFAULT_VOICE_PREFS);
  assert.deepEqual(parseVoicePrefs(JSON.stringify({ enabled: true, hotkey: "F9" })), { enabled: true, hotkey: "F9" });
  // an unknown or dangerous accelerator falls back, "true"-like strings do not enable it
  assert.equal(parseVoicePrefs(JSON.stringify({ enabled: true, hotkey: "Ctrl+Alt+Delete" })).hotkey, "Ctrl+Shift+Space");
  assert.equal(parseVoicePrefs(JSON.stringify({ enabled: "yes" })).enabled, false);
  assert.equal(DEFAULT_VOICE_PREFS.enabled, false, "voice control is opt-in");
});

test("a recognised phrase becomes a command only when it says something", () => {
  assert.equal(cleanCommand("  открой   блендер  и  сделай куб "), "открой блендер и сделай куб");
  assert.equal(cleanCommand("Open Blender."), "Open Blender.");
  for (const noise of ["", "  ", "э", "ээ", "угу", "ага ага", "um uh", "хм...", "ok", "а а а"]) assert.equal(cleanCommand(noise), null, noise);
  assert.equal(cleanCommand("я".repeat(2000))!.length, MAX_COMMAND);
});

test("hotkey: hold to talk, or tap to start and tap to stop", () => {
  // start
  assert.equal(hotkeyAction("idle", "pressed", 0, false), "start");
  // the operating system repeats the press while the keys are held: ignored
  assert.equal(hotkeyAction("listening", "pressed", 0, true), "none");
  // push-to-talk: released after a long hold ends the recording
  assert.equal(hotkeyAction("listening", "released", HOLD_MS, false), "finish");
  assert.equal(hotkeyAction("listening", "released", 5000, false), "finish");
  // a short tap keeps listening, the next tap ends it
  assert.equal(hotkeyAction("listening", "released", HOLD_MS - 1, false), "none");
  assert.equal(hotkeyAction("listening", "pressed", 0, false), "finish");
  // pressing during the countdown cancels the pending command
  assert.equal(hotkeyAction("countdown", "pressed", 0, false), "cancel-send");
  // while recognising nothing happens
  assert.equal(hotkeyAction("working", "pressed", 0, false), "none");
  assert.equal(hotkeyAction("idle", "released", 9999, false), "none");
});
