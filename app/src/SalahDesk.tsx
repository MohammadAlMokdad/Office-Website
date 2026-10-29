// Salah's desk: our website (octopus.eu.com, the real one in a frame) on his left monitor, the chat app (ChatApp.tsx) on
// his right, the curved one. One E on the desk (its label is up) and the camera flies to the whole desk with both
// screens (inspect.ts); A / D or the arrows move to the left screen or the right one and back. The chat can be used
// whenever it is in view (click in the box, type, Enter), the website on its own screen (scroll and click as in a
// browser). Esc and you are back where you were.
// The website runs only while its screen is in view: hidden, the browser stops it, and shown again it carries on where
// it was.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { ChatApp } from './ChatApp'
import { HtmlScreen } from './htmlScreen'
import { frameAround, inspect, type View } from './inspect'
import { addUsable } from './interact'

const SITE = 'https://octopus.eu.com'
const SITE_PX = 1600 // the website's width in CSS pixels: its desktop layout
const SITE_BG = '#0b0d15' // the website's own background, while it loads
const CHAT_PX = 1130 // the chat's width in CSS pixels: the same size of type as on a flat screen 840 px across
const CURVE = 0.08 // m: the middle of the curved monitor's glass is this much deeper than its sides (in the model)
const CHAT_BG = '#faf9f5' // the chat's background (--ch-bg in styles.css), for the curved glass's sides
const REACH = 2.2 // m

export function SalahDesk({ left, right }: { left: THREE.Mesh; right: THREE.Mesh }) {
  const camera = useThree((s) => s.camera)
  const site = useRef<{ page: HtmlScreen; bounds: THREE.Sphere } | null>(null)

  useEffect(() => {
    const page = new HtmlScreen(left, 'site', SITE_PX)
    page.el.style.background = SITE_BG
    const frame = Object.assign(document.createElement('iframe'), { src: SITE, title: 'Octopus', allow: 'autoplay; fullscreen; clipboard-write' })
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: '0' })
    page.el.appendChild(frame)
    left.geometry.computeBoundingSphere()
    site.current = { page, bounds: left.geometry.boundingSphere!.clone().applyMatrix4(left.matrixWorld) }

    const chat = new HtmlScreen(right, 'chat', CHAT_PX, { depth: CURVE, fill: CHAT_BG })
    chat.show(true)
    const root = createRoot(chat.el)
    root.render(<ChatApp />)

    const whole = frameAround([page, chat])
    // left to right as you sit: A / left arrow from the whole desk is the website, D / right arrow the chat
    const views: View[] = [{ frame: page, page }, { frame: whole, page: chat }, { frame: chat, page: chat }]
    const removeUsable = addUsable({
      at: whole.center, facing: whole.normal, reach: REACH, lift: whole.size[1] / 2 + 0.06, icon: 'monitor',
      label: () => 'Salah’s desk', use: () => inspect.enter('salah', views, { start: 1 }),
    })
    return () => {
      removeUsable()
      if (inspect.name() === 'salah') inspect.leave(false)
      setTimeout(() => root.unmount()) // not while React is rendering
      site.current = null
      page.dispose(); chat.dispose()
    }
  }, [left, right])

  // the website: on while its screen is in view and you are in front of it
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const toCamera = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const s = site.current
    if (!s) return
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const front = toCamera.copy(camera.position).sub(s.page.center).dot(s.page.normal) > 0
    s.page.show(front && frustum.intersectsSphere(s.bounds))
  })
  return null
}
