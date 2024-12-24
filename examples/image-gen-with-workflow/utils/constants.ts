import { Prompt } from "./types"

export const RATELIMIT_CODE = 429
export const REDIS_PREFIX = 'llm-call'

export const PROMPTS = [
  'A supersonic jet rising to the stars in 1980s propaganda posters style. For coloring, use a contrast between a calm white/blue and a striking red',
  'A futuristic city skyline at dusk, with towering skyscrapers and flying vehicles in the style of retro sci-fi art. Colors should feature deep purples, bright neon pinks, and glowing electric blues.',
  'A high-speed train racing through a futuristic city, inspired by cyberpunk aesthetics. Use a mix of metallic greys and dark purples, with neon accents lighting up the scene.',
  'A tranquil mountain village under a starry night sky, painted in the style of traditional Japanese woodblock prints with a modern touch. Use soft blues and greens for the landscape, with glowing golden stars in the sky.',
  'A group of astronauts exploring a distant planet, depicted in the vibrant, surreal style of 1970s space art.'
] as const

export const IMAGES: Record<Prompt, string> = {
  "A futuristic city skyline at dusk, with towering skyscrapers and flying vehicles in the style of retro sci-fi art. Colors should feature deep purples, bright neon pinks, and glowing electric blues.": "futuristic-city.png",
  "A group of astronauts exploring a distant planet, depicted in the vibrant, surreal style of 1970s space art.": "astronauts.png",
  "A high-speed train racing through a futuristic city, inspired by cyberpunk aesthetics. Use a mix of metallic greys and dark purples, with neon accents lighting up the scene.": "train.png",
  "A supersonic jet rising to the stars in 1980s propaganda posters style. For coloring, use a contrast between a calm white/blue and a striking red": "supersonic-jet.png",
  "A tranquil mountain village under a starry night sky, painted in the style of traditional Japanese woodblock prints with a modern touch. Use soft blues and greens for the landscape, with glowing golden stars in the sky.": "mountain-village.png"
}
export const MOCK_WAIT_MS = 7_000