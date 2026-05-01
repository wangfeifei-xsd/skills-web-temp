import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  type MenuProps,
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd'
import {
  BulbOutlined,
  CloudUploadOutlined,
  FileTextOutlined,
  HistoryOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import './App.css'

type SkillItem = {
  skillId: string
  name: string
  description: string
  importedAt: string
}

type ShellBlacklistResponse = {
  items?: string[]
  permanentBannedCommands?: string[]
}

type ShellBlacklistHitRow = {
  id: number
  createdAt: string
  category: string
  message: string
  rawCommand: string
  normalizedCommand: string
  argsJson: string
}

type AgentChatMessage = {
  id: string
  role: 'user' | 'agent' | 'system'
  title?: string
  content: string
  collapsible?: boolean
}

type GeneratedSkillPreviewFile = {
  path: string
  content: string
  size: number
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function createMessage(
  role: AgentChatMessage['role'],
  content: string,
  title?: string,
  collapsible = false,
): AgentChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    title,
    content,
    collapsible,
  }
}

function extractApiErrorMessage(data: unknown): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.message === 'string' && d.message.trim()) return d.message
    if (Array.isArray(d.message) && d.message.length > 0) {
      return d.message.map(String).join('；')
    }
    if (typeof d.error === 'string' && d.error.trim()) return d.error
  }
  return ''
}

async function readJsonOrText(resp: Response): Promise<{ data: unknown; raw: string }> {
  const raw = await resp.text()
  if (!raw.trim()) return { data: {}, raw }
  try {
    return { data: JSON.parse(raw) as unknown, raw }
  } catch {
    return { data: { message: raw }, raw }
  }
}

function parseContentDispositionFilename(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      return star[1]
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header)
  if (quoted?.[1]) return quoted[1]
  const plain = /filename=([^;\s]+)/i.exec(header)
  if (plain?.[1]) return plain[1].replace(/^"|"$/g, '')
  return fallback
}

function renderStructuredValue(value: JsonValue, path = 'root'): ReactNode {
  if (value === null) {
    return (
      <Typography.Text type="secondary" code>
        null
      </Typography.Text>
    )
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <Typography.Text>{String(value)}</Typography.Text>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <Typography.Text type="secondary" code>
          []
        </Typography.Text>
      )
    }

    return (
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        {value.map((item, index) => (
          <Card key={`${path}-${index}`} size="small" type="inner" title={`[${index}]`}>
            {renderStructuredValue(item, `${path}-${index}`)}
          </Card>
        ))}
      </Space>
    )
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    return (
      <Typography.Text type="secondary" code>
        {'{}'}
      </Typography.Text>
    )
  }

  return (
    <Space orientation="vertical" size="small" style={{ width: '100%' }}>
      {entries.map(([key, nestedValue]) => {
        const nestedIsObject =
          Array.isArray(nestedValue) ||
          (typeof nestedValue === 'object' && nestedValue !== null)

        return (
          <div key={`${path}-${key}`}>
            <Typography.Text strong>{key}</Typography.Text>
            <div style={{ marginTop: 4, paddingLeft: nestedIsObject ? 12 : 0 }}>
              {renderStructuredValue(nestedValue, `${path}-${key}`)}
            </div>
          </div>
        )
      })}
    </Space>
  )
}

function App() {
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('gpt-4o-mini')
  const [maskedApiKey, setMaskedApiKey] = useState('')
  const [apiKeyDirty, setApiKeyDirty] = useState(false)
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [skillList, setSkillList] = useState<SkillItem[]>([])
  const [detailSkillId, setDetailSkillId] = useState('')
  const [detailResult, setDetailResult] = useState('')
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [agentQuery, setAgentQuery] = useState('帮我搜索知识库')
  const [agentContext, setAgentContext] = useState(JSON.stringify({}, null, 2))
  const [agentMaxIterations, setAgentMaxIterations] = useState(6)
  const [agentPlanId, setAgentPlanId] = useState('')
  const [agentConfirmed, setAgentConfirmed] = useState(false)
  const [agentResult, setAgentResult] = useState('')
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([])
  const [agentReply, setAgentReply] = useState('')
  const [agentNeedsInput, setAgentNeedsInput] = useState(false)
  const [shellBlacklist, setShellBlacklist] = useState<string[]>([])
  const [permanentBannedCommands, setPermanentBannedCommands] = useState<string[]>([])
  const [newBlacklistCommand, setNewBlacklistCommand] = useState('')
  const [editingBlacklistCommand, setEditingBlacklistCommand] = useState('')
  const [editingBlacklistDraft, setEditingBlacklistDraft] = useState('')
  const [hitItems, setHitItems] = useState<ShellBlacklistHitRow[]>([])
  const [hitTotal, setHitTotal] = useState(0)
  const [hitCategory, setHitCategory] = useState('')
  const [hitQ, setHitQ] = useState('')
  const [hitSince, setHitSince] = useState('')
  const [hitLimit] = useState(30)
  const [hitOffset, setHitOffset] = useState(0)
  const [generatorSpec, setGeneratorSpec] = useState(
    JSON.stringify(
      {
        name: 'demo-skill',
        description:
          '示例技能：用于演示技能书生成。用户提到 demo、示例、测试技能生成时使用。',
        homepage: 'https://example.com',
        version: '0.1.0',
        credentials: {
          env: ['DEMO_CLIENT_ID', 'DEMO_API_KEY'],
          primaryEnv: 'DEMO_CLIENT_ID',
        },
        security: {
          allowedDomains: ['example.com'],
          credentialsUsage: 'Credentials are only sent to official API domains.',
        },
        requiredBinaries: [
          { name: 'node', minVersion: '18.0.0', reason: '执行脚本与 JSON 处理' },
        ],
        modules: [
          {
            id: 'demo-module',
            title: 'Demo Module',
            triggerIntents: ['演示技能生成', '生成 demo 技能书'],
            rules: ['先确认用户目标，再执行工作流。'],
            workflows: [
              {
                intent: '生成 demo 内容',
                steps: ['读取输入', '生成结果', '返回结果'],
                apiPath: 'openapi/demo/v1/run',
              },
            ],
            references: [
              {
                filename: 'references/api.md',
                content: '# API\n\n这里填写 API 说明。',
              },
            ],
            scripts: [
              {
                targetPath: 'scripts/helper.cjs',
                content: "console.log('demo helper')",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  )
  const [generatorWarnings, setGeneratorWarnings] = useState<string[]>([])
  const [generatorPreviewFiles, setGeneratorPreviewFiles] = useState<
    GeneratedSkillPreviewFile[]
  >([])
  const [generatorResult, setGeneratorResult] = useState('')
  const [generatorDraftPrompt, setGeneratorDraftPrompt] = useState(
    [
      '技能说明：查询城市天气',
      'HTTPS 基址与路径：写进 references/api.md（方法、路径、查询参数、鉴权头）；不要在步骤里写 curl',
      'allowedDomains：api.example.com；密钥：环境变量 WEATHER_API_KEY（勿写入真实密钥）',
    ].join('\n'),
  )
  const [generatorAction, setGeneratorAction] = useState<
    null | 'preview' | 'package' | 'import' | 'polish'
  >(null)
  const [configFeedback, setConfigFeedback] = useState<{
    type: 'success' | 'info'
    message: string
  } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  type ModuleId =
    | 'config'
    | 'import'
    | 'skills'
    | 'agent'
    | 'generator'
    | 'blacklist'
    | 'blacklistHits'
    | 'logs'
  const [activeModule, setActiveModule] = useState<ModuleId>('config')

  const apiBase = useMemo(() => `${baseUrl.replace(/\/$/, '')}/api/v1`, [baseUrl])
  const moduleTitles: Record<ModuleId, string> = {
    config: '服务 & 模型',
    import: '导入技能书',
    skills: '技能书列表',
    agent: 'Agent 执行',
    generator: '生成技能书',
    blacklist: '命令行黑名单配置',
    blacklistHits: '黑名单命中记录',
    logs: '日志',
  }
  const llmEnvPreview = useMemo(
    () =>
      [
        `export LLM_BASE_URL="${llmBaseUrl}"`,
        `export LLM_API_KEY="${llmApiKey}"`,
        `export LLM_MODEL="${llmModel}"`,
      ].join('\n'),
    [llmApiKey, llmBaseUrl, llmModel],
  )
  const detailParsed = useMemo(() => {
    if (!detailResult.trim()) {
      return null
    }
    try {
      return JSON.parse(detailResult) as JsonValue
    } catch {
      return null
    }
  }, [detailResult])

  const { Header, Sider, Content } = Layout

  const siderMenuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'config', icon: <SettingOutlined />, label: '服务 & 模型' },
      { key: 'import', icon: <CloudUploadOutlined />, label: '导入技能书' },
      { key: 'skills', icon: <UnorderedListOutlined />, label: '技能书列表' },
      { key: 'agent', icon: <RobotOutlined />, label: 'Agent 执行' },
      { key: 'generator', icon: <FileTextOutlined />, label: '生成技能书' },
      {
        key: 'blacklist',
        icon: <SafetyCertificateOutlined />,
        label: '命令行黑名单配置',
      },
      { key: 'blacklistHits', icon: <HistoryOutlined />, label: '黑名单命中记录' },
      { key: 'logs', icon: <FileTextOutlined />, label: '日志' },
    ],
    [],
  )

  const hitTableColumns = useMemo(
    () => [
      { title: '时间', dataIndex: 'createdAt', width: 176, ellipsis: true },
      {
        title: '类别',
        dataIndex: 'category',
        width: 168,
        render: (t: string) => <Typography.Text code>{t}</Typography.Text>,
      },
      { title: '原因', dataIndex: 'message', ellipsis: true },
      {
        title: '原始命令',
        dataIndex: 'rawCommand',
        width: 220,
        ellipsis: true,
        render: (t: string) => (
          <Typography.Paragraph copyable style={{ marginBottom: 0 }} code>
            {t}
          </Typography.Paragraph>
        ),
      },
      {
        title: 'basename',
        dataIndex: 'normalizedCommand',
        width: 120,
        render: (t: string) => <Typography.Text code>{t}</Typography.Text>,
      },
      {
        title: '参数 JSON',
        dataIndex: 'argsJson',
        ellipsis: true,
        render: (t: string) => (
          <Typography.Paragraph style={{ marginBottom: 0 }} code>
            {t}
          </Typography.Paragraph>
        ),
      },
    ],
    [],
  )

  const pushLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  useEffect(() => {
    const loadServerLlmConfig = async () => {
      try {
        const resp = await fetch(`${apiBase}/skills/llm-config`)
        if (!resp.ok) return
        const data = (await resp.json()) as {
          baseUrl?: string
          apiKey?: string
          model?: string
        }
        setLlmBaseUrl(data.baseUrl || '')
        setLlmApiKey(data.apiKey || '')
        setMaskedApiKey(data.apiKey || '')
        setApiKeyDirty(false)
        setLlmModel(data.model || 'gpt-4o-mini')
      } catch {
        // ignore init errors
      }
    }

    void loadServerLlmConfig()
  }, [apiBase])

  const saveModelConfig = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/llm-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: llmBaseUrl,
          apiKey:
            !apiKeyDirty && llmApiKey === maskedApiKey
              ? '__KEEP_EXISTING__'
              : llmApiKey,
          model: llmModel,
        }),
      })
      const data = await resp.json()
      setLlmBaseUrl((data.baseUrl as string) || llmBaseUrl)
      setLlmApiKey((data.apiKey as string) || llmApiKey)
      setMaskedApiKey((data.apiKey as string) || llmApiKey)
      setApiKeyDirty(false)
      setLlmModel((data.model as string) || llmModel)
      setConfigFeedback({
        type: 'success',
        message: '模型配置已保存到服务端，后续智能执行将直接使用',
      })
      pushLog(`模型配置保存成功，HTTP ${resp.status}`)
    } catch (err) {
      setConfigFeedback({
        type: 'info',
        message: `模型配置保存失败：${String(err)}`,
      })
      pushLog(`模型配置保存失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const clearModelConfig = () => {
    setLlmBaseUrl('')
    setLlmApiKey('')
    setMaskedApiKey('')
    setApiKeyDirty(true)
    setLlmModel('gpt-4o-mini')
    setConfigFeedback({
      type: 'info',
      message: '已清空输入框，点击保存后会覆盖服务端配置',
    })
    pushLog('模型配置输入框已清空')
  }

  const importZip = async () => {
    if (!zipFile) {
      pushLog('请先选择 zip 文件')
      return
    }
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', zipFile)
      const resp = await fetch(`${apiBase}/skills/import`, {
        method: 'POST',
        body: formData,
      })
      const text = await resp.text()
      pushLog(`导入状态 ${resp.status}: ${text}`)
      await loadSkills()
    } catch (err) {
      pushLog(`导入失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadSkills = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills`)
      const data = (await resp.json()) as { items?: SkillItem[] }
      setSkillList(data.items || [])
      pushLog(`已加载技能列表，共 ${data.items?.length || 0} 条`)
    } catch (err) {
      pushLog(`加载技能列表失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadDetail = async (skillId?: string) => {
    const resolvedSkillId = (skillId ?? detailSkillId).trim()
    if (!resolvedSkillId) {
      pushLog('请输入 skillId')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/${encodeURIComponent(resolvedSkillId)}`)
      const text = await resp.text()
      setDetailResult(text)
      pushLog(`详情状态 ${resp.status}`)
    } catch (err) {
      pushLog(`加载详情失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const deleteSkill = async (skillId: string) => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
      })
      const { data } = await readJsonOrText(resp)
      if (!resp.ok) {
        const msg = extractApiErrorMessage(data) || `HTTP ${resp.status}`
        message.error(msg)
        pushLog(`删除技能书失败: ${msg}`)
        return
      }
      message.success('已删除技能书')
      pushLog(`已删除技能书 ${skillId}`)
      if (detailModalOpen && detailSkillId === skillId) {
        setDetailModalOpen(false)
        setDetailResult('')
      }
      await loadSkills()
    } catch (err) {
      message.error(String(err))
      pushLog(`删除技能书失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadShellBlacklist = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/shell-blacklist`)
      const data = (await resp.json()) as ShellBlacklistResponse
      setShellBlacklist(Array.isArray(data.items) ? data.items : [])
      setPermanentBannedCommands(
        Array.isArray(data.permanentBannedCommands) ? data.permanentBannedCommands : [],
      )
      pushLog(`黑名单加载状态 ${resp.status}`)
    } catch (err) {
      pushLog(`加载黑名单失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const addShellBlacklistCommand = async () => {
    if (!newBlacklistCommand.trim()) {
      pushLog('请输入要新增的黑名单命令')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/shell-blacklist/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: newBlacklistCommand }),
      })
      const data = (await resp.json()) as ShellBlacklistResponse & { message?: string }
      if (!resp.ok) {
        pushLog(`新增黑名单失败: ${data.message || JSON.stringify(data)}`)
        return
      }
      setShellBlacklist(Array.isArray(data.items) ? data.items : [])
      setPermanentBannedCommands(
        Array.isArray(data.permanentBannedCommands) ? data.permanentBannedCommands : [],
      )
      setNewBlacklistCommand('')
      pushLog(`新增黑名单成功，HTTP ${resp.status}`)
    } catch (err) {
      pushLog(`新增黑名单失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const updateShellBlacklistCommand = async () => {
    if (!editingBlacklistCommand) {
      pushLog('请先选择要修改的命令')
      return
    }
    if (!editingBlacklistDraft.trim()) {
      pushLog('请输入修改后的命令')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/shell-blacklist/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousCommand: editingBlacklistCommand,
          nextCommand: editingBlacklistDraft,
        }),
      })
      const data = (await resp.json()) as ShellBlacklistResponse & { message?: string }
      if (!resp.ok) {
        pushLog(`修改黑名单失败: ${data.message || JSON.stringify(data)}`)
        return
      }
      setShellBlacklist(Array.isArray(data.items) ? data.items : [])
      setPermanentBannedCommands(
        Array.isArray(data.permanentBannedCommands) ? data.permanentBannedCommands : [],
      )
      setEditingBlacklistCommand('')
      setEditingBlacklistDraft('')
      pushLog(`修改黑名单成功，HTTP ${resp.status}`)
    } catch (err) {
      pushLog(`修改黑名单失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const removeShellBlacklistCommand = async (command: string) => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/shell-blacklist/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      const data = (await resp.json()) as ShellBlacklistResponse & { message?: string }
      if (!resp.ok) {
        pushLog(`删除黑名单失败: ${data.message || JSON.stringify(data)}`)
        return
      }
      setShellBlacklist(Array.isArray(data.items) ? data.items : [])
      setPermanentBannedCommands(
        Array.isArray(data.permanentBannedCommands) ? data.permanentBannedCommands : [],
      )
      if (editingBlacklistCommand === command) {
        setEditingBlacklistCommand('')
        setEditingBlacklistDraft('')
      }
      pushLog(`删除黑名单成功，HTTP ${resp.status}`)
    } catch (err) {
      pushLog(`删除黑名单失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadBlacklistHits = async (nextOffset = hitOffset) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(hitLimit))
      params.set('offset', String(nextOffset))
      if (hitCategory.trim()) params.set('category', hitCategory.trim())
      if (hitQ.trim()) params.set('q', hitQ.trim())
      if (hitSince.trim()) params.set('since', hitSince.trim())
      const resp = await fetch(`${apiBase}/skills/shell-blacklist/hits?${params.toString()}`)
      const data = (await resp.json()) as { total?: number; items?: ShellBlacklistHitRow[] }
      if (!resp.ok) {
        pushLog(`加载命中记录失败: ${JSON.stringify(data)}`)
        return
      }
      setHitItems(Array.isArray(data.items) ? data.items : [])
      setHitTotal(typeof data.total === 'number' ? data.total : 0)
      setHitOffset(nextOffset)
      pushLog(`命中记录加载成功，HTTP ${resp.status}`)
    } catch (err) {
      pushLog(`加载命中记录失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeModule !== 'blacklistHits') return
    void loadBlacklistHits(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule, apiBase])

  const requestAgentPlan = async (
    query: string,
    context: Record<string, unknown>,
    appendUserMessage?: string,
  ) => {
    setLoading(true)
    try {
      if (appendUserMessage) {
        setAgentMessages((prev) => [
          ...prev,
          createMessage('user', appendUserMessage, '用户'),
        ])
      }
      const resp = await fetch(`${apiBase}/skills/agent/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          context,
          maxIterations: agentMaxIterations,
        }),
      })
      const data = await resp.json()
      const planId = data?.agentPlan?.agentPlanId
      setAgentPlanId(typeof planId === 'string' ? planId : '')
      setAgentConfirmed(false)
      setAgentResult(JSON.stringify(data, null, 2))
      setAgentNeedsInput(false)
      const summaryLines = [
        typeof data?.agentPlan?.strategy === 'string'
          ? `计划说明：${data.agentPlan.strategy}`
          : '已生成 Agent 计划',
        typeof planId === 'string' ? `计划ID：${planId}` : '',
        Array.isArray(data?.candidates)
          ? `候选技能：${data.candidates
              .map((item: { skillId?: string }) => item.skillId || '-')
              .join('、')}`
          : '',
        '如需继续，请点击“确认运行 Agent”。',
      ]
        .filter(Boolean)
        .join('\n')
      setAgentMessages((prev) => [
        ...prev,
        createMessage('agent', summaryLines, 'Agent 计划'),
      ])
      pushLog(`Agent 计划状态 ${resp.status}`)
    } catch (err) {
      setAgentMessages((prev) => [
        ...prev,
        createMessage('system', `生成 Agent 计划失败：${String(err)}`, '系统'),
      ])
      pushLog(`生成 Agent 计划失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const createAgentPlan = async () => {
    const context = JSON.parse(agentContext) as Record<string, unknown>
    await requestAgentPlan(agentQuery, context, agentQuery)
  }

  const confirmAgentPlan = async () => {
    if (!agentPlanId) {
      pushLog('请先生成 Agent 计划')
      return
    }
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/skills/agent/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentPlanId }),
      })
      const data = await resp.json()
      setAgentResult(JSON.stringify(data, null, 2))
      setAgentNeedsInput(data?.status === 'need_user_input')
      setAgentConfirmed(true)
      const traceMessages: AgentChatMessage[] = Array.isArray(data?.trace)
        ? data.trace.flatMap(
            (item: {
              iteration?: number
              thoughtSummary?: string
              action?: unknown
              observation?: unknown
            }) => {
              const iteration = item.iteration ?? '?'
              const thought = item.thoughtSummary
                ? createMessage(
                    'agent',
                    item.thoughtSummary,
                    `第 ${iteration} 轮思考`,
                    true,
                  )
                : null
              const action = createMessage(
                'agent',
                JSON.stringify(item.action ?? {}, null, 2),
                `第 ${iteration} 轮动作`,
                true,
              )
              const observation = createMessage(
                'system',
                JSON.stringify(item.observation ?? {}, null, 2),
                `第 ${iteration} 轮观察`,
                true,
              )
              return [thought, action, observation].filter(
                Boolean,
              ) as AgentChatMessage[]
            },
          )
        : []
      const finalMessage = createMessage(
        data?.ok ? 'agent' : 'system',
        String(data?.finalSummary || 'Agent 执行结束'),
        `执行结果（${String(data?.status || 'unknown')}）`,
      )
      setAgentMessages((prev) => [...prev, ...traceMessages, finalMessage])
      pushLog(`Agent 确认执行状态 ${resp.status}`)
    } catch (err) {
      setAgentMessages((prev) => [
        ...prev,
        createMessage('system', `Agent 执行失败：${String(err)}`, '系统'),
      ])
      pushLog(`Agent 执行失败: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const clearAgentConversation = () => {
    setAgentMessages([])
    setAgentPlanId('')
    setAgentConfirmed(false)
    setAgentResult('')
    setAgentReply('')
    setAgentNeedsInput(false)
  }

  const parseGeneratorSpec = () => {
    try {
      return JSON.parse(generatorSpec) as Record<string, unknown>
    } catch {
      message.error('生成规格 JSON 无效，请检查语法')
      pushLog('生成规格 JSON 非法，请先修正')
      return null
    }
  }

  const polishGeneratorSpecFromLlm = async () => {
    const trimmed = generatorDraftPrompt.trim()
    if (trimmed.length < 4) {
      message.warning('请先写几句技能说明（至少 4 个字符），再调用 LLM 润色')
      return
    }
    setGeneratorAction('polish')
    try {
      const resp = await fetch(`${apiBase}/skills/generator/polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
      })
      const { data, raw } = await readJsonOrText(resp)
      setGeneratorResult(JSON.stringify(data, null, 2))
      if (!resp.ok) {
        const detail = extractApiErrorMessage(data) || raw.slice(0, 400)
        message.error(detail ? `润色失败（${resp.status}）：${detail}` : `润色失败（${resp.status}）`)
        pushLog(`LLM 润色失败，HTTP ${resp.status}`)
        return
      }
      const body = data as { ok?: boolean; spec?: Record<string, unknown> }
      if (!body.spec || typeof body.spec !== 'object') {
        message.error('服务端未返回 spec 字段，请查看接口返回 JSON')
        pushLog('LLM 润色：响应缺少 spec')
        return
      }
      setGeneratorSpec(JSON.stringify(body.spec, null, 2))
      message.success('已根据 LLM 结果填充下方的 GenerateSkillDto JSON，可继续预览或打包')
      pushLog('LLM 润色成功，规格已写入编辑器')
    } catch (err) {
      message.error(`润色请求失败：${String(err)}`)
      pushLog(`LLM 润色失败: ${String(err)}`)
    } finally {
      setGeneratorAction(null)
    }
  }

  const previewGeneratedSkill = async () => {
    const payload = parseGeneratorSpec()
    if (!payload) return
    setGeneratorAction('preview')
    try {
      const resp = await fetch(`${apiBase}/skills/generator/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { data, raw } = await readJsonOrText(resp)
      setGeneratorResult(JSON.stringify(data, null, 2))
      if (!resp.ok) {
        const detail = extractApiErrorMessage(data) || raw.slice(0, 200)
        message.error(detail ? `预览失败（${resp.status}）：${detail}` : `预览失败（${resp.status}）`)
        pushLog(`预览生成失败，HTTP ${resp.status}`)
        return
      }
      const body = data as {
        warnings?: string[]
        files?: GeneratedSkillPreviewFile[]
      }
      setGeneratorWarnings(Array.isArray(body.warnings) ? body.warnings : [])
      setGeneratorPreviewFiles(Array.isArray(body.files) ? body.files : [])
      const n = body.files?.length ?? 0
      message.success(`预览已生成，共 ${n} 个文件`)
      if (body.warnings?.length) {
        message.warning(`有 ${body.warnings.length} 条告警，请展开「生成告警」查看`)
      }
      pushLog(`预览生成成功，文件数 ${n}`)
    } catch (err) {
      message.error(`预览请求失败：${String(err)}`)
      pushLog(`预览生成失败: ${String(err)}`)
    } finally {
      setGeneratorAction(null)
    }
  }

  const packageGeneratedSkill = async () => {
    const payload = parseGeneratorSpec()
    if (!payload) return
    const fallbackName =
      typeof payload.name === 'string' && payload.name ? `${payload.name}.zip` : 'skill.zip'
    setGeneratorAction('package')
    try {
      const resp = await fetch(`${apiBase}/skills/generator/package/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const { data, raw } = await readJsonOrText(resp)
        setGeneratorResult(JSON.stringify(data, null, 2))
        const detail = extractApiErrorMessage(data) || raw.slice(0, 200)
        message.error(detail ? `下载失败（${resp.status}）：${detail}` : `下载失败（${resp.status}）`)
        pushLog(`打包下载失败，HTTP ${resp.status}`)
        return
      }
      const blob = await resp.blob()
      const filename = parseContentDispositionFilename(
        resp.headers.get('Content-Disposition'),
        fallbackName,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      setGeneratorResult(
        JSON.stringify(
          {
            downloaded: true,
            filename,
            size: blob.size,
            contentType: resp.headers.get('Content-Type') || 'application/zip',
          },
          null,
          2,
        ),
      )
      message.success(`已开始下载：${filename}（${blob.size} 字节）`)
      pushLog(`打包下载成功，HTTP ${resp.status}，文件 ${filename}`)
    } catch (err) {
      message.error(`打包下载失败：${String(err)}`)
      pushLog(`打包技能书失败: ${String(err)}`)
    } finally {
      setGeneratorAction(null)
    }
  }

  const importGeneratedSkill = async () => {
    const payload = parseGeneratorSpec()
    if (!payload) return
    setGeneratorAction('import')
    try {
      const resp = await fetch(`${apiBase}/skills/generator/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { data, raw } = await readJsonOrText(resp)
      setGeneratorResult(JSON.stringify(data, null, 2))
      if (!resp.ok) {
        const detail = extractApiErrorMessage(data) || raw.slice(0, 200)
        message.error(detail ? `导入失败（${resp.status}）：${detail}` : `导入失败（${resp.status}）`)
        pushLog(`生成并导入失败，HTTP ${resp.status}`)
        return
      }
      const body = data as { ok?: boolean; skillId?: string; imported?: boolean }
      if (body.ok === false) {
        message.error('服务端返回未成功，请查看下方「接口返回 JSON」')
        pushLog('生成并导入：服务端 ok=false')
        return
      }
      message.success(
        body.skillId ? `已导入技能书，目录 ID：${body.skillId}` : '已导入技能书',
      )
      pushLog(`生成并导入成功，HTTP ${resp.status}`)
      await loadSkills()
    } catch (err) {
      message.error(`导入请求失败：${String(err)}`)
      pushLog(`生成并导入失败: ${String(err)}`)
    } finally {
      setGeneratorAction(null)
    }
  }

  const sendAgentReply = async () => {
    if (!agentReply.trim()) {
      pushLog('请输入补充内容')
      return
    }

    let parsedContext: Record<string, unknown>
    try {
      parsedContext = JSON.parse(agentContext) as Record<string, unknown>
    } catch {
      pushLog('Agent 上下文 JSON 非法，无法追加补充内容')
      return
    }

    const followUps = Array.isArray(parsedContext.followUpMessages)
      ? [...(parsedContext.followUpMessages as string[]), agentReply.trim()]
      : [agentReply.trim()]
    const nextContext = {
      ...parsedContext,
      followUpMessages: followUps,
      latestUserReply: agentReply.trim(),
    }
    const nextContextText = JSON.stringify(nextContext, null, 2)
    setAgentContext(nextContextText)
    const replyText = agentReply.trim()
    setAgentReply('')
    await requestAgentPlan(agentQuery, nextContext, replyText)
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        width={220}
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            padding: '20px 16px',
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          skills-server
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeModule]}
          items={siderMenuItems}
          onClick={({ key }) => setActiveModule(key as ModuleId)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '16px 24px',
            height: 'auto',
            lineHeight: 1.4,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {moduleTitles[activeModule]}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前 API Base：{apiBase}
          </Typography.Text>
        </Header>
        <Content style={{ margin: 24 }}>
          <Spin spinning={loading}>
            {activeModule === 'config' ? (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                <Card title="服务地址">
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                  />
                  <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    当前 API Base: {apiBase}
                  </Typography.Paragraph>
                </Card>
                <Card title="模型配置">
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    <Input
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                      placeholder="LLM_BASE_URL"
                    />
                    <Input.Password
                      value={llmApiKey}
                      onChange={(e) => {
                        setLlmApiKey(e.target.value)
                        setApiKeyDirty(true)
                      }}
                      placeholder="LLM_API_KEY"
                    />
                    <Input
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder="LLM_MODEL"
                    />
                    <Space wrap>
                      <Button type="primary" onClick={() => void saveModelConfig()}>
                        保存模型配置
                      </Button>
                      <Button onClick={clearModelConfig}>清空模型配置</Button>
                    </Space>
                    {configFeedback ? (
                      <Alert
                        type={configFeedback.type === 'success' ? 'success' : 'info'}
                        message={configFeedback.message}
                        showIcon
                      />
                    ) : null}
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      当前页面读写的是服务端模型配置；保存后，后续智能执行会直接使用该配置。
                    </Typography.Paragraph>
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{llmEnvPreview}</pre>
                    </Typography.Paragraph>
                  </Space>
                </Card>
              </Space>
            ) : null}

            {activeModule === 'import' ? (
              <Card title="导入技能书 ZIP">
                <Space orientation="vertical">
                  <Upload
                    accept=".zip"
                    maxCount={1}
                    beforeUpload={(file) => {
                      setZipFile(file)
                      return false
                    }}
                    onRemove={() => {
                      setZipFile(null)
                      return true
                    }}
                  >
                    <Button icon={<UploadOutlined />}>选择 ZIP</Button>
                  </Upload>
                  <Button
                    type="primary"
                    onClick={() => void importZip()}
                    disabled={!zipFile}
                  >
                    导入
                  </Button>
                </Space>
              </Card>
            ) : null}

            {activeModule === 'skills' ? (
              <Card
                title="技能书列表"
                extra={
                  <Button onClick={() => void loadSkills()}>刷新列表</Button>
                }
              >
                <List
                  dataSource={skillList}
                  locale={{ emptyText: '暂无技能书，可先导入 ZIP' }}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button
                          key={`detail-${item.skillId}`}
                          type="link"
                          onClick={async () => {
                            setDetailSkillId(item.skillId)
                            setDetailModalOpen(true)
                            await loadDetail(item.skillId)
                          }}
                        >
                          查看详情
                        </Button>,
                        <Button
                          key={`delete-${item.skillId}`}
                          type="link"
                          danger
                          onClick={() => {
                            Modal.confirm({
                              title: '确认删除技能书',
                              content: `将永久删除「${item.name || item.skillId}」（ID：${item.skillId}），不可恢复。`,
                              okText: '删除',
                              okType: 'danger',
                              cancelText: '取消',
                              onOk: () => deleteSkill(item.skillId),
                            })
                          }}
                        >
                          删除
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={<Typography.Text code>{item.skillId}</Typography.Text>}
                        description={
                          <Space orientation="vertical" size={0}>
                            <span>名称：{item.name || '-'}</span>
                            <span>描述：{item.description || '-'}</span>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            ) : null}

            {activeModule === 'agent' ? (
              <Card title="Agent 执行">
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                  <Input
                    value={agentQuery}
                    onChange={(e) => setAgentQuery(e.target.value)}
                    placeholder="自然语言请求"
                  />
                  <Input.TextArea
                    rows={5}
                    value={agentContext}
                    onChange={(e) => setAgentContext(e.target.value)}
                    placeholder="Agent 上下文 JSON"
                  />
                  <Space align="center">
                    <Typography.Text type="secondary">迭代执行次数</Typography.Text>
                    <InputNumber
                      min={1}
                      max={10}
                      value={agentMaxIterations}
                      onChange={(v) => setAgentMaxIterations(typeof v === 'number' ? v : 1)}
                    />
                  </Space>
                  <Space wrap>
                    <Button type="primary" onClick={() => void createAgentPlan()}>
                      生成 Agent 计划
                    </Button>
                    <Button onClick={clearAgentConversation}>清空对话</Button>
                  </Space>
                  <div>
                    {agentMessages.length === 0 ? (
                      <Typography.Text type="secondary">
                        这里会显示 Agent 对话、计划、trace 和最终总结。
                      </Typography.Text>
                    ) : (
                      <Space orientation="vertical" style={{ width: '100%' }}>
                        {agentMessages.map((message) => (
                          <Card key={message.id} size="small">
                            {message.collapsible ? (
                              <Collapse
                                bordered={false}
                                size="small"
                                items={[
                                  {
                                    key: `${message.id}-c`,
                                    label: message.title || message.role,
                                    children: (
                                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {message.content}
                                      </pre>
                                    ),
                                  },
                                ]}
                              />
                            ) : (
                              <>
                                <Typography.Text strong>
                                  {message.title || message.role}
                                </Typography.Text>
                                <Divider style={{ margin: '8px 0' }} />
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.content}</pre>
                                {message.title === 'Agent 计划' ? (
                                  <Button
                                    type="primary"
                                    style={{ marginTop: 12 }}
                                    onClick={() => void confirmAgentPlan()}
                                    disabled={!agentPlanId || agentConfirmed}
                                  >
                                    确认运行 Agent
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </Card>
                        ))}
                      </Space>
                    )}
                  </div>
                  <Divider plain>补充信息</Divider>
                  <Input.TextArea
                    rows={3}
                    value={agentReply}
                    onChange={(e) => setAgentReply(e.target.value)}
                    placeholder={
                      agentNeedsInput
                        ? 'Agent 正在等待你的补充信息，例如凭证、目标知识库名、确认内容...'
                        : '可以继续输入补充信息，作为下一轮 Agent 计划的上下文'
                    }
                  />
                  <Button type="primary" onClick={() => void sendAgentReply()}>
                    发送补充信息
                  </Button>
                  <Collapse
                    items={[
                      {
                        key: 'raw-json',
                        label: '查看原始 JSON',
                        children: (
                          <Typography.Paragraph style={{ marginBottom: 0 }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{agentResult}</pre>
                          </Typography.Paragraph>
                        ),
                      },
                    ]}
                  />
                </Space>
              </Card>
            ) : null}

            {activeModule === 'generator' ? (
              <Card title="生成技能书">
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                  <Divider plain>LLM 润色</Divider>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    用几条中文说明要写什么技能（可含 API 域名、密钥应放在哪个环境变量等）。会先调用「服务 &
                    模型」里配置的 LLM，自动生成下方结构化规格 JSON。
                  </Typography.Paragraph>
                  <Input.TextArea
                    rows={6}
                    value={generatorDraftPrompt}
                    onChange={(e) => setGeneratorDraftPrompt(e.target.value)}
                    placeholder={
                      '例如：\n技能：查询某地天气\n接口：https://api.xxx.com/weather\n密钥：用户使用 WEATHER_API_KEY'
                    }
                  />
                  <Button
                    icon={<BulbOutlined />}
                    loading={generatorAction === 'polish'}
                    disabled={generatorAction !== null && generatorAction !== 'polish'}
                    onClick={() => void polishGeneratorSpecFromLlm()}
                  >
                    LLM 润色并填充规格
                  </Button>
                  <Divider plain>结构化规格（GenerateSkillDto）</Divider>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    润色结果会填入此处，也可直接手写或微调 JSON。预览后可下载 ZIP（浏览器保存，服务端不落盘）；「生成并导入」写入服务端
                    static/skills。
                  </Typography.Paragraph>
                  <Input.TextArea
                    rows={18}
                    value={generatorSpec}
                    onChange={(e) => setGeneratorSpec(e.target.value)}
                    placeholder="请输入 GenerateSkillDto JSON"
                  />
                  <Space wrap>
                    <Button
                      type="primary"
                      loading={generatorAction === 'preview'}
                      disabled={generatorAction !== null && generatorAction !== 'preview'}
                      onClick={() => void previewGeneratedSkill()}
                    >
                      预览生成
                    </Button>
                    <Button
                      loading={generatorAction === 'package'}
                      disabled={generatorAction !== null && generatorAction !== 'package'}
                      onClick={() => void packageGeneratedSkill()}
                    >
                      下载 ZIP
                    </Button>
                    <Button
                      loading={generatorAction === 'import'}
                      disabled={generatorAction !== null && generatorAction !== 'import'}
                      onClick={() => void importGeneratedSkill()}
                    >
                      生成并导入
                    </Button>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                    点击后右上角会有结果提示；「下载 ZIP」成功时还会触发浏览器下载。进行中当前按钮显示加载，其余按钮暂时禁用。
                  </Typography.Paragraph>
                  {generatorWarnings.length > 0 ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="生成告警"
                      description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {generatorWarnings.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      }
                    />
                  ) : null}
                  <Collapse
                    items={[
                      {
                        key: 'preview-files',
                        label: `预览文件（${generatorPreviewFiles.length}）`,
                        children: (
                          <List
                            size="small"
                            bordered
                            dataSource={generatorPreviewFiles}
                            locale={{ emptyText: '暂无预览文件，请先点击“预览生成”' }}
                            renderItem={(file) => (
                              <List.Item>
                                <Space orientation="vertical" style={{ width: '100%' }} size={4}>
                                  <Typography.Text code>{file.path}</Typography.Text>
                                  <Typography.Text type="secondary">
                                    {file.size} bytes
                                  </Typography.Text>
                                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                    {file.content}
                                  </pre>
                                </Space>
                              </List.Item>
                            )}
                          />
                        ),
                      },
                      {
                        key: 'generator-raw',
                        label: '接口返回 JSON',
                        children: (
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {generatorResult}
                          </pre>
                        ),
                      },
                    ]}
                  />
                </Space>
              </Card>
            ) : null}

            {activeModule === 'blacklist' ? (
              <Card title="命令行黑名单配置">
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                  <Button onClick={() => void loadShellBlacklist()}>刷新黑名单</Button>
                  <Typography.Text type="secondary">
                    永久封禁（语法规则 + 高危命令，不可编辑）：
                  </Typography.Text>
                  <List
                    size="small"
                    bordered
                    dataSource={permanentBannedCommands}
                    renderItem={(command) => (
                      <List.Item>
                        <Space>
                          <Typography.Text code>{command}</Typography.Text>
                          <Tag color="red">永久</Tag>
                        </Space>
                      </List.Item>
                    )}
                  />
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      value={newBlacklistCommand}
                      onChange={(e) => setNewBlacklistCommand(e.target.value)}
                      placeholder="新增黑名单命令，例如 echo"
                    />
                    <Button type="primary" onClick={() => void addShellBlacklistCommand()}>
                      新增
                    </Button>
                  </Space.Compact>
                  <List
                    dataSource={shellBlacklist}
                    renderItem={(command) => (
                      <List.Item
                        actions={[
                          <Button
                            key="edit"
                            type="link"
                            onClick={() => {
                              setEditingBlacklistCommand(command)
                              setEditingBlacklistDraft(command)
                            }}
                          >
                            编辑
                          </Button>,
                          <Button
                            key="del"
                            type="link"
                            danger
                            onClick={() => void removeShellBlacklistCommand(command)}
                          >
                            删除
                          </Button>,
                        ]}
                      >
                        <Typography.Text code>{command}</Typography.Text>
                      </List.Item>
                    )}
                  />
                  {editingBlacklistCommand ? (
                    <Card size="small" type="inner" title={`正在编辑：${editingBlacklistCommand}`}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={editingBlacklistDraft}
                          onChange={(e) => setEditingBlacklistDraft(e.target.value)}
                          placeholder="修改后的命令"
                        />
                        <Button type="primary" onClick={() => void updateShellBlacklistCommand()}>
                          保存修改
                        </Button>
                      </Space.Compact>
                    </Card>
                  ) : null}
                </Space>
              </Card>
            ) : null}

            {activeModule === 'blacklistHits' ? (
              <Card title="黑名单命中记录">
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    当 Agent 的 shell_check 在服务端被拦截时，会写入本地 SQLite（static/data/shell-blacklist-hits.db）。
                  </Typography.Paragraph>
                  <Space wrap>
                    <Input
                      addonBefore="类别"
                      value={hitCategory}
                      onChange={(e) => setHitCategory(e.target.value)}
                      placeholder="例如 permanent_rule"
                      style={{ minWidth: 260 }}
                    />
                    <Input
                      addonBefore="关键字"
                      value={hitQ}
                      onChange={(e) => setHitQ(e.target.value)}
                      placeholder="模糊搜索"
                      style={{ minWidth: 260 }}
                    />
                    <Input
                      addonBefore="since"
                      value={hitSince}
                      onChange={(e) => setHitSince(e.target.value)}
                      placeholder="2026-04-01"
                      style={{ minWidth: 260 }}
                    />
                  </Space>
                  <Space wrap>
                    <Button type="primary" onClick={() => void loadBlacklistHits(0)}>
                      查询
                    </Button>
                    <Button
                      onClick={() => {
                        setHitCategory('')
                        setHitQ('')
                        setHitSince('')
                        void loadBlacklistHits(0)
                      }}
                    >
                      重置条件
                    </Button>
                  </Space>
                  <Table<ShellBlacklistHitRow>
                    rowKey="id"
                    size="small"
                    scroll={{ x: 1100 }}
                    columns={hitTableColumns}
                    dataSource={hitItems}
                    pagination={{
                      current: hitLimit ? Math.floor(hitOffset / hitLimit) + 1 : 1,
                      pageSize: hitLimit,
                      total: hitTotal,
                      showSizeChanger: false,
                      showTotal: (t) => `共 ${t} 条`,
                      onChange: (page) => void loadBlacklistHits((page - 1) * hitLimit),
                    }}
                  />
                </Space>
              </Card>
            ) : null}

            {activeModule === 'logs' ? (
              <Card title="日志" extra={<Button onClick={() => setLogs([])}>清空日志</Button>}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                    {logs.join('\n')}
                  </pre>
                </Typography.Paragraph>
              </Card>
            ) : null}
          </Spin>
        </Content>
      </Layout>

      <Modal
        title={`技能书详情 · ${detailSkillId || '-'}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        width={960}
        footer={
          <Button type="primary" onClick={() => setDetailModalOpen(false)}>
            关闭
          </Button>
        }
        destroyOnHidden
      >
        <Spin spinning={loading}>
          {detailParsed ? (
            <div style={{ maxHeight: '70vh', overflow: 'auto' }}>{renderStructuredValue(detailParsed)}</div>
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap' }}>{detailResult}</pre>
          )}
        </Spin>
      </Modal>
    </Layout>
  )

}

export default App
