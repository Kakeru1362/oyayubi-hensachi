// 親指偏差値 プロトタイプ 辛口QAスクリプト（Playwright直接駆動）
// 実行: node tests-e2e/qa.mjs
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
  await page.screenshot({ path: p, fullPage: false })
  console.log(`SHOT | ${p}`)
  return p
}

// ===== かな → キー/方向/変換回数 のプラン =====
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
function planChar(c) {
  const cycle = CYCLES.find(cy => cy.includes(c))
  const base = cycle ? cycle[0] : c
  const mods = cycle ? cycle.indexOf(c) : 0
  for (const [keyId, chars] of Object.entries(KEY_CHARS)) {
    const dir = chars.indexOf(base)
    if (dir >= 0) return { keyId, dir, mods }
  }
  return null
}

// ===== タッチ駆動（CDP: 実機相当のtouch→pointerイベント） =====
function makeDriver(page, cdp) {
  let last = { keyId: null, tap: false, t: 0 }
  let toggleWaits = 0

  const keyCenter = keyId =>
    page.evaluate(id => {
      const el = document.querySelector(`.kb-key[data-key="${id}"]`)
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, keyId)

  const touchTap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const touchFlick = async (x, y, dx, dy) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    for (let i = 1; i <= 3; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 3, y: y + (dy * i) / 3, id: 1 }],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  const tapKey = async keyId => {
    const { x, y } = await keyCenter(keyId)
    await touchTap(x, y)
  }
  const flickKey = async (keyId, dir) => {
    const { x, y } = await keyCenter(keyId)
    const D = 70
    const [dx, dy] = dir === 1 ? [-D, 0] : dir === 2 ? [0, -D] : dir === 3 ? [D, 0] : [0, D]
    await touchFlick(x, y, dx, dy)
  }

  /** 1かな（濁点等含む）をフル入力。トグル誤爆回避のため同一キー連続タップは待つ */
  const typeChar = async c => {
    const plan = planChar(c)
    if (!plan) throw new Error(`no plan: ${c}`)
    if (plan.dir === 0) {
      if (last.tap && last.keyId === plan.keyId && Date.now() - last.t < 800) {
        toggleWaits++
        await page.waitForTimeout(800)
      }
      await tapKey(plan.keyId)
      last = { keyId: plan.keyId, tap: true, t: Date.now() }
    } else {
      await flickKey(plan.keyId, plan.dir)
      last = { keyId: plan.keyId, tap: false, t: 0 }
    }
    for (let i = 0; i < plan.mods; i++) {
      await tapKey('mod')
      last = { keyId: null, tap: false, t: 0 }
    }
  }

  return {
    tapKey, flickKey, typeChar, touchTap, touchFlick, keyCenter,
    get toggleWaits() { return toggleWaits },
    resetLast() { last = { keyId: null, tap: false, t: 0 } },
  }
}

const playState = page =>
  page.evaluate(() => ({
    kana: document.getElementById('target-kana').textContent,
    done: document.querySelectorAll('#target-kana .done').length,
    pend: document.querySelectorAll('#target-kana .pend').length,
    score: parseInt(document.getElementById('score-live').textContent, 10),
    timer: document.getElementById('timer').textContent,
    phase: document.getElementById('phase-label').textContent,
    missFlash: document.getElementById('target-area').classList.contains('miss-flash'),
  }))

const installLatencyProbe = page =>
  page.evaluate(() => {
    window.__lat = []
    let up = 0
    document.addEventListener('pointerup', () => { up = performance.now() }, true)
    new MutationObserver(() => {
      if (!up) return
      const u = up
      up = 0
      const mut = performance.now() - u
      requestAnimationFrame(() => {
        window.__lat.push({ mut, frame: performance.now() - u })
      })
    }).observe(document.getElementById('target-kana'), {
      childList: true, subtree: true, characterData: true,
    })
  })

const layoutAudit = page =>
  page.evaluate(() => {
    const keys = [...document.querySelectorAll('.kb-key')].map(el => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.key, w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) }
    })
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      vOverflow: document.body.scrollHeight > window.innerHeight + 1,
      keys,
      kbTop: document.getElementById('keyboard')
        ? document.getElementById('keyboard').getBoundingClientRect().top : null,
      targetKanaSize: document.getElementById('target-kana')
        ? getComputedStyle(document.getElementById('target-kana')).fontSize : null,
    }
  })

// ============================================================
async function mainRun(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.grantPermissions(['clipboard-write', 'clipboard-read'], { origin: 'http://localhost:4173' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
  const dialogs = []
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}) })
  const cdp = await ctx.newCDPSession(page)
  const drv = makeDriver(page, cdp)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await shot(page, '01-home-iphone13.png')

  // --- ホーム画面 ---
  const homeOk = await page.evaluate(() => {
    const b = document.getElementById('btn-start')
    const r = b.getBoundingClientRect()
    return { visible: !document.getElementById('screen-home').hidden, btnH: r.height, btnW: r.width }
  })
  log('ホーム表示・測定開始ボタン', homeOk.visible && homeOk.btnH >= 44,
    `btn ${homeOk.btnW.toFixed(0)}x${homeOk.btnH.toFixed(0)}px`)

  // 較正スライダー
  await page.tap('.settings summary')
  await page.evaluate(() => {
    const s = document.getElementById('sensitivity')
    s.value = '20'
    s.dispatchEvent(new Event('input'))
  })
  const sensState = await page.evaluate(() => ({
    label: document.getElementById('sensitivity-val').textContent,
    stored: localStorage.getItem('oyayubi.sensitivity'),
  }))
  log('較正スライダー反映+保存', sensState.label === '20' && sensState.stored === '20',
    JSON.stringify(sensState))
  await page.evaluate(() => {
    const s = document.getElementById('sensitivity')
    s.value = '24'
    s.dispatchEvent(new Event('input'))
  })
  await shot(page, '02-home-settings-open.png')

  // --- 測定開始 → カウントダウン ---
  const tClick = Date.now()
  await page.tap('#btn-start')
  const cdVisible = await page.locator('.countdown').isVisible().catch(() => false)
  log('カウントダウン表示', cdVisible)
  await shot(page, '03-countdown.png')
  await installLatencyProbe(page)

  // カウントダウン中の入力受付バグ検査
  let cdInputBug = null
  try {
    const st0 = await playState(page)
    const c0 = [...st0.kana][0]
    await drv.typeChar(c0)
    const st1 = await playState(page)
    cdInputBug = st1.score > st0.score || st1.done > st0.done || st1.pend > st0.pend
    // ⌫で戻す（スコアが戻るかも記録）
    await drv.tapKey('del')
    const st2 = await playState(page)
    log('カウントダウン中は入力を受け付けない(べき)', !cdInputBug,
      `入力前score=${st0.score} 入力後score=${st1.score} done=${st1.done} pend=${st1.pend} / ⌫後score=${st2.score}`)
  } catch (e) {
    log('カウントダウン中入力検査', false, `実行エラー: ${e.message}`)
  }

  await page.waitForSelector('.countdown', { state: 'detached', timeout: 8000 })
  const cdMs = Date.now() - tClick
  log('カウントダウン→測定開始', true, `所要 ${cdMs}ms（表示は「3,2,1」）`)

  // --- 本測定: 14秒タイピング ---
  drv.resetLast()
  let wordsDone = 0
  let charsTyped = 0
  let stallNotes = []
  const typeUntil = Date.now() + 14000
  while (Date.now() < typeUntil) {
    const st = await playState(page)
    if (st.pend > 0) { await drv.tapKey('del'); continue }
    const remaining = [...st.kana].slice(st.done)
    if (remaining.length === 0) { await page.waitForTimeout(40); continue }
    const c = remaining[0]
    try {
      await drv.typeChar(c)
      charsTyped++
    } catch (e) {
      stallNotes.push(`${c}: ${e.message}`)
      break
    }
    const st2 = await playState(page)
    if (st2.kana !== st.kana) wordsDone++
    else if (st2.done <= st.done && st2.pend === st.pend) {
      stallNotes.push(`「${c}」入力後も進捗なし(done=${st.done})`)
      if (stallNotes.length > 5) break
    }
  }
  log('タップ/フリック/濁点入力でお題が進行', wordsDone >= 2 && stallNotes.length === 0,
    `14秒で ${wordsDone}語完了 / ${charsTyped}かな入力 / 停滞:${stallNotes.length ? stallNotes.join('; ') : 'なし'} / トグル誤爆回避待ち:${drv.toggleWaits}回`)
  await shot(page, '04-play-typing.png')

  // 緑(done)表示確認
  const colorSt = await playState(page)
  log('正解文字の緑色(done)表示', colorSt.done >= 0, `done=${colorSt.done} pend=${colorSt.pend} kana="${colorSt.kana}"`)

  // --- ミス入力 → 赤フラッシュ ---
  {
    const st = await playState(page)
    const c = [...st.kana][st.done]
    const plan = planChar(c) ?? { keyId: 'none' }
    const wrong = ['ra', 'ma', 'na'].find(k => k !== plan.keyId)
    await drv.tapKey(wrong)
    const st2 = await playState(page)
    log('ミス入力で赤フラッシュ+進捗なし', st2.missFlash && st2.done === st.done,
      `missFlash=${st2.missFlash} done ${st.done}→${st2.done}（対象「${c}」に対し「${KEY_CHARS[wrong][0]}」タップ）`)
    drv.resetLast()
  }

  // --- トグル入力（同一キー連打） ---
  {
    await page.waitForTimeout(750)
    const st = await playState(page)
    const c = [...st.kana][st.done]
    const plan = planChar(c)
    if (plan && plan.mods === 0 && plan.dir > 0) {
      const filtered = KEY_CHARS[plan.keyId].filter(x => x !== '')
      const idx = filtered.indexOf(c)
      await drv.tapKey(plan.keyId)
      for (let i = 0; i < idx; i++) await drv.tapKey(plan.keyId)
      const st2 = await playState(page)
      log('トグル入力（同一キー連打）', st2.done === st.done + 1 || st2.kana !== st.kana,
        `「${c}」をタップ${idx + 1}回で入力 → done ${st.done}→${st2.done}`)
    } else {
      log('トグル入力（同一キー連打）', true, `対象文字「${c}」がトグル向きでないためスキップ`)
    }
    drv.resetLast()
  }

  // --- ポイント稼ぎバグ（入力→削除の繰り返し） ---
  {
    await page.waitForTimeout(750)
    const st = await playState(page)
    for (let i = 0; i < 3; i++) {
      const cur = await playState(page)
      const c = [...cur.kana][cur.done]
      const plan = planChar(c)
      if (!plan) break
      if (plan.dir === 0) await drv.tapKey(plan.keyId)
      else await drv.flickKey(plan.keyId, plan.dir)
      await drv.tapKey('del')
      await page.waitForTimeout(750)
    }
    const st2 = await playState(page)
    const farmed = st2.score - st.score
    log('入力→⌫削除でスコアが増えない(べき)', farmed <= 0,
      `同じ文字を打って消すを3回 → スコア +${farmed}pt（done不変: ${st.done}→${st2.done}）`)
    drv.resetLast()
  }

  // --- フリック中の花弁ポップアップ ---
  {
    const { x, y } = await drv.keyCenter('ka')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 70, id: 1 }] })
    const popup = await page.evaluate(() => {
      const p = document.querySelector('.flick-popup')
      const on = p.querySelector('.fp.on')
      return { visible: !p.hidden, highlighted: on ? on.textContent : null }
    })
    await shot(page, '05-flick-popup.png')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await drv.tapKey('del')
    log('フリック中ポップアップ表示+方向ハイライト', popup.visible && popup.highlighted === 'く',
      `visible=${popup.visible} highlight="${popup.highlighted}"（か→上=く）`)
    drv.resetLast()
  }

  // --- 種目フェーズの進行と60秒終了 ---
  const phasesSeen = new Set()
  const tEnd = Date.now() + 80000
  let resultShown = false
  while (Date.now() < tEnd) {
    const vis = await page.evaluate(() => !document.getElementById('screen-result').hidden)
    if (vis) { resultShown = true; break }
    const ph = await page.evaluate(() => document.getElementById('phase-label').textContent)
    phasesSeen.add(ph)
    await page.waitForTimeout(700)
  }
  log('3種目フェーズ切替（瞬発→敏捷→持久）', phasesSeen.size === 3, [...phasesSeen].join('→'))
  log('60秒経過で診断書画面へ遷移', resultShown)

  // --- レイテンシ集計 ---
  const lat = await page.evaluate(() => window.__lat || [])
  let latReport = 'サンプルなし'
  if (lat.length > 0) {
    const stats = arr => ({
      n: arr.length,
      avg: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
      max: +Math.max(...arr).toFixed(2),
      min: +Math.min(...arr).toFixed(2),
    })
    const mut = stats(lat.map(s => s.mut))
    const frame = stats(lat.map(s => s.frame))
    latReport = `n=${lat.length} | pointerup→DOM更新: avg ${mut.avg}ms / max ${mut.max}ms | pointerup→次フレーム描画: avg ${frame.avg}ms / max ${frame.max}ms`
  }
  log('入力レイテンシ計測(10回以上)', lat.length >= 10, latReport)

  // --- 診断書の内容 ---
  if (resultShown) {
    const res = await page.evaluate(() => ({
      hensachi: document.getElementById('result-hensachi-val').textContent,
      title: document.getElementById('result-title').textContent,
      score: document.getElementById('result-score').textContent,
      acc: document.getElementById('result-acc').textContent,
      words: document.getElementById('result-words').textContent,
      notes: [...document.querySelectorAll('#result-notes p')].map(p => p.textContent),
      newRecord: !document.getElementById('new-record').hidden,
      phasesRows: document.querySelectorAll('#result-phases .radar-row').length,
    }))
    await shot(page, '06-result-iphone13.png')
    log('診断書: 偏差値/称号/スコア/所見の表示',
      res.hensachi !== '--' && res.title !== '--' && res.notes.length > 0 && res.phasesRows === 3,
      `偏差値${res.hensachi} 称号「${res.title}」 ${res.score} 正確率${res.acc} 完了${res.words} 所見${res.notes.length}件 新記録=${res.newRecord}`)
    console.log('NOTES |', res.notes.join(' / '))

    // --- シェアボタン ---
    await page.tap('#btn-share')
    await page.waitForTimeout(1200)
    const shareFeedback1 = dialogs.length
    // navigator.share を無効化してクリップボードフォールバックも検査
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }))
    await page.tap('#btn-share')
    await page.waitForTimeout(1500)
    const shareFeedback2 = dialogs.length
    log('シェア: 押下後に何らかのフィードバック', shareFeedback2 > 0,
      `1回目(share API)アラート${shareFeedback1}件 / 2回目(クリップボード)累計${shareFeedback2}件: ${JSON.stringify(dialogs)}`)

    // --- ホームへ → 自己ベスト表示 ---
    await page.tap('#btn-home')
    const best = await page.evaluate(() => ({
      homeVisible: !document.getElementById('screen-home').hidden,
      bestText: document.getElementById('home-best').textContent,
      bestHidden: document.getElementById('home-best').hidden,
    }))
    log('ホームへ戻る+自己ベスト表示', best.homeVisible && !best.bestHidden, best.bestText)
    await shot(page, '07-home-with-best.png')

    // --- もう一回測定 ---
    await page.tap('#btn-start')
    const cd2 = await page.locator('.countdown').isVisible().catch(() => false)
    log('再測定開始（カウントダウン再表示）', cd2)
    // 測定中に中断手段があるか
    const abortable = await page.evaluate(() =>
      [...document.querySelectorAll('#screen-play button, #screen-play [role="button"]')].length)
    log('測定中の中断/ホーム手段', abortable > 0, abortable === 0 ? '中断ボタンなし。60秒待つかリロードしかない' : '')
  }

  if (errors.length) log('コンソール/ページエラーなし', false, errors.join(' | '))
  else log('コンソール/ページエラーなし', true)

  await ctx.close()
}

// ============================================================
async function viewportRun(browser, label, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const home = await layoutAudit(page)
  await shot(page, `10-home-${label}.png`)
  await page.tap('#btn-start')
  await page.waitForSelector('.countdown', { state: 'detached', timeout: 8000 })
  const play = await layoutAudit(page)
  await shot(page, `11-play-${label}.png`)
  const minW = Math.min(...play.keys.map(k => k.w))
  const minH = Math.min(...play.keys.map(k => k.h))
  const offscreen = play.keys.filter(k => k.bottom > play.innerH + 1).length
  log(`レイアウト ${label} (${width}x${height})`,
    !home.hOverflow && !play.hOverflow && offscreen === 0,
    `横はみ出し home=${home.hOverflow} play=${play.hOverflow} / 画面外キー=${offscreen} / kana font=${play.targetKanaSize}`)
  log(`タップターゲット ${label} 全キー44px以上`, minW >= 44 && minH >= 44,
    `最小キー ${minW}x${minH}px / キーボード上端y=${play.kbTop ? play.kbTop.toFixed(0) : '?'}`)
  await ctx.close()
}

// ============================================================
async function mouseEdgeRun(browser) {
  // デスクトップ（マウス）でフリックがキーボード外で終わった場合の挙動
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.click('#btn-start')
  await page.waitForSelector('.countdown', { state: 'detached', timeout: 8000 })
  const r = await page.evaluate(() => {
    const el = document.querySelector('.kb-key[data-key="a"]')
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.mouse.move(r.x, r.y)
  await page.mouse.down()
  await page.mouse.move(r.x, r.y - 120, { steps: 4 }) // キーボード外まで上フリック
  await page.mouse.up()
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => ({
    popupVisible: !document.querySelector('.flick-popup').hidden,
    pressedStuck: !!document.querySelector('.kb-key.kb-pressed'),
    pend: document.querySelectorAll('#target-kana .pend').length,
    done: document.querySelectorAll('#target-kana .done').length,
  }))
  await shot(page, '12-mouse-flick-stuck.png')
  log('マウス操作: キーボード外で離した上フリック',
    !after.popupVisible && !after.pressedStuck,
    `ポップアップ残留=${after.popupVisible} 押下表示残留=${after.pressedStuck} 入力反映 done=${after.done} pend=${after.pend}`)
  await ctx.close()
}

// ============================================================
const browser = await chromium.launch()
try {
  await mainRun(browser)
  await viewportRun(browser, 'iphone-se', 375, 667)
  await viewportRun(browser, 'pro-max', 430, 932)
  await mouseEdgeRun(browser)
} catch (e) {
  console.error('FATAL:', e)
} finally {
  await browser.close()
}

console.log('\n===== SUMMARY =====')
for (const r of results) console.log(`${r.ok ? 'OK' : 'NG'} | ${r.name}${r.detail ? ' | ' + r.detail : ''}`)
const ng = results.filter(r => !r.ok).length
console.log(`\n${results.length} tests, NG=${ng}`)
