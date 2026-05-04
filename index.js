import { trace, context } from '@opentelemetry/api';
import { flatten } from 'flat';

const tracer = trace.getTracer('oteltrace');

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'cookie']);

/**
 * Sentinel value for `openSpan`'s `parentSpan` argument. When passed,
 * the new span attaches to the first span opened on the same request.
 */
export const ROOT = Symbol('oteltrace.root');

/**
 * Default request extractor. Duck-types Fastify and Express request
 * shapes; falls back to `req.url` for `path` when no router is present.
 * Override via `start({ extractRequest })` for unusual shapes.
 */
export const defaultExtractRequest = (req) => ({
    id: req.id,
    url: req.url,
    method: req.method,
    path: req.routeOptions?.url ?? req.route?.path ?? req.url,
    headers: req.headers,
    params: req.params,
    query: req.query,
});

class OtelTraceStore {
    #requests = new Map();
    #extractRequest = defaultExtractRequest;

    /** Override the request extractor (called by `start()`). */
    configure({ extractRequest } = {}) {
        if (typeof extractRequest === 'function') {
            this.#extractRequest = extractRequest;
        }
    }

    /**
     * Start a span for a request. If `parentSpan` is the `ROOT` sentinel,
     * the new span attaches to the first span opened on this request
     * (resolved by Map insertion order, no name lookup needed).
     * Otherwise `parentSpan` is treated as the name of a previously
     * started span on the same request.
     */
    openSpan(req, spanName, parentSpan) {
        const r = this.#extractRequest(req);
        if (r?.id == null) {
            throw new Error('oteltrace: extractRequest must return a non-null `id`');
        }

        let parent;
        if (parentSpan === ROOT) {
            parent = this.#requests.get(r.id)?.values().next().value;
        } else if (parentSpan) {
            parent = this.#getRawSpan(r.id, parentSpan);
        }

        const span = tracer.startSpan(spanName, {}, trace.setSpan(context.active(), parent));

        this.#setSpan(r.id, span);
        const handle = this.#createHandle(span);

        handle.setTag({ id: r.id });

        if (!parent) {
            handle.setTag({
                url: r.url,
                path: r.path,
                method: r.method,
                headers: r.headers != null ? JSON.stringify(r.headers) : undefined,
                params: r.params != null ? JSON.stringify(r.params) : undefined,
                query: r.query != null ? JSON.stringify(r.query) : undefined,
            });
        }

        return handle;
    }

    /** Look up an existing span handle on a request, or create one if missing. */
    getSpan(req, spanName) {
        const { id } = this.#extractRequest(req);
        const span = this.#getRawSpan(id, spanName);
        return span ? this.#createHandle(span) : this.openSpan(req, spanName);
    }

    /** End every span recorded for the request and remove it from the store. */
    endAllSpans(req) {
        const { id } = this.#extractRequest(req);
        const spans = this.#requests.get(id);
        if (!spans) return;
        for (const span of spans.values()) span.end();
        this.#requests.delete(id);
    }

    #getRawSpan(id, spanName) {
        return this.#requests.get(id)?.get(spanName);
    }

    #setSpan(id, span) {
        let bucket = this.#requests.get(id);
        if (!bucket) {
            bucket = new Map();
            this.#requests.set(id, bucket);
        }
        bucket.set(span.name, span);
    }

    #createHandle(span) {
        const setTag = (options) => {
            const flat = this.#flattenObject(options);
            for (const [key, value] of Object.entries(flat)) {
                span.setAttribute(key, value);
            }
            return { addEventLog, endSpan };
        };
        const addEventLog = (eventName, options = {}) => {
            span.addEvent(eventName, this.#flattenObject(options));
            return { endSpan };
        };
        const endSpan = () => span.end();
        const getTraceId = () => span.spanContext().traceId;
        return { setTag, addEventLog, endSpan, getTraceId };
    }

    #tryParseObject(value) {
        if (typeof value !== 'string') return undefined;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    #flattenObject(obj) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value === undefined) continue;
            const parsed = this.#tryParseObject(value);
            if (parsed === undefined) {
                result[key] = value;
                continue;
            }
            const safe = key === 'headers' ? this.#maskHeaders(parsed) : parsed;
            Object.assign(result, flatten({ [key]: safe }));
        }
        return result;
    }

    #maskHeaders(headers) {
        const masked = {};
        for (const [key, value] of Object.entries(headers)) {
            masked[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '*****' : value;
        }
        return masked;
    }
}

const otelTrace = new OtelTraceStore();

export { otelTrace };
