# `@jarvis/contracts`

Browser-safe runtime schemas and derived TypeScript types for Jarvis process and network boundaries.

This package has no import-time side effects and must not import React, Next.js, Electron, Node filesystem/process APIs, database drivers, or vendor SDK payloads. Consumers parse untrusted values with the exported schemas before converting them into use-case or adapter calls.

Protocol version `1` defines the initial standard command/result envelope. Marketing application versions do not change the protocol automatically.
