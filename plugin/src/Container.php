<?php
declare(strict_types=1);

namespace Joist;

use Joist\Audit\AuditLogger;
use Joist\Cache\CacheFlusher;
use Joist\Concurrency\LockManager;
use Joist\Concurrency\OperatingMode;
use Joist\Concurrency\SessionTracker;
use Joist\Core\Hasher;
use Joist\Core\IDGenerator;
use Joist\Elementor\AtomicDocumentWriter;
use Joist\Elementor\AtomicSchemaProbe;
use Joist\Elementor\ContainerModeAdapter;
use Joist\Elementor\CSSRegenerator;
use Joist\Elementor\CustomCSSBlockManager;
use Joist\Elementor\DocumentWriter;
use Joist\Elementor\DynamicTagValidator;
use Joist\Elementor\GlobalRefPreferrer;
use Joist\Elementor\PatchEngine;
use Joist\Elementor\ResponsiveFiller;
use Joist\Elementor\SchemaValidator;
use Joist\Elementor\WidgetCatalog;
use Joist\Eval\ForbiddenPhraseValidator;
use Joist\Eval\MemoryToolHandler;
use Joist\Eval\PreferenceMemory;
use Joist\Generate\Copy\BatchQueue;
use Joist\Generate\Copy\BrandBlockAssembler;
use Joist\Generate\Copy\CopyCostMeter;
use Joist\Generate\Copy\CopyGenerator;
use Joist\Generate\Image\AssetRouter;
use Joist\Generate\Image\FluxLoraClient;
use Joist\Generate\Image\HttpTransport;
use Joist\Generate\Image\IdeogramClient;
use Joist\Generate\Image\RecraftClient;
use Joist\Host\HostDetector;
use Joist\Plan\PlanExecutor;
use Joist\Plan\PlanStore;
use Joist\Security\PolicyGuard;
use Joist\Security\RateLimiter;
use Joist\Security\URLValidator;
use Joist\Webhooks\WebhookEmitter;
use Joist\Webhooks\WebhookStore;

/**
 * Minimal service factory. No fancy DI container — just lazy singletons.
 */
final class Container
{
    private static array $instances = [];

    public static function get(string $key)
    {
        if (isset(self::$instances[$key])) {
            return self::$instances[$key];
        }
        $obj = self::build($key);
        self::$instances[$key] = $obj;
        return $obj;
    }

    /**
     * Quick existence check used by optional integration paths (e.g. the FLUX
     * client persisting a lora_id only when preferenceMemory is wired up).
     * Returns true if the key is in the registered set. Does NOT instantiate.
     */
    public static function has(string $key): bool
    {
        return in_array($key, self::REGISTERED, true);
    }

    /** List of every key build() knows about. Keep in sync with the match below. */
    public const REGISTERED = [
        'hasher', 'idGen', 'catalog', 'schemaValidator', 'dynamicTags', 'globals',
        'cssBlocks', 'responsiveFiller', 'layoutMode', 'locks', 'opMode', 'sessions',
        'rateLimiter', 'urlValidator', 'policy', 'revisions', 'audit', 'cssRegen',
        'cacheFlusher', 'hostDetector', 'webhookStore', 'webhooks', 'patchEngine',
        'planStore', 'atomicSchemaProbe', 'atomicDocumentWriter', 'documentWriter',
        'preferenceMemory', 'forbiddenPhraseValidator', 'memoryToolHandler',
        'planExecutor',
        // Wave 6b — image-generation pipeline (FLUX.2 + Recraft + Ideogram + AssetRouter).
        'imageHttpTransport', 'fluxClient', 'recraftClient', 'ideogramClient', 'assetRouter',
        // Wave 6c — copy-generation pipeline (Anthropic Messages API + cached brand block + batch queue).
        'brandBlockAssembler', 'copyCostMeter', 'copyGenerator', 'copyBatchQueue',
    ];

    private static function build(string $key)
    {
        return match ($key) {
            'hasher' => new Hasher(),
            'idGen' => new IDGenerator(),
            'catalog' => new WidgetCatalog(),
            'schemaValidator' => new SchemaValidator(self::get('catalog')),
            'dynamicTags' => new DynamicTagValidator(),
            'globals' => new GlobalRefPreferrer(),
            'cssBlocks' => new CustomCSSBlockManager(),
            'responsiveFiller' => new ResponsiveFiller(self::get('catalog')),
            'layoutMode' => new ContainerModeAdapter(),
            'locks' => new LockManager(),
            'opMode' => new OperatingMode(),
            'sessions' => new SessionTracker(),
            'rateLimiter' => new RateLimiter(),
            'urlValidator' => new URLValidator(),
            'policy' => new PolicyGuard(self::get('sessions')),
            'revisions' => new \Joist\Storage\RevisionStore(),
            'audit' => new AuditLogger(),
            'cssRegen' => new CSSRegenerator(),
            'cacheFlusher' => new CacheFlusher(),
            'hostDetector' => new HostDetector(),
            'webhookStore' => new WebhookStore(self::get('urlValidator')),
            'webhooks' => new WebhookEmitter(self::get('webhookStore'), self::get('urlValidator')),
            'patchEngine' => new PatchEngine(self::get('idGen'), self::get('cssBlocks')),
            'planStore' => new PlanStore(),
            // Wave 3 (2026-05-28): V3/V4 routing chokepoint.
            // VersionRouter::detect() is the source of truth; AtomicSchemaProbe
            // introspects the V4 atomic registry; AtomicDocumentWriter performs
            // V4 writes (refuses on known_broken; read-after-write on safe path).
            'atomicSchemaProbe' => new AtomicSchemaProbe(),
            'atomicDocumentWriter' => new AtomicDocumentWriter(self::get('hasher')),
            'documentWriter' => new DocumentWriter(
                self::get('hasher'),
                self::get('idGen'),
                self::get('catalog'),
                self::get('schemaValidator'),
                self::get('dynamicTags'),
                self::get('globals'),
                self::get('layoutMode'),
                self::get('locks'),
                self::get('opMode'),
                self::get('sessions'),
                self::get('policy'),
                self::get('revisions'),
                self::get('audit'),
                self::get('webhooks'),
                self::get('responsiveFiller'),
                self::get('atomicDocumentWriter'),
            ),
            'preferenceMemory' => new PreferenceMemory(),
            'forbiddenPhraseValidator' => new ForbiddenPhraseValidator(self::get('preferenceMemory')),
            'memoryToolHandler' => new MemoryToolHandler(self::get('preferenceMemory')),
            'planExecutor' => new PlanExecutor(
                self::get('planStore'),
                self::get('documentWriter'),
                self::get('patchEngine'),
                self::get('revisions'),
                self::get('hasher'),
                self::get('sessions'),
                self::get('webhooks'),
            ),
            // Wave 6b (2026-05-28): brand-faithful image generation pipeline.
            // HttpTransport is the single chokepoint that owns timeouts, the
            // Joist UA, and JSON strict-decode discipline; each provider client
            // takes it via constructor injection so we can swap a fake in tests.
            'imageHttpTransport' => new HttpTransport(),
            'fluxClient' => new FluxLoraClient(self::get('imageHttpTransport')),
            'recraftClient' => new RecraftClient(self::get('imageHttpTransport')),
            'ideogramClient' => new IdeogramClient(self::get('imageHttpTransport')),
            'assetRouter' => new AssetRouter(
                self::get('fluxClient'),
                self::get('recraftClient'),
                self::get('ideogramClient'),
            ),
            // Wave 6c (2026-05-28): copy-generation pipeline.
            // BrandBlockAssembler builds the layered cache prefix from
            // preference_memory + brand.json; CopyGenerator calls the
            // Anthropic Messages API with that prefix; CopyCostMeter gates
            // every call (constraint #9); BatchQueue amortises the 5-min
            // prompt-cache TTL across multiple per-site requests.
            'brandBlockAssembler' => new BrandBlockAssembler(self::get('preferenceMemory')),
            'copyCostMeter' => new CopyCostMeter(),
            'copyGenerator' => new CopyGenerator(
                self::get('brandBlockAssembler'),
                self::get('copyCostMeter'),
            ),
            'copyBatchQueue' => new BatchQueue(self::get('copyGenerator')),
            default => throw new \InvalidArgumentException("Unknown service: {$key}"),
        };
    }

    /** Reset (used in tests). */
    public static function reset(): void
    {
        self::$instances = [];
    }
}
