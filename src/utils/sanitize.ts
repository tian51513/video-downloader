/**
 * 检测文本是否为乱码或无意义的 ID
 */
export function isGarbled(text: string): boolean {
  if (!text || text.trim().length === 0) return true
  if (/^\d{4,}$/.test(text)) return true
  if (/^[0-9a-f]{16,}$/i.test(text)) return true
  const encodedRatio =
    (text.match(/%[0-9a-f]{2}/gi) || []).length / text.length
  if (encodedRatio > 0.3) return true
  const garbledRatio =
    (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length /
    text.length
  if (garbledRatio > 0.2) return true
  return false
}

const HTML_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014',
  amp: '&', lt: '<', gt: '>', nbsp: '\u00a0',
}

function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(\w+);/g, (_m, entity) => {
    if (entity in HTML_ENTITIES) return HTML_ENTITIES[entity]
    if (entity[0] === '#') {
      const code = entity.charAt(1) === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10)
      if (!isNaN(code) && code > 0) return String.fromCodePoint(code)
    }
    return _m[0]
  })
}

export function sanitizeName(raw: string): string {
  return raw
    .trim()
    .replace(/&(\w+);/g, (_m, entity) => {
      if (entity in HTML_ENTITIES) return HTML_ENTITIES[entity]
      if (entity[0] === '#') {
        const code = entity.charAt(1) === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
        if (!isNaN(code) && code > 0) return String.fromCodePoint(code)
      }
      return _m[0]
    })
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .substring(0, 200)
}

export function buildFileName(
  template: string,
  vars: Record<string, string>
): string {
  let name = template
  for (const [key, value] of Object.entries(vars)) {
    name = name.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return sanitizeName(name)
}
