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
            default => throw new \InvalidArgumentException("Unknown service: {$key}"),
        };
    }

    /** Reset (used in tests). */
    public static function reset(): void
    {
        self::$instances = [];
    }
}
