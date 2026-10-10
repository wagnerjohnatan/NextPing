import { useEffect, useRef, useState } from 'react'
import type { ChartOptions } from 'chart.js'
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Crosshair,
  Gamepad2,
  Gauge,
  Globe2,
  History,
  LoaderCircle,
  Network,
  Play,
  Radio,
  ShieldCheck,
  Signal,
  Trash2,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip)

type Metrics = {
  download: number
  upload: number
  ping: number
  jitter: number
  loss: number
  samples: number[]
}

type TestRecord = Metrics & {
  id: string
  testedAt: string
  game: string
}

type Rating = 'good' | 'warning' | 'bad'

type IndicatorAssessment = {
  key: keyof Pick<Metrics, 'ping' | 'jitter' | 'download' | 'upload' | 'loss'>
  label: string
  value: string
  status: Rating
  statusLabel: string
  hint: string
  icon: LucideIcon
  higherIsBetter: boolean
}

type ServerMessage = {
  type: string
  id?: number
}

const TRANSFER_SIZE = 128 * 1024
const TRANSFER_CHUNKS = 8
const HISTORY_KEY = 'nextping-test-history-v1'
const games = ['Counter-Strike 2', 'VALORANT', 'League of Legends', 'Call of Duty']

function assessMetrics(metrics: Metrics): IndicatorAssessment[] {
  const rate = (value: number, goodLimit: number, warningLimit: number, higherIsBetter = false): Rating => {
    if (higherIsBetter) return value >= goodLimit ? 'good' : value >= warningLimit ? 'warning' : 'bad'
    return value <= goodLimit ? 'good' : value <= warningLimit ? 'warning' : 'bad'
  }
  const statusLabel: Record<Rating, string> = { good: 'Bom', warning: 'Atenção', bad: 'Ruim' }

  return [
    {
      key: 'ping',
      label: 'Ping',
      value: `${metrics.ping.toFixed(1)} ms`,
      status: rate(metrics.ping, 50, 100),
      statusLabel: statusLabel[rate(metrics.ping, 50, 100)],
      hint: 'Até 50 ms costuma responder bem; acima de 100 ms pode atrasar comandos.',
      icon: Clock3,
      higherIsBetter: false,
    },
    {
      key: 'jitter',
      label: 'Jitter',
      value: `${metrics.jitter.toFixed(1)} ms`,
      status: rate(metrics.jitter, 10, 30),
      statusLabel: statusLabel[rate(metrics.jitter, 10, 30)],
      hint: 'Até 10 ms é mais estável; muita variação pode causar travadinhas.',
      icon: Activity,
      higherIsBetter: false,
    },
    {
      key: 'download',
      label: 'Download',
      value: `${metrics.download.toFixed(1)} Mbps`,
      status: rate(metrics.download, 25, 10, true),
      statusLabel: statusLabel[rate(metrics.download, 25, 10, true)],
      hint: '25 Mbps ou mais é uma boa referência para jogar e usar outros serviços.',
      icon: ArrowDownToLine,
      higherIsBetter: true,
    },
    {
      key: 'upload',
      label: 'Upload',
      value: `${metrics.upload.toFixed(1)} Mbps`,
      status: rate(metrics.upload, 5, 2, true),
      statusLabel: statusLabel[rate(metrics.upload, 5, 2, true)],
      hint: '5 Mbps ou mais ajuda em chamadas e transmissões enquanto joga.',
      icon: ArrowUpFromLine,
      higherIsBetter: true,
    },
    {
      key: 'loss',
      label: 'Ping sem resposta',
      value: `${metrics.loss.toFixed(1)}%`,
      status: rate(metrics.loss, 0, 10),
      statusLabel: statusLabel[rate(metrics.loss, 0, 10)],
      hint: 'São sondas TCP sem resposta, não uma medição de perda de pacotes UDP.',
      icon: Signal,
      higherIsBetter: false,
    },
  ]
}

function getScore(metrics: Metrics) {
  const indicators = assessMetrics(metrics)
  const points = indicators.reduce((sum, indicator) => (
    sum + (indicator.status === 'good' ? 100 : indicator.status === 'warning' ? 50 : 0)
  ), 0)
  return Math.round(points / indicators.length)
}

function getOverallRating(score: number): { status: Rating; label: string; summary: string } {
  if (score >= 80) return { status: 'good', label: 'Bom', summary: 'Os indicadores medidos estão em uma faixa favorável.' }
  if (score >= 50) return { status: 'warning', label: 'Atenção', summary: 'Alguns indicadores merecem atenção.' }
  return { status: 'bad', label: 'Ruim', summary: 'Há indicadores que podem prejudicar a experiência.' }
}

function isTestRecord(value: unknown): value is TestRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<TestRecord>
  return typeof record.id === 'string'
    && typeof record.testedAt === 'string'
    && Number.isFinite(Date.parse(record.testedAt))
    && typeof record.game === 'string'
    && ['download', 'upload', 'ping', 'jitter', 'loss'].every((key) => (
      typeof record[key as keyof Metrics] === 'number'
      && Number.isFinite(record[key as keyof Metrics] as number)
    ))
    && Array.isArray(record.samples)
    && record.samples.every((sample) => typeof sample === 'number' && Number.isFinite(sample))
}

function readSavedHistory() {
  try {
    const savedHistory = localStorage.getItem(HISTORY_KEY)
    if (!savedHistory) return { history: [] as TestRecord[], error: '' }

    const parsed: unknown = JSON.parse(savedHistory)
    if (!Array.isArray(parsed) || !parsed.every(isTestRecord)) {
      throw new Error('Os dados salvos não correspondem ao formato esperado.')
    }
    return { history: parsed, error: '' }
  } catch {
    return {
      history: [] as TestRecord[],
      error: 'Não foi possível ler o histórico salvo. Os dados existentes foram preservados.',
    }
  }
}

function waitForMessage(
  socket: WebSocket,
  matches: (message: ServerMessage | ArrayBuffer) => boolean,
  timeoutMs: number,
) {
  return new Promise<ServerMessage | ArrayBuffer>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error('O servidor de teste não respondeu a tempo.'))
    }, timeoutMs)

    function onMessage(event: MessageEvent<string | ArrayBuffer>) {
      let message: ServerMessage | ArrayBuffer
      if (typeof event.data === 'string') {
        try {
          message = JSON.parse(event.data) as ServerMessage
        } catch {
          return
        }
      } else {
        message = event.data
      }

      if (!matches(message)) return
      window.clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      resolve(message)
    }

    socket.addEventListener('message', onMessage)
  })
}

function openTestSocket() {
  return new Promise<WebSocket>((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/test`)
    const timer = window.setTimeout(() => {
      socket.close()
      reject(new Error('Tempo esgotado ao conectar ao servidor de teste.'))
    }, 4000)

    socket.addEventListener('open', () => {
      window.clearTimeout(timer)
      resolve(socket)
    }, { once: true })
    socket.addEventListener('error', () => {
      window.clearTimeout(timer)
      reject(new Error('Não foi possível conectar ao servidor de teste.'))
    }, { once: true })
  })
}

async function measureConnection(onProgress: (stage: string) => void, onSample: (sample: number) => void) {
  const socket = await openTestSocket()
  socket.binaryType = 'arraybuffer'
  const samples: number[] = []
  let missed = 0

  try {
    onProgress('Medindo latência')
    for (let id = 0; id < 12; id += 1) {
      const startedAt = performance.now()
      const pong = waitForMessage(
        socket,
        (message) => !(message instanceof ArrayBuffer) && message.type === 'pong' && message.id === id,
        1000,
      )
      socket.send(JSON.stringify({ type: 'ping', id }))
      try {
        await pong
        const latency = performance.now() - startedAt
        samples.push(latency)
        onSample(latency)
      } catch {
        missed += 1
      }
    }

    onProgress('Medindo upload')
    const uploadStartedAt = performance.now()
    const uploadComplete = waitForMessage(
      socket,
      (message) => !(message instanceof ArrayBuffer) && message.type === 'upload-complete',
      10000,
    )
    const payload = new Uint8Array(TRANSFER_SIZE)
    for (let chunk = 0; chunk < TRANSFER_CHUNKS; chunk += 1) socket.send(payload)
    await uploadComplete
    const upload = ((TRANSFER_SIZE * TRANSFER_CHUNKS * 8) / (performance.now() - uploadStartedAt)) / 1_000

    onProgress('Medindo download')
    const downloadStartedAt = performance.now()
    const downloadComplete = waitForMessage(
      socket,
      (message) => !(message instanceof ArrayBuffer) && message.type === 'download-complete',
      10000,
    )
    socket.send(JSON.stringify({ type: 'download' }))
    await downloadComplete
    const download = ((TRANSFER_SIZE * TRANSFER_CHUNKS * 8) / (performance.now() - downloadStartedAt)) / 1_000

    const ping = samples.reduce((total, value) => total + value, 0) / Math.max(samples.length, 1)
    const jitter = samples.slice(1).reduce((total, value, index) => total + Math.abs(value - samples[index]), 0)
      / Math.max(samples.length - 1, 1)

    return {
      download,
      upload,
      ping,
      jitter,
      loss: (missed / 12) * 100,
      samples,
    }
  } finally {
    socket.close()
  }
}

const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#151a26',
      borderColor: '#293243',
      borderWidth: 1,
      titleColor: '#a0a9b9',
      bodyColor: '#f3f5fa',
      displayColors: false,
      callbacks: { label: (item) => ` ${item.parsed.y?.toFixed(1) ?? '—'} ms` },
    },
  },
  scales: {
    x: { display: false, grid: { display: false } },
    y: {
      min: 0,
      suggestedMax: 60,
      ticks: { color: '#687386', maxTicksLimit: 4, font: { size: 10 }, padding: 8 },
      grid: { color: 'rgba(123, 139, 162, 0.10)', drawTicks: false },
      border: { display: false },
    },
  },
}

function App() {
  const [savedHistory] = useState(readSavedHistory)
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview')
  const [selectedGame, setSelectedGame] = useState(games[1])
  const [isTesting, setIsTesting] = useState(false)
  const [stage, setStage] = useState('')
  const [serverOnline, setServerOnline] = useState(false)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState(savedHistory.error)
  const [history, setHistory] = useState(savedHistory.history)
  const historyRef = useRef(savedHistory.history)
  const [samples, setSamples] = useState<number[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    let isMounted = true
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('O servidor de teste não respondeu.')
        if (isMounted) setServerOnline(true)
      })
      .catch(() => {
        if (isMounted) setServerOnline(false)
      })
    return () => { isMounted = false }
  }, [])

  function updateHistory(nextHistory: TestRecord[]) {
    historyRef.current = nextHistory
    setHistory(nextHistory)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
      setHistoryError('')
    } catch {
      setHistoryError('Não foi possível salvar o histórico neste navegador.')
    }
  }

  async function startTest() {
    setIsTesting(true)
    setError('')
    setMetrics(null)
    setSamples([])

    try {
      const result = await measureConnection(setStage, (sample) => {
        setSamples((current) => [...current, sample])
      })
      setMetrics(result)
      const nextHistory = [{
        ...result,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        testedAt: new Date().toISOString(),
        game: selectedGame,
      }, ...historyRef.current].slice(0, 50)
      updateHistory(nextHistory)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'O teste não pôde ser concluído.')
    } finally {
      setIsTesting(false)
      setStage('')
    }
  }

  function clearHistory() {
    if (!window.confirm('Apagar todos os testes salvos neste navegador?')) return
    updateHistory([])
  }

  const chartData = {
    labels: samples.map((_, index) => `${index + 1}`),
    datasets: [{
      data: samples,
      borderColor: '#b8f36a',
      backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
        const { ctx, chartArea } = context.chart
        if (!chartArea) return 'rgba(184, 243, 106, 0.08)'
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
        gradient.addColorStop(0, 'rgba(184, 243, 106, 0.20)')
        gradient.addColorStop(1, 'rgba(184, 243, 106, 0)')
        return gradient
      },
      fill: true,
      borderWidth: 2,
      tension: 0.35,
      pointRadius: samples.length > 1 ? 2 : 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#b8f36a',
    }],
  }
  const latestRecord = history[0]
  const previousRecord = history[1]
  const assessments = metrics ? assessMetrics(metrics) : []
  const overallRating = metrics ? getOverallRating(getScore(metrics)) : null

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="topbar">
          <a className="brand" href="#" aria-label="NEXTPING início">
            <span className="brand-mark"><Zap size={18} fill="currentColor" /></span>
            <span className="brand-name">NEXT<span>PING</span></span>
          </a>
          <nav className="top-tabs" aria-label="Navegação principal">
            <button className={`top-tab ${activeTab === 'overview' ? 'active' : ''}`} aria-pressed={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
              <Gauge size={15} /> Visão geral
            </button>
            <button className={`top-tab ${activeTab === 'history' ? 'active' : ''}`} aria-pressed={activeTab === 'history'} onClick={() => setActiveTab('history')}>
              <History size={15} /> Histórico <span className="history-count">{history.length}</span>
            </button>
          </nav>
          <div className="topbar-right">
            <span className="live-indicator"><span className={`status-dot ${serverOnline ? '' : 'offline'}`} /> {serverOnline ? 'SERVIDOR ONLINE' : 'SERVIDOR OFFLINE'}</span>
          </div>
        </header>

        {activeTab === 'overview' ? (
        <>
        <section className="page-heading" id="dashboard">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> PERFORMANCE DE REDE</div>
            <h1>Sua conexão, <span>sem lag.</span></h1>
            <p>Entenda o que acontece entre você e uma partida melhor.</p>
          </div>
          <div className="game-select-wrap">
            <label htmlFor="game-profile">PERFIL DE JOGO</label>
            <div className="game-select">
              <Gamepad2 size={17} />
              <select id="game-profile" value={selectedGame} onChange={(event) => setSelectedGame(event.target.value)}>
                {games.map((game) => <option key={game}>{game}</option>)}
              </select>
              <ChevronDown size={14} className="select-chevron" />
            </div>
          </div>
        </section>

        <section className="test-layout" id="connection">
          <div className="card hero-card">
            <div className="card-heading">
              <div><span className="section-icon"><Crosshair size={16} /></span><span className="card-title">TESTE DE CONEXÃO</span></div>
              <span className="secure-label"><ShieldCheck size={13} /> WEBSOCKET / TCP</span>
            </div>

            <div className="hero-center">
              <div className={`speed-gauge ${isTesting ? 'is-testing' : ''}`}>
                <div className="gauge-ring"><div className="gauge-inner">
                  {isTesting
                    ? <LoaderCircle className="gauge-loader" size={28} />
                    : <Radio className="gauge-radio" size={27} />}
                  <span className="gauge-value">{metrics ? metrics.ping.toFixed(0) : '—'}</span>
                  <span className="gauge-unit">MS PING</span>
                </div></div>
                <span className="gauge-caption">{isTesting ? stage : metrics ? 'Teste concluído' : 'Pronto para testar'}</span>
              </div>
              <div className="hero-copy">
                <span className="hero-tag"><span className="status-dot" /> NÓ DE TESTE LOCAL</span>
                <h2>{isTesting ? 'Analisando sua conexão' : metrics ? 'Teste finalizado.' : 'Vamos testar sua rede.'}</h2>
                <p>{isTesting
                  ? 'Aguarde enquanto medimos os indicadores da conexão.'
                  : 'Meça sua conexão com o servidor de teste e descubra como ela está respondendo.'}</p>
                <button className="start-button" onClick={startTest} disabled={isTesting}>
                  {isTesting ? <LoaderCircle size={16} className="button-loader" /> : <Play size={15} fill="currentColor" />}
                  {isTesting ? 'TESTE EM ANDAMENTO' : metrics ? 'TESTAR NOVAMENTE' : 'INICIAR TESTE'}
                </button>
                {error && <p className="error-message" role="alert">{error}</p>}
              </div>
            </div>

            <div className="hero-footer">
              <span><Globe2 size={14} /> Servidor: localhost</span>
              <span><Wifi size={14} /> Latência via WebSocket / TCP</span>
              <span className="footer-note">Não mede ping até o servidor do jogo</span>
            </div>
          </div>

          <div className="metrics-column">
            <MetricCard icon={<ArrowDownToLine size={17} />} label="DOWNLOAD" value={metrics?.download.toFixed(1) ?? '—'} unit="Mbps" tone="lime" detail="Recebimento de dados" />
            <MetricCard icon={<ArrowUpFromLine size={17} />} label="UPLOAD" value={metrics?.upload.toFixed(1) ?? '—'} unit="Mbps" tone="blue" detail="Envio de dados" />
            <MetricCard icon={<Clock3 size={17} />} label="JITTER" value={metrics?.jitter.toFixed(1) ?? '—'} unit="ms" tone="purple" detail="Variação da latência" />
            <MetricCard icon={<Signal size={17} />} label="PING SEM RESPOSTA" value={metrics ? metrics.loss.toFixed(1) : '—'} unit="%" tone="orange" detail="Probes TCP sem resposta" />
          </div>
        </section>

        <section className={`card assessment-card ${overallRating ? `rating-${overallRating.status}` : ''}`} aria-live="polite">
          {metrics && overallRating ? (
            <>
              <div className="assessment-summary">
                <div className={`score-ring rating-${overallRating.status}`}>
                  <strong>{getScore(metrics)}</strong><span>DE 100</span>
                </div>
                <div className="assessment-overview">
                  <span className="metric-label">NOTA DESTA MEDIÇÃO</span>
                  <h2>Diagnóstico: <RatingBadge status={overallRating.status} label={overallRating.label} /></h2>
                  <p>{overallRating.summary}</p>
                </div>
              </div>
              <div className="assessment-indicators">
                {assessments.map((indicator) => (
                  <IndicatorCard key={indicator.key} indicator={indicator} />
                ))}
              </div>
              <p className="assessment-disclaimer"><CircleHelp size={14} /> A nota é a média das classificações dos cinco indicadores: Bom = 100, Atenção = 50 e Ruim = 0. É uma referência educativa; o teste local não avalia sua internet nem o caminho até o jogo.</p>
            </>
          ) : (
            <div className="assessment-empty">
              <span className="section-icon"><Activity size={17} /></span>
              <div><h2>Receba uma nota fácil de entender</h2><p>Inicie um teste para ver o que está bom, o que merece atenção e a explicação de cada indicador.</p></div>
            </div>
          )}
        </section>

        <section className="lower-grid">
          <div className="card latency-card">
            <div className="panel-heading">
              <div><div className="panel-title"><Activity size={16} /> ESTABILIDADE DA LATÊNCIA</div><p>Tempo de resposta durante a medição</p></div>
              <div className="latency-legend"><span /> RTT <strong>{metrics ? `${metrics.ping.toFixed(1)} ms` : '— ms'}</strong></div>
            </div>
            <div className="chart-wrap">
              {samples.length === 0 && !isTesting && <div className="chart-empty">Inicie um teste para visualizar as medições de latência.</div>}
              <Line data={chartData} options={chartOptions} />
            </div>
            <div className="chart-axis"><span>AMOSTRAS DE LATÊNCIA</span><span>{samples.length} / 12</span></div>
          </div>

          <div className="card diagnostics-card" id="diagnostics">
            <div className="panel-title"><Network size={16} /> O QUE ESTE TESTE NÃO VERIFICA</div>
            <p className="diagnostics-intro">Estes fatores precisam de outras medições ou permissões.</p>
            <div className="diagnostic-row">
              <span className="diagnostic-icon"><Wifi size={16} /></span>
              <div><strong>Wi-Fi ou cabo</strong><small>O navegador não identifica com confiança o tipo de conexão.</small></div>
              <span className="diagnostic-pending">NÃO MEDIDO</span>
            </div>
            <div className="diagnostic-row">
              <span className="diagnostic-icon"><Zap size={16} /></span>
              <div><strong>Bufferbloat</strong><small>Latência durante downloads e uploads simultâneos.</small></div>
              <span className="diagnostic-pending">NÃO MEDIDO</span>
            </div>
            <div className="diagnostic-row">
              <span className="diagnostic-icon"><Globe2 size={16} /></span>
              <div><strong>Servidor do jogo</strong><small>Ping real exige um servidor remoto dedicado.</small></div>
              <span className="diagnostic-pending">NÃO MEDIDO</span>
            </div>
            <div className="diagnostic-note"><CircleHelp size={14} /> Os resultados de agora medem apenas a comunicação com o servidor local deste protótipo.</div>
          </div>
        </section>

        <footer className="page-footer">
          <span><Gamepad2 size={14} /> Feito para quem leva o jogo a sério.</span>
          <span><span className="status-dot" /> MEDIÇÃO DO NÓ DE TESTE</span>
        </footer>
        </>
        ) : (
          <HistoryPage
            history={history}
            latestRecord={latestRecord}
            previousRecord={previousRecord}
            historyError={historyError}
            onClear={clearHistory}
          />
        )}
      </main>
    </div>
  )
}

function RatingBadge({ status, label }: { status: Rating; label: string }) {
  const Icon = status === 'good' ? CheckCircle2 : status === 'warning' ? AlertTriangle : XCircle
  return <span className={`rating-badge rating-${status}`}><Icon size={14} /> {label}</span>
}

function IndicatorCard({ indicator }: { indicator: IndicatorAssessment }) {
  const Icon = indicator.icon
  return (
    <article className={`indicator-card rating-${indicator.status}`}>
      <div className="indicator-heading">
        <span className="indicator-icon"><Icon size={15} /></span>
        <RatingBadge status={indicator.status} label={indicator.statusLabel} />
      </div>
      <span className="indicator-name">{indicator.label}</span>
      <strong className="indicator-value">{indicator.value}</strong>
      <p>{indicator.hint}</p>
    </article>
  )
}

function HistoryPage({
  history,
  latestRecord,
  previousRecord,
  historyError,
  onClear,
}: {
  history: TestRecord[]
  latestRecord: TestRecord | undefined
  previousRecord: TestRecord | undefined
  historyError: string
  onClear: () => void
}) {
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <section className="history-page">
      <div className="page-heading history-page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> SEUS RESULTADOS</div>
          <h1>Histórico de <span>testes.</span></h1>
          <p>Compare as medições salvas neste navegador e acompanhe as mudanças.</p>
        </div>
        {history.length > 0 && (
          <button className="clear-history-button" onClick={onClear}><Trash2 size={14} /> Limpar histórico</button>
        )}
      </div>

      {historyError && <p className="history-alert" role="alert">{historyError}</p>}

      {history.length === 0 ? (
        <div className="card history-empty">
          <span className="section-icon"><History size={18} /></span>
          <h2>Nenhum teste salvo ainda</h2>
          <p>Faça um teste na visão geral. Seus resultados serão salvos aqui para comparar com o próximo.</p>
        </div>
      ) : (
        <>
          {latestRecord && previousRecord && (
            <section className="card comparison-card">
              <div className="comparison-heading">
                <div>
                  <div className="panel-title"><Activity size={16} /> COMPARAÇÃO COM O TESTE ANTERIOR</div>
                  <p>{dateFormatter.format(new Date(latestRecord.testedAt))} <span>comparado com</span> {dateFormatter.format(new Date(previousRecord.testedAt))}</p>
                </div>
                {(() => {
                  const difference = getScore(latestRecord) - getScore(previousRecord)
                  const status: Rating = difference > 0 ? 'good' : difference < 0 ? 'bad' : 'warning'
                  const label = difference > 0 ? `Nota melhorou ${difference} pontos` : difference < 0 ? `Nota caiu ${Math.abs(difference)} pontos` : 'Nota sem alteração'
                  return <RatingBadge status={status} label={label} />
                })()}
              </div>
              <div className="comparison-scores">
                {[latestRecord, previousRecord].map((record, index) => {
                  const score = getScore(record)
                  const overall = getOverallRating(score)
                  return (
                    <div className="comparison-score" key={record.id}>
                      <span>{index === 0 ? 'TESTE MAIS RECENTE' : 'TESTE ANTERIOR'}</span>
                      <strong>{score}<small>/100</small></strong>
                      <RatingBadge status={overall.status} label={overall.label} />
                    </div>
                  )
                })}
              </div>
              <div className="comparison-indicators">
                {assessMetrics(latestRecord).map((indicator) => {
                  const difference = latestRecord[indicator.key] - previousRecord[indicator.key]
                  const changed = Math.abs(difference) >= 0.05
                  const improved = changed && (indicator.higherIsBetter ? difference > 0 : difference < 0)
                  const trend = !changed ? 'stable' : improved ? 'better' : 'worse'
                  const change = Math.abs(difference).toFixed(1)
                  const unit = indicator.key === 'download' || indicator.key === 'upload' ? 'Mbps' : indicator.key === 'loss' ? '%' : 'ms'
                  return (
                    <div className={`comparison-indicator trend-${trend}`} key={indicator.key}>
                      <span>{indicator.label}</span>
                      <strong>{indicator.value}</strong>
                      <small>{!changed ? 'Sem alteração' : `${improved ? 'Melhorou' : 'Piorou'} ${change} ${unit}`}</small>
                    </div>
                  )
                })}
              </div>
              <p className="history-local-note"><CircleHelp size={14} /> Comparação educativa: os testes atuais usam o nó local e não medem sua internet real.</p>
            </section>
          )}

          <div className="history-list-heading">
            <div><h2>Todos os testes</h2><span>{history.length} de até 50 resultados</span></div>
          </div>
          <div className="history-list">
            {history.map((record, index) => {
              const score = getScore(record)
              const overall = getOverallRating(score)
              return (
                <article className="card history-record" key={record.id}>
                  <div className="history-record-main">
                    <div className="history-number">{history.length - index}</div>
                    <div className="history-record-title">
                      <strong>{record.game}</strong>
                      <span>{dateFormatter.format(new Date(record.testedAt))}</span>
                    </div>
                    <div className="history-record-score"><strong>{score}<small>/100</small></strong><RatingBadge status={overall.status} label={overall.label} /></div>
                  </div>
                  <div className="history-record-metrics">
                    {assessMetrics(record).map((indicator) => (
                      <span className={`history-metric rating-${indicator.status}`} key={indicator.key}>
                        <span>{indicator.label}</span><strong>{indicator.value}</strong>
                      </span>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function MetricCard({ icon, label, value, unit, tone, detail }: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  tone: string
  detail: string
}) {
  return (
    <div className="card metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <span className="metric-label">{label}</span>
      <div className="metric-value">{value}<span>{unit}</span></div>
      <span className="metric-detail">{detail}</span>
    </div>
  )
}

export default App
