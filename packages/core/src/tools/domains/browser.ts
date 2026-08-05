import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const BROWSER_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'browser.chrome_control',
    inputSchema: z.strictObject({
      action: z.enum(['status', 'list_tabs', 'search', 'open_tab', 'switch_tab', 'close_tab', 'navigate', 'back', 'forward', 'reload', 'read_page', 'screenshot', 'click', 'type', 'press_key', 'scroll', 'find', 'get_selected_text']),
      query: z.string().optional(),
      url: z.string().optional(),
      tabId: z.number().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      replace: z.boolean().optional(),
      key: z.string().optional(),
      shift: z.boolean().optional(),
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
      amount: z.number().optional(),
    }),
    policy: { operation: 'chrome_control', capability: 'browser.site.control', risk: 'external-side-effect', ability: 'chrome', confirmation: 'always' },
  }),
]);
