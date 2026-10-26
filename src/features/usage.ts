import { loadSettings } from "../config.js";
import { ScopedState } from "./state.js";

export interface UsageDay { tokens: number; cost: number; turns: number; unknown: number }
export class UsageLedger {
  private readonly state: ScopedState<Record<string, UsageDay>>;
  constructor(root?: string) { this.state = new ScopedState("usage", () => ({}), root); }
  private day(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: loadSettings().budget?.timeZone ?? "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  today(key: string): UsageDay { return this.state.get(key)[this.day()] ?? { tokens: 0, cost: 0, turns: 0, unknown: 0 }; }
  add(key: string, tokens: number, cost: number, known: boolean): void {
    const days = this.state.get(key);
    const current = this.today(key);
    current.turns++;
    if (!known) current.unknown++;
    current.tokens += tokens; current.cost += cost;
    days[this.day()] = current;
    this.state.set(key, days);
  }
  check(key: string): void {
    const budget = loadSettings().budget;
    const used = this.today(key);
    for (const limit of [budget?.dailyTokens, budget?.dailyCost]) {
      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) throw new Error("预算必须为正数");
    }
    if (budget?.dailyTokens && used.tokens >= budget.dailyTokens) throw new Error("今日已报告的 Token 用量达到预算");
    if (budget?.dailyCost && used.cost >= budget.dailyCost) throw new Error("今日已报告的费用达到预算");
  }
}
