#!/usr/bin/env node
// Transparent CONNECT tunnel proxy for Copilot CLI (experimental).
//
// The Copilot CLI authenticates itself at runtime (mints its own bearer token).
// This proxy acts as a transparent tunnel: it forwards encrypted HTTPS bytes
// without rewriting, so the CLI's auth flow stays intact.
//
// **Status (experimental):** This implements Option 1 from the user's analysis.
// The tunnel layer works, but Copilot's token validation may fail through the proxy
// due to timing or upstream validation. See README.md for Options 2–3.
//
// Run: node tunnel-proxy.mjs [--port 8787]
// Then: set HTTPS_PROXY=http://127.0.0.1:8787
//       copilot -p "your prompt"

import http from "node:http";
import net from "node:net";

const DEFAULT_PORT = 8787;

function createTunnelProxy(port) {
  const server = http.createServer((req, res) => {
    // Regular HTTP requests (not CONNECT tunnels) — block them
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("This proxy only supports CONNECT tunneling. Set HTTPS_PROXY, not HTTP_PROXY.");
  });

  server.on("connect", (req, clientSocket, head) => {
    const [hostname, portStr] = req.url.split(":");
    const upstreamPort = parseInt(portStr, 10) || 443;

    console.log(`[TunnelProxy] CONNECT ${hostname}:${upstreamPort}`);

    // Create a socket to the upstream server (unencrypted at this layer).
    // TLS/HTTPS happens inside the tunnel; we just forward bytes.
    const upstreamSocket = net.createConnection(upstreamPort, hostname, () => {
      // Once connected, send the 200 OK and start forwarding.
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      // Bi-directional byte forwarding (no modification, no decryption, no inspection).
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });

    upstreamSocket.on("error", (err) => {
      console.error(`[TunnelProxy] Upstream error: ${err.message}`);
      clientSocket.destroy();
    });

    clientSocket.on("error", (err) => {
      console.error(`[TunnelProxy] Client error: ${err.message}`);
      upstreamSocket.destroy();
    });

    // Forward any buffered data from the initial CONNECT request.
    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }
  });

  server.on("error", (err) => {
    console.error(`[TunnelProxy] Server error: ${err.message}`);
  });

  return server;
}

const port = process.argv.includes("--port")
  ? parseInt(process.argv[process.argv.indexOf("--port") + 1], 10)
  : DEFAULT_PORT;

const server = createTunnelProxy(port);
server.listen(port, "127.0.0.1", () => {
  console.log(`[TunnelProxy] Listening on http://127.0.0.1:${port}`);
  console.log(`[TunnelProxy]`);
  console.log(`[TunnelProxy] To use with Copilot CLI (experimental):`);
  console.log(`[TunnelProxy]   set HTTPS_PROXY=http://127.0.0.1:${port}`);
  console.log(`[TunnelProxy]   copilot -p "your prompt"`);
  console.log(`[TunnelProxy]`);
  console.log(`[TunnelProxy] This is a transparent CONNECT tunnel.`);
  console.log(`[TunnelProxy] Copilot authenticates itself inside the tunnel.`);
  console.log(`[TunnelProxy] See README.md for status and alternative approaches.`);
});
