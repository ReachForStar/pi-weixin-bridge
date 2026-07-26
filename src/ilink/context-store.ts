// context_token / typing ticket 持久化存储。
// - 按用户持久化 context_token（每条入站消息刷新），重启后可恢复，支持主动推送消息。
// - typing ticket 带过期时间，过期后调用方应重新 getconfig 获取。
// 存储于 STATE_DIR/context.json。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger/index.js";

interface ContextEntry {
  contextToken: string;
  typingTicket?: string;
  /** typing ticket 过期时间戳（ms）；过期后需重新 getconfig */
  ticketExpiresAt?: number;
  updatedAt: number;
}

type ContextData = Record<string, ContextEntry>;

export class ContextStore {
  private store = new Map<string, ContextEntry>();

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as ContextData;
      for (const [userId, entry] of Object.entries(data)) {
        this.store.set(userId, entry);
      }
      logger.debug(`ContextStore 已恢复 ${this.store.size} 个用户的上下文`);
    } catch (err) {
      logger.warn(`ContextStore 加载失败，忽略: ${String(err)}`);
    }
  }

  /** 持久化到磁盘（写入失败仅告警，不中断） */
  save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const data: ContextData = {};
      for (const [userId, entry] of this.store) data[userId] = entry;
      writeFileSync(this.file, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      logger.warn(`ContextStore 持久化失败: ${String(err)}`);
    }
  }

  /** 记录/刷新用户的 context_token（来自入站消息） */
  setContextToken(userId: string, contextToken: string): void {
    const entry = this.store.get(userId) ?? { contextToken, updatedAt: Date.now() };
    entry.contextToken = contextToken;
    entry.updatedAt = Date.now();
    this.store.set(userId, entry);
    this.save();
  }

  /** 获取用户最新的 context_token（用于回复或主动推送） */
  getContextToken(userId: string): string | undefined {
    return this.store.get(userId)?.contextToken;
  }

  /** 缓存用户的 typing ticket（带 TTL，过期自动失效） */
  setTypingTicket(userId: string, ticket: string, ttlMs: number): void {
    const entry = this.store.get(userId) ?? { contextToken: "", updatedAt: Date.now() };
    entry.typingTicket = ticket;
    entry.ticketExpiresAt = Date.now() + ttlMs;
    this.store.set(userId, entry);
    this.save();
  }

  /** 获取未过期的 typing ticket；过期则清除并返回 undefined（调用方应重新 getconfig） */
  getTypingTicket(userId: string): string | undefined {
    const entry = this.store.get(userId);
    if (!entry?.typingTicket) return undefined;
    if (entry.ticketExpiresAt && Date.now() > entry.ticketExpiresAt) {
      entry.typingTicket = undefined;
      entry.ticketExpiresAt = undefined;
      this.store.set(userId, entry);
      return undefined;
    }
    return entry.typingTicket;
  }

  /** 已知上下文的用户列表（用于主动推送场景） */
  knownUsers(): string[] {
    return [...this.store.keys()].filter((u) => this.store.get(u)?.contextToken);
  }
}
