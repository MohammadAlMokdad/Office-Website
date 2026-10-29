// Vercel function: /api/chat (the logic is in _chat.ts, which Vercel does not publish on its own).
import { handleChat } from './_chat.js'

const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'

export const GET = (req: Request) => handleChat(req, ip(req))
export const POST = (req: Request) => handleChat(req, ip(req))
