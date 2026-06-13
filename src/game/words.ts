// 週間お題セット（プロト版: 固定シード1セット）
// display: 画面に出す表記 / reading: 判定対象のひらがな列（読み一意のみ）
export interface Word {
  display: string
  reading: string
}

/** 種目1: 瞬発（2〜4かな の短語連打） */
export const SPRINT: readonly Word[] = [
  { display: 'りょ', reading: 'りょ' },
  { display: 'うん', reading: 'うん' },
  { display: 'おけ', reading: 'おけ' },
  { display: 'いいよ', reading: 'いいよ' },
  { display: 'それな', reading: 'それな' },
  { display: 'まじか', reading: 'まじか' },
  { display: 'ねむい', reading: 'ねむい' },
  { display: 'あとで', reading: 'あとで' },
  { display: 'いまどこ', reading: 'いまどこ' },
  { display: 'たしかに', reading: 'たしかに' },
  { display: 'おはよう', reading: 'おはよう' },
  { display: 'ごめん', reading: 'ごめん' },
  { display: 'わかった', reading: 'わかった' },
  { display: 'やばい', reading: 'やばい' },
  { display: 'すごい', reading: 'すごい' },
  { display: 'なるほど', reading: 'なるほど' },
]

/** 種目2: 敏捷（キー間の移動距離が大きい・変換キー多め） */
export const AGILITY: readonly Word[] = [
  { display: 'お疲れさま', reading: 'おつかれさま' },
  { display: 'ありがとう', reading: 'ありがとう' },
  { display: '了解です', reading: 'りょうかいです' },
  { display: 'ぜんぜん大丈夫', reading: 'ぜんぜんだいじょうぶ' },
  { display: 'ちょっと待って', reading: 'ちょっとまって' },
  { display: 'がんばって', reading: 'がんばって' },
  { display: 'びっくりした', reading: 'びっくりした' },
  { display: 'ぴったり', reading: 'ぴったり' },
  { display: 'らじゃー', reading: 'らじゃー' },
  { display: 'ほんとそれ', reading: 'ほんとそれ' },
  { display: 'おめでとう', reading: 'おめでとう' },
  { display: 'どんまい', reading: 'どんまい' },
]

/** 種目3: 持久（8〜15かな の文） */
export const ENDURANCE: readonly Word[] = [
  { display: '今向かってるところ', reading: 'いまむかってるところ' },
  { display: 'ごめん寝てたわ', reading: 'ごめんねてたわ' },
  { display: 'あとごふんでつく', reading: 'あとごふんでつく' },
  { display: 'きょうはありがとうね', reading: 'きょうはありがとうね' },
  { display: 'また誘ってください', reading: 'またさそってください' },
  { display: 'しゅうまつあいてますか', reading: 'しゅうまつあいてますか' },
  { display: 'さきにはじめてていいよ', reading: 'さきにはじめてていいよ' },
  { display: 'のみものかってくね', reading: 'のみものかってくね' },
  { display: 'でんしゃおくれてるみたい', reading: 'でんしゃおくれてるみたい' },
  { display: 'あしたのよていきまった', reading: 'あしたのよていきまった' },
]

/** 決定論的シャッフル（週間シード想定。プロトは固定シード） */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items]
  let s = seed
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
