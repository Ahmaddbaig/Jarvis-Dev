import { z } from 'zod';
import { defineStaticTool } from '../declaration';

const emptyInput = () => z.strictObject({});

export const INFORMATION_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'information.get_date',
    inputSchema: emptyInput(),
    policy: { operation: 'get_date', capability: 'information.date.read', risk: 'read-public', ability: 'information', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'information.get_time',
    inputSchema: emptyInput(),
    policy: { operation: 'get_time', capability: 'information.time.read', risk: 'read-public', ability: 'information', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'information.get_location',
    inputSchema: emptyInput(),
    policy: { operation: 'get_location', capability: 'device.location.read', risk: 'read-private', ability: 'device', confirmation: 'when-model' },
  }),
  defineStaticTool({
    handlerId: 'information.get_battery_level',
    inputSchema: emptyInput(),
    policy: { operation: 'get_battery_level', capability: 'device.battery.read', risk: 'read-private', ability: 'device', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'information.web_search',
    inputSchema: z.strictObject({ query: z.string() }),
    policy: { operation: 'web_search', capability: 'search.public.read', risk: 'read-public', ability: 'web-search', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'information.find_datasheet',
    inputSchema: z.strictObject({ part_name: z.string(), title: z.string().optional() }),
    policy: { operation: 'find_datasheet', capability: 'search.datasheet.read', risk: 'read-public', ability: 'datasheets', confirmation: 'never' },
  }),
]);
