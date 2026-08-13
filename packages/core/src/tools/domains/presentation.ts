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
      widget: z.enum([
        'clock', 'system', 'network', 'map', 'suit', 'music', 'text', 'pdf', 'image', 'terminal',
        'agenda', 'todo', 'stocks', 'headlines', 'timer', 'weather-radar', 'camera-feed', 'transcript', 'uptime', 'orbit', 'calculator',
      ]).optional(),
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
      page: z.enum([
        'home', 'news', 'calendar', 'home-assistant', '3d-printers', 'music',
        'spiderman', 'manufacturing', 'webshooter', 'onewheel', 'social', 'audio-test', 'round-display',
      ]),
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
      widget_type: z.enum([
        'tv', 'printer', 'weather-home', 'weather-radar', 'agenda', 'todo', 'stocks', 'headlines',
        'timer', 'camera-feed', 'transcript', 'uptime', 'orbit', 'calculator', 'ha-device', 'ha-toggle',
      ]),
      title: z.string().optional(),
      printer_name: z.string().optional(),
      domain: z.string().optional(),
      entity_ids: z.array(z.string()).optional(),
      name_filter: z.string().optional(),
      label: z.string().optional(),
      symbols: z.string().optional(),
      hosts: z.string().optional(),
    }),
    policy: { operation: 'add_home_widget', capability: 'ui.home-widget.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.fullscreen',
    inputSchema: z.strictObject({ action: z.enum(['enter', 'exit', 'toggle']) }),
    policy: { operation: 'fullscreen', capability: 'ui.fullscreen.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.open_3d_model',
    inputSchema: z.strictObject({
      model_name: z.string(),
      display_name: z.string().optional(),
    }),
    policy: { operation: 'open_3d_model', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.lock_interface',
    inputSchema: z.strictObject({}),
    policy: { operation: 'lock_interface', capability: 'ui.lock.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.set_timer',
    inputSchema: z.strictObject({
      action: z.enum(['start', 'cancel', 'list']),
      minutes: z.number().optional(),
      label: z.string().optional(),
    }),
    policy: { operation: 'set_timer', capability: 'time.timer.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.set_reminder',
    inputSchema: z.strictObject({
      action: z.enum(['add', 'cancel', 'list']),
      text: z.string().optional(),
      in_minutes: z.number().optional(),
      time: z.string().optional(),
      date: z.string().optional(),
    }),
    policy: { operation: 'set_reminder', capability: 'time.reminder.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.hud_layout',
    inputSchema: z.strictObject({
      action: z.enum(['save', 'load', 'delete', 'list']),
      name: z.string().optional(),
    }),
    policy: { operation: 'hud_layout', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.briefing',
    inputSchema: z.strictObject({}),
    policy: { operation: 'briefing', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.set_theme',
    inputSchema: z.strictObject({
      theme: z.enum(['arc-reactor', 'midnight', 'crimson', 'matrix', 'custom']),
    }),
    policy: { operation: 'set_theme', capability: 'ui.theme.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.ambient_mode',
    inputSchema: z.strictObject({ action: z.enum(['enter', 'exit']) }),
    policy: { operation: 'ambient_mode', capability: 'ui.ambient.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.remember',
    inputSchema: z.strictObject({
      text: z.string(),
      category: z.enum(['identity', 'preference', 'home', 'hardware', 'project', 'routine', 'contact', 'general']).optional(),
      importance: z.number().optional(),
    }),
    policy: { operation: 'remember', capability: 'memory.longterm.write', risk: 'local-reversible', ability: 'memory', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.recall',
    inputSchema: z.strictObject({
      query: z.string(),
      limit: z.number().optional(),
    }),
    policy: { operation: 'recall', capability: 'memory.longterm.read', risk: 'read-private', ability: 'memory', confirmation: 'never' },
  }),
  defineStaticTool({
    handlerId: 'presentation.forget',
    inputSchema: z.strictObject({ query: z.string() }),
    policy: { operation: 'forget', capability: 'memory.longterm.delete', risk: 'local-reversible', ability: 'memory', confirmation: 'never' },
  }),
]);
