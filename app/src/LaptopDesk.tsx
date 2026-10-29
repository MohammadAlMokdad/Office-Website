// Mhmd's and Zuhair's desks: VS Code (vscode/VSCodeApp.tsx) on each laptop's screen, a web page on the glass
// (htmlScreen.ts) that stays on. One E on the desk (its label is up) and the camera flies up to the laptop's screen
// (inspect.ts), the one view there, and the mouse is free: click in the editor and the keys type, click outside it and
// they are the walkthrough's again; Esc and you are back where you were. The chairs of these desks are not for sitting
// (Seats.tsx): one E per desk.
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type * as THREE from 'three'
import { HtmlScreen } from './htmlScreen'
import { inspect } from './inspect'
import { addUsable } from './interact'
import { scene as manifest } from './scene'
import { VSCodeApp } from './vscode/VSCodeApp'

const PX = 1366 // the laptop's panel in CSS pixels across (16:9: the height follows the screen's frame in scene.json)
const REACH = 2.2 // m (plan) from you to the screen: the label shows from behind the chair
const debug = new URLSearchParams(window.location.search).has('debug')

export function LaptopDesk({ screen, laptop, user }: { screen: THREE.Mesh; laptop: 'mhmd' | 'zuhair'; user: string }) {
  useEffect(() => {
    if (!manifest.screens?.[screen.name]?.frame) { console.warn(`${screen.name}: no screen frame in scene.json, no VS Code on it`); return }
    const name = `laptop_${laptop}`
    const page = new HtmlScreen(screen, name, PX)
    page.show(true)
    const root = createRoot(page.el)
    root.render(<VSCodeApp laptop={laptop} user={user} onClose={() => inspect.leave('after')} />)
    const w = window as unknown as { __laptops?: Record<string, HtmlScreen> }
    if (debug) (w.__laptops ??= {})[laptop] = page // tests
    const removeUsable = addUsable({
      at: page.center, facing: page.normal, reach: REACH, lift: page.size[1] / 2 + 0.06, icon: 'laptop',
      label: () => `${user}’s desk`, use: () => inspect.enter(name, [{ frame: page, page }]),
    })
    return () => {
      removeUsable()
      if (inspect.name() === name) inspect.leave(false)
      if (debug) delete w.__laptops?.[laptop]
      setTimeout(() => root.unmount()) // not while React is rendering
      page.dispose()
    }
  }, [screen, laptop, user])
  return null
}
