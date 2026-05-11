<?php
declare(strict_types=1);

namespace Joist\SEO;

final class SEOAdapterFactory
{
    public static function active(): SEOAdapterInterface
    {
        $candidates = [
            new YoastAdapter(),
            new RankMathAdapter(),
            new AIOSEOAdapter(),
        ];
        foreach ($candidates as $a) {
            if ($a->detect()) return $a;
        }
        return new NativeAdapter();
    }
}
