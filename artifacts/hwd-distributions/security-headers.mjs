export function securityHeaders(development = false) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self'${development ? " 'unsafe-inline'" : ""}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      `connect-src 'self' https://storage.googleapis.com${development ? " ws: wss:" : ""}`,
      "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
