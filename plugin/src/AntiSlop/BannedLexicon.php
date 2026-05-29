<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

/**
 * @purpose Static catalogue of the four "banned lexicon" layers Joist screens
 *          AI-generated copy against. Sourced from the 2026 Ozigi banned-lexicon
 *          validator essay + memory/taste_anti_slop_rules.md + Joist's own
 *          brand voice rules (memory/brand_decisions.md).
 *
 * Four orthogonal layers, screened in order by CopyValidator:
 *   1. vocab            — single LLM-slop tokens (delve, tapestry, robust...)
 *   2. phrases          — multi-word slop phrases ("at its core"...)
 *   3. sentenceOpeners  — regexes for slop sentence-position structures
 *   4. structures       — regexes for slop-shaped formatting (em-dash overuse,
 *                         bold-colon prefixes, LinkedIn-isms, listicle lead-ins)
 *
 * Every entry carries {severity, category} so the validator can:
 *   - weight the score correctly (high=15, medium=8, low=3)
 *   - emit a useful replacement_suggestion when there's a clean alternative
 *
 * This file is the canonical source of truth — specs/ANTI_SLOP.md links here
 * rather than redefining the list, so the prompt-cached banned-lexicon system
 * block (consumed by W6c copy-gen) and the post-gen validator stay in sync.
 */
final class BannedLexicon
{
    public const SEVERITY_HIGH = 'high';
    public const SEVERITY_MEDIUM = 'medium';
    public const SEVERITY_LOW = 'low';

    public const SCORE_WEIGHT = [
        self::SEVERITY_HIGH => 15,
        self::SEVERITY_MEDIUM => 8,
        self::SEVERITY_LOW => 3,
    ];

    public const CATEGORY_VOCAB = 'vocab';
    public const CATEGORY_CORPORATE = 'corporate';
    public const CATEGORY_MYSTICAL = 'mystical';
    public const CATEGORY_STRUCTURE = 'structure';
    public const CATEGORY_OPENER = 'opener';
    public const CATEGORY_PHRASE = 'phrase';

    /**
     * Layer 1 — single-token slop. Whole-word case-insensitive match.
     *
     * @return list<array{token:string, severity:string, category:string, replacement:?string}>
     */
    public static function vocab(): array
    {
        return [
            // Classic LLM-slop verbs/nouns
            ['token' => 'delve',        'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_VOCAB,     'replacement' => 'examine'],
            ['token' => 'tapestry',     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'realm',        'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL,  'replacement' => 'area'],
            ['token' => 'landscape',    'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'market'],
            ['token' => 'myriad',       'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_VOCAB,     'replacement' => 'many'],
            ['token' => 'plethora',     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_VOCAB,     'replacement' => 'many'],
            ['token' => 'pivotal',      'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'key'],
            ['token' => 'paramount',    'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'most important'],
            ['token' => 'crucial',      'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'important'],
            ['token' => 'foster',       'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'grow'],
            ['token' => 'embark',       'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_VOCAB,     'replacement' => 'start'],
            ['token' => 'unleash',      'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'unlock',       'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'utilize',      'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_VOCAB,     'replacement' => 'use'],
            ['token' => 'leverage',     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => 'use'],

            // Corporate vocab Joist has banned in its own voice rules
            ['token' => 'synergy',      'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'revolutionize','severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'transform',    'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => 'change'],
            ['token' => 'empower',      'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'streamline',   'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => 'simplify'],
            ['token' => 'innovative',   'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => 'new'],
            ['token' => 'disruptive',   'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'game-changing','severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'cutting-edge', 'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => 'current'],
            ['token' => 'state-of-the-art', 'severity' => self::SEVERITY_HIGH, 'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'best-in-class','severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'seamless',     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'seamlessly',   'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'robust',       'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => 'reliable'],
            ['token' => 'holistic',     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'scalable',     'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'next-gen',     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['token' => 'mission-critical','severity' => self::SEVERITY_HIGH,'category' => self::CATEGORY_CORPORATE, 'replacement' => null],

            // Mystical / overwrought
            ['token' => 'magical',      'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'magic',        'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'journey',      'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'beacon',       'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'vibrant',      'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
            ['token' => 'bustling',     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => 'busy'],
            ['token' => 'meticulous',   'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_VOCAB,     'replacement' => 'careful'],
            ['token' => 'profound',     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => 'deep'],
            ['token' => 'resonate',     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_MYSTICAL,  'replacement' => null],
        ];
    }

    /**
     * Layer 2 — multi-word slop phrases. Case-insensitive substring match.
     *
     * @return list<array{phrase:string, severity:string, category:string, replacement:?string}>
     */
    public static function phrases(): array
    {
        return [
            ['phrase' => 'at its core',                       'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => "in today's fast-paced world",       'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'in the realm of',                   'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL, 'replacement' => null],
            ['phrase' => 'navigate the complexities',         'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'unlock the potential',              'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'unlock the power',                  'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'a testament to',                    'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'it goes without saying',            'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'the world of',                      'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'dive into',                         'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'delve into',                        'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'embark on a journey',               'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL, 'replacement' => null],
            ['phrase' => 'in conclusion',                     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_OPENER, 'replacement' => null],
            ['phrase' => 'in summary',                        'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_OPENER, 'replacement' => null],
            ['phrase' => "the future of",                     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'build the future of',               'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'scale without limits',              'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'all-in-one platform',               'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => 'ai-powered',                        'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_CORPORATE, 'replacement' => null],
            ['phrase' => "let's take a look",                 'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'when it comes to',                  'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => "let's explore",                     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'rich tapestry',                     'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_MYSTICAL, 'replacement' => null],
            ['phrase' => 'ever-evolving',                     'severity' => self::SEVERITY_MEDIUM, 'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'ever-changing',                     'severity' => self::SEVERITY_LOW,    'category' => self::CATEGORY_PHRASE, 'replacement' => null],
            ['phrase' => 'as we navigate',                    'severity' => self::SEVERITY_HIGH,   'category' => self::CATEGORY_PHRASE, 'replacement' => null],
        ];
    }

    /**
     * Layer 3 — sentence-position slop. Regex against sentence-leading text.
     * Patterns are PCRE bodies WITHOUT delimiters; CopyValidator wraps with /…/u.
     *
     * @return list<array{name:string, regex:string, severity:string, category:string, hint:string}>
     */
    public static function sentenceOpeners(): array
    {
        return [
            [
                'name' => 'its_not_x_its_y',
                'regex' => "^It's not (?:just |only |simply |merely )?[A-Za-z][\\w\\-' ]{0,40}\\. It's [A-Za-z][\\w\\-' ]{0,40}\\.",
                'severity' => self::SEVERITY_HIGH,
                'category' => self::CATEGORY_OPENER,
                'hint' => "Avoid the 'It's not X. It's Y.' contrastive pattern — it reads as AI-generated marketing.",
            ],
            [
                'name' => 'in_conclusion',
                'regex' => '^In conclusion[,\\.]',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_OPENER,
                'hint' => "Drop 'In conclusion' — let the closing sentence land on its own.",
            ],
            [
                'name' => 'in_summary',
                'regex' => '^In summary[,\\.]',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_OPENER,
                'hint' => "Drop 'In summary' — restate without the label.",
            ],
            [
                'name' => 'moreover',
                'regex' => '^Moreover[,\\.]',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_OPENER,
                'hint' => "'Moreover' is a slop tell. Use 'Also' or restructure.",
            ],
            [
                'name' => 'furthermore',
                'regex' => '^Furthermore[,\\.]',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_OPENER,
                'hint' => "'Furthermore' is a slop tell. Use 'Also' or restructure.",
            ],
            [
                'name' => 'indeed',
                'regex' => '^Indeed[,\\.]',
                'severity' => self::SEVERITY_LOW,
                'category' => self::CATEGORY_OPENER,
                'hint' => "Drop the leading 'Indeed,' — usually filler.",
            ],
            [
                'name' => 'in_essence',
                'regex' => '^In essence[,\\.]',
                'severity' => self::SEVERITY_HIGH,
                'category' => self::CATEGORY_OPENER,
                'hint' => "'In essence' is high-slop. Cut and rewrite the sentence directly.",
            ],
            [
                'name' => 'in_todays_fpw',
                'regex' => "^In today's (?:fast-paced|ever-changing|digital|modern) world",
                'severity' => self::SEVERITY_HIGH,
                'category' => self::CATEGORY_OPENER,
                'hint' => "'In today's fast-paced/ever-changing/digital world' is the canonical AI opener. Delete it.",
            ],
            [
                'name' => 'imagine_a_world',
                'regex' => '^Imagine a world (?:where|in which)',
                'severity' => self::SEVERITY_HIGH,
                'category' => self::CATEGORY_OPENER,
                'hint' => "'Imagine a world where…' opener is slop. Open with a concrete fact.",
            ],
        ];
    }

    /**
     * Layer 4 — slop-shaped structures. Regex against the whole text + special
     * compound checks (em-dash density, bullet-listicle lead-ins, etc.).
     *
     * @return list<array{name:string, regex:?string, severity:string, category:string, hint:string, kind:string}>
     */
    public static function structures(): array
    {
        return [
            [
                'name' => 'bold_colon_prefix',
                'regex' => '\\*\\*[A-Z][^*\\n]{1,60}:\\*\\*\\s',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => "Bold-label-colon prefix ('**Heading:**') is a Markdown-slop tell. Use a real heading or inline the content.",
                'kind' => 'regex',
            ],
            [
                'name' => 'linkedin_heres_the_thing',
                'regex' => "\\bHere's the thing:\\s",
                'severity' => self::SEVERITY_HIGH,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => "'Here's the thing:' is a LinkedIn-ism. Drop it.",
                'kind' => 'regex',
            ],
            [
                'name' => 'listicle_lead_in_reasons',
                'regex' => '\\bHere are \\d+ (?:reasons|ways|tips|things|steps)\\b',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => "Numbered-listicle lead-in ('Here are 5 reasons') is slop. Lead with the strongest reason instead.",
                'kind' => 'regex',
            ],
            [
                'name' => 'em_dash_overuse',
                'regex' => null,
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => 'More than 3 em-dashes per 200 characters — the model is over-using parenthetical dashes. Convert most to commas or full stops.',
                'kind' => 'em_dash_density',
            ],
            [
                'name' => 'rhetorical_question_chain',
                'regex' => '\\?[^?]{1,80}\\?[^?]{1,80}\\?',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => 'Three rhetorical questions in close succession — collapse to one or none.',
                'kind' => 'regex',
            ],
            [
                'name' => 'emoji_bullet_prefix',
                'regex' => '(?:^|\\n)[\\x{1F300}-\\x{1FAFF}\\x{2600}-\\x{27BF}]\\s',
                'severity' => self::SEVERITY_MEDIUM,
                'category' => self::CATEGORY_STRUCTURE,
                'hint' => 'Emoji-prefixed bullets are AI-marketing-slop. Use plain bullets.',
                'kind' => 'regex',
            ],
        ];
    }

    /**
     * Count of entries per layer — used by telemetry / introspection.
     *
     * @return array{vocab:int, phrases:int, sentenceOpeners:int, structures:int, total:int}
     */
    public static function counts(): array
    {
        $v = count(self::vocab());
        $p = count(self::phrases());
        $o = count(self::sentenceOpeners());
        $s = count(self::structures());
        return [
            'vocab' => $v,
            'phrases' => $p,
            'sentenceOpeners' => $o,
            'structures' => $s,
            'total' => $v + $p + $o + $s,
        ];
    }
}
