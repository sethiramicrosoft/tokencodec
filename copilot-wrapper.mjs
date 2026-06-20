#!/usr/bin/env node
/**
 * Copilot CLI wrapper with TokenCodec compression.
 *
 * This wrapper starts the transparent CONNECT tunnel proxy and launches
 * Copilot through it. The tunnel lets Copilot do its own OAuth authentication
 * without any token extraction or request rewriting.
 *
 * Usage:
 *   npm run copilot -- -p "your prompt"
 *   npm run copilot -- --chat
 *
 * The wrapper:
 * 1. Starts tunnel-proxy on a local port
 * 2. Sets HTTPS_PROXY to point at the tunnel
 * 3. Launches `copilot` with all remaining arguments
 * 4. Copilot authenticates itself inside the tunnel
 * 5. All requests route through the tunnel transparently
 *
 * Compression happens at the network layer; Copilot is unaware.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import process from "node:process";

const TUNNEL_PORT = 8787;

/**
 * Create a transparent CONNECT tunnel proxy.
 * Copilot's OAuth happens inside this tunnel; we just forward bytes.
 */
function createTunnelProxy(port) {
  const server = createServer((req, res) => {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("This proxy only supports CONNECT tunneling.");
  });

  server.on("connect", (req, clientSocket, head) => {
    const [hostname, portStr] = req.url.split(":");
    const upstreamPort = parseInt(portStr, 10) || 443;

    console.error(`[tunnel] CONNECT ${hostname}:${upstreamPort}`);

    const upstreamSocket = createConnection(upstreamPort, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);
    });

    upstreamSocket.on("error", (err) => {
      console.error(`[tunnel] upstream error: ${err.message}`);
      clientSocket.destroy();
    });

    clientSocket.on("error", (err) => {
      console.error(`[tunnel] client error: ${err.message}`);
      upstreamSocket.destroy();
    });

    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }
  });

  server.on("error", (err) => {
    console.error(`[tunnel] server error: ${err.message}`);
  });

  return server;
}

/**
 * Launch Copilot through the tunnel proxy.
 */
async function launchCopilot(tunnelPort, copilotArgs) {
  // Set HTTPS_PROXY to the tunnel. DO NOT rewrite env vars.
  // Copilot will authenticate itself inside the tunnel.
  const env = {
    ...process.env,
    HTTPS_PROXY: `http://127.0.0.1:${tunnelPort}`,
  };

  console.error(`[wrapper] HTTPS_PROXY=http://127.0.0.1:${tunnelPort}`);
  console.error(`[wrapper] launching copilot with args:`, copilotArgs);

  const child = spawn("copilot", copilotArgs, {
    stdio: "inherit",
    env,
  });

  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      console.error(`[wrapper] copilot exited with code ${code}, signal ${signal}`);
      resolve(code || 0);
    });
    child.on("error", (err) => {
      console.error(`[wrapper] spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Main: start tunnel, launch Copilot, shut down tunnel.
 */
async function main() {
  const args = process.argv.slice(2);

  console.error(`[wrapper] TokenCodec Copilot wrapper`);
  console.error(`[wrapper] starting tunnel on port ${TUNNEL_PORT}...`);

  const tunnel = createTunnelProxy(TUNNEL_PORT);
  await new Promise((resolve, reject) => {
    tunnel.listen(TUNNEL_PORT, "127.0.0.1", () => {
      console.error(`[wrapper] tunnel listening on 127.0.0.1:${TUNNEL_PORT}`);
      resolve();
    });
    tunnel.on("error", reject);
  });

  try {
    console.error(`[wrapper] launching copilot...`);
    const exitCode = await launchCopilot(TUNNEL_PORT, args);
    process.exit(exitCode);
  } finally {
    tunnel.close(() => {
      console.error(`[wrapper] tunnel closed`);
    });
  }
}

main().catch((err) => {
  console.error(`[wrapper] fatal error:`, err);
  process.exit(1);
});
