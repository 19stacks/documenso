import { IS_HIDE_POWERED_BY_ENABLED } from '../constants/app';
import type { TClaimFlags } from '../types/subscription';

/**
 * Resolve whether "Powered by" branding should be hidden for an organisation.
 *
 * Defaults to hiding the branding when `NEXT_PUBLIC_FEATURE_HIDE_POWERED_BY_ENABLED`
 * is set, unless the organisation claim explicitly opts in or out via
 * `hidePoweredBy`.
 */
export const resolveHidePoweredBy = (flags?: TClaimFlags | null): boolean => {
  return flags?.hidePoweredBy ?? IS_HIDE_POWERED_BY_ENABLED();
};
