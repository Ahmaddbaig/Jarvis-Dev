import { randomId } from './crypto';
import {
  capabilityGrantInputSchema,
  capabilityGrantSchema,
  type Capability,
  type CapabilityGrant,
  type CapabilityGrantInput,
  type CommandEnvelope,
} from '@jarvis/contracts';
import type { Clock, GrantIssueContext } from './types';

const systemClock: Clock = { now: () => Date.now() };

export class CapabilityGrantStore {
  readonly #clock: Clock;
  readonly #grants = new Map<string, CapabilityGrant>();

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  grant(input: CapabilityGrantInput, context: GrantIssueContext): CapabilityGrant {
    if (context.source !== 'user' || !context.userGesture) {
      throw new Error('Capability grants can be issued only from an explicit user gesture.');
    }
    const parsed = capabilityGrantInputSchema.parse(input);
    const grant = Object.freeze(capabilityGrantSchema.parse({ ...parsed, grantId: `grant:${randomId()}` }));
    this.#grants.set(grant.grantId, grant);
    return grant;
  }

  revoke(grantId: string): boolean {
    return this.#grants.delete(grantId);
  }

  /**
   * Drop every grant. Callers that derive grants from user settings rebuild
   * the whole set on change, so that disabling a tool revokes it at once
   * rather than leaving a stale grant behind.
   */
  revokeAll(): void {
    this.#grants.clear();
  }

  allows(command: CommandEnvelope, capability: Capability): boolean {
    const now = this.#clock.now();
    for (const [grantId, grant] of this.#grants) {
      if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) {
        this.#grants.delete(grantId);
        continue;
      }
      if (grant.actorId !== command.actor.id || grant.capability !== capability) continue;
      if (grant.targetType && grant.targetType !== command.target.type) continue;
      if (grant.targetId && grant.targetId !== command.target.id) continue;
      return true;
    }
    return false;
  }
}
