import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.01"],
  },
};

const baseUrl = (__ENV.BASE_URL ?? "").replace(/\/$/u, "");
if (!baseUrl) throw new Error("BASE_URL is required");

export default function smoke() {
  const response = http.get(`${baseUrl}/health/live`, {
    headers: { "user-agent": "thaarei-k6-smoke/1.0" },
    timeout: "10s",
  });
  check(response, { "liveness returns 200": (result) => result.status === 200 });
  sleep(1);
}
