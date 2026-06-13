// 60秒測定のゲームループ（UI非依存）
import { Composer } from '../engine/composer'
import { emptyStats, type GameStats } from '../engine/score'
import { AGILITY, ENDURANCE, SPRINT, shuffled, type Word } from './words'
import { totalActions, type FlickDir } from '../engine/kana'

export const GAME_SECONDS = 60
/** 種目の切り替え秒（経過秒）: 0-20瞬発 / 20-40敏捷 / 40-60持久 */
const PHASE_BOUNDARIES = [20, 40]
export const PHASE_LABELS = ['瞬発', '敏捷', '持久'] as const

export type GameEventKind = 'char' | 'modifier' | 'toggle' | 'delete'

export interface GameView {
  word: Word
  typed: string
  matchedCount: number
  next: Word[]
  phase: number
  stats: GameStats
}

export class Game {
  readonly stats: GameStats = emptyStats()
  private queues: Word[][]
  private indexInPhase = 0
  private word: Word
  /** 現在のお題がどの種目キューから出たか（種目切替の猶予管理用） */
  private wordPhase = 0
  private composer: Composer
  private elapsedSec = 0
  /** 現在のお題で加点済みの正準アクション数（削除→再入力での水増しを防ぐ単調増加値） */
  private awardedForWord = 0

  constructor(seed = 1) {
    this.queues = [
      shuffled(SPRINT, seed),
      shuffled(AGILITY, seed + 1),
      shuffled(ENDURANCE, seed + 2),
    ]
    this.word = this.queues[0][0]
    this.composer = new Composer(this.word.reading)
  }

  get phase(): number {
    if (this.elapsedSec >= PHASE_BOUNDARIES[1]) return 2
    if (this.elapsedSec >= PHASE_BOUNDARIES[0]) return 1
    return 0
  }

  /** 次のお題を現在の種目キューから取り出す */
  private pickWord(): void {
    if (this.wordPhase !== this.phase) {
      this.wordPhase = this.phase
      this.indexInPhase = 0
    }
    const q = this.queues[this.wordPhase]
    this.word = q[this.indexInPhase % q.length]
    this.composer = new Composer(this.word.reading)
    this.awardedForWord = 0
  }

  /** タイマーから経過秒を通知。種目が切り替わったら true */
  tick(elapsedSec: number): boolean {
    const before = this.phase
    this.elapsedSec = elapsedSec
    if (this.phase !== before) {
      // 打ちかけのお題は破棄せず維持（理不尽ミス防止）。未入力なら即座に新種目のお題へ
      if (this.composer.current === '') this.pickWord()
      return true
    }
    return false
  }

  currentWord(): Word {
    return this.word
  }

  view(): GameView {
    // NEXT表示: 種目が既に切り替わっていれば新種目のキューを見せる
    const q = this.queues[this.phase]
    const base = this.wordPhase === this.phase ? this.indexInPhase : -1
    const next = [1, 2].map(d => q[(base + d) % q.length])
    return {
      word: this.word,
      typed: this.composer.current,
      matchedCount: this.composer.matchedCount,
      next,
      phase: this.phase,
      stats: this.stats,
    }
  }

  /**
   * 入力イベント処理。
   * dir はミス方向分析用（charイベントのみ意味を持つ）
   * 返り値: 'ok' 受理 / 'miss' 拒否 / 'word' お題完了 / 'noop'
   */
  handle(kind: GameEventKind, char: string, dir: FlickDir = 0): 'ok' | 'miss' | 'word' | 'noop' {
    const result =
      kind === 'char' ? this.composer.inputChar(char)
      : kind === 'modifier' ? this.composer.inputModifier()
      : kind === 'toggle' ? this.composer.inputToggle()
      : this.composer.deleteChar()

    const p = this.stats.phases[this.phase]
    switch (result.kind) {
      case 'complete': {
        this.awardUpTo(totalActions(this.composer.target))
        this.stats.completedWords++
        this.indexInPhase++
        this.pickWord()
        return 'word'
      }
      case 'progress': {
        // 確定文字（targetと一致した先頭部分）の正準アクション数の純増分だけ加点。
        // 暫定文字や削除→再入力では増えないため、スコア水増しが構造的に不可能
        const confirmed = this.composer.target.slice(0, this.composer.matchedCount)
        this.awardUpTo(totalActions(confirmed))
        return 'ok'
      }
      case 'miss': {
        this.stats.misses++
        p.misses++
        this.stats.missByDir[dir]++
        return 'miss'
      }
      default:
        return 'noop'
    }
  }

  private awardUpTo(due: number): void {
    if (due <= this.awardedForWord) return
    const delta = due - this.awardedForWord
    this.stats.actions += delta
    this.stats.phases[this.phase].actions += delta
    this.awardedForWord = due
  }
}
