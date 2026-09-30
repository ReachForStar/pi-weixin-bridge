---
title: anydoc 依赖
type: entity
tags: [文档转换, 依赖]
created: 2026-09-30
updated: 2026-09-30
status: active
---

## 职责

将成熟文档格式转换为 GitHub-Flavored Markdown。

## 关键文件与接口

本项目固定使用 @firecrawl/anydoc 0.2.4；接口从安装包 README.md、anydoc.d.ts、index.d.ts 和 cli.js 实际读取。支持 PDF、Word、PowerPoint、Excel、OpenDocument、RTF、EPUB、CSV；原生二进制随平台依赖安装。

- formatFromBytes：识别文档内容。
- formatFromPath：识别扩展名，CSV 等无签名格式需要它。
- CLI 的 --format 显式指定已识别格式，--ocr reject 禁止云端转换。
- CLI 退出码 0 成功，1 转换失败，2 参数错误，3 需要 OCR。

## 上下游依赖

由 [入站文档自动转换](inbound-documents.md) 使用；解析和转换交给此库，不自行实现格式解析。

## 重要变更记录

2026-09-30：用户指定使用 anydoc，并确认安装固定版本依赖。安装成功，真实 PDF 与 Word 转换回归通过；CLI 路径使用 createRequire 定位安装包，源代码、构建产物和测试加载器使用同一 CJS 解析方式。
