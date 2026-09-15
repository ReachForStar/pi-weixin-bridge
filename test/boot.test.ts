import { describe, it, expect } from "vitest";
import { renderSystemdUnit } from "../src/daemon/boot.js";

describe("renderSystemdUnit", () => {
  it("生成 Type=forking 用户服务单元，PIDFile 指向 supervisor.pid", () => {
    const unit = renderSystemdUnit(
      "/usr/bin/node",
      "/opt/pi-weixin-bridge/bin/pi-weixin-bridge.js",
      "/home/u/.pi-weixin-bridge/daemon/supervisor.pid",
    );
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("Type=forking");
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/pi-weixin-bridge/bin/pi-weixin-bridge.js daemon start",
    );
    expect(unit).toContain("PIDFile=/home/u/.pi-weixin-bridge/daemon/supervisor.pid");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("路径含空格时保持单参数序列（systemd ExecStart 按空白分词）", () => {
    const unit = renderSystemdUnit(
      "/usr/bin/node",
      "/opt/my bridge/bin/pi-weixin-bridge.js",
      "/home/u/state daemon/supervisor.pid",
    );
    // 含空格的路径需要引号包裹才能被 systemd 正确分词
    expect(unit).toContain("ExecStart=/usr/bin/node \"/opt/my bridge/bin/pi-weixin-bridge.js\" daemon start");
  });
});
