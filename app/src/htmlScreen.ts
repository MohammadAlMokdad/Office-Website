// A web page on a screen in the room (the TV's YouTube, Salah's website and chat, VS Code on the laptops). The page is HTML laid over the
// screen's glass with CSS 3D, behind the canvas; while the screen is on, its glass draws a transparent window into the
// canvas, so the page shows exactly there and whatever stands in front of the screen still hides it.
// Using a screen (inspect.ts flies you up to it, Esc back): the mouse is free and clicks go through the page and the
// canvas to it (body.screen-in-use in styles.css). After a click in an iframe on a screen (YouTube's player) the page
// takes the keyboard back, so the keys keep working.
// A curved screen (Salah's right monitor): the page is flat, so it lies at the depth of the glass's middle, where the
// text is, and stays put on the glass as you move; it is widened until its sides meet the screen's sides seen from
// where you fly in to it, and its colour fills whatever of the glass it leaves (the sides, which bend towards you).
import * as THREE from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { flyDistance, type Frame } from './Player'
import { scene as manifest } from './scene'

// CSS 3D works in millimetres here (positions and the camera x1000): in metres a desk monitor's transform is so small
// that the browser draws it but cannot tell what is under the mouse on it
const MM = 1000
const css = new CSS3DRenderer() // one layer for every screen
const cssCamera = new THREE.PerspectiveCamera()
Object.assign(css.domElement.style, { position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none' })
const cssScene = new THREE.Scene()
const screens = new Set<HtmlScreen>()

/** Whether a key press goes to a text box there (an input, a textarea, or editable text such as CodeMirror's editor on
 *  the laptops): then the walkthrough's keys type instead. */
export const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)

let current: HtmlScreen | null = null

export class HtmlScreen implements Frame {
  readonly el = Object.assign(document.createElement('div'), { className: 'screen-page' })
  readonly center: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly size: [number, number]
  on = false
  since = 0 // when it came into use: the E that did it is not a key press for the page
  private readonly basis: THREE.Matrix4
  private readonly obj: CSS3DObject
  private readonly glass: THREE.Material
  private readonly hole = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending })
  private readonly depth: number
  private aspect = 0 // the camera's, when the page was last widened for it

  /** `width`: the page's width in CSS pixels (its height follows the screen's shape). A curved screen: `depth`, how much
   *  deeper the middle of its glass is than its sides (m), and `fill`, the page's colour for the sides. */
  constructor(readonly mesh: THREE.Mesh, readonly name: string, readonly width: number, { depth = 0, fill = '' } = {}) {
    const frame = manifest.screens?.[mesh.name]?.frame
    if (!frame) throw new Error(`no screen frame for ${mesh.name} in scene.json`)
    this.center = new THREE.Vector3(...frame.center)
    this.normal = new THREE.Vector3(...frame.normal)
    this.basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.right), new THREE.Vector3(...frame.up), this.normal)
    this.size = frame.size
    this.depth = depth
    Object.assign(this.el.style, {
      // (no overflow: hidden here: on a 3D-placed element it stops the browser finding what is under the mouse)
      width: `${width}px`, height: `${Math.round((width * frame.size[1]) / frame.size[0])}px`, position: 'relative',
      background: '#000', visibility: 'hidden', pointerEvents: 'none', boxShadow: fill && `0 0 0 ${width / 2}px ${fill}`,
    })
    this.obj = new CSS3DObject(this.el)
    this.obj.position.copy(this.center).addScaledVector(this.normal, -depth).multiplyScalar(MM)
    this.obj.quaternion.setFromRotationMatrix(this.basis)
    this.obj.scale.setScalar((frame.size[0] / width) * MM)
    this.glass = mesh.material as THREE.Material
    cssScene.add(this.obj)
    if (!screens.size) document.body.appendChild(css.domElement)
    screens.add(this)
  }

  get using() { return current === this }

  show(on: boolean) {
    if (on === this.on) return
    this.on = on
    this.el.style.visibility = on ? 'visible' : 'hidden'
    this.mesh.material = on ? this.hole : this.glass
    if (!on) this.leave()
  }

  /** The page takes the mouse (inspect.ts freed it). */
  use() {
    if (!this.on || current === this) return
    current?.leave()
    current = this; this.since = performance.now()
    this.el.style.pointerEvents = 'auto'; document.body.classList.add('screen-in-use')
  }

  leave() {
    if (current !== this) return
    current = null
    this.el.style.pointerEvents = 'none'; document.body.classList.remove('screen-in-use')
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur() // a text box lets go of the keys
  }

  dispose() {
    this.leave()
    this.mesh.material = this.glass
    this.hole.dispose()
    cssScene.remove(this.obj)
    screens.delete(this)
    if (!screens.size) css.domElement.remove()
  }

  /** A curved screen's page, as wide as the screen looks from where you fly in to it (that depends on the window's shape). */
  private widen(camera: THREE.PerspectiveCamera) {
    if (!this.depth || camera.aspect === this.aspect) return
    this.aspect = camera.aspect
    const d = flyDistance(this, camera)
    this.el.style.width = `${Math.round((this.width * (d + this.depth)) / d)}px`
  }

  /** Every frame, after the camera moved: the pages of the screens that are on, placed for this camera. */
  static render(camera: THREE.Camera) {
    let any = false
    for (const s of screens) if (s.on) { s.widen(camera as THREE.PerspectiveCamera); any = true }
    if (!any) return
    cssCamera.copy(camera as THREE.PerspectiveCamera)
    cssCamera.position.multiplyScalar(MM); cssCamera.updateMatrixWorld()
    css.render(cssScene, cssCamera)
  }

  static setSize(width: number, height: number) { css.setSize(width, height) }
}

window.addEventListener('blur', () => {
  if (current) setTimeout(() => { if (document.activeElement instanceof HTMLIFrameElement) { document.activeElement.blur(); window.focus() } }, 0)
})
