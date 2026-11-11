import http from "node:http";
function get(port) {
  return new Promise((r) => {
    const q = http.get({ host: "127.0.0.1", port, timeout: 1500 }, (res) => r(port + ":" + res.statusCode));
    q.on("error", () => r(port + ":down"));
    q.on("timeout", () => { q.destroy(); r(port + ":down"); });
  });
}
console.log(await get(5174));
console.log(await get(8787));
