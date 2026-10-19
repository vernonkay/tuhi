# Security Policy

## Supported versions

tuhi is pre-1.0. Security fixes land on the latest release line only (currently
`0.1.x`).

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue. Use GitHub's
private vulnerability reporting: go to the repository's **Security** tab →
**Report a vulnerability**. That opens a confidential channel with the maintainer.

Please include what you found, how to reproduce it, and the impact as you see it.
You will get an acknowledgement, and a fix or an explanation once it has been assessed.

## Threat model note

tuhi opens arbitrary, untrusted files (that is its job), so parsing, encoding
detection and the large-file engine are the areas that most warrant scrutiny. File
content is rendered as text, never evaluated, and the web-view runs under a restrictive
Content-Security-Policy. Reports in these areas are especially welcome.
