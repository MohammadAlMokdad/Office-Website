import { Preload } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useState } from 'react'
import * as THREE from 'three'
import { Backdrop } from './Backdrop'
import { Blinds } from './Blinds'
import { SoundListener } from './sfx'
import { DebugHud } from './DebugHud'
import { Interaction } from './interact'
import { Lights } from './Lights'
import { Office } from './Office'
import { Overlay } from './Overlay'
import { type Mouse, Player } from './Player'
import { Seats } from './Seats'

const params = new URLSearchParams(window.location.search)
const noUI = params.has('noui')
const debug = params.has('debug')

export default function App() {
  const [mouse, setMouse] = useState<Mouse>(null)
  const [started, setStarted] = useState(false)
  return (
    <>
      <Canvas
        // the baked textures already went through Blender's view transform: no tone mapping here
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: debug }}
        camera={{ fov: 70, near: 0.05, far: 700 }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace }}
      >
        <Suspense fallback={null}>
          <Backdrop />
          <Office />
          <Player onLockChange={(m) => { setMouse(m); if (m) setStarted(true) }} />
          <Interaction />
          <Seats />
          <Lights />
          <Blinds />
          <SoundListener />
          <SoundListener />
          <SoundListener />
          {/* compile every shader and upload every texture before the first frame, so nothing stutters later */}
          <Preload all />
        </Suspense>
        {debug && <DebugHud />}
      </Canvas>
      {!noUI && <Overlay mouse={mouse} started={started} />}
    </>
  )
}
