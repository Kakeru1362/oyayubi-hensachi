// 親指偏差値 QA 第2ラン: 精密レイテンシ計測 + フルゲーム自動プレイ + スコア仕様検証
// 実行: node tests-e2e/qa2.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const BASE = 'http://localhost:4173/oyayubi-hensachi/'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(DIR, 'screenshots')
mkdirSync(SHOTS, { recursive: true })

const results = []
const log = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK' : 'NG'} | ${name}${detail ? ' | ' + detail : ''}`)
}
const shot = async (page, name) => {
  const p = path.join(SHOTS, name)
  await page.screenshot({ path: p })
  console.log(`SHOT | ${p}`)
}

const browser = await chromium.launch() // ヘッドレス（rAFはスクリーンショット/評価で駆動される）
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })

// CDPタッチでドライバ側オーバーヘッドだけ別計測（参考値）
const cdp = await ctx.newCDPSession(page)

// ===== ゲーム開始 =====
await page.tap('#btn-start')

// カウントダウン中: CDPタッチがオーバーレイに吸われる（=入力ブロック）ことの確認
const blocked = await page.evaluate(() => {
  const el = document.elementFromPoint(195, 700) // キーボード領域の座標
  return el ? el.className : 'none'
})
log('カウントダウン中オーバーレイがキーボードを覆う', String(blocked).includes('countdown'),
  `elementFromPoint=「${blocked}」`)

await page.waitForSelector('.countdown', { state: 'detached', timeout: 8000 })

// ===== ページ内ドライバ注入 =====
await page.evaluate(() => {
  const KEY_CHARS = {
    a: ['あ', 'い', 'う', 'え', 'お'],
    ka: ['か', 'き', 'く', 'け', 'こ'],
    sa: ['さ', 'し', 'す', 'せ', 'そ'],
    ta: ['た', 'ち', 'つ', 'て', 'と'],
    na: ['な', 'に', 'ぬ', 'ね', 'の'],
    ha: ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    ma: ['ま', 'み', 'む', 'め', 'も'],
    ya: ['や', '（', 'ゆ', '）', 'よ'],
    ra: ['ら', 'り', 'る', 'れ', 'ろ'],
    wa: ['わ', 'を', 'ん', 'ー', ''],
  }
  const CYCLES = [
    ['あ', 'ぁ'], ['い', 'ぃ'], ['う', 'ぅ'], ['え', 'ぇ'], ['お', 'ぉ'],
    ['か', 'が'], ['き', 'ぎ'], ['く', 'ぐ'], ['け', 'げ'], ['こ', 'ご'],
    ['さ', 'ざ'], ['し', 'じ'], ['す', 'ず'], ['せ', 'ぜ'], ['そ', 'ぞ'],
    ['た', 'だ'], ['ち', 'ぢ'], ['つ', 'っ', 'づ'], ['て', 'で'], ['と', 'ど'],
    ['は', 'ば', 'ぱ'], ['ひ', 'び', 'ぴ'], ['ふ', 'ぶ', 'ぷ'], ['へ', 'べ', 'ぺ'], ['ほ', 'ぼ', 'ぽ'],
    ['や', 'ゃ'], ['ゆ', 'ゅ'], ['よ', 'ょ'],
    ['わ', 'ゎ'],
  ]
  const planChar = c => {
    const cycle = CYCLES.find(cy => cy.includes(c))
    const base = cycle ? cycle[0] : c
    const mods = cycle ? cycle.indexOf(c) : 0
    for (const [keyId, chars] of Object.entries(KEY_CHARS)) {
      const dir = chars.indexOf(base)
      if (dir >= 0) return { keyId, dir, mods, base }
    }
    return null
  }
  const keyEl = id => document.querySelector(`.kb-key[data-key="${id}"]`)
  const center = id => {
    const r = keyEl(id).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const fire = (id, type, x, y) =>
    keyEl(id).dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 7, pointerType: 'touch', isPrimary: true,
    }))
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const state = () => ({
    kana: document.getElementById('target-kana').textContent,
    done: document.querySelectorAll('#target-kana .done').length,
    pend: document.querySelectorAll('#target-kana .pend').length,
    score: parseInt(document.getElementById('score-live').textContent, 10),
  })

  const lat = { mut: [], frame: [] }
  let lastTap = { keyId: null, t: 0 }
  let toggleWaits = 0

  /** pointerup1回を計測付きで発火（同期dispatch→直後に処理完了している） */
  const measuredUp = (id, x, y) => {
    const t0 = performance.now()
    fire(id, 'pointerup', x, y)
    const t1 = performance.now()
    lat.mut.push(t1 - t0)
    requestAnimationFrame(() => lat.frame.push(performance.now() - t0))
  }

  const tapKey = async id => {
    if (lastTap.keyId === id && performance.now() - lastTap.t < 750) {
      toggleWaits++
      await sleep(760) // トグル誤爆回避
    }
    const { x, y } = center(id)
    fire(id, 'pointerdown', x, y)
    measuredUp(id, x, y)
    lastTap = id === 'mod' || id === 'del' ? { keyId: null, t: 0 } : { keyId: id, t: performance.now() }
  }
  const flickKey = (id, dir) => {
    const { x, y } = center(id)
    const D = 70
    const [dx, dy] = dir === 1 ? [-D, 0] : dir === 2 ? [0, -D] : dir === 3 ? [D, 0] : [0, D]
    fire(id, 'pointerdown', x, y)
    fire(id, 'pointermove', x + dx / 2, y + dy / 2)
    fire(id, 'pointermove', x + dx, y + dy)
    measuredUp(id, x + dx, y + dy)
    lastTap = { keyId: null, t: 0 }
  }
  const typeChar = async (c, useToggle = false) => {
    const p = planChar(c)
    if (!p) return false
    if (useToggle && p.mods === 0 && p.dir > 0) {
      const filtered = KEY_CHARS[p.keyId].filter(x => x !== '')
      const idx = filtered.indexOf(c)
      await tapKey(p.keyId)
      for (let i = 0; i < idx; i++) {
        const { x, y } = center(p.keyId)
        fire(p.keyId, 'pointerdown', x, y)
        measuredUp(p.keyId, x, y)
      }
      lastTap = { keyId: null, t: 0 }
      return true
    }
    if (p.dir === 0) await tapKey(p.keyId)
    else flickKey(p.keyId, p.dir)
    for (let i = 0; i < p.mods; i++) await tapKey('mod')
    return true
  }

  window.__qa = { planChar, state, tapKey, flickKey, typeChar, lat, sleep,
    get toggleWaits() { return toggleWaits } }
})

// ===== A. スコア仕様: 入力→削除でポイントが残るか =====
{
  const r = await page.evaluate(async () => {
    const q = window.__qa
    // pendをクリア
    let s = q.state()
    while (s.pend > 0) { await q.tapKey('del'); s = q.state() }
    const before = q.state()
    const detail = []
    for (let i = 0; i < 3; i++) {
      let st = q.state()
      const c = [...st.kana][st.done]
      await q.typeChar(c) // 正しい文字を入力（mod含むフル入力）
      const mid = q.state()
      await q.tapKey('del')
      // mod付き文字はdel1回で基底文字が残る場合があるので全部消す
      let cur = q.state()
      while (cur.pend > 0 || cur.done > before.done) { await q.tapKey('del'); cur = q.state() }
      detail.push(`#${i + 1} 「${c}」入力 score ${st.score}→${mid.score}, 全削除後 ${cur.score}`)
      await q.sleep(760)
    }
    const after = q.state()
    return { gained: after.score - before.score, done: `${before.done}→${after.done}`, detail }
  })
  log('入力→⌫全削除でスコアが戻る(べき)', r.gained <= 0,
    `正しい文字を打って全削除×3 → 進捗ゼロのままスコア +${r.gained}pt | ${r.detail.join(' / ')}`)
}

// ===== B. トグル入力検証（あ連打→い 等） =====
{
  const r = await page.evaluate(async () => {
    const q = window.__qa
    await q.sleep(760)
    for (let tries = 0; tries < 6; tries++) {
      const st = q.state()
      const c = [...st.kana][st.done]
      const p = q.planChar(c)
      if (p && p.mods === 0 && p.dir > 0) {
        await q.typeChar(c, true) // トグルで入力
        const st2 = q.state()
        return { tested: true, c, ok: st2.done === st.done + 1 || st2.kana !== st.kana }
      }
      await q.typeChar(c) // 普通に入力して次の文字へ
      await q.sleep(100)
    }
    return { tested: false }
  })
  log('トグル入力（同一キー連打で次の文字）', !r.tested || r.ok,
    r.tested ? `「${r.c}」をタップ連打で入力 → ${r.ok ? '成功' : '失敗'}` : '対象文字が出現せずスキップ')
}

// ===== C. 自動プレイ（残り時間めいっぱい、100ms/アクション） =====
{
  const r = await page.evaluate(async () => {
    const q = window.__qa
    const out = { chars: 0, words: 0, stalls: [] }
    const t0 = performance.now()
    while (performance.now() - t0 < 46000) {
      if (document.getElementById('screen-result').hidden === false) break
      const st = q.state()
      if (st.pend > 0) { await q.tapKey('del'); continue }
      const chars = [...st.kana]
      if (chars.length === 0 || st.done >= chars.length) { await q.sleep(50); continue }
      const c = chars[st.done]
      const ok = await q.typeChar(c)
      if (!ok) { out.stalls.push(`plan不能:${c}`); break }
      out.chars++
      const st2 = q.state()
      if (st2.kana !== st.kana) out.words++
      else if (st2.done === st.done && st2.pend === st.pend && st2.score === st.score) {
        out.stalls.push(`「${c}」无progress(done=${st.done})`)
        if (out.stalls.length > 8) break
      }
      await q.sleep(100)
    }
    out.toggleWaits = q.toggleWaits
    out.finalScore = q.state().score
    return out
  })
  log('自動プレイ進行（タップ/フリック/濁点/小書き）',
    r.words >= 10 && r.stalls.length === 0,
    `${r.chars}かな入力 / ${r.words}語完了 / 最終 ${r.finalScore}pt / 停滞: ${r.stalls.length ? r.stalls.join('; ') : 'なし'} / トグル誤爆回避待ち ${r.toggleWaits}回`)
  await shot(page, '20-play-late-game.png')
}

// ===== D. レイテンシ集計 =====
{
  const lat = await page.evaluate(() => window.__qa.lat)
  const stats = arr => {
    const s = [...arr].sort((a, b) => a - b)
    return {
      n: s.length,
      avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(2),
      max: +s[s.length - 1].toFixed(2),
    }
  }
  const mut = stats(lat.mut)
  const frame = stats(lat.frame.filter(v => v < 2000))
  log('入力レイテンシ（pointerup→DOM反映 同期計測）', mut.n >= 10 && mut.avg < 16,
    `n=${mut.n} avg=${mut.avg}ms p95=${mut.p95}ms max=${mut.max}ms`)
  log('入力レイテンシ（pointerup→次フレーム描画）', frame.avg < 50,
    `n=${frame.n} avg=${frame.avg}ms p95=${frame.p95}ms max=${frame.max}ms`)
}

// done文字の色（緑）確認
{
  const c = await page.evaluate(() => {
    const el = document.querySelector('#target-kana .done')
    return el ? getComputedStyle(el).color : null
  })
  log('確定文字が緑表示', c === 'rgb(61, 220, 132)', `color=${c}`)
}

// ===== E. 終了→診断書 =====
{
  let resultShown = false
  const tEnd = Date.now() + 30000
  while (Date.now() < tEnd) {
    if (await page.evaluate(() => !document.getElementById('screen-result').hidden)) {
      resultShown = true
      break
    }
    await page.waitForTimeout(500)
  }
  log('60秒終了→診断書へ', resultShown)
  if (resultShown) {
    const res = await page.evaluate(() => ({
      hensachi: document.getElementById('result-hensachi-val').textContent,
      title: document.getElementById('result-title').textContent,
      score: document.getElementById('result-score').textContent,
      acc: document.getElementById('result-acc').textContent,
      words: document.getElementById('result-words').textContent,
      notes: [...document.querySelectorAll('#result-notes p')].map(p => p.textContent),
      newRecord: !document.getElementById('new-record').hidden,
      cardBottom: document.querySelector('.result-actions').getBoundingClientRect().bottom,
      innerH: window.innerHeight,
    }))
    await shot(page, '21-result-good-score.png')
    log('診断書（高スコア時）表示内容', res.hensachi !== '--' && res.title !== '--',
      `偏差値${res.hensachi} 「${res.title}」 ${res.score} 正確率${res.acc} 完了${res.words} 新記録=${res.newRecord} ボタン下端${res.cardBottom.toFixed(0)}px/画面${res.innerH}px`)
    console.log('NOTES |', res.notes.join(' / '))
  }
}

// ===== F. CDPタッチ実機相当のタップ往復時間（参考: ドライバ遅延の切り分け） =====
{
  const times = []
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 500, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    times.push(Date.now() - t0)
  }
  console.log(`INFO | CDPタッチ往復(参考): ${times.join(',')}ms — 第1ランの遅さはテストドライバ起因かの判定材料`)
}

if (errors.length) log('コンソール/ページエラーなし', false, errors.join(' | '))
else log('コンソール/ページエラーなし', true)

await browser.close()

console.log('\n===== SUMMARY(run2) =====')
for (const r of results) console.log(`${r.ok ? 'OK' : 'NG'} | ${r.name}${r.detail ? ' | ' + r.detail : ''}`)
