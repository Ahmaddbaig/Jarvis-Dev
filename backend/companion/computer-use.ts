import OpenAI from 'openai';
import crypto from 'crypto';
import type {
  ComputerAction,
  ResponseComputerToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import { runCompanionCommand } from './client';
import type { CompanionDevice } from './types';

const MODEL = 'gpt-5.4';
const MAX_TURNS = 30;
const APPROVAL_TTL_MS = 60_000;
const MAX_PENDING_APPROVALS = 50;

type SafetyChecks = NonNullable<ResponseComputerToolCall['pending_safety_checks']>;

interface PendingApproval {
  deviceId: string;
  taskHash: string;
  responseId: string;
  callId: string;
  actions: ComputerAction[];
  safetyChecks: SafetyChecks;
  screen: number;
  turn: number;
  expiresAt: number;
}

export type RemoteComputerUseResult =
  | { result: string; turns: number; target: string }
  | {
      confirmationRequired: true;
      confirmationId: string;
      confirmationMessage: string;
      turns: number;
      target: string;
    };

const pendingApprovals = new Map<string, PendingApproval>();

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

function taskHash(task: string): string {
  return crypto.createHash('sha256').update(task).digest('hex');
}

function cleanupPendingApprovals(): void {
  const now = Date.now();
  for (const [id, pending] of pendingApprovals) {
    if (pending.expiresAt <= now) pendingApprovals.delete(id);
  }
  while (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
    const oldest = pendingApprovals.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingApprovals.delete(oldest);
  }
}

function safetyMessage(checks: SafetyChecks, deviceName: string): string {
  const details = checks
    .map((check) => {
      const value = check as unknown as { message?: unknown; code?: unknown; id?: unknown };
      return [value.message, value.code, value.id].find((item) => typeof item === 'string') as string | undefined;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
  return [
    `Jarvis wants to perform a potentially consequential action on ${deviceName}.`,
    ...details.map((detail) => `• ${detail}`),
    'Approve only if this matches what you asked Jarvis to do.',
  ].join('\n');
}

async function executeActions(device: CompanionDevice, actions: ComputerAction[], screen: number): Promise<void> {
  for (const action of actions) {
    if (action.type === 'wait') {
      await wait(1000);
      continue;
    }
    const translated = companionAction(action);
    if (translated) {
      // Each command claims a fresh short lease, so model/network latency can
      // never leave a stale long-running control session behind.
      await runCompanionCommand(device.id, 'input', { actions: [translated], screen });
    }
  }
}

async function continueAfterActions(
  client: OpenAI,
  device: CompanionDevice,
  responseId: string,
  callId: string,
  acknowledgedSafetyChecks: SafetyChecks,
  screen: number
) {
  await wait(300);
  const capture = await runCompanionCommand(device.id, 'capture', { screen }) as {
    mimeType?: string;
    imageBase64?: string;
  };
  if (!capture.imageBase64) throw new Error('Companion returned an empty screenshot.');

  const callOutput: ResponseInputItem.ComputerCallOutput = {
    type: 'computer_call_output',
    call_id: callId,
    output: {
      type: 'computer_screenshot',
      image_url: `data:${capture.mimeType || 'image/jpeg'};base64,${capture.imageBase64}`,
    },
    acknowledged_safety_checks: acknowledgedSafetyChecks,
  };
  return client.responses.create({
    model: MODEL,
    tools: [{ type: 'computer' }],
    previous_response_id: responseId,
    input: [callOutput],
  });
}

export async function runRemoteComputerUse(
  task: string,
  apiKey: string,
  device: CompanionDevice,
  approval: { confirmationId?: string; confirmed?: boolean; screen?: number } = {}
): Promise<RemoteComputerUseResult> {
  const client = new OpenAI({ apiKey });
  const target = `remote ${device.name}`;
  const status = await runCompanionCommand(device.id, 'status') as {
    platform?: string;
    screen?: { width?: number; height?: number };
    displays?: Array<{ width?: number; height?: number; name?: string; jarvisScreen?: number }>;
  };
  const screen = Number.isInteger(approval.screen) && Number(approval.screen) >= 0 ? Number(approval.screen) : 0;
  const selectedDisplay = status.displays?.find((display) => display.jarvisScreen === screen) ||
    (screen === 0 ? status.displays?.[0] : undefined);
  const routedTask = [
    `[Remote target: ${device.name}; operating system: ${status.platform || device.platform}; ` +
      `display ${screen}: ${selectedDisplay?.width || status.screen?.width || '?'}x${selectedDisplay?.height || status.screen?.height || '?'}]`,
    task,
  ].join(' ');

  let response;
  let firstTurn = 1;
  if (approval.confirmationId) {
    cleanupPendingApprovals();
    const pending = pendingApprovals.get(approval.confirmationId);
    // Consume before executing so retries cannot replay an approved side effect.
    pendingApprovals.delete(approval.confirmationId);
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new Error('That Computer Use approval expired. Ask Jarvis to try the task again.');
    }
    if (approval.confirmed !== true) throw new Error('Computer Use approval was not granted.');
    if (pending.deviceId !== device.id || pending.taskHash !== taskHash(task) || pending.screen !== screen) {
      throw new Error('The approved Computer Use action no longer matches this task or computer.');
    }
    await executeActions(device, pending.actions, screen);
    response = await continueAfterActions(
      client,
      device,
      pending.responseId,
      pending.callId,
      pending.safetyChecks,
      screen
    );
    firstTurn = pending.turn + 1;
  } else {
    response = await client.responses.create({
      model: MODEL,
      tools: [{ type: 'computer' }],
      input: routedTask,
    });
  }

  for (let turn = firstTurn; turn <= MAX_TURNS; turn += 1) {
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
    const safetyChecks = computerCall.pending_safety_checks || [];
    if (safetyChecks.length > 0) {
      cleanupPendingApprovals();
      const confirmationId = crypto.randomUUID();
      pendingApprovals.set(confirmationId, {
        deviceId: device.id,
        taskHash: taskHash(task),
        responseId: response.id,
        callId: computerCall.call_id,
        actions,
        safetyChecks,
        screen,
        turn,
        expiresAt: Date.now() + APPROVAL_TTL_MS,
      });
      return {
        confirmationRequired: true,
        confirmationId,
        confirmationMessage: safetyMessage(safetyChecks, device.name),
        turns: turn,
        target,
      };
    }

    await executeActions(device, actions, screen);
    response = await continueAfterActions(client, device, response.id, computerCall.call_id, [], screen);
  }

  return {
    result: `Reached max turns (${MAX_TURNS}). Task may be incomplete.`,
    turns: MAX_TURNS,
    target,
  };
}
