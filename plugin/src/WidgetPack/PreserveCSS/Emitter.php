<?php
declare(strict_types=1);

namespace Joist\WidgetPack\PreserveCSS;

/**
 * @purpose PRESERVE channel (productionized from /tmp/preserve-spike/joist-preserve-css.php,
 * 2026-06-14). Per-element source-CSS stamping: a node carries a `joist_preserve_css` JSON
 * payload = its full source-resolved box+paint CSS (position/grid/overflow/transform/box/paint
 * + @media) and this Emitter stamps it to `.elementor-element.elementor-element-<id>` through
 * Elementor's CORE Post_CSS channel at parse_css time — exactly as DisplaySwap/Extension.php
 * routes its per-breakpoint `display` block, and FlexWidthFiller routes its flex:/@media block.
 *
 * This is the load-bearing channel proven by the PRESERVE spike: the absolute/grid/overflow/
 * transform layout class the flex solver CANNOT express renders through core CSS, kses-untouched,
 * on the free atomic stack (226 `position:absolute` rules landed on the clerk hero; hRatio 1.000;
 * PRESERVE 72 vs FLOW 8 on a clean local 3.28.4 stack). Content widgets stay real + editable;
 * geometry is frozen in the preserveCSS string (the documented CONTENT-editable / LAYOUT-frozen
 * trade-off — a per-section ARM for the residual flow can't reach, NOT a wholesale replacement).
 *
 * Payload shape (JSON string stored as element setting `joist_preserve_css`):
 *   {
 *     "d": "<desktop-decl-block>",   // e.g. "position:absolute !important;top:40px;..."
 *     "x": "<inner-selector-rules>", // raw full rules, e.g. ".el-<id> .elementor-button{...}"
 *     "m": { "1024": "<decls>", "767": "<decls>" }  // per-breakpoint @media(max-width:Npx)
 *   }
 *
 * WHY a REGISTERED control (vs the spike's get_data RAW-read workaround):
 *   get_settings_for_display() SILENTLY DROPS any setting key with no REGISTERED control. The
 *   spike wrote the key straight to _elementor_data and had to read get_data('settings') raw to
 *   recover it. Registering a real (HIDDEN) `joist_preserve_css` control on every element makes
 *   the key a first-class setting that survives get_settings_for_display() AND SchemaValidator —
 *   so the RAW-read workaround is no longer needed. We still fall back to the raw reads for
 *   robustness (older data written before the control existed).
 *
 * REVERSIBLE / OPT-IN:
 *   - The control is HIDDEN + default '' (empty) — no editor UI, no effect on any element that
 *     doesn't carry a payload. Zero behavior change for existing pages.
 *   - A global kill-switch constant JOIST_PRESERVE_CSS_DISABLE (define true in wp-config) makes
 *     parseCss a no-op site-wide, so the channel can be turned off without a code change.
 *
 * Wired from WidgetPack\PackBootstrap::init(), the same place DisplaySwap is wired.
 */

use Elementor\Controls_Manager;

if (!defined('ABSPATH')) exit;

final class Emitter
{
    /** The per-element setting key carrying the preserve payload. */
    public const CONTROL = 'joist_preserve_css';

    /** Tracks element NAMES we've already registered the control on (once each). */
    private static array $registered = [];

    public static function init(): void
    {
        if (!class_exists('\Elementor\Plugin')) return;

        // Register the HIDDEN control on EVERY element (containers + widgets) the first time
        // each element type's controls stack finishes a section. `elementor/element/after_section_end`
        // fires generically from controls-stack.php for all element types; a per-name guard keeps
        // us to one registration per element so we don't add it 30 times.
        add_action('elementor/element/after_section_end', [self::class, 'registerControl'], 10, 3);

        // Emit the per-element preserve CSS via the standard parse_css filter — the SAME hook
        // DisplaySwap uses, so the rules land in the core Post_CSS file kses-untouched.
        add_action('elementor/element/parse_css', [self::class, 'parseCss'], 10, 2);
    }

    /**
     * Register a single HIDDEN `joist_preserve_css` control per element type. HIDDEN = no editor
     * UI but a real, schema-recognized setting key that get_settings_for_display() preserves.
     *
     * @param object $element   The element (widget/container) whose controls stack is open.
     * @param string $sectionId The section that just ended.
     * @param array  $args      Section args.
     */
    public static function registerControl($element, $sectionId, $args): void
    {
        if (!is_object($element) || !method_exists($element, 'add_control')) return;
        if (!method_exists($element, 'get_name')) return;

        $name = $element->get_name();
        if (isset(self::$registered[$name])) return;
        self::$registered[$name] = true;

        // Guard against double-registration within a single stack (Elementor throws/notices on
        // a duplicate control id). get_controls() is the authoritative check.
        if (method_exists($element, 'get_controls') && $element->get_controls(self::CONTROL) !== null) {
            return;
        }

        try {
            $element->add_control(self::CONTROL, [
                'label'       => __('Joist · Preserve CSS', 'joist'),
                'type'        => Controls_Manager::HIDDEN,
                'default'     => '',
                // Not surfaced to the AI authoring panel — this is a machine channel.
                'ai'          => ['active' => false],
                // No live-edit re-render in the editor; it's a frontend CSS channel.
                'render_type' => 'none',
            ]);
        } catch (\Throwable $e) {
            // Never let a control-registration edge case fatal the editor.
        }
    }

    /**
     * Stamp the element's preserve payload into the core Post_CSS stylesheet.
     *
     * @param object $post_css The Elementor Post CSS file being assembled.
     * @param object $element  The element whose settings carry the payload.
     */
    public static function parseCss($post_css, $element): void
    {
        // Reversible global kill-switch.
        if (defined('JOIST_PRESERVE_CSS_DISABLE') && JOIST_PRESERVE_CSS_DISABLE) return;

        if (!is_object($element) || !method_exists($element, 'get_id')) return;

        $raw = self::readPayload($element);
        if ($raw === '') return;

        $payload = json_decode($raw, true);
        if (!is_array($payload)) return;

        if (!is_object($post_css) || !method_exists($post_css, 'get_stylesheet')) return;
        $stylesheet = $post_css->get_stylesheet();
        if (!is_object($stylesheet) || !method_exists($stylesheet, 'add_raw_css')) return;

        $selector = '.elementor-element.elementor-element-' . $element->get_id();

        // Desktop / base declaration block.
        $desktop = isset($payload['d']) && is_string($payload['d']) ? trim($payload['d']) : '';
        if ($desktop !== '') {
            $stylesheet->add_raw_css($selector . '{' . $desktop . '}');
        }

        // Extra raw CSS — already a full rule (e.g. a descendant selector for inner button/heading
        // color). Emitted verbatim. Must be a SEPARATE add_raw_css (a nested selector inlined into
        // selector{...} corrupts the whole rule — spike bug #2).
        if (isset($payload['x']) && is_string($payload['x']) && trim($payload['x']) !== '') {
            $stylesheet->add_raw_css(trim($payload['x']));
        }

        // Per-breakpoint @media(max-width:Npx) blocks. Keyed by max-width px (desktop-first
        // cascade), emitted widest→narrowest so later (narrower) rules win — matches DisplaySwap.
        if (isset($payload['m']) && is_array($payload['m'])) {
            $widths = array_map('intval', array_keys($payload['m']));
            rsort($widths);
            foreach ($widths as $w) {
                $decls = $payload['m'][(string) $w] ?? ($payload['m'][$w] ?? '');
                if (!is_string($decls) || trim($decls) === '') continue;
                $stylesheet->add_raw_css('@media(max-width:' . $w . 'px){' . $selector . '{' . trim($decls) . '}}');
            }
        }
    }

    /**
     * Read the preserve payload. With the registered HIDDEN control,
     * get_settings_for_display() now KEEPS the key — that's the primary path. We still try the
     * raw reads (get_data('settings') / get_settings()) as a fallback for data written before the
     * control existed, or by external writers that bypass the control registry.
     */
    private static function readPayload($element): string
    {
        // Primary: registered-control path. Survives get_settings_for_display().
        if (method_exists($element, 'get_settings_for_display')) {
            $sd = $element->get_settings_for_display();
            if (is_array($sd) && isset($sd[self::CONTROL]) && is_string($sd[self::CONTROL]) && $sd[self::CONTROL] !== '') {
                return $sd[self::CONTROL];
            }
        }
        // Fallback: raw stored settings (legacy / external writes).
        if (method_exists($element, 'get_data')) {
            $data = $element->get_data('settings');
            if (is_array($data) && isset($data[self::CONTROL]) && is_string($data[self::CONTROL]) && $data[self::CONTROL] !== '') {
                return $data[self::CONTROL];
            }
        }
        if (method_exists($element, 'get_settings')) {
            $s = $element->get_settings(self::CONTROL);
            if (is_string($s) && $s !== '') return $s;
        }
        return '';
    }
}
