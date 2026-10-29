// What an amount or quantity field keeps of what was typed (owner, 1.5.2, D-085). The browser's
// own number field drops Arabic-Indic digits (١٥٠ became empty) and the Arabic decimal sign
// (12٫5 became 125), so amount fields are text fields that convert as they are typed:
//  - Arabic-Indic (٠–٩) and Persian (۰–۹) digits become 0–9;
//  - the Arabic decimal sign ٫ and a comma become the decimal point;
//  - the Arabic thousands sign ٬ and spaces are dropped;
//  - anything else that cannot be part of a number is dropped: digits, one point and a leading
//    minus remain, so a value is never silently read as another number.
const ARABIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'

export function toLatinNumber(raw) {
  let s = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/[٬\s]/g, '')
  const negative = s.trimStart().startsWith('-')
  s = s.replace(/[^0-9.]/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  return (negative ? '-' : '') + s
}
