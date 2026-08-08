import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const SMART_ENVIRONMENT_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'smart_environment.3d_printing',
    inputSchema: z.strictObject({ description: z.string() }),
    policy: { operation: '3d_printing', capability: 'printer.job.create', risk: 'external-side-effect', ability: 'printers', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'smart_environment.calendar_command',
    inputSchema: z.strictObject({
      command: z.enum(['add_task', 'complete_task', 'delete_event', 'list_tasks', 'clear_tasks', 'go_to_date', 'get_upcoming']),
      date: z.string().optional(),
      text: z.string().optional(),
      time: z.string().optional(),
    }),
    policy: { operation: 'calendar_command', capability: 'calendar.event.manage', risk: 'external-side-effect', ability: 'calendar', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'smart_environment.home_assistant_command',
    inputSchema: z.strictObject({
      command: z.enum(['turn_on', 'turn_off', 'toggle', 'set_brightness', 'set_temperature', 'select_source', 'list_devices']),
      entity_id: z.string().optional(),
      friendly_name: z.string().optional(),
      brightness: z.number().optional(),
      temperature: z.number().optional(),
      source: z.string().optional(),
      domain: z.string().optional(),
    }),
    policy: { operation: 'home_assistant_command', capability: 'home.device.control', risk: 'external-side-effect', ability: 'home-assistant', confirmation: 'always' },
  }),
  defineStaticTool({
    handlerId: 'smart_environment.printer_command',
    inputSchema: z.strictObject({
      command: z.enum(['status', 'pause', 'resume', 'stop']),
      printer_name: z.string().optional(),
    }),
    policy: { operation: 'printer_command', capability: 'printer.device.control', risk: 'external-side-effect', ability: 'printers', confirmation: 'always' },
  }),
]);
