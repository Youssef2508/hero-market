// Immediate hints while a new password is typed. The service applies the full rules (length,
// letters and digits, common passwords, the username) and its message is shown if it refuses.
export const MIN_PASSWORD = 8

/** Arabic hint for a new password and its confirmation, or '' when nothing is wrong yet. */
export function passwordHint(password, confirm) {
  if (!password) return ''
  if (password.length < MIN_PASSWORD) return `${MIN_PASSWORD} أحرف على الأقل.`
  if (!/\p{L}/u.test(password) || !/[0-9٠-٩]/.test(password))
    return 'يجب أن تحتوي على حروف وأرقام معاً.'
  if (confirm !== undefined && confirm !== '' && confirm !== password)
    return 'تأكيد كلمة المرور غير مطابق.'
  return ''
}

/** True when the pair can be sent to the service. */
export const passwordReady = (password, confirm) =>
  !!password && password === confirm && passwordHint(password, confirm) === ''
