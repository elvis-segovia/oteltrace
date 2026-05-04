/* instrumentation.js */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { otelTrace } from './index.js';

let sdk;

/**
 * Start the OpenTelemetry SDK.
 * @param {object} config
 * @param {string} config.serviceName              service.name resource attribute (required)
 * @param {string} [config.traceExporterUrl]      OTLP/HTTP traces endpoint (default http://localhost:4318/v1/traces)
 * @param {Record<string,string>} [config.headers] custom headers sent with each export
 * @param {(req: any) => { id: any, url?, method?, path?, headers?, params?, body?, query? }} [config.extractRequest]
 *        Maps a framework request object to the shape oteltrace consumes.
 *        Defaults to a duck-typed extractor that handles Fastify and Express.
 * @returns {NodeSDK}
 */
export function start(config = {}) {
    const { serviceName, traceExporterUrl, headers = {}, extractRequest } = config;

    if (!serviceName) {
        throw new Error('oteltrace: config.serviceName is required');
    }

    otelTrace.configure({ extractRequest });

    sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({
            url: traceExporterUrl,
            headers,
        }),
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
        }),
    });

    sdk.start();
    return sdk;
}

/** Flush and shut down the SDK. */
export function shutdown() {
    return sdk?.shutdown();
}
