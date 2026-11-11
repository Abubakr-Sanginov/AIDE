import { test } from "node:test";
import assert from "node:assert/strict";
import { BridgeError, parseStyles, projectFile } from "../src/lib/bridgeArgs.ts";

test("bridge: CSS list is parsed and malformed parts are dropped", () => {
  assert.deepEqual(parseStyles("color:#111;padding: 16px;;bad;:x;1x:y"), { color: "#111", padding: "16px" });
});

test("bridge: CSS values go through the cleaner (no external urls)", () => {
  const out = parseStyles("background:url(https://evil.example/x.png);width:10px");
  assert.ok(!(out.background ?? "").includes("evil.example"));
  assert.equal(out.width, "10px");
});

test("bridge: property names must be plain CSS names", () => {
  assert.deepEqual(parseStyles("color):1;a b:2;{x}:3;-:4"), {});
});

test("bridge: file paths stay inside the project", () => {
  assert.equal(projectFile("D:\\proj", "src/a.ts"), "D:\\proj\\src\\a.ts");
  for (const bad of ["../x", "src/../../x", "C:/Windows/x", "", "a//b"]) {
    assert.throws(() => projectFile("D:\\proj", bad), BridgeError, bad);
  }
});

test("bridge: file paths are refused when no project is open", () => {
  assert.throws(() => projectFile(null, "a.ts"), BridgeError);
});
