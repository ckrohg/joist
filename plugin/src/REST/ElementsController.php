<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/pages/{id}/elements/{element_id} — single-element read.
 * Writes are done via /pages/{id}/patch; this is a convenience reader.
 */
final class ElementsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/elements/(?P<eid>[a-z0-9]+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/elements/(?P<eid>[a-z0-9]+)/css', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'css'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            $eid = (string) $req->get_param('eid');
            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            $tree = $document->get_elements_data();
            $tree = is_array($tree) ? $tree : [];
            $found = $this->findSubtree($tree, $eid, []);
            if ($found === null) throw new WriteException('not_found.element', "Element {$eid} not found on page {$postId}.", 404);
            [$element, $path, $parentId] = $found;
            return $this->ok([
                'element' => $element,
                'parent_id' => $parentId,
                'path' => $path,
                'hash' => Container::get('hasher')->forElements([$element]),
            ]);
        });
    }

    public function css(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $eid = (string) $req->get_param('eid');
            // v0.5: return the selector; computed CSS extraction is v0.7.
            return $this->ok([
                'element_id' => $eid,
                'wrapper_selector' => ".elementor-element-{$eid}",
                'note' => 'Computed-CSS extraction is planned for v0.7.',
            ]);
        });
    }

    private function findSubtree(array $tree, string $targetId, array $path, ?string $parentId = null): ?array
    {
        foreach ($tree as $i => $el) {
            if (!is_array($el)) continue;
            $currentPath = array_merge($path, [$el['id'] ?? '']);
            if (($el['id'] ?? '') === $targetId) {
                return [$el, $currentPath, $parentId];
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $r = $this->findSubtree($el['elements'], $targetId, $currentPath, $el['id'] ?? null);
                if ($r !== null) return $r;
            }
        }
        return null;
    }
}
