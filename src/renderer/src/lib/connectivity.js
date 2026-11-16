// The shop's connection as the internet screens show it (D-114): its state and its last successful
// contact with the cloud, both from the cloud's own observation – never from when this page loaded,
// signed in or last asked. The page's clock may be wrong or in another time zone: ages are measured
// against the cloud's clock, and times are shown in the store's time zone.

/**
 * The state now, from the cloud's last answer and the time since it arrived.
 *   unknown   – the shop has never been in contact (or the cloud does not say);
 *   offline   – the cloud does not route to the shop (it said so), or the last contact is older
 *               than offlineMs;
 *   delayed   – the last contact is older than healthyMs;
 *   connected – a recent contact.
 * `answer`: link.state / link.watch; `receivedAt`: Date.now() when it arrived; `now`: Date.now().
 */
export function connectivityNow(answer, receivedAt, now) {
  if (!answer || answer.connectivity === 'unpaired') return { state: 'unpaired', ageMs: null }
  if (!answer.lastContactAt) return { state: 'unknown', ageMs: null }
  // The cloud's "now" when it answered, carried forward by the time since: the page's own clock
  // never enters the age.
  const cloudNow = Date.parse(answer.serverTime) + Math.max(0, now - receivedAt)
  const ageMs = Math.max(0, cloudNow - Date.parse(answer.lastContactAt))
  const offlineMs = answer.offlineMs ?? 40000
  const healthyMs = answer.healthyMs ?? 25000
  const state =
    answer.connectivity === 'offline' || ageMs > offlineMs
      ? 'offline'
      : ageMs > healthyMs
        ? 'delayed'
        : 'connected'
  return { state, ageMs }
}

/** Arabic count with the right noun form: ثانية / ثانيتين / 3 ثوانٍ / 11 ثانية. */
function counted(n, [one, two, few, many]) {
  if (n === 1) return one
  if (n === 2) return two
  if (n >= 3 && n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}
const UNITS = [
  [86400, ['يوم', 'يومين', 'أيام', 'يوماً']],
  [3600, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']],
  [60, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة']],
  [1, ['ثانية', 'ثانيتين', 'ثوانٍ', 'ثانية']]
]

/** "منذ 4 ثوانٍ", "منذ دقيقتين", "منذ 3 ساعات"; "الآن" under a second. */
export function sinceText(ageMs) {
  const s = Math.floor((Number(ageMs) || 0) / 1000)
  if (s < 1) return 'الآن'
  const [size, forms] = UNITS.find(([u]) => s >= u)
  return `منذ ${counted(Math.floor(s / size), forms)}`
}

/** The contact's time in the store's time zone: today as "10:45:12 م", another day with its date. */
export function contactTime(iso, timeZone, now = Date.now()) {
  const at = new Date(iso)
  const tz = timeZone || undefined
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  const time = new Intl.DateTimeFormat('ar-EG', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(at)
  if (day(at) === day(new Date(now))) return time
  const date = new Intl.DateTimeFormat('ar-EG', { timeZone: tz, day: 'numeric', month: 'short' })
  return `${date.format(at)} ${time}`
}

/** The strip's sentence for a state. */
export function connectivityText({ state, ageMs }, answer) {
  if (state === 'unpaired') return 'لم يُربط المحل بالسحابة بعد.'
  if (state === 'unknown') return 'لم يتصل المحل بالسحابة بعد.'
  if (state === 'connected') return `متصل الآن — آخر تواصل ${sinceText(ageMs)}`
  if (state === 'delayed') return `الاتصال متأخر — آخر تواصل ${sinceText(ageMs)}`
  return `المحل غير متصل — آخر تواصل ناجح: ${contactTime(answer.lastContactAt, answer.timeZone)}`
}
