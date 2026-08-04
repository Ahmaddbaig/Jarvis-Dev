import OpenAI from 'openai';
import type {
  ComputerAction,
  ResponseComputerToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import { runCompanionCommand } from './client';
import type { CompanionDevice } from './types';

const MODEL = 'gpt-5.4';
const MAX_TURNS = 30;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function companionAction(action: ComputerAction): Record<string, unknown> | null {
  switch (action.type) {
    case 'screenshot':
    case 'wait':
      return null;
    case 'click':
      return {
        type: 'click',
        x: action.x,
        y: action.y,
        button: ['left', 'right'].includes(action.button) ? action.button : 'left',
      };
    case 'double_click':
      return { type: 'double_click', x: action.x, y: action.y, button: 'left' };
    case 'drag':
      return { type: 'drag', path: action.path };
    case 'keypress':
      return { type: 'keypress', keys: action.keys };
    case 'move':
      return { type: 'move', x: action.x, y: action.y };
    case 'scroll':
      return {
        type: 'scroll',
        x: action.x,
        y: action.y,
        scrollX: action.scroll_x,
        scrollY: action.scroll_y,
      };
    case 'type':
      return { type: 'type', text: action.text };
  }
}

function finalResponseText(response: { output_text?: string }): string {
  return response.output_text?.trim() || 'Task completed.';
}

export async function runRemoteComputerUse(
  task: string,
  apiKey: string,
  device: CompanionDevice
): Promise<{ result: string; turns: number; target: string }> {
  const client = new OpenAI({ apiKey });
  const target = `remote ${device.name}`;
  const status = await runCompanionCommand(device.id, 'status') as {
    platform?: string;
    screen?: { width?: number; height?: number };
  };
  const routedTask = [
    `[Remote target: ${device.name}; operating system: ${status.platform || device.platform}; ` +
      `primary display: ${status.screen?.width || '?'}x${status.screen?.height || '?'}]`,
    task,
  ].join(' ');

  let response = await client.responses.create({
    model: MODEL,
    tools: [{ type: 'computer' }],
    input: routedTask,
  });

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    const computerCall = response.output.find(
      (item): item is ResponseComputerToolCall => item.type === 'computer_call'
    );
    if (!computerCall) {
      return { result: finalResponseText(response), turns: turn, target };
    }

    const actions = computerCall.actions?.length
      ? computerCall.actions
      : computerCall.action
        ? [computerCall.action]
        : [];

    for (const action of actions) {
      if (action.type === 'wait') {
        await wait(1000);
        continue;
      }
      const translated = companionAction(action);
      if (translated) {
        // Each command claims a fresh short lease, so model/network latency can
        // never leave a stale long-running control session behind.
        await runCompanionCommand(device.id, 'input', { actions: [translated] });
      }
    }

    await wait(300);
    const capture = await runCompanionCommand(device.id, 'capture', { screen: 0 }) as {
      mimeType?: string;
      imageBase64?: string;
    };
    if (!capture.imageBase64) throw new Error('Companion returned an empty screenshot.');

    const callOutput: ResponseInputItem.ComputerCallOutput = {
      type: 'computer_call_output',
      call_id: computerCall.call_id,
      output: {
        type: 'computer_screenshot',
        image_url: `data:${capture.mimeType || 'image/jpeg'};base64,${capture.imageBase64}`,
      },
      acknowledged_safety_checks: computerCall.pending_safety_checks,
    };
    response = await client.responses.create({
      model: MODEL,
      tools: [{ type: 'computer' }],
      previous_response_id: response.id,
      input: [callOutput],
    });
  }

  return {
    result: `Reached max turns (${MAX_TURNS}). Task may be incomplete.`,
    turns: MAX_TURNS,
    target,
  };
}
