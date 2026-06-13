// 画面制御: ホーム → カウントダウン → 60秒測定 → 診断書
import './style.css'
import { Game, GAME_SECONDS, PHASE_LABELS } from './game/game'
import { FlickKeyboard } from './keyboard/flickKeyboard'
import {
  accuracy, diagnosis, finalScore, pseudoHensachi, titleFor,
} from './engine/score'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const screens = {
  home: $('screen-home'),
  play: $('screen-play'),
  result: $('screen-result'),
}

function show(name: keyof typeof screens): void {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name
}

// ===== 設定（フリック感度の較正） =====
const SENS_KEY = 'oyayubi.sensitivity'
const BEST_KEY = 'oyayubi.best'
const sensInput = $<HTMLInputElement>('sensitivity')
const sensVal = $('sensitivity-val')
const savedSens = Number(localStorage.getItem(SENS_KEY)) || 24
sensInput.value = String(savedSens)
sensVal.textContent = String(savedSens)
sensInput.addEventListener('input', () => {
  sensVal.textContent = sensInput.value
  localStorage.setItem(SENS_KEY, sensInput.value)
  keyboard.threshold = Number(sensInput.value)
})

// ===== キーボード =====
let game: Game | null = null
/** 計測中のみtrue。カウントダウン中・終了後の入力を無視するゲート */
let running = false
const keyboard = new FlickKeyboard($('keyboard'), {
  threshold: savedSens,
  onInput: e => {
    if (!game || !running) return
    const result = game.handle(e.kind, e.char, e.dir)
    if (result === 'word') keyboard.breakToggle() // 語境界をまたぐ同一キー連打のトグル誤爆防止
    if (result === 'miss') {
      const area = $('target-area')
      area.classList.remove('miss-flash')
      void area.offsetWidth // reflowでアニメ再発火
      area.classList.add('miss-flash')
      // 暫定文字（黄色）が残ったまま詰まっている場合は直し方を示す
      const v = game.view()
      if (v.typed.length > v.matchedCount) showStuckHint()
    }
    renderPlay()
  },
})

// ===== ホーム =====
interface BestRecord {
  score: number
  hensachi: number
  title: string
}

function loadBest(): BestRecord | null {
  const raw = localStorage.getItem(BEST_KEY)
  if (!raw) return null
  try {
    const b = JSON.parse(raw) as BestRecord
    if (typeof b.score !== 'number') throw new Error('invalid')
    return b
  } catch {
    localStorage.removeItem(BEST_KEY)
    return null
  }
}

function renderHome(): void {
  const b = loadBest()
  const bestEl = $('home-best')
  if (b) {
    bestEl.textContent = `自己ベスト: ${b.score} pt（偏差値${b.hensachi}・${b.title}）`
    bestEl.hidden = false
  } else {
    bestEl.hidden = true
  }
}

$('btn-start').addEventListener('click', startCountdown)
$('btn-retry').addEventListener('click', startCountdown)
$('btn-home').addEventListener('click', () => {
  renderHome()
  show('home')
})
$('btn-quit').addEventListener('click', () => {
  running = false
  cancelAnimationFrame(rafId)
  game = null
  keyboard.cancelAll()
  renderHome()
  show('home')
})

function toast(message: string): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1700)
}

// ===== カウントダウン → 測定 =====
function startCountdown(): void {
  show('play')
  renderNewGame()
  const overlay = document.createElement('div')
  overlay.className = 'countdown'
  overlay.textContent = '3'
  document.body.appendChild(overlay)
  let n = 3
  const iv = setInterval(() => {
    n--
    if (n > 0) {
      overlay.textContent = String(n)
    } else {
      clearInterval(iv)
      overlay.remove()
      startGame()
    }
  }, 700)
}

let rafId = 0
let startedAt = 0

function renderNewGame(): void {
  game = new Game(1) // プロト版: 固定シード
  $('timer').textContent = GAME_SECONDS.toFixed(1)
  $('timer-fill').style.width = '100%'
  $('score-live').textContent = '0 pt'
  renderPlay()
}

let stuckTimer = 0
function showStuckHint(): void {
  const el = $('stuck-hint')
  el.hidden = false
  clearTimeout(stuckTimer)
  stuckTimer = window.setTimeout(() => {
    el.hidden = true
  }, 2500)
}

// バックグラウンド移行（通知・アプリ切替）で計測は無効になるため中断扱いにする
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    running = false
    cancelAnimationFrame(rafId)
    game = null
    keyboard.cancelAll()
    renderHome()
    show('home')
    const bestEl = $('home-best')
    bestEl.textContent = '⚠️ 画面を離れたため測定を中断しました'
    bestEl.hidden = false
  }
})

function startGame(): void {
  running = true
  startedAt = performance.now()
  const loop = (): void => {
    if (!game) return
    const elapsed = (performance.now() - startedAt) / 1000
    const remain = Math.max(0, GAME_SECONDS - elapsed)
    $('timer').textContent = remain.toFixed(1)
    $('timer-fill').style.width = `${(remain / GAME_SECONDS) * 100}%`
    if (game.tick(Math.min(elapsed, GAME_SECONDS - 0.001))) renderPlay()
    if (remain <= 0) {
      finishGame()
      return
    }
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
}

function renderPlay(): void {
  if (!game) return
  const v = game.view()
  $('phase-label').textContent = PHASE_LABELS[v.phase]
  $('score-live').textContent = `${v.stats.actions} pt`
  $('target-display').textContent = v.word.display

  // かな列: 確定済み(緑) / 暫定(黄) / 残り(白)
  const kanaEl = $('target-kana')
  kanaEl.textContent = ''
  const frag = document.createDocumentFragment()
  const matched = v.matchedCount
  const typedLen = v.typed.length
  for (let i = 0; i < v.word.reading.length; i++) {
    const span = document.createElement('span')
    span.textContent = v.word.reading[i]
    span.className = i < matched ? 'done' : i < typedLen ? 'pend' : 'rest'
    frag.appendChild(span)
  }
  kanaEl.appendChild(frag)

  $('next-queue').textContent = `NEXT: ${v.next.map(w => w.display).join(' → ')}`
}

// ===== 結果 =====
function finishGame(): void {
  running = false
  cancelAnimationFrame(rafId)
  keyboard.cancelAll()
  if (!game) return
  const stats = game.stats
  const score = finalScore(stats)
  const hensachi = pseudoHensachi(score)
  const title = titleFor(score)
  const acc = accuracy(stats)

  $('result-hensachi-val').textContent = String(hensachi)
  $('result-title').textContent = title.name
  $('result-score').textContent = `${score} pt`
  $('result-acc').textContent = `${(acc * 100).toFixed(1)}%`
  $('result-words').textContent = `${stats.completedWords}個`

  // 3種目バー
  const phasesEl = $('result-phases')
  phasesEl.textContent = ''
  const maxActions = Math.max(...stats.phases.map(p => p.actions), 1)
  stats.phases.forEach((p, i) => {
    const row = document.createElement('div')
    row.className = 'radar-row'
    const lbl = document.createElement('span')
    lbl.className = 'lbl'
    lbl.textContent = PHASE_LABELS[i]
    const bar = document.createElement('div')
    bar.className = 'bar'
    const fill = document.createElement('div')
    fill.style.width = `${(p.actions / maxActions) * 100}%`
    bar.appendChild(fill)
    const val = document.createElement('span')
    val.textContent = String(p.actions)
    row.append(lbl, bar, val)
    phasesEl.appendChild(row)
  })

  // 所見
  const notesEl = $('result-notes')
  notesEl.textContent = ''
  for (const n of diagnosis(stats)) {
    const p = document.createElement('p')
    p.textContent = `・${n}`
    notesEl.appendChild(p)
  }

  // 自己ベスト
  const prev = loadBest()
  const isNewRecord = score > (prev?.score ?? -1)
  $('new-record').hidden = !isNewRecord
  if (isNewRecord) {
    localStorage.setItem(
      BEST_KEY,
      JSON.stringify({ score, hensachi, title: title.name }),
    )
  }

  game = null
  show('result')

  // シェア
  $('btn-share').onclick = () => {
    const text = `親指偏差値${hensachi}（${title.name}・${score}pt）だった。お前の親指、偏差値いくつ？`
    const url = location.href
    if (navigator.share) {
      navigator.share({ text, url }).catch(() => {})
    } else if (navigator.clipboard) {
      navigator.clipboard
        .writeText(`${text} ${url}`)
        .then(() => toast('結果をコピーしました'))
        .catch(() => prompt('コピーしてシェアしてください', `${text} ${url}`))
    } else {
      prompt('コピーしてシェアしてください', `${text} ${url}`)
    }
  }
}

renderHome()
show('home')
