# Office Website

A first-person walkthrough of a 3D office in the browser, with lighting baked in Blender Cycles and interactive screens, lights, blinds and sounds.

The room's light is rendered once in Blender and baked into texture atlases, so the browser draws the scene with no
real-time lights or shadows. Shiny surfaces get reflections from 360° panoramas of the room, and switching a lamp or
lowering a blind relights the room from baked per-light maps instead of re-rendering it.

## Features

- **Walk around**: pointer-lock mouse look, WASD or the arrow keys, Shift to walk faster, collision with the room's
  floor plan and furniture.
- **Use things**: walk up to an object and face it, a label appears, press **E**. You can sit in chairs, fly the
  camera up to a desk or the TV and browse its screens, and get back with **Esc**.
- **Light switches**: four wall rockers switch the four ceiling lamps. The baked light is split per lamp, per window
  and for the sun, so the room darkens and brightens correctly.
- **Roller blinds**: blackout and sheer blinds on three windows, driven by two remotes (**1** and **2** near the
  drawer unit). They cut the daylight and the sun patch on the floor.
- **TV with a YouTube app**: home (popular videos for a region), search and results through the YouTube Data API;
  videos play in YouTube's own player. TV remote (**T**) and soundbar (**B**) by the recliner. Works without a key
  using a short built-in list.
- **Screens with live web pages**: a monitor showing a real website in an iframe, a chat app answered by a Gemini
  model through `/api/chat`, and two laptops running a VS Code-like editor (CodeMirror 6) with a file explorer,
  terminal, a Run button that opens the page in a sandboxed browser window, Download as zip, and an AI pair-programmer
  panel. The workspace is kept in the browser's localStorage.
- **Other screens**: a door intercom that shows a camera picture, and a monitor that plays a screen recording.
- **Sound**: footsteps, switches, keys, chairs, the blinds' motor, TV and soundbar, positioned in 3D, plus a quiet room
  tone. **M** mutes everything.
- **Desktop only**: touch-only devices get a notice asking for a keyboard and mouse.

## Tech stack

- **App**: React 19, React Three Fiber 9, drei, three.js 0.186, TypeScript, Vite 8
- **In-scene apps**: CodeMirror 6, react-markdown + remark-gfm, fflate (zip download)
- **Server**: one serverless route, `app/api/chat.ts` (Vercel); locally the same handler runs inside the Vite dev and
  preview servers
- **Assets**: glTF with meshopt-compressed geometry, KTX2 (Basis Universal) textures, EXR reflection panoramas
- **Pipeline**: Blender 5.1 (Cycles, Python scripts), Node scripts with glTF-Transform, meshoptimizer and
  ktx2-encoder; headless-Chrome checks with playwright-core

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 8)
- A desktop browser with WebGL 2 (developed against Chrome)
- Optional: a YouTube Data API v3 key and a Gemini API key (see [Configuration](#configuration))
- For the asset pipeline only: Blender 5.1 and the source `.blend` files, which are not part of this repository

## Getting started

```sh
cd app
npm install
npm run dev        # http://localhost:5173
```

The compiled 3D model, textures and scene data are committed, so nothing has to be exported to run the site.

Production build:

```sh
cd app
npm run build      # type-check, then build into app/dist
npm run preview    # serve app/dist (http://localhost:4173), with /api/chat
```

### Configuration

All keys are optional. Copy the template and fill in what you need:

```sh
cd app
cp .env.example .env.local
```

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_YOUTUBE_KEY` | page (built in) | YouTube Data API v3 key for the TV. Restrict it to your domain in Google Cloud. |
| `GEMINI_API_KEY` | server | Key for the chat and the editor's AI panel. Without it they report that they are not connected. |
| `CHAT_MODEL` | server | Gemini model id (default `gemini-3.5-flash-lite`). |
| `CHAT_PREVIEW_CLAUDE` | server | `1` shows Claude's name and mark on the chat screens while the configured model answers. |

The chat server never sends the key to the page and limits what a visitor can send (message count and length, output
tokens, and requests per minute and per day per IP).

### URL switches

- `?debug`: frame rate, draw calls and triangle count, plus test hooks on `window`
- `?noui`: hide the overlay
- `?reflect=1.5`: reflection strength
- `?view=x,y,z,tx,ty,tz,lens`: a fixed camera in Blender coordinates, for side-by-side checks with Blender renders
- `?dbg=occ|f0|rough|spec|base|screen|lamps|day|sun`: show a single baked channel
- `?only=Atlas1,Atlas2`: draw only those meshes
- `?vscode=1`, `?aipanel=1`: the editor or its AI panel flat on the page

## Deploying

The `app/` folder deploys to Vercel as is: Vite is detected, files in `app/api/` become functions (files starting with
`_` are not routes), and `app/vercel.json` sets the build. Set the variables above in the Vercel project, then:

```sh
cd app
npx vercel deploy --prod
```

`app/.vercelignore` makes sure the models and scene data are uploaded.

## Asset pipeline

The model goes from Blender to the browser in eight steps. The scripts are in this repository; the source scenes
(`Office.blend` and its bake copy `blender/Office_bake.blend`) and the raw bakes in `build/` are not, because of their
size.

| Step | Where | Script | What it does |
|---|---|---|---|
| 1 | Blender | (save as) | `Office_bake.blend`: a working copy of the source scene |
| 2 | Blender (live) | `s2_cleanup.py` | make shared meshes single-user, collapse heavy models, mark faces nobody can see |
| 3 | Blender (live) | `s3_relight.py` | Cycles and a daylight setup matched to the original EEVEE look |
| 4 | Blender (live) | `s4_uv.py` | a `BakeUV` layer on every mesh, packed into 11 atlases by room area |
| 5 | Blender (background) | `s5_env.py`, `s5_bake.py`, `s5_combine.py`, `s5_env_web.py` | reflection panoramas; per atlas: denoised light, albedo, emission, specular and roughness; final PNG atlases |
| 5d | Blender (background) | `s5_groups.py` | each switchable light group alone (4 lamps, daylight per window, sun) as fraction maps |
| 6 | Blender (background) | `s6_export.py` | one mesh per atlas plus the moving parts → `build/office.glb`, `scene.json`, `collision.json` |
| 7 | Node | `tools/compress.mjs` | meshopt geometry and KTX2 textures with mipmaps, copied into `app/public/models` and `app/src/data` |
| 8 | Node | `tools/*_check.mjs` | headless-Chrome checks of the running site |

Live scripts are sent to an open Blender session through the Blender MCP add-on's socket (port 9876); background
scripts run with `blender -b` and never touch the open session:

```sh
cd blender/scripts
python bl.py s4_uv.py 3600 --lib     # live: refuses to run unless Office_bake.blend is the open file

cd blender
./bake_all.sh                        # steps 5-6 for every atlas (or ./bake_all.sh Floor,Structure)
cd ../tools
npm install
npm run compress                     # step 7 -> app/public/models, app/src/data
```

Before running the pipeline on another machine, set the `OFFICE_PROJECT` environment variable to your clone (read by `blender/scripts/web_lib.py`) and the
Blender path at the top of the `blender/*.sh` scripts. Texture compression per atlas (UASTC or ETC1S) is set in
`tools/texture-modes.json`. Screen recordings for the monitors can be converted with
`blender -b --factory-startup -P tools/video_web.py -- in.mp4 app/public/media/out.mp4 1920 MEDIUM`.

The check scripts in `tools/` drive a local Chrome (path set at the top of each script) against a running server; pass
`APP=http://localhost:<port>` to point them at it.

## Project structure

```
app/                  the website
  api/                /api/chat: Vercel function (chat.ts) and the shared handler (_chat.ts)
  public/models/      office.glb, KTX2 texture atlases, EXR reflection panoramas
  public/basis/       Basis Universal transcoder (from three.js)
  public/media/       screen content and blind fabric textures
  public/sfx/         sound effects (licences in LICENSE.txt)
  src/                React Three Fiber app: player, interaction, lights, blinds, screens, sound
  src/vscode/         the in-scene code editor
  src/data/           scene.json and collision.json from the export
blender/              bake pipeline drivers (*.sh) and scripts/ (Blender Python)
tools/                compress.mjs, the video converter and headless-Chrome check scripts
```

Not included: the Blender source files, raw bakes and renders (`build/`), and the screen recording shown on one
monitor (`app/public/media/*.mp4`); that monitor stays dark without it.

## Credits

3D models used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and modified for this scene; everything
else was modelled for this project.

| Used for | Model | Author |
|---|---|---|
| Desktop PC | [Alienware Aurora R9 3D Model](https://sketchfab.com/3d-models/alienware-aurora-r9-3d-model-40572a8b1c584f6098d5b8c5c6be15ba) | [Naman Deep](https://sketchfab.com/namandeep444) |
| Window-desk laptops | [Asus ROG Strix Scar 17 (2023) G733 Gaming Laptop](https://sketchfab.com/3d-models/asus-rog-strix-scar-17-2023-g733-gaming-laptop-51eca7b2e5884c4087f3499e523d5184) | [RaflyNaHa](https://sketchfab.com/RaflyNaHa) |
| Office chair | [Office Chair](https://sketchfab.com/3d-models/office-chair-0e7b238f35ff458e8a48236db6b0354d) | [Niels Philipsen](https://sketchfab.com/n.philipsen) |
| Mesh office chairs | [Ergonomic mesh office chair](https://sketchfab.com/3d-models/ergonomic-mesh-office-chair-cd5ef0305d8545dd8cd934ebb99cf7d5) | [guillaumecrz](https://sketchfab.com/guillaumecrz) |
| Standing desks | [Standing Desk](https://sketchfab.com/3d-models/standing-desk-65a7f4b06a5f4954a0d43eb8812dd165) | [Ryan_Nein](https://sketchfab.com/Ryan_Nein) |
| Coffee maker | [Drip Coffee Maker](https://sketchfab.com/3d-models/drip-coffee-maker-b3087fb615e14949ac6e790c60c42020) | [JudeNavarre](https://sketchfab.com/JudeNavarre) |
| Ultrawide monitor | [3D Model Acer Nitro UltraWide Gaming Monitor](https://sketchfab.com/3d-models/3d-model-acer-nitro-ultrawide-gaming-monitor-fa6768c49e354b70a8a7bf0864903883) | [hoang_anh 3D Hard](https://sketchfab.com/hoanganhpk26) |
| Headsets | [Gaming Headset](https://sketchfab.com/3d-models/gaming-headset-8a8ea478c4ec40bfad58f9e214177bdc) | [YarikLegendary](https://sketchfab.com/YarikLegendary) |
| Keyboard | [Logitech k380 Keyboard](https://sketchfab.com/3d-models/logitech-k380-keyboard-673e44cab52e407c85188f32dc76b990) | [Wittybacon](https://sketchfab.com/wittybacon) |
| Keyboard | [Logitech mechanical gaming keyboard RGB](https://sketchfab.com/3d-models/logitech-mechanical-gaming-keyboard-rgb-3f9f5098b8d248b3829735e05178a3dd) | [BlackCube](https://sketchfab.com/blackcube4) |
| MacBook | [Macbook Pro 13 inch 2020](https://sketchfab.com/3d-models/macbook-pro-13-inch-2020-efab224280fd4c3993c808107f7c0b38) | [timblewee](https://sketchfab.com/timblewee) |
| Mice | [Razer Basilisk V3](https://sketchfab.com/3d-models/razer-basilisk-v3-02ea1e3f51e34b59ab0140fb85a6b191) | [thegraphicsgeek](https://sketchfab.com/thegraphicsgeek) |
| Recliner | [Single Seater Reclining Sofa](https://sketchfab.com/3d-models/single-seater-reclining-sofa-e42c8f99b9f5426f8ccdcdb3156908e4) | [HARSHA](https://sketchfab.com/harshatantri5) |
| Tissue boxes | [TISSUE BOX](https://sketchfab.com/3d-models/tissue-box-46991c113ce84f73b5b8fc4de2df199c) | [pejucho](https://sketchfab.com/kh1002) |
| Window-desk mice | [Wireless Mouse](https://sketchfab.com/3d-models/wireless-mouse-c21ee6865cbf45ee9e3caebb1d90058e) | [wheeldingdragon](https://sketchfab.com/wheeldingdragon) |
| Xbox controller | [Xbox Controller](https://sketchfab.com/3d-models/xbox-controller-32d17951703b4e05abed11a1c65f5909) | [umkhero](https://sketchfab.com/umkhero) |

Sound effects: [Mixkit](https://mixkit.co) (Mixkit Sound Effects Free License),
[martin-bn on Freesound](https://freesound.org/people/martin-bn/sounds/500313/) (CC0) and
[Kenney](https://kenney.nl) (CC0). Details in `app/public/sfx/LICENSE.txt`.

The way you use objects and look at screens up close is modelled on [Graffico's office](https://office.graffico.it).
