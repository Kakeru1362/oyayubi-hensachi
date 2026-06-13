import { describe, expect, it } from 'vitest'
import { Composer } from '../src/engine/composer'
import { actionCost, baseChar, canBecome, flick, nextInCycle, nextToggle, totalActions } from './helpers'
import { flickDir } from '../src/keyboard/flickKeyboard'
import { Game } from '../src/game/game'

describe('kana 変換テーブル', () => {
  it('変換キーのサイクル: か→が→か', () => {
    expect(nextInCycle('か')).toBe('が')
    expect(nextInCycle('が')).toBe('か')
  })
  it('は行は3段サイクル: は→ば→ぱ→は', () => {
    expect(nextInCycle('は')).toBe('ば')
    expect(nextInCycle('ば')).toBe('ぱ')
    expect(nextInCycle('ぱ')).toBe('は')
  })
  it('つ→っ→づ→つ', () => {
    expect(nextInCycle('つ')).toBe('っ')
    expect(nextInCycle('っ')).toBe('づ')
    expect(nextInCycle('づ')).toBe('つ')
  })
  it('canBecome: か→が / ゆ→ゅ / か→ぱ は不可', () => {
    expect(canBecome('か', 'が')).toBe(true)
    expect(canBecome('ゆ', 'ゅ')).toBe(true)
    expect(canBecome('か', 'ぱ')).toBe(false)
  })
  it('トグル: あ→い→う、わ→を→ん→ー→わ', () => {
    expect(nextToggle('あ')).toBe('い')
    expect(nextToggle('い')).toBe('う')
    expect(nextToggle('ー')).toBe('わ')
  })
  it('正準アクション数: 清音1/濁音2/半濁音3/小書き2/っ2', () => {
    expect(actionCost('か')).toBe(1)
    expect(actionCost('が')).toBe(2)
    expect(actionCost('ぱ')).toBe(3)
    expect(actionCost('ゃ')).toBe(2)
    expect(actionCost('っ')).toBe(2)
    expect(actionCost('ん')).toBe(1)
    expect(actionCost('ー')).toBe(1)
  })
  it('読み全体のアクション数: ぎゃ=4（ぎ2+ゃ2）', () => {
    expect(totalActions('ぎゃ')).toBe(4)
    expect(totalActions('りょうかい')).toBe(6) // り1+ょ2+う1+か1+い1
  })
})

describe('Composer 受理判定', () => {
  it('正しい入力で進行し完了する', () => {
    const c = new Composer('うん')
    expect(c.inputChar('う').kind).toBe('progress')
    expect(c.inputChar('ん').kind).toBe('complete')
  })
  it('後から゛: か+変換キー=が', () => {
    const c = new Composer('がっこう')
    expect(c.inputChar('か').kind).toBe('progress') // 暫定受理
    expect(c.matchedCount).toBe(0)
    expect(c.inputModifier().kind).toBe('progress')
    expect(c.matchedCount).toBe(1)
  })
  it('後から小書き: ゆ+変換キー=ゅ', () => {
    const c = new Composer('りょ')
    expect(c.inputChar('り').kind).toBe('progress')
    expect(c.inputChar('よ').kind).toBe('progress') // よ は ょ になり得る
    expect(c.inputModifier().kind).toBe('complete')
  })
  it('トグル入力: あ連打で い に到達', () => {
    const c = new Composer('いぬ')
    expect(c.inputChar('あ').kind).toBe('progress') // 同一キーグループで暫定受理
    expect(c.inputToggle().kind).toBe('progress') // あ→い
    expect(c.matchedCount).toBe(1)
    expect(c.inputChar('ぬ').kind).toBe('complete')
  })
  it('全く違うキーはミス、状態は変わらない', () => {
    const c = new Composer('うん')
    expect(c.inputChar('ま').kind).toBe('miss')
    expect(c.current).toBe('')
  })
  it('変換キー: 対象がない時はミス、変換不能文字もミス', () => {
    const c = new Composer('んー')
    expect(c.inputModifier().kind).toBe('noop') // 空
    c.inputChar('ん')
    expect(c.inputModifier().kind).toBe('miss') // ん は変換不能
  })
  it('削除でやり直せる（ペナルティなし）', () => {
    const c = new Composer('いぬ')
    c.inputChar('あ')
    expect(c.deleteChar().kind).toBe('progress')
    expect(c.current).toBe('')
    expect(c.inputChar('い').kind).toBe('progress')
  })
  it('長すぎる入力は受理しない', () => {
    const c = new Composer('あ')
    c.inputChar('あ') // complete だが続けて打つと
    expect(c.inputChar('あ').kind).toBe('miss')
  })
})

describe('flickDir 方向判定', () => {
  it('閾値未満はタップ', () => {
    expect(flickDir(5, 5, 24)).toBe(0)
  })
  it('4方向の判定', () => {
    expect(flickDir(-40, 0, 24)).toBe(1) // 左
    expect(flickDir(0, -40, 24)).toBe(2) // 上
    expect(flickDir(40, 0, 24)).toBe(3) // 右
    expect(flickDir(0, 40, 24)).toBe(4) // 下
  })
  it('斜め45°の境界', () => {
    expect(flickDir(30, -29, 24)).toBe(3) // 右上寄り → 右
    expect(flickDir(29, -30, 24)).toBe(2) // 上寄り → 上
  })
})

describe('Game 統合', () => {
  it('お題完了で次のお題に進み、統計が更新される', () => {
    const g = new Game(1)
    const word = g.currentWord()
    let last: string = ''
    for (const ch of word.reading) {
      last = g.handle('char', ch, flick(ch))
    }
    expect(last).toBe('word')
    expect(g.stats.completedWords).toBe(1)
    expect(g.stats.actions).toBe(word.reading.length)
    expect(g.currentWord().reading).not.toBe(word.reading)
  })
  it('ミスが方向別に記録される', () => {
    const g = new Game(1)
    // 必ずミスになる文字を動的に探す（お題の先頭で受理されない文字）
    const missChar = ['ぴ', 'む', 'ろ', 'せ', 'ぬ', 'へ'].find(c => {
      const probe = new Composer(g.currentWord().reading)
      return probe.inputChar(c).kind === 'miss'
    })
    expect(missChar, '全候補が受理されるお題は想定外').toBeDefined()
    g.handle('char', missChar!, 2)
    expect(g.stats.misses).toBe(1)
    expect(g.stats.missByDir[2]).toBe(1)
  })

  it('【C-1回帰】暫定受理→削除→再入力でスコアは増えない', () => {
    const g = new Game(1)
    const target = g.currentWord().reading
    // 先頭文字と同一キーグループだが不一致の文字（暫定受理される）を探す
    const probe = [...'あいうえおかきくたちつまみやゆらりわ'].find(c => {
      const cm = new Composer(target)
      return c !== target[0] && cm.inputChar(c).kind === 'progress'
    })
    expect(probe, '暫定受理できる文字が見つからないお題は想定外').toBeDefined()
    g.handle('char', probe!, 0)
    expect(g.stats.actions).toBe(0) // 暫定文字は加点されない
    for (let i = 0; i < 10; i++) {
      g.handle('delete', '', 0)
      g.handle('char', probe!, 0)
    }
    expect(g.stats.actions).toBe(0) // 削除→再入力の往復でも一切増えない
    expect(g.stats.misses).toBe(0)
  })

  it('【正準加点】濁点・促音を含むお題は正準アクション数どおりに加点される', () => {
    const g = new Game(1)
    g.tick(21) // フェーズ1（敏捷）: 濁点入りの語が含まれる
    const target = g.currentWord().reading
    const expected = totalActions(target)
    // 各文字を「基底を打つ→変換キーをサイクル位置の回数」で正確に入力
    for (const ch of target) {
      g.handle('char', baseChar(ch), 0)
      for (let i = 0; i < actionCost(ch) - 1; i++) g.handle('modifier', '', 0)
    }
    expect(g.stats.completedWords).toBe(1)
    expect(g.stats.actions).toBe(expected)
    expect(g.stats.misses).toBe(0)
  })
  it('種目切替でお題が切り替わる', () => {
    const g = new Game(1)
    expect(g.phase).toBe(0)
    g.tick(21)
    expect(g.phase).toBe(1)
    g.tick(41)
    expect(g.phase).toBe(2)
  })
})
