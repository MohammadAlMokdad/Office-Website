// What the screens show. Ali's monitor plays a screen recording (only while you are near, in front of it and it is
// in view; one E on his desk flies you up to it, Esc back); the small screen on the wall (the door intercom) is off
// until you use it (E), then shows the camera picture.
// The TV (YouTube, remotes, sound) is TV.tsx, Salah's desk (our website, the chat) SalahDesk.tsx; they are web pages on
// a screen (htmlScreen.ts).
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { fitContent, type ScreenInfo } from './bakedMaterial'
import { HtmlScreen } from './htmlScreen'
import { frameOf, inspect } from './inspect'
import { addUsable } from './interact'
import { LaptopDesk } from './LaptopDesk'
import { SalahDesk } from './SalahDesk'
import { scene as manifest } from './scene'
import { TV } from './TV'
import { sfx } from './sfx'

const BASE = import.meta.env.BASE_URL
const BRIGHTNESS = 0.92 // a lit screen next to white walls in daylight is not pure white
const PLAY_DISTANCE = 8 // m
const FADE = 0.35 // s, switching a screen on or off
const REACH = 2.2 // m, to Ali's monitor or the wall screen

type Screen = { mesh: THREE.Mesh; material: THREE.ShaderMaterial; info: ScreenInfo }

export function Screens({ meshes }: { meshes: THREE.Mesh[] }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const screens = useMemo(() => {
    const out: Record<string, Screen> = {}
    for (const mesh of meshes) {
      out[mesh.name] = { mesh, material: mesh.material as THREE.ShaderMaterial, info: manifest.screens?.[mesh.name] ?? { aspect: 16 / 9 } }
    }
    return out
  }, [meshes])

  // Ali's PC: the screen recording, stretched edge to edge over the visible screen (the model's monitor is a little
  // taller than the real one)
  const video = useMemo(() => {
    const s = screens.screen_Ali_Monitor
    if (!s) return null
    const v = document.createElement('video')
    Object.assign(v, { src: `${BASE}media/ali_pc.mp4`, muted: true, loop: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous' })
    const tex = new THREE.VideoTexture(v)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    v.addEventListener('loadedmetadata', () => fitContent(s.material.uniforms.contentRect.value, s.info, v.videoWidth / v.videoHeight, 'fill'))
    s.material.uniforms.content.value = tex
    s.material.uniforms.power.value = BRIGHTNESS
    // which way the screen faces (world), to pause the video while you are behind the monitor
    const n = s.mesh.geometry.getAttribute('normal'), facing = new THREE.Vector3()
    for (let i = 0; i < n.count; i++) facing.x += n.getX(i), facing.y += n.getY(i), facing.z += n.getZ(i)
    facing.transformDirection(s.mesh.matrixWorld)
    return { el: v, tex, screen: s, facing }
  }, [screens, gl])
  useEffect(() => {
    if (!video) return
    const frame = frameOf('screen_Ali_Monitor')
    const remove = frame && addUsable({
      at: frame.center, facing: frame.normal, reach: REACH, lift: frame.size[1] / 2 + 0.06, icon: 'monitor',
      label: () => 'Ali’s desk', use: () => inspect.enter('ali', [{ frame }]),
    })
    return () => { remove?.(); video.el.pause(); video.el.removeAttribute('src'); video.el.load(); video.tex.dispose() }
  }, [video])

  // the wall screen: off until used
  const wall = useMemo(() => {
    const s = screens.screen_AliWall_DisplayOutlets
    if (!s) return null
    const tex = new THREE.TextureLoader().load(`${BASE}media/intercom.jpg`, (t) => {
      const img = t.image as HTMLImageElement
      fitContent(s.material.uniforms.contentRect.value, s.info, img.width / img.height, 'cover')
    })
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    s.material.uniforms.content.value = tex
    return { tex, screen: s, on: false, level: 0 }
  }, [screens, gl])
  useEffect(() => {
    const frame = frameOf('screen_AliWall_DisplayOutlets')
    if (!wall || !frame) return
    const remove = addUsable({
      at: frame.center, facing: frame.normal, reach: REACH, lift: frame.size[1] / 2 + 0.05, icon: 'power',
      label: () => (wall.on ? 'Intercom off' : 'Intercom'),
      use: () => { wall.on = !wall.on; sfx.play('toggle', { at: frame.center, variant: wall.on ? 0 : 1 }) },
    })
    return () => { remove(); wall.tex.dispose() }
  }, [wall])

  const size = useThree((s) => s.size)
  useEffect(() => HtmlScreen.setSize(size.width, size.height), [size])

  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const sphere = useMemo(() => new THREE.Sphere(), [])
  useFrame((_, dt) => {
    HtmlScreen.render(camera) // the web pages on screens, for this frame's camera (Player moved it already: mounted earlier)
    if (video) {
      const g = video.screen.mesh.geometry
      if (!g.boundingSphere) g.computeBoundingSphere()
      sphere.copy(g.boundingSphere!).applyMatrix4(video.screen.mesh.matrixWorld)
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const toCamera = camera.position.clone().sub(sphere.center)
      const wanted = toCamera.length() < PLAY_DISTANCE && toCamera.dot(video.facing) > 0 && frustum.intersectsSphere(sphere)
      if (wanted && video.el.paused) video.el.play().catch(() => {})
      else if (!wanted && !video.el.paused) video.el.pause()
    }
    if (wall) {
      const target = wall.on ? 1 : 0
      wall.level += Math.sign(target - wall.level) * Math.min(Math.abs(target - wall.level), dt / FADE)
      const t = wall.level
      wall.screen.material.uniforms.power.value = BRIGHTNESS * t * t * (3 - 2 * t)
    }
  })
  return (
    <>
      {screens.screen_TV_75in && <TV screen={screens.screen_TV_75in.mesh} />}
      {screens.screen_Salah_MonitorFlat && screens.screen_Salah_MonitorCurved &&
        <SalahDesk left={screens.screen_Salah_MonitorFlat.mesh} right={screens.screen_Salah_MonitorCurved.mesh} />}
      {screens.screen_Laptop_Desk2 && <LaptopDesk screen={screens.screen_Laptop_Desk2.mesh} laptop="mhmd" user="Mhmd" />}
      {screens.screen_Laptop_Desk1 && <LaptopDesk screen={screens.screen_Laptop_Desk1.mesh} laptop="zuhair" user="Zuhair" />}
    </>
  )
}
