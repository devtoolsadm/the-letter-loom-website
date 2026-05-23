const host = window.location.hostname
const href = window.location.href

export const IS_LOCAL   = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
                          host === '0.0.0.0'   || host.endsWith('.local') ||
                          /^10\./.test(host)   || /^192\.168\./.test(host) ||
                          (() => { const m = host.match(/^172\.(\d+)\./); return m && Number(m[1]) >= 16 && Number(m[1]) <= 31 })()

export const IS_PREVIEW = !IS_LOCAL && (/preview/i.test(host) || /preview/i.test(href))

export const IS_PROD    = !IS_LOCAL && !IS_PREVIEW
