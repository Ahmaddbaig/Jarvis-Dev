import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const COMPUTER_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'computer.use',
    inputSchema: z.strictObject({
      task: z.string(),
      target: z.string().optional(),
      screen: z.number().optional(),
    }),
    policy: { operation: 'computer_use', capability: 'computer.local.control', risk: 'local-privileged', ability: 'computer-use', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'computer.companion_control',
    inputSchema: z.strictObject({
      action: z.enum(['list', 'status', 'show_display', 'hide_display', 'launch', 'launch_and_type', 'type', 'keypress', 'click']),
      target: z.string().optional(),
      application: z.string().optional(),
      text: z.string().optional(),
      keys: z.array(z.string()).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      button: z.enum(['left', 'right', 'middle']).optional(),
      screen: z.number().optional(),
    }),
    policy: { operation: 'companion_control', capability: 'computer.remote.control', risk: 'remote-control', ability: 'companions', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'computer.deskflow_control',
    inputSchema: z.strictObject({
      action: z.enum(['status', 'switch']),
      target: z.string().optional(),
    }),
    policy: { operation: 'deskflow_control', capability: 'computer.remote.switch', risk: 'remote-control', ability: 'deskflow', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'computer.xray',
    inputSchema: z.strictObject({}),
    policy: { operation: 'xray', capability: 'camera.private.capture', risk: 'read-private', ability: 'xray', confirmation: 'when-model' },
  }),
  defineStaticTool({
    handlerId: 'computer.take_photo',
    inputSchema: z.strictObject({}),
    policy: { operation: 'take_photo', capability: 'camera.private.capture', risk: 'read-private', ability: 'camera', confirmation: 'when-model' },
  }),
]);
