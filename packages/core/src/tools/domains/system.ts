import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const SYSTEM_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'system.run_shell_command',
    inputSchema: z.strictObject({ command: z.string() }),
    policy: { operation: 'run_shell_command', capability: 'shell.command.execute', risk: 'local-privileged', ability: 'shell', confirmation: 'always' },
  }),
]);
