# oteltrace

A lightweight OpenTelemetry tracing wrapper for Node.js services. Wraps the
`@opentelemetry/api` tracer with a per-request span store, automatic
flattening of nested attributes, and built-in masking of sensitive headers
(`authorization`, `x-api-key`, `cookie`).

## Install

```bash
npm install oteltrace
```

## Usage

### 1. Bootstrap the SDK

The SDK must start **before** any application code that uses tracing. Create
a separate file (e.g. `instrumentation.js`) and load it with Node's
`--import` flag.

```js
// instrumentation.js
import { start } from 'oteltrace/instrumentation';
import config from './oteltrace.config.js';

start(config);
```

```js
// oteltrace.config.js
export default {
  serviceName: 'my-service',
  traceExporterUrl: 'http://localhost:4318/v1/traces',
  headers: {},
};
```

```bash
node --import ./instrumentation.js ./server.js
```

#### Config options

| Option              | Type                     | Required | Default                              |
| ------------------- | ------------------------ | -------- | ------------------------------------ |
| `serviceName`       | `string`                 | yes      | —                                    |
| `traceExporterUrl`  | `string`                 | no       | `http://localhost:4318/v1/traces`    |
| `headers`           | `Record<string, string>` | no       | `{}`                                 |
| `extractRequest`    | `(req) => NormalizedReq` | no       | duck-typed (Fastify + Express)       |

##### `extractRequest`

Maps your framework's request object to the shape oteltrace consumes.
The default handles Fastify and Express out of the box; provide your own
for Koa, raw `http`, or unusual request shapes.

```ts
type NormalizedReq = {
  id: string | number;       // required — keys spans per request
  url?: string;
  method?: string;
  path?: string;              // route pattern, e.g. '/users/:id'
  headers?: Record<string, string>;
  params?: object;
  body?: object;
  query?: object;
};
```

Example for Koa:

```js
start({
  serviceName: 'my-service',
  extractRequest: (ctx) => ({
    id: ctx.state.reqId,
    url: ctx.request.url,
    method: ctx.request.method,
    path: ctx._matchedRoute,
    headers: ctx.request.headers,
    params: ctx.params,
    body: ctx.request.body,
    query: ctx.query,
  }),
});
```

### 2. Create and use spans

```js
import { otelTrace, ROOT } from 'oteltrace';

app.post('/orders', async (req, reply) => {
  const root = otelTrace.openSpan(req, 'POST /orders');

  const validate = otelTrace.openSpan(req, 'validate', ROOT);
  validate.setTag({ payloadSize: JSON.stringify(req.body).length });
  validate.endSpan();

  const persist = otelTrace.openSpan(req, 'persist', ROOT);
  persist.addEventLog('db.write', { table: 'orders' });
  persist.endSpan();

  reply.send({ ok: true });
  otelTrace.endAllSpans(req);
});
```

The store keys spans by `req.id`, so each request gets its own span tree.
Call `endAllSpans(req)` once the request finishes to flush them.

## API

### `start(config)` / `shutdown()`
From `oteltrace/instrumentation`. Boots and tears down the OpenTelemetry
NodeSDK with an OTLP/HTTP trace exporter.

### `otelTrace.openSpan(req, name, parent?)`
Starts a span keyed by the id returned from `extractRequest(req)`.
If `parent` is a string, the new span is created as a child of the
previously started span with that name. Pass the exported `ROOT`
sentinel to attach to the first span opened on the same request.

When the new span is the request's first span, it is automatically
annotated with `url`, `path`, `method`, `headers`, `params`, `body`,
and `query` (whichever fields the extractor returned) — nested values
are flattened and sensitive headers are masked.

### `ROOT`
A `Symbol` exported from `oteltrace`, used as the `parent` argument to
`openSpan` to attach a child to the request's first-opened span without
having to remember its name. Resolution is by Map insertion order — no
framework-specific name lookup. Using a Symbol means it can never
collide with an actual span name.

### Returned span handle
```ts
{
  setTag(attrs): { addEventLog, endSpan }
  addEventLog(name, attrs): { endSpan }
  endSpan(): void
}
```

String values that parse as JSON objects are flattened into dot-separated
keys (`body.user.id` rather than a nested object), since OpenTelemetry span
attributes only accept primitives.

### `otelTrace.endAllSpans(req)`
Ends every span associated with `req.id` and removes the request from the
store. Call this in your response/error hook.

## Header masking

Headers whose names match (case-insensitively) any of `authorization`,
`x-api-key`, or `cookie` are replaced with `*****` before being recorded.
Masking happens on a copy — your original request object is not mutated.

## Requirements

- Node.js >= 18
- An OTLP/HTTP-compatible collector (e.g. the OpenTelemetry Collector,
  Jaeger, Tempo, etc.) reachable at `traceExporterUrl`.

## License

MIT
