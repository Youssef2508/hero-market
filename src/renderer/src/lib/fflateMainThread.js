// fflate on the page's own thread (1.6.3). The Excel libraries (read-excel-file, write-excel-file)
// import 'fflate'; the screens' builds resolve that name to this file (electron.vite.config.mjs,
// vite.web.config.mjs).
//
// fflate's asynchronous unzip() and zip() hand every part of a file larger than 512 KB to a Worker
// made from a blob: URL. The app's Content-Security-Policy (script-src 'self', G-15) refuses that
// worker, and fflate sets no error handler on it: the callback never comes, and reading an Excel
// file of about a thousand products or more waited for ever, with nothing on the screen. Here the
// same two functions use fflate's synchronous versions – a few tens of milliseconds for a file of
// 5,000 products – so no worker is ever made and the policy stays as it is.
import { unzipSync, zipSync } from 'fflate/browser'

export * from 'fflate/browser'

const answer = (cb, run) => {
  let result
  try {
    result = [null, run()]
  } catch (e) {
    result = [e, null]
  }
  // Called back later, as the asynchronous versions do.
  setTimeout(() => cb(...result), 0)
  return () => {}
}

export function unzip(data, opts, cb) {
  if (typeof opts === 'function') [cb, opts] = [opts, {}]
  return answer(cb, () => unzipSync(data, opts))
}

export function zip(data, opts, cb) {
  if (typeof opts === 'function') [cb, opts] = [opts, {}]
  return answer(cb, () => zipSync(data, opts))
}
