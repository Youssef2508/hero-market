// Immediate hints while a new password is typed. The service applies the full rules and its
// message is shown if it refuses. Which rule applies is the service's decision too (D-113): the
// strong one – length, at least 4 different characters, no plain runs, common passwords, the
// username – for whoever may sign in through the internet; for whoever signs in only at the shop,
// any password that is not empty. Any characters are allowed (USER-01).
export const MIN_PASSWORD = 8

/** Arabic hint for a new password and its confirmation, or '' when nothing is wrong yet. */
export function passwordHint(password, confirm, policy = 'strong') {
  if (!password) return ''
  if (policy !== 'simple') {
    if (password.length < MIN_PASSWORD) return `${MIN_PASSWORD} أحرف على الأقل.`
    if (new Set([...password]).size < 4) return 'يجب أن تحتوي على 4 رموز مختلفة على الأقل.'
  } else if (!password.trim()) return 'اكتب كلمة المرور.'
  if (confirm !== undefined && confirm !== '' && confirm !== password)
    return 'تأكيد كلمة المرور غير مطابق.'
  return ''
}

/** What the rule asks for, shown under the field while nothing is wrong. */
export const policyText = (policy) =>
  policy === 'simple'
    ? 'أي كلمة مرور غير فارغة (أرقام أو حروف أو الاثنان). يحتاج الدخول عبر الإنترنت كلمة مرور قوية.'
    : '8 رموز على الأقل (حروف أو أرقام أو علامات)، ولا تحتوي على اسم المستخدم.'

/** True when the pair can be sent to the service. */
export const passwordReady = (password, confirm, policy = 'strong') =>
  !!password && password === confirm && passwordHint(password, confirm, policy) === ''
