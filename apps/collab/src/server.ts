import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 1234);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404).end();
});

// Yjs document sync wiring lands in Phase 5 (§6); this upgrade handler
// is a placeholder so the service shape (HTTP health + WS) exists now.
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  socket.on("error", () => socket.close());
});

server.listen(PORT, () => {
  console.log(`collab listening on :${PORT}`);
});
