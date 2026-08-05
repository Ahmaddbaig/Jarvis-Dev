import type { CapabilityDefinition } from '@jarvis/contracts';
import { CapabilityCatalog } from '../policy/catalog';

const definitions = [
  { operation: 'get_date', capability: 'information.date.read', risk: 'read-public', ability: 'information', confirmation: 'never' },
  { operation: 'get_time', capability: 'information.time.read', risk: 'read-public', ability: 'information', confirmation: 'never' },
  { operation: 'get_location', capability: 'device.location.read', risk: 'read-private', ability: 'device', confirmation: 'when-model' },
  { operation: 'get_battery_level', capability: 'device.battery.read', risk: 'read-private', ability: 'device', confirmation: 'never' },
  { operation: 'computer_use', capability: 'computer.local.control', risk: 'local-privileged', ability: 'computer-use', confirmation: 'always' },
  { operation: 'companion_control', capability: 'computer.remote.control', risk: 'remote-control', ability: 'companions', confirmation: 'always' },
  { operation: 'deskflow_control', capability: 'computer.remote.switch', risk: 'remote-control', ability: 'deskflow', confirmation: 'always' },
  { operation: 'xray', capability: 'camera.private.capture', risk: 'read-private', ability: 'xray', confirmation: 'when-model' },
  { operation: 'image_generation', capability: 'provider.image.generate', risk: 'external-side-effect', ability: 'image-generation', confirmation: 'always' },
  { operation: '3d_printing', capability: 'printer.job.create', risk: 'external-side-effect', ability: 'printers', confirmation: 'always' },
  { operation: 'run_shell_command', capability: 'shell.command.execute', risk: 'local-privileged', ability: 'shell', confirmation: 'always' },
  { operation: 'web_search', capability: 'search.public.read', risk: 'read-public', ability: 'web-search', confirmation: 'never' },
  { operation: 'chrome_control', capability: 'browser.site.control', risk: 'external-side-effect', ability: 'chrome', confirmation: 'always' },
  { operation: 'take_photo', capability: 'camera.private.capture', risk: 'read-private', ability: 'camera', confirmation: 'when-model' },
  { operation: 'play_spotify', capability: 'media.playback.control', risk: 'local-reversible', ability: 'music', confirmation: 'never' },
  { operation: 'control_music', capability: 'media.playback.control', risk: 'local-reversible', ability: 'music', confirmation: 'never' },
  { operation: 'get_now_playing', capability: 'media.playback.read', risk: 'read-private', ability: 'music', confirmation: 'never' },
  { operation: 'show_hud_text', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'control_hud', capability: 'ui.hud.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'open_url', capability: 'url.external.open', risk: 'local-reversible', ability: 'open-url', confirmation: 'when-model' },
  { operation: 'open_pdf', capability: 'file.pdf.read', risk: 'read-private', ability: 'files', confirmation: 'when-model' },
  { operation: 'find_datasheet', capability: 'search.datasheet.read', risk: 'read-public', ability: 'datasheets', confirmation: 'never' },
  { operation: 'desktop_mode', capability: 'ui.desktop-mode.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'jarvis_disconnect', capability: 'voice.session.control', risk: 'local-reversible', ability: 'voice', confirmation: 'never' },
  { operation: 'navigate_to_page', capability: 'ui.navigation.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'map_command', capability: 'maps.ui.control', risk: 'local-reversible', ability: 'maps', confirmation: 'never' },
  { operation: 'calendar_command', capability: 'calendar.event.manage', risk: 'external-side-effect', ability: 'calendar', confirmation: 'always' },
  { operation: 'home_assistant_command', capability: 'home.device.control', risk: 'external-side-effect', ability: 'home-assistant', confirmation: 'always' },
  { operation: 'printer_command', capability: 'printer.device.control', risk: 'external-side-effect', ability: 'printers', confirmation: 'always' },
  { operation: 'add_home_widget', capability: 'ui.home-widget.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
  { operation: 'fullscreen', capability: 'ui.fullscreen.control', risk: 'local-reversible', ability: 'interface', confirmation: 'never' },
] satisfies readonly CapabilityDefinition[];

export const STATIC_TOOL_DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze(
  definitions.map((definition) => Object.freeze(definition)),
);

export function createStaticToolCatalog(): CapabilityCatalog {
  return new CapabilityCatalog(STATIC_TOOL_DEFINITIONS);
}
