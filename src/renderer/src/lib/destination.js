import { can } from './api'

/**
 * Where a payment is recorded (owner feedback EXP-03 / CUST-02): the user's open shift drawer or,
 * for treasury managers, the treasury. 'treasury' or 'shift' when there is only one possibility;
 * null when the user must choose (both possible): the service refuses a guess.
 */
export function fixedDestination(currentUser, currentShift) {
  const canTreasury = can(currentUser, 'treasury.manage')
  const hasShift = !!(currentShift && currentShift.status === 'open')
  if (!canTreasury) return 'shift'
  return hasShift ? null : 'treasury'
}
