// 画面スタッキングバグの実害検証: hidden画面が表示され、実タッチを奪うか
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173/oyayubi-hensachi/'
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
})
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await page.goto(BASE, { waitUntil: 'networkidle' })

// 1) hidden属性が効いているか（computed display）
const disp = await page.evaluate(() => ({
  play: getComputedStyle(document.getElementById('screen-play')).display,
  result: getComputedStyle(document.getElementById('screen-result')).display,
  playHidden: document.getElementById('screen-play').hidden,
  resultHidden: document.getElementById('screen-result').hidden,
}))
console.log('hidden画面のcomputed display:', JSON.stringify(disp))

// 2) ゲーム開始してキーボード各キーの上に何が乗っているか
await page.tap('#btn-start')
await page.waitForSelector('.countdown', { state: 'detached', timeout: 8000 })
const hit = await page.evaluate(() => {
  const out = {}
  for (const el of document.querySelectorAll('.kb-key')) {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    out[el.dataset.key] = top === el || el.contains(top)
      ? 'OK(キー自身)'
      : `奪われ → ${top ? top.className || top.id || top.tagName : 'null'}`
  }
  return out
})
console.log('キー中心のヒットテスト:', JSON.stringify(hit, null, 1))

// 3) 実タッチ(CDP)で⌫キーと゛゜小キーを叩く → 入力が届くか
//    まず「た」をタップして1文字入れる(届くキー)、次にmodキー実タッチ
const center = async id => page.evaluate(k => {
  const r = document.querySelector(`.kb-key[data-key="${k}"]`).getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, id)
const tap = async ({ x, y }) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const state = () => page.evaluate(() => ({
  done: document.querySelectorAll('#target-kana .done').length,
  pend: document.querySelectorAll('#target-kana .pend').length,
  score: document.getElementById('score-live').textContent,
}))

const s0 = await state()
await tap(await center('ta')) // 上段キー: 届くはず
const s1 = await state()
console.log(`実タッチ た: score ${s0.score} → ${s1.score}（届けば変化）`)
await tap(await center('mod')) // 4段目: 診断書カードに覆われている疑い
const s2 = await state()
console.log(`実タッチ ゛゜小: pend=${s1.pend}→${s2.pend} score ${s1.score}→${s2.score}（覆われていれば無反応）`)
await tap(await center('del'))
const s3 = await state()
console.log(`実タッチ ⌫: pend=${s2.pend}→${s3.pend} score変化=${s3.score !== s2.score}`)
await tap(await center('wa'))
const s4 = await state()
console.log(`実タッチ わ: score ${s3.score} → ${s4.score}`)

await browser.close()
