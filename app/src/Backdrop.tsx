// Behind the outside photo: a large sphere fading from the photo's ground colour to its sky colour, so looking steeply
// up or down through a window shows sky / ground instead of the empty (black) canvas.
import { useMemo } from 'react'
import * as THREE from 'three'
import { scene as manifest } from './scene'

export function Backdrop() {
  const material = useMemo(() => {
    const [sky, ground] = [manifest.backdrop?.sky ?? [0.8, 0.83, 0.86], manifest.backdrop?.ground ?? [0.45, 0.45, 0.43]]
    return new THREE.ShaderMaterial({
      name: 'backdrop',
      // colours are display values already: written straight out, no colour management
      uniforms: { sky: { value: new THREE.Vector3(...sky) }, ground: { value: new THREE.Vector3(...ground) } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sky;
        uniform vec3 ground;
        varying vec3 vDir;
        void main() {
          float t = smoothstep( - 0.25, 0.2, vDir.y );
          gl_FragColor = vec4( mix( ground, sky, t ), 1.0 );
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    })
  }, [])
  // centred on the room, bigger than the outside-view cylinder (radius ~120 m), inside the camera's far plane
  return <mesh material={material} renderOrder={-10} frustumCulled={false} position={[0, 1, 0]}><sphereGeometry args={[300, 32, 16]} /></mesh>
}
