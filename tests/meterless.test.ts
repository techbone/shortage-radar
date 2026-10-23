import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoDetect, chat, checkStatus, describeModel, normalizeBaseUrl, parseConnectLink } from "../src/adapters/meterless";

const TOKEN = "ns-test-token-123";
let server: http.Server;
let port: number;
const seen: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  // A minimal fake of Meterless Runtime 1.4 for the contract checks.
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end();
    if (req.url === "/v1/models") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "meterless/auto" }, { id: "meterless/reasoning.deep" }, { id: "meterless/brand-new-mode" }, { id: "gpt-x" }] }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model } = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ model: model === "meterless/auto" ? "nvidia/nemotron-3.5-lightning-30b-a3b" : model, choices: [{ message: { role: "assistant", content: "pong" } }] }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

describe("Meterless Runtime provider contract v4", () => {
  it.each([
    ["127.0.0.1:8088", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1"],
    ["http://127.0.0.1:8088/v1/v1", "http://127.0.0.1:8088/v1"],
    ["127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1"],
    ["http://localhost:8088/v1/models", "http://localhost:8088/v1"],
    ["http://localhost:8088/healthz", "http://localhost:8088/v1"],
    ["https://nightshift.example.com/", "https://nightshift.example.com/v1"],
  ])("normalizes %s → %s, never /v1/v1", (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it("takes base URL and key from a connect link", () => {
    expect(parseConnectLink("http://127.0.0.1:8088/connect#k=abc123&m=meterless/fast&n=x")).toEqual({ baseUrl: "http://127.0.0.1:8088/v1", token: "abc123", model: "meterless/fast" });
    expect(parseConnectLink("http://127.0.0.1:8088/v1")).toBeNull();
  });

  it("reads routing modes and keeps unknown meterless/* ids", () => {
    expect(describeModel("meterless/auto")).toEqual({ disposition: "auto" });
    expect(describeModel("meterless/reasoning.deep")).toEqual({ class: "reasoning", disposition: "deep" });
  });

  it("a wrong token is unauthorized, not offline", async () => {
    expect((await checkStatus({ baseUrl: `127.0.0.1:${port}`, token: "wrong" })).status).toBe("unauthorized");
    expect((await checkStatus({ baseUrl: `127.0.0.1:${port}`, token: "rt-local" })).status).toBe("unauthorized");
  });

  it("the right token is online and lists only meterless ids, unknown ones kept", async () => {
    const s = await checkStatus({ baseUrl: `http://127.0.0.1:${port}/v1`, token: TOKEN });
    expect(s).toEqual({ status: "online", models: ["meterless/auto", "meterless/reasoning.deep", "meterless/brand-new-mode"] });
  });

  it("nothing listening is offline", async () => {
    expect((await checkStatus({ baseUrl: "http://127.0.0.1:1/v1", token: TOKEN })).status).toBe("offline");
  });

  it("auto detect finds the runtime", async () => {
    const hit = await autoDetect(TOKEN, [1, port], ["127.0.0.1"]);
    expect(hit).toMatchObject({ baseUrl: `http://127.0.0.1:${port}/v1`, status: "online" });
  });

  it("a plain text request on meterless/auto returns a string and the model that answered", async () => {
    const r = await chat({ messages: [{ role: "user", content: "ping" }] }, { baseUrl: `http://127.0.0.1:${port}/v1`, token: TOKEN, model: "meterless/auto" });
    expect(r.content).toBe("pong");
    expect(r.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    const last = seen.at(-1)!;
    expect(last["meterless-app"]).toBe("shortage-radar");
    expect(last["meterless-scope"]).toBe("user");
  });

  it("refuses the rt-local placeholder before sending", async () => {
    await expect(chat({ messages: [{ role: "user", content: "x" }] }, { baseUrl: `http://127.0.0.1:${port}/v1`, token: "rt-local", model: "meterless/auto" })).rejects.toThrow(/placeholder/);
  });
});
