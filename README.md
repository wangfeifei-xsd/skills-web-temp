# skills-web-temp

面向 **skills-server** 的 Web 管理端：用 React + TypeScript + Vite 构建，界面使用 Ant Design（中文语言包）。在浏览器中配置服务地址与 LLM、管理技能书、驱动 Agent 执行，并维护 Shell 命令黑名单与命中审计。

## 功能概览

| 模块 | 说明 |
|------|------|
| **服务 & 模型** | 设置后端根地址（默认 `http://localhost:3000`），请求统一走 `{baseUrl}/api/v1`。读写服务端 LLM 配置（Base URL、API Key、模型名），供生成、润色、Agent 等能力使用。 |
| **导入技能书** | 上传符合约定的 **ZIP** 技能包，调用 `/skills/import` 导入到服务端。 |
| **技能书列表** | 拉取已导入技能，支持查看结构化详情、删除技能目录。 |
| **Agent 执行** | 输入自然语言与 JSON 上下文，先 **生成 Agent 计划**，再 **确认运行**；展示多轮 trace（思考 / 动作 / 观察）与最终摘要，可追加「补充信息」继续多轮计划。 |
| **生成技能书** | 用自然语言描述需求，经 LLM **润色** 得到 `GenerateSkillDto` JSON；支持 **预览** 生成文件树、**下载 ZIP**（浏览器侧保存）、**生成并导入** 到服务端 `static/skills`。 |
| **命令行黑名单配置** | 查看永久封禁规则、增删改可配置黑名单命令，降低 Agent 执行危险 Shell 的风险。 |
| **黑名单命中记录** | 按类别、关键字、时间等条件查询拦截记录（数据由服务端 SQLite 等存储提供）。 |
| **日志** | 本页操作与请求结果的本地时间线日志，便于联调。 |

## 技术栈

- **React 19**、**TypeScript**、**Vite 8**
- **Ant Design 6**、**@ant-design/icons**

## 环境要求

- Node.js 建议 **18+**
- 需先启动 **skills-server**，否则除「服务地址」外多数接口会失败

## 本地开发

```bash
npm install
npm run dev
```

默认通过 Vite 本地开发服务器打开页面；在「服务 & 模型」里把后端地址指到正在运行的 skills-server。

## 构建与预览

```bash
npm run build
npm run preview
```

产物在 `dist/`，可部署到任意静态资源托管，并确保浏览器能访问你的 skills-server（注意跨域与 HTTPS 策略）。

## 代码质量

```bash
npm run lint
```

## 仓库说明

本目录既可作为独立仓库使用，也可放在与 `skills-server` 同级的 monorepo 中；与后端的契约以 skills-server 的 `GET/POST /api/v1/...` 为准。
