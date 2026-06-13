// 入力合成エンジン: お題（読みかな列）に対する入力の受理判定
// 許容パターン: 後から゛゜小（変換キー）、同一キートグル、削除によるやり直し
import { canBecome, nextInCycle, nextToggle, sameKeyGroup } from './kana'

export type InputResult =
  | { kind: 'progress'; typed: string }
  | { kind: 'complete'; typed: string }
  | { kind: 'miss'; typed: string }
  | { kind: 'noop'; typed: string }

/**
 * 1お題分の入力状態。
 * typed はまだ確定しきっていない最後の1文字が「target の対応位置の文字に
 * 変換キーまたはトグルで到達可能」であれば暫定受理される。
 */
export class Composer {
  readonly target: string
  private typed = ''

  constructor(target: string) {
    this.target = target
  }

  get current(): string {
    return this.typed
  }

  /** 確定済み文字数（target と完全一致している先頭部分） */
  get matchedCount(): number {
    let n = 0
    while (n < this.typed.length && this.typed[n] === this.target[n]) n++
    return n
  }

  /** かな1文字の入力（タップ/フリック由来） */
  inputChar(c: string): InputResult {
    return this.evaluate(this.typed + c)
  }

  /** 変換キー（゛゜小）押下: 最後の文字をサイクルの次へ */
  inputModifier(): InputResult {
    if (!this.typed) return { kind: 'noop', typed: this.typed }
    const last = this.typed[this.typed.length - 1]
    const next = nextInCycle(last)
    if (next === null) return { kind: 'miss', typed: this.typed }
    return this.evaluate(this.typed.slice(0, -1) + next)
  }

  /** トグル: 最後の文字を同一キーの次の文字に置換（キーボード層が同一キー連打を検知して呼ぶ） */
  inputToggle(): InputResult {
    if (!this.typed) return { kind: 'noop', typed: this.typed }
    const last = this.typed[this.typed.length - 1]
    const next = nextToggle(last)
    if (next === null) return { kind: 'miss', typed: this.typed }
    return this.evaluate(this.typed.slice(0, -1) + next)
  }

  /** 削除キー: ペナルティなしで1文字戻す */
  deleteChar(): InputResult {
    if (!this.typed) return { kind: 'noop', typed: this.typed }
    this.typed = this.typed.slice(0, -1)
    return { kind: 'progress', typed: this.typed }
  }

  /** candidate が受理可能ならコミットし、不可なら状態を変えず miss */
  private evaluate(candidate: string): InputResult {
    if (candidate === this.target) {
      this.typed = candidate
      return { kind: 'complete', typed: this.typed }
    }
    if (this.isAcceptablePrefix(candidate)) {
      this.typed = candidate
      return { kind: 'progress', typed: this.typed }
    }
    return { kind: 'miss', typed: this.typed }
  }

  /**
   * 受理条件: 最後の文字以外は target と完全一致、
   * 最後の文字は target の対応位置と一致 or 変換キーで到達可能 or 同一キーのトグルグループ
   */
  private isAcceptablePrefix(s: string): boolean {
    if (s.length === 0) return true
    if (s.length > this.target.length) return false
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] !== this.target[i]) return false
    }
    const last = s[s.length - 1]
    const want = this.target[s.length - 1]
    return last === want || canBecome(last, want) || sameKeyGroup(last, want)
  }
}
