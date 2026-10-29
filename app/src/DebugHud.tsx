// ?debug: frame rate and what the GPU is asked to do (draw calls, triangles, textures), top-left.
// Also exposes the numbers on window.__office for automated checks.
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

declare global {
  interface Window {
    __office?: { fps: number; calls: number; triangles: number; textures: number; geometries: number; programs: number; frames: number }
    __three?: { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }
    __pick?: (x: number, y: number) => { name: string; material: string; face: number; uv: number[]; distance: number; blender: number[] }[]
  }
}

export function DebugHud() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    window.__three = { gl, scene, camera }
    // what is under a canvas pixel (debugging): every mesh the ray hits, nearest first
    window.__pick = (x, y) => {
      const r = new THREE.Raycaster(), el = gl.domElement
      r.setFromCamera(new THREE.Vector2((x / el.clientWidth) * 2 - 1, -(y / el.clientHeight) * 2 + 1), camera)
      return r.intersectObjects(scene.children, true).slice(0, 6).map((h) => ({
        name: h.object.name, material: ((h.object as THREE.Mesh).material as THREE.Material).name, face: h.faceIndex ?? -1,
        uv: h.uv ? [h.uv.x, h.uv.y] : [], distance: h.distance, blender: [h.point.x, -h.point.z, h.point.y],
      }))
    }
  }, [gl, scene, camera])
  const el = useMemo(() => {
    const d = document.createElement('div')
    Object.assign(d.style, { position: 'fixed', left: '8px', top: '8px', padding: '6px 9px', font: '12px/1.45 ui-monospace, monospace',
      color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: '6px', zIndex: '10', pointerEvents: 'none', whiteSpace: 'pre' })
    return d
  }, [])
  useEffect(() => { document.body.appendChild(el); return () => { el.remove() } }, [el])
  const acc = useRef({ t: 0, n: 0, frames: 0 })
  useFrame((_, dt) => {
    const a = acc.current
    a.t += dt; a.n++; a.frames++
    if (a.t < 0.5) return
    const fps = a.n / a.t
    a.t = 0; a.n = 0
    const r = gl.info.render, m = gl.info.memory
    const programs = gl.info.programs?.length ?? 0
    window.__office = { fps, calls: r.calls, triangles: r.triangles, textures: m.textures, geometries: m.geometries, programs, frames: a.frames }
    el.textContent = `${fps.toFixed(0)} fps\n${r.calls} draw calls\n${(r.triangles / 1000).toFixed(0)}k triangles\n${m.textures} textures · ${m.geometries} meshes · ${programs} shaders`
  })
  return null
}
