# Kura

[English](README-EN.md)

Kura 是一个面向 NAS 场景的动漫优先媒体自动化系统。

它覆盖 RSS 订阅、BT/磁力下载、文件整理、元数据修复、本地素材缓存、数据健康检查和浏览器播放，适合在自托管环境中管理动漫为主的媒体库。

![Kura 首页工作台](docs/images/kura-home.png)

## 主要功能

- 动漫媒体库：按作品、季度、集数管理内容，支持封面、播放进度、缺失集、标签、元数据审计和修复。
- RSS 订阅：管理多个 RSS 源，解析候选资源，按作品合并发布版本，并根据订阅策略自动下载或进入审核。
- 手动导入：支持磁力链接和 `.torrent` 文件，可指定动漫、电影、电视剧或自动识别媒体类型。
- 下载同步：通过 aria2 JSON-RPC 同步 BT/磁力任务，展示进度、速度、状态、来源和失败原因。
- 文件整理：为下载目录和导入目录生成 dry-run 整理计划，确认目标路径、匹配结果、置信度和冲突状态后再执行。
- 元数据修复：通过规则、外部元数据源和可选 AI 能力修复标题、别名、封面、简介、季信息和集数映射。
- 历史补番：识别缺失集、订阅范围、历史候选、合集包和绝对集数资源。
- 本地素材缓存：将封面、背景图和元数据保存到 NAS 本地目录。
- 浏览器播放：支持网页播放、HLS 准备、字幕、观看进度和继续观看。
- 数据健康检查：检查候选归组、整理计划、解析规则和媒体路径中的历史问题，并提供安全修复入口。
- 电影与电视剧：提供非动漫内容的媒体库入口和整理能力。
- 文件浏览：只读浏览配置的 NAS 根目录、下载目录、导入目录、媒体库目录和元数据目录。
- 多语言界面：支持英文、简体中文和繁体中文。

## 产品界面

### 动漫库

动漫库是 Kura 的核心入口，围绕作品、季度、集数和播放状态组织内容。

![Kura 动漫库](docs/images/kura-anime-library.png)

### 电视剧库

电影和电视剧用于承载 NAS 上已有或手动导入的非动漫媒体，复用整理、元数据和播放能力。

![Kura 电视剧库](docs/images/kura-tv-library.png)

### 订阅

订阅页负责 RSS 源、手动导入、候选合并和订阅策略管理。用户可以按字幕组、清晰度、编码、语言和集数范围控制下载。

![RSS 与订阅管理](docs/images/kura-subscriptions.png)

### 下载

下载页同步 aria2 任务，展示活跃、等待、暂停、完成和失败任务。

![下载任务管理](docs/images/kura-downloads.png)

### 整理

整理页展示文件移动前的计划预览，高置信度计划可以自动执行，低置信度或冲突计划进入人工审核。

![整理计划](docs/images/kura-organizer.png)

### 文件与数据健康

文件页用于只读浏览配置目录；数据健康页用于检查解析漂移、候选污染、拆分归组和整理问题。

![文件浏览](docs/images/kura-files.png)

![数据健康检查](docs/images/kura-data-health.png)

## 工作流

1. 添加 RSS 源或手动导入磁力 / `.torrent` 文件。
2. Kura 解析候选资源，识别作品、季度、集数、字幕组、清晰度、编码和语言。
3. 订阅策略决定自动下载、忽略或进入审核。
4. aria2 执行下载，Kura 同步任务状态和失败原因。
5. 下载完成后生成整理计划，确认目标路径和风险。
6. 执行归档，更新媒体库、元数据、本地素材和播放入口。
7. 数据健康检查持续发现历史解析和整理问题。

## 产品特点

- 面向动漫命名规则设计，不把字幕组、季度、集数和发布版本当作普通文件名处理。
- 自动化流程可追踪，RSS 候选、订阅命中、下载任务、整理计划和修复结果都有记录。
- 文件操作以 NAS 安全为前提，整理默认先预览，路径必须位于配置的允许根目录内。
- AI 能力可选，只用于候选归组、标题等价和整理审核，不绕过低置信度审核与路径安全检查。
- 支持 Docker Compose 和 Unraid 部署，适合长期运行在家庭服务器或 NAS 环境中。

## 技术栈

- Web：Next.js App Router、React、TypeScript
- 数据库：PostgreSQL、Prisma
- 后台任务：独立 Node worker、Postgres-backed job queue
- 下载器：aria2 JSON-RPC
- 媒体处理：本地文件扫描、整理计划、HLS/转码目录、本地素材缓存
- 部署：Docker Compose、Unraid 目录映射
- 国际化：英文、简体中文、繁体中文

## 快速开始

```bash
cp .env.example .env
npm install
npm run prisma:migrate:dev
npm run dev
```

启动后台任务：

```bash
npm run worker
```

默认访问地址：

```text
http://localhost:3000/zh-Hans
```

常用命令：

```bash
npm run lint
npm run test
npm run build
```

## 文档

- [部署和本地开发](docs/deployment.md)
- [Unraid 部署指南](docs/unraid-deployment.md)
- [订阅策略路线图](docs/subscription-strategy-roadmap.md)
- [历史补番设计](docs/history-backfill-plan.md)
- [产品基线](docs/kura-product-baseline.md)
- [开发规范与项目宪章](docs/development-charter.zh-CN.md)

## 项目状态

Kura 正在持续开发中。当前重点是动漫 RSS/订阅工作流、aria2 下载同步、整理自动化、元数据与封面修复、数据健康检查、浏览器播放，以及电影、电视剧和文件浏览等 NAS 媒体辅助能力。
