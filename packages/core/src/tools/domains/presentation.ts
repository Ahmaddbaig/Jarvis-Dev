import { z } from 'zod';
import { defineStaticTool } from '../declaration';

export const PRESENTATION_TOOLS = Object.freeze([
  defineStaticTool({
    handlerId: 'presentation.show_hud_text',
    inputSchema: z.strictObject({ content: z.string(), title: z.string().optional() }),
    policy: { operation: 'show_hud_text', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.control_hud',
    inputSchema: z.strictObject({
      command: z.enum(['open', 'close', 'clear', 'reset']),
      widget: z.enum(['clock', 'system', 'network', 'map', 'suit', 'music', 'text', 'pdf', 'image', 'terminal']).optional(),
      text_content: z.string().optional(),
      pdf_source: z.string().optional(),
      title: z.string().optional(),
    }),
    policy: { operation: 'control_hud', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.open_url',
    inputSchema: z.strictObject({ url: z.string() }),
    policy: { operation: 'open_url', capability: 'url.external.open', risk: 'local-reversible', ability: 'open-url', confirmation: 'when-model' },
  }),
  defineStaticTool({
    handlerId: 'presentation.open_pdf',
    inputSchema: z.strictObject({ source: z.string(), title: z.string().optional() }),
    policy: { operation: 'open_pdf', capability: 'file.pdf.read', risk: 'read-private', ability: 'files', confirmation: 'when-model' },
  }),
  defineStaticTool({
    handlerId: 'presentation.desktop_mode',
    inputSchema: z.strictObject({
      action: z.enum(['enable', 'disable', 'move']),
      position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
    }),
    policy: { operation: 'desktop_mode', capability: 'ui.desktop-mode.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.jarvis_disconnect',
    inputSchema: z.strictObject({}),
    policy: { operation: 'jarvis_disconnect', capability: 'voice.session.control', risk: 'local-reversible', ability: 'voice', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.navigate_to_page',
    inputSchema: z.strictObject({
      page: z.enum(['home', 'news', 'calendar', 'home-assistant', '3d-printers', 'music']),
    }),
    policy: { operation: 'navigate_to_page', capability: 'ui.navigation.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.map_command',
    inputSchema: z.strictObject({
      command: z.enum(['fly_to', 'fly_to_coordinates', 'add_marker', 'show_user_location', 'draw_route', 'clear_markers', 'search_nearby']),
      location: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      zoom: z.number().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      query: z.string().optional(),
    }),
    policy: { operation: 'map_command', capability: 'maps.ui.control', risk: 'local-reversible', ability: 'maps', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.add_home_widget',
    inputSchema: z.strictObject({
      action: z.enum(['add', 'remove']),
      widget_type: z.enum(['tv', 'printer', 'weather-home', 'ha-device', 'ha-toggle']),
      title: z.string().optional(),
      printer_name: z.string().optional(),
      domain: z.string().optional(),
      entity_ids: z.array(z.string()).optional(),
      name_filter: z.string().optional(),
      label: z.string().optional(),
    }),
    policy: { operation: 'add_home_widget', capability: 'ui.home-widget.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.fullscreen',
    inputSchema: z.strictObject({ action: z.enum(['enter', 'exit', 'toggle']) }),
    policy: { operation: 'fullscreen', capability: 'ui.fullscreen.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
]);
