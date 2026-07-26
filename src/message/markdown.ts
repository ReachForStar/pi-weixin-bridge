// Markdown 渲染辅助：格式化与转义，适配微信消息文本。
// 微信消息对 markdown 的支持有限，这里提供常用的格式化与转义工具。

/** 转义 markdown 特殊字符，用于纯文本上下文 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|])/g, "\\$1");
}

/** 加粗 */
export function bold(text: string): string {
  return `**${text}**`;
}

/** 斜体 */
export function italic(text: string): string {
  return `*${text}*`;
}

/** 行内代码 */
export function inlineCode(text: string): string {
  return `\`${text}\``;
}

/** 代码块 */
export function codeBlock(code: string, lang = ""): string {
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

/** 链接 */
export function link(text: string, url: string): string {
  return `[${text}](${url})`;
}

/** 无序列表 */
export function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** 有序列表 */
export function orderedList(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/** 引用 */
export function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * 将过长的文本按段落分块（微信单条消息有长度限制）。
 * 优先按换行分段，尽量在段落边界切分，避免破坏 markdown 结构。
 */
export function chunkText(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  // 单段仍超长时硬切
  const result: string[] = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += maxLen) {
      result.push(chunk.slice(i, i + maxLen));
    }
  }
  return result;
}
