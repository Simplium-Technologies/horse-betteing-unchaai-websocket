import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { prisma } from "./db";

const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

const clients = new Set<any>();

function broadcast(event: string, data: any) {
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      clients.delete(client);
    }
  }
}

async function autoCloseRaces() {
  const now = new Date();
  try {
    const openRaces = await prisma.race.findMany({
      where: { status: "OPEN" },
    });

    for (const race of openRaces) {
      if (!race.autoClose || !race.startedAt) continue;
      const closeTime = new Date(race.startedAt.getTime() + race.durationMinutes * 60 * 1000);
      if (now >= closeTime) {
        await prisma.race.update({
          where: { id: race.id },
          data: { status: "CLOSED", closedAt: closeTime },
        });
        broadcast("race:status_changed", { raceId: race.id, status: "CLOSED", closedAt: closeTime.toISOString() });
        console.log(`[cron] Auto-closed race "${race.name}"`);
      }
    }
  } catch (error) {
    console.error("[cron] Auto-close error:", error);
  }
}

setInterval(autoCloseRaces, 1000);

const app = new Elysia()
  .use(
    cors({
      origin: CORS_ORIGIN,
      methods: ["GET", "POST"],
    })
  )
  .ws("/ws", {
    open(ws) {
      clients.add(ws);
      console.log(`[ws] Client connected (${clients.size} total)`);
    },
    close(ws) {
      clients.delete(ws);
      console.log(`[ws] Client disconnected (${clients.size} total)`);
    },
    message(ws, message) {
      try {
        const msg = typeof message === "string" ? JSON.parse(message) : message;
        if (msg.action === "ping") {
          ws.send(JSON.stringify({ event: "pong", data: {} }));
        }
      } catch {}
    },
  })
  .post("/notify", ({ body }) => {
    const { event, data } = body as { event: string; data: any };
    if (event && data) {
      broadcast(event, data);
    }
    return { success: true };
  })
  .get("/health", () => ({ status: "ok", clients: clients.size }))
  .listen(PORT);

console.log(`[server] Elysia WebSocket running on port ${PORT}`);
console.log(`[server] Health check: http://localhost:${PORT}/health`);

export type App = typeof app;
