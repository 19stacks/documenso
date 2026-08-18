import { IS_BILLING_ENABLED } from '../constants/app';
import type { TClaimFlags } from '../types/subscription';

/**
 * Resolve whether "Powered by" branding should be hidden for an organisation.
 *
 * Defaults to hiding the branding when billing is disabled, unless the
 * organisation claim explicitly opts in or out via `hidePoweredBy`.
 */
export const resolveHidePoweredBy = (flags?: TClaimFlags | null): boolean => {
  return flags?.hidePoweredBy ?? !IS_BILLING_ENABLED();
};
