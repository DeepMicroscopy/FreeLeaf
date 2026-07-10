import { createServer } from "node:http";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebSocket, WebSocketServer } from "ws";

import { Room } from "./room.js";
import { InvalidCollabToken, verifyCollabToken } from "./token.js";

const PORT = Number(process.env.PORT ?? 1234);
const COLLAB_SHARED_SECRET = process.env.COLLAB_SHARED_SECRET ?? "dev-insecure-collab-secret";

// Outer wire message types — must match apps/web's y-websocket client exactly
// (see node_modules/y-websocket/src/y-websocket.js). messageAuth (2) and
// messageQueryAwareness (3) aren't used here: auth happens once at connect
// time via the signed token, not in-band per Yjs's own auth protocol.
const messageSync = 0;
const messageAwareness = 1;

const rooms = new Map<string, Room>();

async function getOrCreateRoom(fileId: string): Promise<Room> {
  let room = rooms.get(fileId);
  if (!room) {
    room = new Room(fileId);
    rooms.set(fileId, room);
  }
  await room.ready;
  return room;
}

interface ConnState {
  readOnly: boolean;
  controlledClientIds: Set<number>;
}

function send(ws: WebSocket, encoder: encoding.Encoder): void {
  if (encoding.length(encoder) === 0) return;
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(encoding.toUint8Array(encoder));
}

function handleMessage(ws: WebSocket, room: Room, state: ConnState, data: ArrayBuffer): void {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      encoding.writeVarUint(encoder, messageSync);
      readSyncMessage(decoder, encoder, room, ws, state.readOnly);
      // readSyncMessage only writes a reply for step1 (step2/update produce
      // none) — length is always >= 1 here from the outer byte alone, so
      // only send if something beyond that outer byte was actually written.
      if (encoding.length(encoder) > 1) send(ws, encoder);
      break;
    }
    case messageAwareness: {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      break;
    }
    default:
      break;
  }
}

function setupConnection(ws: WebSocket, room: Room, readOnly: boolean): ConnState {
  room.clientCount += 1;
  const state: ConnState = { readOnly, controlledClientIds: new Set() };

  const awarenessChangeHandler = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = added.concat(updated, removed);
    if (origin === ws) {
      for (const clientId of added) state.controlledClientIds.add(clientId);
      for (const clientId of removed) state.controlledClientIds.delete(clientId);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed));
    send(ws, encoder);
  };
  room.awareness.on("update", awarenessChangeHandler);

  const updateHandler = (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    send(ws, encoder);
  };
  room.ydoc.on("update", updateHandler);

  ws.on("close", () => {
    room.ydoc.off("update", updateHandler);
    room.awareness.off("update", awarenessChangeHandler);
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(state.controlledClientIds), null);
    room.clientCount -= 1;
    if (room.clientCount <= 0) {
      const fileId = [...rooms.entries()].find(([, r]) => r === room)?.[0];
      void room.destroy();
      if (fileId) rooms.delete(fileId);
    }
  });

  // Initial handshake: our state vector (step1) and current content (step2),
  // then ask the client for theirs so a reconnect after a drop converges.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.ydoc);
  send(ws, encoder);

  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder2 = encoding.createEncoder();
    encoding.writeVarUint(encoder2, messageAwareness);
    encoding.writeVarUint8Array(
      encoder2,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys())),
    );
    send(ws, encoder2);
  }

  return state;
}

/** Mirrors y-protocols/sync's readSyncMessage, except step2/update are
 * skipped (not applied to the doc) for read-only (viewer) connections —
 * they still receive step1's reply, so they see the doc, they just can't
 * mutate it. See apps/collab README note in server.ts history / Status.md
 * for the caveat: a maliciously crafted step2 could still slip an update
 * through this specific gate; the real enforcement is server-side role
 * checks on the REST API, this is defense in depth, not the only line. */
function readSyncMessage(
  decoder: decoding.Decoder,
  encoder: encoding.Encoder,
  room: Room,
  origin: WebSocket,
  readOnly: boolean,
): void {
  const innerType = decoding.readVarUint(decoder);
  switch (innerType) {
    case syncProtocol.messageYjsSyncStep1:
      syncProtocol.readSyncStep1(decoder, encoder, room.ydoc);
      break;
    case syncProtocol.messageYjsSyncStep2:
      if (!readOnly) syncProtocol.readSyncStep2(decoder, room.ydoc, origin);
      break;
    case syncProtocol.messageYjsUpdate:
      if (!readOnly) syncProtocol.readUpdate(decoder, room.ydoc, origin);
      break;
    default:
      break;
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
  ws.binaryType = "arraybuffer";
  ws.on("error", () => ws.close());

  const url = new URL(req.url ?? "/", "http://internal");
  const fileId = url.pathname.replace(/^\//, "");
  const token = url.searchParams.get("token") ?? "";

  let payload;
  try {
    payload = verifyCollabToken(token, COLLAB_SHARED_SECRET);
  } catch (err) {
    const reason = err instanceof InvalidCollabToken ? err.message : "invalid token";
    ws.close(4401, reason);
    return;
  }
  if (payload.file_id !== fileId) {
    ws.close(4401, "token does not match room");
    return;
  }

  // The client sends its own sync step1 immediately on open — before
  // getOrCreateRoom's async content fetch resolves. Buffer any message that
  // arrives before the room is ready instead of attaching the real handler
  // late, which would silently drop that first message (EventEmitter doesn't
  // queue events for listeners that aren't attached yet) and leave the
  // client stuck never receiving the step2 reply that marks it synced.
  const pending: ArrayBuffer[] = [];
  ws.on("message", (data: ArrayBuffer) => pending.push(data));

  void getOrCreateRoom(fileId).then((room) => {
    if (ws.readyState !== WebSocket.OPEN) return; // client may have gone already
    const state = setupConnection(ws, room, payload.role === "viewer");
    ws.removeAllListeners("message");
    for (const data of pending) handleMessage(ws, room, state, data);
    ws.on("message", (data: ArrayBuffer) => handleMessage(ws, room, state, data));
  });
});

server.listen(PORT, () => {
  console.log(`collab listening on :${PORT}`);
});
