// A tiny fake "3D" MCP server for trying the 3D Studio mode without Blender, Unity or Unreal.
// Speaks MCP over stdio (one JSON message per line). Tools:
//   get_viewport_screenshot -> an image (1x1 PNG, enlarged in the preview)
//   execute_code            -> echoes the code (does NOT run it)
// Add it in Settings -> MCP servers -> Your own server: command `node`, argument `scripts/fake-3d-mcp.mjs`.
import { createInterface } from "node:readline";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const TOOLS = [
  {
    name: "get_viewport_screenshot",
    description: "Take a screenshot of the 3D viewport (fake).",
    inputSchema: { type: "object", properties: { max_size: { type: "number" } } },
  },
  {
    name: "execute_code",
    description: "Run Python code in the scene (fake: only echoes it).",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function handle(msg) {
  if (msg.id === undefined) return; // notifications need no answer
  switch (msg.method) {
    case "initialize":
      return reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-3d", version: "0.0.1" },
      });
    case "tools/list":
      return reply(msg.id, { tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args } = msg.params ?? {};
      if (name === "get_viewport_screenshot") {
        return reply(msg.id, { content: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }] });
      }
      if (name === "execute_code") {
        return reply(msg.id, { content: [{ type: "text", text: `ok (not executed): ${String(args?.code ?? "").slice(0, 200)}` }] });
      }
      return reply(msg.id, { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] });
    }
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } }) + "\n");
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    handle(JSON.parse(line));
  } catch {
    // ignore malformed input
  }
});
