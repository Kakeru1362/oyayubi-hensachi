// 12キーフリックキーボード: PointerEventsベース、atan2方向判定、花弁ポップアップ
import { KEYS, type FlickDir } from '../engine/kana'

export interface KeyEvent {
  kind: 'char' | 'modifier' | 'toggle' | 'delete'
  char: string
  dir: FlickDir
}

export interface KeyboardOptions {
  /** フリック判定の最小移動距離(px)。較正スライダーで変更可能 */
  threshold: number
  onInput: (e: KeyEvent) => void
}

const TOGGLE_WINDOW_MS = 700

/** dx,dy からフリック方向（atan2 の4方向±45°） */
export function flickDir(dx: number, dy: number, threshold: number): FlickDir {
  if (Math.hypot(dx, dy) < threshold) return 0
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (deg >= -45 && deg < 45) return 3 // 右
  if (deg >= 45 && deg < 135) return 4 // 下
  if (deg >= -135 && deg < -45) return 2 // 上
  return 1 // 左
}

interface ActivePointer {
  keyId: string
  startX: number
  startY: number
  el: HTMLElement
}

export class FlickKeyboard {
  threshold: number
  private onInput: (e: KeyEvent) => void
  private root: HTMLElement
  private popup: HTMLElement
  /** pointerId単位で管理（親指2本打ち・押下オーバーラップに対応） */
  private active = new Map<number, ActivePointer>()
  private lastTap: { keyId: string; at: number; toggleIdx: number } | null = null

  constructor(container: HTMLElement, opts: KeyboardOptions) {
    this.threshold = opts.threshold
    this.onInput = opts.onInput
    this.root = container
    this.popup = document.createElement('div')
    this.popup.className = 'flick-popup'
    this.popup.hidden = true
    this.render()
    document.body.appendChild(this.popup)
  }

  private render(): void {
    this.root.innerHTML = ''
    this.root.classList.add('kb')

    // 3列×4行: かな10キー + 変換キー + 削除キー
    const layout: (string | null)[] = [
      'a', 'ka', 'sa',
      'ta', 'na', 'ha',
      'ma', 'ya', 'ra',
      'mod', 'wa', 'del',
    ]
    for (const id of layout) {
      const el = document.createElement('div')
      el.className = 'kb-key'
      el.dataset.key = id ?? ''
      if (id === 'mod') {
        el.textContent = '゛゜小'
        el.classList.add('kb-fn')
      } else if (id === 'del') {
        el.textContent = '⌫'
        el.classList.add('kb-fn')
      } else if (id) {
        const def = KEYS.find(k => k.id === id)!
        el.innerHTML = `<span class="kb-main">${def.chars[0]}</span><span class="kb-sub">${[def.chars[1], def.chars[2], def.chars[3]].filter(Boolean).join(' ')}</span>`
      }
      this.root.appendChild(el)
    }

    this.root.addEventListener('pointerdown', this.onDown, { passive: false })
    this.root.addEventListener('pointermove', this.onMove, { passive: false })
    this.root.addEventListener('pointerup', this.onUp, { passive: false })
    this.root.addEventListener('pointercancel', this.onCancel)
    // スクロール・ダブルタップズーム抑止
    this.root.addEventListener('touchstart', e => e.preventDefault(), { passive: false })
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault()
    const el = (e.target as HTMLElement).closest('.kb-key') as HTMLElement | null
    if (!el || !el.dataset.key) return
    // キー外（画面端・お題エリア）まで指が滑ってもmove/upを受け取れるよう捕捉
    try {
      this.root.setPointerCapture(e.pointerId)
    } catch {
      /* 非対応環境では従来挙動 */
    }
    const keyId = el.dataset.key
    this.active.set(e.pointerId, { keyId, startX: e.clientX, startY: e.clientY, el })
    el.classList.add('kb-pressed')
    if (keyId !== 'mod' && keyId !== 'del') {
      this.showPopup(keyId, el, 0)
    }
  }

  private onMove = (e: PointerEvent): void => {
    const a = this.active.get(e.pointerId)
    if (!a) return
    e.preventDefault()
    if (a.keyId === 'mod' || a.keyId === 'del') return
    const dir = flickDir(e.clientX - a.startX, e.clientY - a.startY, this.threshold)
    this.showPopup(a.keyId, a.el, dir)
  }

  private onUp = (e: PointerEvent): void => {
    const a = this.active.get(e.pointerId)
    if (!a) return
    e.preventDefault()
    const { keyId, startX, startY, el } = a
    el.classList.remove('kb-pressed')
    this.hidePopup()
    this.active.delete(e.pointerId)

    const now = performance.now()
    if (keyId === 'mod') {
      this.lastTap = null
      this.onInput({ kind: 'modifier', char: '', dir: 0 })
      return
    }
    if (keyId === 'del') {
      this.lastTap = null
      this.onInput({ kind: 'delete', char: '', dir: 0 })
      return
    }

    const def = KEYS.find(k => k.id === keyId)!
    const dir = flickDir(e.clientX - startX, e.clientY - startY, this.threshold)
    const char = def.chars[dir]
    if (!char) {
      this.lastTap = null
      return // 割り当てなし方向は無反応（ミス扱いにしない）
    }

    // 同一キーをタップ連打 → トグル
    if (
      dir === 0 &&
      this.lastTap &&
      this.lastTap.keyId === keyId &&
      now - this.lastTap.at < TOGGLE_WINDOW_MS
    ) {
      this.lastTap = { keyId, at: now, toggleIdx: this.lastTap.toggleIdx + 1 }
      this.onInput({ kind: 'toggle', char: '', dir: 0 })
      return
    }

    this.lastTap = dir === 0 ? { keyId, at: now, toggleIdx: 0 } : null
    this.onInput({ kind: 'char', char, dir })
    if (navigator.vibrate) navigator.vibrate(8)
  }

  private onCancel = (e: PointerEvent): void => {
    const a = this.active.get(e.pointerId)
    if (a) {
      a.el.classList.remove('kb-pressed')
      this.active.delete(e.pointerId)
    }
    this.hidePopup()
  }

  /** 語の完了時に呼ぶ: 直後の同一キータップがトグル誤爆しないようにする */
  breakToggle(): void {
    this.lastTap = null
  }

  /** 画面遷移・測定終了時の後始末（押しっぱなし状態とポップアップの残留防止） */
  cancelAll(): void {
    for (const a of this.active.values()) a.el.classList.remove('kb-pressed')
    this.active.clear()
    this.lastTap = null
    this.hidePopup()
  }

  /** 花弁ポップアップ: 中央＋十字に4方向の候補を表示、選択中方向をハイライト */
  private showPopup(keyId: string, keyEl: HTMLElement, dir: FlickDir): void {
    const def = KEYS.find(k => k.id === keyId)
    if (!def) return
    const r = keyEl.getBoundingClientRect()
    const [c, l, u, rt, d] = [0, 1, 2, 3, 4].map(i => def.chars[i] ?? '')
    this.popup.innerHTML = `
      <span class="fp fp-u ${dir === 2 ? 'on' : ''}">${u}</span>
      <span class="fp fp-l ${dir === 1 ? 'on' : ''}">${l}</span>
      <span class="fp fp-c ${dir === 0 ? 'on' : ''}">${c}</span>
      <span class="fp fp-r ${dir === 3 ? 'on' : ''}">${rt}</span>
      <span class="fp fp-d ${dir === 4 ? 'on' : ''}">${d}</span>`
    this.popup.style.left = `${r.left + r.width / 2}px`
    this.popup.style.top = `${r.top + r.height / 2}px`
    this.popup.hidden = false
  }

  private hidePopup(): void {
    this.popup.hidden = true
  }
}
