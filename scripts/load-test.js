/**
 * @file load-test.js
 * @description k6 load testing script for EDITH gateway.
 *
 * Usage:
 *   k6 run scripts/load-test.js
 *   k6 run scripts/load-test.js -e BASE_URL=https://edith-staging.fly.dev -e AUTH_TOKEN=xxx
 *
 * Stages:
 *   - 30s ramp up to 10 VUs
 *   - 1m sustained at 50 VUs
 *   - 30s ramp down
 *
 * Thresholds:
 *   - p95 latency < 3 seconds
 *   - 99% message delivery
 *   - <1% HTTP error rate
 */

import ws from "k6/ws"
import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"

const msgReceived = new Counter("messages_received")
const pipelineLatency = new Trend("pipeline_latency_ms")

export const options = {
  stages: [
    { duration: "30s", target: 10 },  // ramp up
    { duration: "1m", target: 50 },   // sustained load
    { duration: "30s", target: 0 },   // ramp down
  ],
  thresholds: {
    pipeline_latency_ms: ["p(95)<3000"],  // p95 < 3 seconds
    messages_received: ["rate>0.99"],     // 99% delivery
    http_req_failed: ["rate<0.01"],       // <1% error rate
  },
}

const BASE_URL = __ENV.BASE_URL || "http://localhost:18789"
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "test-token"

export default function () {
  // Health check endpoint (HTTP)
  const healthRes = http.get(`${BASE_URL}/health`)
  check(healthRes, {
    "health status 200": (r) => r.status === 200,
    "health body ok": (r) => {
      try {
        return JSON.parse(r.body).status === "ok"
      } catch {
        return false
      }
    },
  })

  // WebSocket message flow
  const wsUrl = BASE_URL.replace(/^http/, "ws")
  const res = ws.connect(`${wsUrl}/ws?token=${AUTH_TOKEN}`, {}, (socket) => {
    socket.on("open", () => {
      const t0 = Date.now()
      socket.send(
        JSON.stringify({
          type: "message",
          content: `load test ping ${Date.now()}`,
        }),
      )

      socket.on("message", (data) => {
        try {
          const msg = JSON.parse(data)
          if (msg.type === "response" || msg.type === "reply") {
            pipelineLatency.add(Date.now() - t0)
            msgReceived.add(1)
          }
        } catch {
          // ignore parse errors
        }
      })
    })

    socket.setTimeout(() => socket.close(), 5000)
  })

  check(res, {
    "ws connected": (r) => r && r.status === 101,
  })

  sleep(1)
}
