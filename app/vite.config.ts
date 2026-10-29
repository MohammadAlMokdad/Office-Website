import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { type Connect, defineConfig, loadEnv, type Plugin } from 'vite'
import { handleChat } from './api/_chat.js'

// /api/chat on this computer too (on Vercel it is a function, api/chat.ts): the same code, behind the dev and preview
// servers, with the settings from .env.local
function localApi(): Plugin {
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    const request = new Request(`http://localhost${req.url ?? ''}`, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined })
    const response = await handleChat(request, req.socket.remoteAddress ?? 'local')
    res.statusCode = response.status
    response.headers.forEach((v, k) => res.setHeader(k, v))
    if (response.body) for await (const chunk of response.body) res.write(chunk)
    res.end()
  }
  const mount = (m: Connect.Server) => m.use('/api/chat', (req, res) => { serve(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end() }) })
  return { name: 'local-api', configureServer: (s) => { mount(s.middlewares) }, configurePreviewServer: (s) => { mount(s.middlewares) } }
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), '')) // GEMINI_API_KEY etc. for the local /api/chat
  return {
    plugins: [react(), localApi()],
    server: { port: 5173, open: false },
    // three.js + react-three-fiber make one ~1.3 MB chunk (~360 KB gzipped); the 12.5 MB office model is the real download
    build: { chunkSizeWarningLimit: 1500 },
  }
})
