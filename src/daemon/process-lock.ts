import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

export function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function readProcessId(file: string): number | null {
  try {
    const text = readFileSync(file, "utf8").trim();
    if (!/^\d+$/.test(text)) throw new Error(`进程锁损坏：${file}`);
    const pid = Number(text);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`进程锁损坏：${file}`);
    return pid;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function acquireProcessLock(file: string): () => void {
  const write = () => writeFileSync(file, String(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { write(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = readProcessId(file);
    if (pid && processExists(pid)) throw new Error(`已有进程运行（pid ${pid}）`);
    // 回收旧锁也必须独占，并在取得回收权后重读，避免删除其他启动者的新锁。
    const reclaim = `${file}.reclaim`;
    writeFileSync(reclaim, String(process.pid), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      const current = readProcessId(file);
      if (current && processExists(current)) throw new Error(`已有进程运行（pid ${current}）`);
      if (existsSync(file)) unlinkSync(file);
      write();
    } finally { unlinkSync(reclaim); }
  }
  return () => {
    if (readProcessId(file) === process.pid) unlinkSync(file);
  };
}
