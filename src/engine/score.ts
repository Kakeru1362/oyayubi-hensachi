// スコア計算と称号判定
export interface PhaseStats {
  actions: number
  misses: number
}

export interface GameStats {
  /** 受理されたキーアクション総数 */
  actions: number
  misses: number
  /** 種目別: 瞬発/敏捷/持久 */
  phases: [PhaseStats, PhaseStats, PhaseStats]
  /** フリック方向別ミス (0=タップ 1=左 2=上 3=右 4=下) */
  missByDir: [number, number, number, number, number]
  completedWords: number
}

export function emptyStats(): GameStats {
  return {
    actions: 0,
    misses: 0,
    phases: [
      { actions: 0, misses: 0 },
      { actions: 0, misses: 0 },
      { actions: 0, misses: 0 },
    ],
    missByDir: [0, 0, 0, 0, 0],
    completedWords: 0,
  }
}

export function accuracy(s: GameStats): number {
  const total = s.actions + s.misses
  return total === 0 ? 1 : s.actions / total
}

/** 最終スコア: キーアクション数 ×（正確率)³ */
export function finalScore(s: GameStats): number {
  return Math.round(s.actions * Math.pow(accuracy(s), 3))
}

/**
 * 演出用の擬似偏差値（プロト版: ローカル換算）。
 * 上限張り付きで差がつかなくならないよう傾斜を緩め、上限99は約490pt必要
 */
export function pseudoHensachi(score: number): number {
  const h = 50 + (score - 150) / 7
  return Math.max(20, Math.min(99, Math.round(h)))
}

export interface Title {
  name: string
  min: number
  theme: string
}

/** 称号8段階（閾値はベータで較正予定） */
export const TITLES: readonly Title[] = [
  { name: '親指赤ちゃん', min: 0, theme: 'baby' },
  { name: 'もやし親指', min: 40, theme: 'moyashi' },
  { name: '省エネ親指', min: 70, theme: 'eco' },
  { name: '一般人の親指', min: 100, theme: 'normal' },
  { name: '鍛えられし親指', min: 140, theme: 'trained' },
  { name: '親指アスリート', min: 190, theme: 'athlete' },
  { name: 'サムライ', min: 250, theme: 'samurai' },
  { name: 'ゴッドサム', min: 320, theme: 'god' },
]

export function titleFor(score: number): Title {
  let result = TITLES[0]
  for (const t of TITLES) {
    if (score >= t.min) result = t
  }
  return result
}

const PHASE_NAMES = ['瞬発', '敏捷', '持久'] as const
const DIR_NAMES = ['タップ', '左フリック', '上フリック', '右フリック', '下フリック'] as const

/** 診断書の所見コメント（静的テンプレ） */
export function diagnosis(s: GameStats): string[] {
  const notes: string[] = []
  const acc = accuracy(s)

  if (acc < 0.8) {
    notes.push('ミスタッチ多発。スコア式は正確率の3乗が効くため、丁寧に打つだけで偏差値が跳ね上がります。')
  } else if (acc >= 0.97 && s.actions > 0) {
    notes.push('驚異の正確性。あとは速度を上げるだけの体です。')
  }

  const phaseScores = s.phases.map(p => p.actions)
  const maxIdx = phaseScores.indexOf(Math.max(...phaseScores))
  const minIdx = phaseScores.indexOf(Math.min(...phaseScores))
  if (s.actions >= 30 && maxIdx !== minIdx) {
    notes.push(
      `あなたは${PHASE_NAMES[maxIdx]}型。${PHASE_NAMES[minIdx]}種目に伸びしろが眠っています。`,
    )
  }

  const worstDir = s.missByDir.indexOf(Math.max(...s.missByDir))
  if (s.missByDir[worstDir] >= 3) {
    notes.push(`${DIR_NAMES[worstDir]}で迷子になりがちです。重点的な経過観察が必要です。`)
  }

  if (notes.length === 0) {
    notes.push('特記事項なし。健康な親指です。')
  }
  notes.push('経過観察のため、また測定に来てください。')
  return notes
}
