import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const MEDIA_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'media.image_generation',
    inputSchema: z.strictObject({
      prompt: z.string(),
      size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).optional(),
      quality: z.enum(['low', 'medium', 'high', 'auto']).optional(),
      enhance_prompt: z.boolean().optional(),
      use_latest_home_image: z.boolean().optional(),
      reference_image_base64: z.string().optional(),
    }),
    policy: { operation: 'image_generation', capability: 'provider.image.generate', risk: 'external-side-effect', ability: 'image-generation', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'media.play_spotify',
    inputSchema: z.strictObject({ query: z.string() }),
    policy: { operation: 'play_spotify', capability: 'media.playback.control', risk: 'local-reversible', ability: 'music', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'media.control_music',
    inputSchema: z.strictObject({
      command: z.enum(['playpause', 'play', 'pause', 'next', 'previous', 'volume_up', 'volume_down', 'volume']),
      value: z.number().optional(),
    }),
    policy: { operation: 'control_music', capability: 'media.playback.control', risk: 'local-reversible', ability: 'music', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'media.get_now_playing',
    inputSchema: z.strictObject({}),
    policy: { operation: 'get_now_playing', capability: 'media.playback.read', risk: 'read-private', ability: 'music', confirmation: 'never' },
  }),
]);
