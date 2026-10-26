import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
import { once, getEventListeners } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { IlinkClient } from "../src/ilink/client.js";
import { Bridge } from "../src/bridge.js";
import { ContextStore } from "../src/ilink/context-store.js";
import { PiSessionManager } from "../src/pi/sessions.js";

let server: Server | undefined;

async function listen(handler: RequestListener): Promise<string> {
  server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法获取测试监听地址");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

describe("真实网络与退出信号", () => {
  it("响应头到达后正文挂起仍受超时控制", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200);
      response.flushHeaders();
    });
    const client = new IlinkClient(url);
    const started = Date.now();
    await expect(client.getUpdates("", 100)).resolves.toMatchObject({ ret: 0, msgs: [] });
    expect(Date.now() - started).toBeLessThan(1500);
  }, 3000);

  it("已中断的请求直接终止", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new IlinkClient("http://127.0.0.1:1").getUpdates("", 1000, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("失败退避期间退出无需等待三秒", async () => {
    const controller = new AbortController();
    const url = await listen((_request, response) => {
      response.writeHead(503);
      response.end();
      setTimeout(() => controller.abort(), 100);
    });
    mkdirSync("tmp", { recursive: true });
    const directory = mkdtempSync(join("tmp", "bridge-reliability-"));
    const bridge = new Bridge(new IlinkClient(url), new PiSessionManager(),
      new ContextStore(join(directory, "context.json")), "");
    const started = Date.now();
    await bridge.run(controller.signal);
    expect(Date.now() - started).toBeLessThan(1500);
  }, 3000);

  it("多轮重登等待不累积退出监听器", async () => {
    mkdirSync("tmp", { recursive: true });
    vi.stubEnv("PI_WEIXIN_STATE_DIR", mkdtempSync(join("tmp", "account-reliability-")));
    vi.resetModules();
    const { waitForAccountChange } = await import("../src/account.js");
    const controller = new AbortController();
    const baseline = getEventListeners(controller.signal, "abort").length;
    const waiting = waitForAccountChange(null, controller.signal, 10);
    const failure = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(getEventListeners(controller.signal, "abort").length).toBeLessThanOrEqual(baseline + 1);
    } finally {
      controller.abort();
      await failure;
    }
    expect(getEventListeners(controller.signal, "abort").length).toBe(baseline);
  });
});
