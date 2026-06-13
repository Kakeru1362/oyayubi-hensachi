// テスト用 re-export と補助
import type { FlickDir } from '../src/engine/kana'
export { actionCost, baseChar, canBecome, nextInCycle, nextToggle, totalActions } from '../src/engine/kana'
import { KEYS, baseChar } from '../src/engine/kana'

/** 文字の入力に必要なフリック方向（テストの入力シミュレーション用） */
export function flick(c: string): FlickDir {
  const base = baseChar(c)
  for (const key of KEYS) {
    const i = key.chars.indexOf(base)
    if (i >= 0) return i as FlickDir
  }
  return 0
}
