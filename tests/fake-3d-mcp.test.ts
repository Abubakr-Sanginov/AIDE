import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isSafeImage, makeItem } from "../src/lib/studioPreview.ts";

// The fake 3D MCP server is the fixture for trying the 3D Studio mode without Blender/Unity/Unreal.
test("the fake 3D MCP server answers like a real one and returns a displayable image", async () => {
  const child = spawn(process.execPath, ["scripts/fake-3d-mcp.mjs"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, (v: any) => void>();
  lines.on("line", (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let id = 0;
  const call = (method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  try {
    const init = await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "fake-3d");
    const list = await call("tools/list", {});
    assert.deepEqual(list.result.tools.map((t: any) => t.name), ["get_viewport_screenshot", "execute_code"]);
    const shot = await call("tools/call", { name: "get_viewport_screenshot", arguments: {} });
    const img = shot.result.content[0];
    assert.equal(img.type, "image");
    assert.ok(isSafeImage({ mime: img.mimeType, data: img.data }));
    assert.ok(makeItem({ mime: img.mimeType, data: img.data }, "mcp__fake3d__get_viewport_screenshot"));
    const code = await call("tools/call", { name: "execute_code", arguments: { code: "print(1)" } });
    assert.match(code.result.content[0].text, /not executed/);
  } finally {
    child.kill();
  }
});
