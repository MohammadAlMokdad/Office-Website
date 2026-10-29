// Materials for the baked office. No lights, no shadows: every surface shows its baked atlas (lighting, colour and
// Blender's view transform already in it). On top, a reflection of the room comes from a 360° panorama rendered in
// Blender (box-projected so reflections line up with the walls), weighted by Fresnel, each texel's specular colour
// and roughness, and the baked light as specular occlusion (dark corners do not reflect the bright room).
// Lights you can switch (lighting.ts): the room is baked with everything on, and an atlas can carry fraction maps
// saying how much of each texel's colour came from each lamp, the sky through each window and the sun. With those
// (LIGHT_MIX), a switched-off light is taken out of the baked colour, a turned-up one put in, and the exposure applied:
// inverse AgX back to scene-linear, scaled, AgX again.
import * as THREE from 'three'
import { GROUPS, LIGHT_UNIFORMS } from './lighting'
import { scene as manifest } from './scene'

export type Env = {
  map: THREE.Texture // PMREM (cube UV) of the room panorama, scene-linear
  center: THREE.Vector3
  boxMin: THREE.Vector3
  boxMax: THREE.Vector3
  exposure: number // stops, as in Blender
}

// three.js r186 AgX (tonemapping_pars_fragment), so reflections go through the same curve as the baked colour. The
// matrices are kept here as numbers (GLSL column order) so the inverse below is computed from exactly these.
const AGX_INSET = [0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859]
const AGX_OUTSET = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405]
const SRGB_TO_REC2020 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956]
const REC2020_TO_SRGB = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187]
// a GLSL mat3 literal is three column vectors; Matrix3.fromArray / .elements are column-major too
const mat3 = (e: ArrayLike<number>) => {
  const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`)
  const col = (i: number) => `vec3( ${f(e[i])}, ${f(e[i + 1])}, ${f(e[i + 2])} )`
  return `mat3( ${col(0)}, ${col(3)}, ${col(6)} )`
}
const inverse = (e: number[]) => mat3(new THREE.Matrix3().fromArray(e).invert().elements)

const AGX = /* glsl */ `
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = ${mat3(SRGB_TO_REC2020)};
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = ${mat3(REC2020_TO_SRGB)};
const mat3 AgXInsetMatrix = ${mat3(AGX_INSET)};
const mat3 AgXOutsetMatrix = ${mat3(AGX_OUTSET)};
const float AgxMinEv = - 12.47393; const float AgxMaxEv = 4.026069;
vec3 agxContrast( vec3 x ) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx( vec3 color ) {
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max( color, 1e-10 );
  color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
  color = clamp( color, 0.0, 1.0 );
  color = agxContrast( color );
  color = AgXOutsetMatrix * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}
#ifdef LIGHT_MIX
// agx() undone step by step (the matrices inverted in JS from the same numbers). agxContrast rises on [0,1] (slope
// 0.11 at the dark end, 2 in the middle): a quintic fit of its inverse as the start, then Newton steps kept inside the
// bracket that holds the root (a step that leaves it is replaced by the bracket's middle; plain Newton from the value
// itself swings between the ends). Exact to float precision for every colour agx() can give.
float agxContrastInverse( float y ) {
  float lo = 0.0, hi = 1.0;
  float t = clamp( ( ( ( ( 18.51255758 * y - 48.87366331 ) * y + 47.99000967 ) * y - 21.39495152 ) * y + 4.714912549 ) * y + 0.06657322967, 0.0, 1.0 );
  for ( int i = 0; i < 5; i ++ ) {
    float t2 = t * t, t4 = t2 * t2;
    float p = 15.5 * t4 * t2 - 40.14 * t4 * t + 31.96 * t4 - 6.868 * t2 * t + 0.4298 * t2 + 0.1191 * t - 0.00232 - y;
    float dp = 93.0 * t4 * t - 200.7 * t4 + 127.84 * t2 * t - 20.604 * t2 + 0.8596 * t + 0.1191;
    if ( p > 0.0 ) hi = t; else lo = t;
    float n = t - p / dp;
    t = ( n >= lo && n <= hi ) ? n : 0.5 * ( lo + hi );
  }
  return t;
}
vec3 agxInverse( vec3 color ) {
  const mat3 AgXInsetInverse = ${inverse(AGX_INSET)};
  const mat3 AgXOutsetInverse = ${inverse(AGX_OUTSET)};
  const mat3 LINEAR_SRGB_TO_LINEAR_REC2020_INVERSE = ${inverse(SRGB_TO_REC2020)};
  const mat3 LINEAR_REC2020_TO_LINEAR_SRGB_INVERSE = ${inverse(REC2020_TO_SRGB)};
  color = LINEAR_REC2020_TO_LINEAR_SRGB_INVERSE * color;
  color = pow( max( color, 0.0 ), vec3( 1.0 / 2.2 ) );
  color = AgXOutsetInverse * color;
  color = vec3( agxContrastInverse( color.r ), agxContrastInverse( color.g ), agxContrastInverse( color.b ) );
  color = exp2( color * ( AgxMaxEv - AgxMinEv ) + AgxMinEv );
  color = AgXInsetInverse * color;
  color = LINEAR_SRGB_TO_LINEAR_REC2020_INVERSE * color;
  return max( color, 0.0 );
}
#endif
`

const COMMON = /* glsl */ `
${AGX}
uniform sampler2D envMap;
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform vec3 probePos;
uniform float exposure;     // 2^stops
uniform float reflectGain;
uniform vec4 lightMisc;     // lighting.ts: x = how much of the panoramas' light is on (exposure included), y = 1 while any light is not fully on, z = the exposure
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#include <cube_uv_reflection_fragment>

// parallax-corrected reflection direction: where the ray leaves the room box, seen from the panorama's centre
vec3 boxProject( vec3 R, vec3 P ) {
  vec3 tMax = ( boxMax - P ) / R;
  vec3 tMin = ( boxMin - P ) / R;
  vec3 t = max( tMax, tMin );
  float d = min( min( t.x, t.y ), t.z );
  return P + R * d - probePos;
}
// split-sum environment BRDF (Karis' analytic fit)
vec2 envBRDF( float NoV, float r ) {
  const vec4 c0 = vec4( - 1.0, - 0.0275, - 0.572, 0.022 );
  const vec4 c1 = vec4( 1.0, 0.0425, 1.04, - 0.04 );
  vec4 q = r * c0 + c1;
  float a004 = min( q.x * q.x, exp2( - 9.28 * NoV ) ) * q.x + q.y;
  return vec2( - 1.04, 1.04 ) * a004 + q.zw;
}
// reflection in display space (the same AgX + exposure as the bake); the panoramas were rendered with every light on
vec3 reflection( vec3 F0, float rough, float occlusion ) {
  vec3 N = normalize( vWorldNormal );
  if ( ! gl_FrontFacing ) N = - N;
  vec3 V = normalize( cameraPosition - vWorldPos );
  float NoV = clamp( dot( N, V ), 1e-4, 1.0 );
  vec3 R = reflect( - V, N );
  vec3 env = textureCubeUV( envMap, boxProject( R, vWorldPos ), rough ).rgb * lightMisc.x;
  vec2 ab = envBRDF( NoV, rough );
  return agx( env * ( F0 * ab.x + ab.y ) * occlusion * reflectGain * exposure );
}
`

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef USE_VERTEX_COLOR
attribute vec3 color;
varying vec3 vColor;
#endif
#ifdef SCREEN
attribute vec2 screenUv;
varying vec2 vScreenUv;
#endif
void main() {
  vUv = uv;
#ifdef SCREEN
  vScreenUv = vec2( screenUv.x, 1.0 - screenUv.y ); // glTF counts v downwards, the content textures upwards
#endif
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  vWorldNormal = normalize( mat3( modelMatrix ) * normal );
#ifdef USE_VERTEX_COLOR
  vColor = color;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const BAKED_FRAG = /* glsl */ `
uniform sampler2D map;       // RGB baked colour (display-referred), A = specular occlusion or opacity
uniform sampler2D specMap;   // RGB specular colour at normal incidence, A = roughness
uniform float occlusionPower;
uniform int debugView;
varying vec2 vUv;
#ifdef SCREEN
uniform sampler2D content;
uniform vec4 contentRect;    // screen UV -> content UV: xy scale, zw offset
uniform float power;         // 0 = off (dark glass) .. 1 = on
uniform float baseScale;     // the baked surface under the glass, darkened: an off screen is near black
varying vec2 vScreenUv;
#endif
#ifdef LIGHT_MIX
uniform sampler2D lampMap;   // R G B A = sqrt of the share of the texel's colour from lamp 1..4, its own glow included (linear data, quarter size, same UVs)
uniform sampler2D dayMap;    // R G B = sqrt of the share from the sky's daylight through the South, East, Angled windows; A = the sun's
uniform vec4 lampW;          // lighting.ts: each lamp's light x its baked light (0 = off, above 1 with the blinds closed)
uniform vec4 dayW;           // each window's sky light, 1 = open; w = the sun
uniform vec3 kLamp[ 4 ];     // a group's light colour relative to all light (per channel), scene.json lightGroups.tint
uniform vec3 kDay[ 4 ];
uniform int selfLamp;        // the lamp this mesh is (0..3: its own glow follows its switch, no gain), -1 for everything else
#endif
${COMMON}
#ifdef LIGHT_MIX
// the baked colour with what is switched off taken out (and what is turned up put in): back to scene-linear, each
// light's share of the texel scaled by what is left of that light (over all of it as baked), the exposure on top,
// through AgX again. Applied
// as a ratio to the stored colour: a texel whose lights did not change keeps its exact colour, and the few saturated
// texels Blender's AgX made that this AgX cannot give back keep their hue. A lamp's own mesh: its own share (mostly
// its glow) follows its switch but never the gain, so a lamp that is on glows as baked.
vec3 relit( vec3 base ) {
  vec4 fl = texture2D( lampMap, vUv ); fl *= fl; // stored as square roots
  vec4 fd = texture2D( dayMap, vUv ); fd *= fd;
  vec3 x = agxInverse( base );
  // The shares are stored as square roots, and the sampler averages those (bilinear, mipmaps): squared, they add up to
  // less than 1 wherever two shares trade off between neighbouring texels (the edge of the sun's patch), by up to a
  // fifth. So the shares are scaled to add up to 1, unless most of the texel's colour is in no share: its own emission
  // (a screen, an LED), which no switch takes away.
  float sum = fl.x + fl.y + fl.z + fl.w + fd.x + fd.y + fd.z + fd.w;
  float deficit = max( 0.0, 1.0 - sum );
  float rest = deficit * smoothstep( 0.15, 0.4, deficit );
  float norm = 1.0 / max( sum + rest, 1e-3 );
  fl *= norm; fd *= norm; rest *= norm;
  vec4 wl = lampW;
  if ( selfLamp == 0 ) wl.x = min( wl.x, 1.0 );
  if ( selfLamp == 1 ) wl.y = min( wl.y, 1.0 );
  if ( selfLamp == 2 ) wl.z = min( wl.z, 1.0 );
  if ( selfLamp == 3 ) wl.w = min( wl.w, 1.0 );
  vec3 on = vec3( rest ), now = vec3( rest );
  on += fl.x * kLamp[ 0 ] + fl.y * kLamp[ 1 ] + fl.z * kLamp[ 2 ] + fl.w * kLamp[ 3 ]
    + fd.x * kDay[ 0 ] + fd.y * kDay[ 1 ] + fd.z * kDay[ 2 ] + fd.w * kDay[ 3 ];
  now += wl.x * fl.x * kLamp[ 0 ] + wl.y * fl.y * kLamp[ 1 ] + wl.z * fl.z * kLamp[ 2 ] + wl.w * fl.w * kLamp[ 3 ]
    + dayW.x * fd.x * kDay[ 0 ] + dayW.y * fd.y * kDay[ 1 ] + dayW.z * fd.z * kDay[ 2 ] + dayW.w * fd.w * kDay[ 3 ];
  vec3 s = now / max( on, vec3( 1e-3 ) ) * lightMisc.z;
  vec3 same = max( agx( x ), 1e-4 );
  return clamp( base * agx( x * s ) / same, 0.0, 1.0 );
}
#endif
void main() {
  vec4 base = texture2D( map, vUv );
  vec4 sp = texture2D( specMap, vUv );
#ifdef LIGHT_MIX
  if ( lightMisc.y > 0.5 ) base.rgb = relit( base.rgb );
#endif
#ifdef SCREEN
  sp = vec4( vec3( 0.03 ), 0.2 ); // screen glass with an anti-glare coat: a faint, soft reflection
  vec2 cuv = vScreenUv * contentRect.xy + contentRect.zw;
  float inside = step( 0.0, cuv.x ) * step( cuv.x, 1.0 ) * step( 0.0, cuv.y ) * step( cuv.y, 1.0 );
  base.rgb = base.rgb * baseScale + texture2D( content, clamp( cuv, 0.0, 1.0 ) ).rgb * inside * power;
#endif
#if defined( CUTOUT )
  if ( base.a < 0.5 ) discard;
  float occ = 1.0; float alpha = 1.0;
#elif defined( BLEND )
  float occ = 1.0; float alpha = base.a;
#else
  float occ = pow( base.a, occlusionPower ); float alpha = 1.0;
#endif
  vec3 spec = reflection( sp.rgb, sp.a, occ );
  gl_FragColor = vec4( base.rgb + spec * ( 1.0 - base.rgb ), alpha );
#ifdef DEBUG_VIEW
  // ?dbg=occ|f0|rough|spec|base: one input at a time
  if ( debugView == 1 ) gl_FragColor = vec4( vec3( occ ), 1.0 );
  if ( debugView == 2 ) gl_FragColor = vec4( sp.rgb * 4.0, 1.0 );
  if ( debugView == 3 ) gl_FragColor = vec4( vec3( sp.a ), 1.0 );
  if ( debugView == 4 ) gl_FragColor = vec4( spec, 1.0 );
  if ( debugView == 5 ) gl_FragColor = vec4( base.rgb, 1.0 );
#ifdef SCREEN
  // ?dbg=screen: the screen UVs (red = across, green = up, white lines every 10 %)
  vec2 g = abs( fract( vScreenUv * 10.0 + 0.5 ) - 0.5 );
  if ( debugView == 6 ) gl_FragColor = vec4( vScreenUv, 0.0, 1.0 ) + vec4( step( min( g.x, g.y ), 0.03 ) );
#endif
#ifdef LIGHT_MIX
  // ?dbg=lamps|day|sun: the fraction maps as stored (lamps 1..3 as red, green, blue; the windows likewise; the sun)
  if ( debugView == 7 ) gl_FragColor = vec4( texture2D( lampMap, vUv ).rgb, 1.0 );
  if ( debugView == 8 ) gl_FragColor = vec4( texture2D( dayMap, vUv ).rgb, 1.0 );
  if ( debugView == 9 ) gl_FragColor = vec4( vec3( texture2D( dayMap, vUv ).a ), 1.0 );
#endif
#endif
  #include <colorspace_fragment>
}
`

const GLASS_FRAG = /* glsl */ `
uniform vec3 tint;           // display colour of the glass body
uniform float opacity;
uniform float f0;
uniform float roughness;
uniform float reflectWeight; // Blender's alpha also scales the reflection of see-through (alpha) glass
${COMMON}
void main() {
  vec3 spec = reflection( vec3( f0 ), roughness, 1.0 ) * reflectWeight;
  // body (opacity a) plus reflection, as one straight-alpha colour: the canvas blends in display (sRGB) space, so
  // the colour is encoded once here and blended normally (premultiplying before the encoding would add a white veil)
  float A = clamp( opacity + max( spec.r, max( spec.g, spec.b ) ), 1e-4, 1.0 );
  gl_FragColor = vec4( ( tint * lightMisc.x * opacity + spec ) / A, A );
  #include <colorspace_fragment>
}
`

function envUniforms(env: Env) {
  return {
    envMap: { value: env.map },
    boxMin: { value: env.boxMin },
    boxMax: { value: env.boxMax },
    probePos: { value: env.center },
    exposure: { value: 2 ** env.exposure },
    reflectGain: { value: 1 },
    ...LIGHT_UNIFORMS, // the very same uniform objects in every material: lighting.ts changes them for all at once
  }
}

function cubeUVDefines(env: Env) {
  // same as three.js WebGLProgram.generateCubeUVSize
  const h = (env.map.image as { height: number }).height
  const maxMip = Math.log2(h) - 2
  return {
    ENVMAP_TYPE_CUBE_UV: '',
    CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(2 ** maxMip, 7 * 16)),
    CUBEUV_TEXEL_HEIGHT: 1 / h,
    CUBEUV_MAX_MIP: `${maxMip}.0`,
  }
}

export type BakedKind = 'opaque' | 'cutout' | 'blend'
const DEBUG_VIEW = Math.max(0, ['', 'occ', 'f0', 'rough', 'spec', 'base', 'screen', 'lamps', 'day', 'sun'].indexOf(new URLSearchParams(window.location.search).get('dbg') ?? ''))

/** An atlas's fraction maps (scene.json atlases[].lamps / .day, linear data); `selfLamp`: this material is lamp n's
 *  own (0..3), whose glow follows its switch. */
export type LightMaps = { lamps: THREE.Texture; day: THREE.Texture; selfLamp?: number }
// each group's light colour relative to all light, from the groups bake (1 until it is baked)
const tintOf = (g: string) => new THREE.Vector3(...(manifest.lightGroups?.tint?.[g] ?? [1, 1, 1]))
const K_LAMP = GROUPS.slice(0, 4).map(tintOf), K_DAY = GROUPS.slice(4).map(tintOf)

export function bakedMaterial(name: string, map: THREE.Texture, specMap: THREE.Texture, env: Env, kind: BakedKind, light?: LightMaps) {
  const m = new THREE.ShaderMaterial({
    name,
    vertexShader: VERT,
    fragmentShader: BAKED_FRAG,
    defines: {
      ...cubeUVDefines(env), ...(kind === 'cutout' ? { CUTOUT: '' } : kind === 'blend' ? { BLEND: '' } : {}),
      ...(DEBUG_VIEW ? { DEBUG_VIEW: '' } : {}),
      ...(light ? { LIGHT_MIX: '' } : {}),
    },
    uniforms: {
      map: { value: map }, specMap: { value: specMap }, occlusionPower: { value: 1.5 }, debugView: { value: DEBUG_VIEW }, ...envUniforms(env),
      ...(light ? { lampMap: { value: light.lamps }, dayMap: { value: light.day }, kLamp: { value: K_LAMP }, kDay: { value: K_DAY }, selfLamp: { value: light.selfLamp ?? -1 } } : {}),
    },
    side: THREE.DoubleSide,
    transparent: kind === 'blend',
    depthWrite: kind !== 'blend',
    alphaToCoverage: kind === 'cutout',
  })
  return m
}

const NO_CONTENT = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
NO_CONTENT.needsUpdate = true

/** A screen: the baked glass (reflections included) with content glowing under it, see Screens.tsx. */
export function screenMaterial(baked: THREE.ShaderMaterial) {
  const shared = Object.fromEntries(Object.entries(baked.uniforms).map(([k, u]) => [k, { value: u.value }])) // (the light weights' Vectors stay shared)
  const m = new THREE.ShaderMaterial({
    name: `screen_${baked.name}`,
    vertexShader: VERT,
    fragmentShader: BAKED_FRAG,
    defines: { ...baked.defines, SCREEN: '' },
    uniforms: {
      ...shared, content: { value: NO_CONTENT }, contentRect: { value: new THREE.Vector4(1, 1, 0, 0) },
      power: { value: 0 }, baseScale: { value: 0.08 },
    },
    side: baked.side,
  })
  m.userData.screen = true
  return m
}

/** contentRect for content of one aspect on a screen: 'contain' shows all of it (black bars), 'cover' fills the
 * screen (crops the overflow), 'fill' stretches it edge to edge. Fitted to the part of the screen you can see
 * (view: [u0, v0, u1, v1] of its UVs). */
export function fitContent(rect: THREE.Vector4, screen: ScreenInfo, contentAspect: number, mode: 'contain' | 'cover' | 'fill') {
  const [u0, v0, u1, v1] = screen.view ?? [0, 0, 1, 1]
  const du = u1 - u0, dv = v1 - v0
  const k = contentAspect / ((screen.aspect * du) / dv) // > 1: the content is wider than the visible screen
  const sx = mode === 'fill' ? 1 : (mode === 'contain') === (k < 1) ? 1 / k : 1
  const sy = mode === 'fill' || sx !== 1 ? 1 : k
  // content UV = ((uv - view min) / view size - 0.5) * s + 0.5
  rect.set(sx / du, sy / dv, 0.5 - 0.5 * sx - (u0 * sx) / du, 0.5 - 0.5 * sy - (v0 * sy) / dv)
}

export type ScreenInfo = { aspect: number; view?: [number, number, number, number] }

export type GlassLook = { color: [number, number, number]; alpha: number; transmission: number; roughness: number; ior: number }

export function glassMaterial(name: string, look: GlassLook, env: Env, ambient: number) {
  // body opacity: Blender alpha, thinned by transmission (clear liquids and lenses stay see-through)
  const opacity = Math.min(0.9, look.alpha * (1 - 0.85 * look.transmission))
  const f0 = ((look.ior - 1) / (look.ior + 1)) ** 2
  // the body colour as the room's average light would show it
  const tint = new THREE.Color(...look.color).multiplyScalar(ambient * 2 ** env.exposure)
  tint.setRGB(1 - Math.exp(-tint.r), 1 - Math.exp(-tint.g), 1 - Math.exp(-tint.b))
  return new THREE.ShaderMaterial({
    name,
    vertexShader: VERT,
    fragmentShader: GLASS_FRAG,
    defines: cubeUVDefines(env),
    uniforms: {
      tint: { value: tint }, opacity: { value: opacity }, f0: { value: f0 }, roughness: { value: look.roughness },
      reflectWeight: { value: look.transmission > 0 ? 1 : look.alpha }, ...envUniforms(env),
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
}

/** Lets ?reflect=<gain> tune every reflection live (calibration against Blender renders). */
export function setReflectGain(materials: THREE.Material[], gain: number) {
  for (const m of materials) {
    const u = (m as THREE.ShaderMaterial).uniforms
    if (u?.reflectGain) u.reflectGain.value = gain
  }
}
