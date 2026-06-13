// Minimal static file server (no dependencies) for demoing the web tool.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".webm": "video/webm" };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/web/index.html";
  const abs = path.join(root, p);
  if (!abs.startsWith(root) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(abs)] || "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
}).listen(8155, "127.0.0.1", () => console.log("serving on http://127.0.0.1:8155/web/index.html"));
