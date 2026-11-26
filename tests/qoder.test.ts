import { test } from "node:test";
import assert from "node:assert/strict";
import { qoderCommands, qoderStep } from "../src/lib/qoderSetup.ts";
import { mergeToolEvent } from "../src/lib/toolEvents.ts";
import { validateCustomProvider } from "../src/lib/customProvider.ts";

test("without the CLI the next step is installing it, even when the desktop app is there", () => {
  assert.equal(qoderStep({ cli: null }), "install");
  assert.equal(qoderStep({ cli: "C:/x/qodercli.exe" }), "check");
});

test("setup commands are the official ones for the system", () => {
  assert.match(qoderCommands(true).install, /^irm https:\/\/qoder\.com\/install\.ps1/);
  assert.match(qoderCommands(false).install, /^curl -fsSL https:\/\/qoder\.com\/install /);
  assert.equal(qoderCommands(true).login, "qodercli login");
});

test("a custom provider cannot claim the Qoder kind or its id", () => {
  const cfg = { id: "my-qoder", name: "Q", kind: "qoder", baseUrl: "https://example.com" };
  assert.throws(() => validateCustomProvider(cfg, []), /provider-kind/);
  assert.throws(() => validateCustomProvider({ ...cfg, id: "qoder", kind: "openai" }, [{ id: "qoder" }]), /provider-duplicate/);
});

const row = (tool: string, iteration: number, status = "running") => ({ tool, args: "{}", status, iteration });

test("the last row is finished in place and a new call is added", () => {
  const one = mergeToolEvent([], row("read", 1));
  assert.deepEqual(mergeToolEvent(one, row("read", 1, "ok")), [row("read", 1, "ok")]);
  assert.equal(mergeToolEvent(one, row("edit", 2)).length, 2);
});

test("tools running at the same time finish their own rows", () => {
  const list = [row("read", 1), row("edit", 2)];
  assert.deepEqual(mergeToolEvent(list, row("read", 1, "ok")), [row("read", 1, "ok"), row("edit", 2)]);
  // Two identical calls: the number tells them apart.
  const twins = [row("read", 1), row("read", 2)];
  assert.deepEqual(mergeToolEvent([...twins, row("edit", 3)], row("read", 1, "ok"))[0], row("read", 1, "ok"));
});
