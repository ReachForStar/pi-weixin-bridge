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
- toMarkdownBytes：转换 Markdown，ocr 默认为 reject；逐文件授权后才允许 hosted。
- toDocument：受支持的非 PDF 文档可取 document.assets，保留内嵌图片。
- 转换 worker 接收已识别格式，内容签名优先，CSV 等无签名格式使用传入格式。
- CLI 退出码 0 成功，1 转换失败，2 参数错误，3 需要 OCR。

## 上下游依赖

由 [入站文档自动转换](inbound-documents.md) 使用；解析和转换交给此库，不自行实现格式解析。

## 重要变更记录

2026-09-30：用户指定使用 anydoc，并确认安装固定版本依赖。安装成功，真实 PDF 与 Word 转换回归通过；当前由独立 API worker import 固定依赖，源代码与构建产物使用同一 scripts 路径；此前 CLI 定位方式已由 worker 替代。
