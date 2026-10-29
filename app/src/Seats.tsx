// Places you can sit: each chair from scene.json; next to one and turned its way, its label shows (E to sit). Not the
// chairs of the desks whose screens you look at (one E on those desks: Ali's in Screens.tsx, Salah's in SalahDesk.tsx,
// Mhmd's and Zuhair's in LaptopDesk.tsx). Seated, you look around as you do walking, and Esc stands you up (Player.tsx).
import { useEffect } from 'react'
import * as THREE from 'three'
import { addUsable } from './interact'
import { seating } from './Player'
import { scene as manifest } from './scene'

const REACH = 1.6 // m (plan) from you to the chair's middle: about a step away
const DESKS = new Set(['Chair_Emp_IslandWest', 'Chair_Salah', 'Chair_Emp_Desk1', 'Chair_Emp_Desk2']) // Ali's, Salah's, Zuhair's, Mhmd's

export function Seats() {
  useEffect(() => {
    const removers = (manifest.seats ?? []).filter((s) => !DESKS.has(s.name)).map((s) => {
      const [lo, hi] = s.box
      const seat = { eye: new THREE.Vector3(...s.eye), look: new THREE.Vector3(...s.look) }
      return addUsable({
        at: new THREE.Vector3((lo[0] + hi[0]) / 2, hi[1], (lo[2] + hi[2]) / 2), // the top of the chair
        reach: REACH, icon: 'seat', label: () => 'Sit', use: () => seating.sit(seat), enabled: () => !seating.seated,
      })
    })
    return () => removers.forEach((r) => r())
  }, [])
  return null
}
