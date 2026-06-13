// 12キーフリックキーボードのかな定義と変換テーブル

/** フリック方向: 0=タップ(中央) 1=左 2=上 3=右 4=下 */
export type FlickDir = 0 | 1 | 2 | 3 | 4

export interface KeyDef {
  id: string
  /** [タップ, 左, 上, 右, 下] 空文字は割り当てなし */
  chars: readonly string[]
}

export const KEYS: readonly KeyDef[] = [
  { id: 'a', chars: ['あ', 'い', 'う', 'え', 'お'] },
  { id: 'ka', chars: ['か', 'き', 'く', 'け', 'こ'] },
  { id: 'sa', chars: ['さ', 'し', 'す', 'せ', 'そ'] },
  { id: 'ta', chars: ['た', 'ち', 'つ', 'て', 'と'] },
  { id: 'na', chars: ['な', 'に', 'ぬ', 'ね', 'の'] },
  { id: 'ha', chars: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
  { id: 'ma', chars: ['ま', 'み', 'む', 'め', 'も'] },
  { id: 'ya', chars: ['や', '（', 'ゆ', '）', 'よ'] },
  { id: 'ra', chars: ['ら', 'り', 'る', 'れ', 'ろ'] },
  { id: 'wa', chars: ['わ', 'を', 'ん', 'ー', ''] },
] as const

/** 変換キー（゛゜小）のサイクル: 1回押すごとに次へ。サイクル末尾は基底に戻る */
const CYCLES: readonly string[][] = [
  ['あ', 'ぁ'], ['い', 'ぃ'], ['う', 'ぅ'], ['え', 'ぇ'], ['お', 'ぉ'],
  ['か', 'が'], ['き', 'ぎ'], ['く', 'ぐ'], ['け', 'げ'], ['こ', 'ご'],
  ['さ', 'ざ'], ['し', 'じ'], ['す', 'ず'], ['せ', 'ぜ'], ['そ', 'ぞ'],
  ['た', 'だ'], ['ち', 'ぢ'], ['つ', 'っ', 'づ'], ['て', 'で'], ['と', 'ど'],
  ['は', 'ば', 'ぱ'], ['ひ', 'び', 'ぴ'], ['ふ', 'ぶ', 'ぷ'], ['へ', 'べ', 'ぺ'], ['ほ', 'ぼ', 'ぽ'],
  ['や', 'ゃ'], ['ゆ', 'ゅ'], ['よ', 'ょ'],
  ['わ', 'ゎ'],
]

const cycleOf = new Map<string, readonly string[]>()
for (const cycle of CYCLES) {
  for (const c of cycle) cycleOf.set(c, cycle)
}

/** 変換キーを1回押したときの結果。変換できない文字は null */
export function nextInCycle(c: string): string | null {
  const cycle = cycleOf.get(c)
  if (!cycle) return null
  const i = cycle.indexOf(c)
  return cycle[(i + 1) % cycle.length]
}

/** c が変換キー押下（何回でも）で target になり得るか */
export function canBecome(c: string, target: string): boolean {
  const cycle = cycleOf.get(c)
  return !!cycle && cycle.includes(target)
}

/** 文字の基底（清音）形。サイクル先頭 */
export function baseChar(c: string): string {
  const cycle = cycleOf.get(c)
  return cycle ? cycle[0] : c
}

const keyOfChar = new Map<string, KeyDef>()
for (const key of KEYS) {
  for (const c of key.chars) {
    if (c) keyOfChar.set(c, key)
  }
}

/** c がどのキーから入力されるか（基底形で引く） */
export function keyFor(c: string): KeyDef | null {
  return keyOfChar.get(baseChar(c)) ?? null
}

/** 同じキーのトグル順で c の次の文字（あ→い→う→え→お→あ）。トグル対象外は null */
export function nextToggle(c: string): string | null {
  const key = keyOfChar.get(c)
  if (!key) return null
  const chars = key.chars.filter(x => x !== '')
  const i = chars.indexOf(c)
  if (i < 0) return null
  return chars[(i + 1) % chars.length]
}

/** 2文字が同一キーのトグルグループに属するか（基底形で比較） */
export function sameKeyGroup(a: string, b: string): boolean {
  const ka = keyOfChar.get(baseChar(a))
  const kb = keyOfChar.get(baseChar(b))
  return !!ka && ka === kb
}

/**
 * 文字1つの正準キーアクション数。
 * 清音/撥音/長音=1、濁音=2、半濁音=3、小書き=2（サイクル位置+1）
 */
export function actionCost(c: string): number {
  const cycle = cycleOf.get(c)
  if (!cycle) return 1
  return cycle.indexOf(c) + 1
}

/** 読み文字列全体の正準キーアクション数（拗音は構成文字の合算） */
export function totalActions(reading: string): number {
  let sum = 0
  for (const c of reading) sum += actionCost(c)
  return sum
}
