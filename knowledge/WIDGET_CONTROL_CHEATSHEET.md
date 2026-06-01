# Widget Control Cheat-Sheet (curated from the LIVE schema)

> Source of truth: `/joist/v1/widgets/{type}/schema` on the live site (Elementor 4.0.9 + JupiterX), 2026-05-31.
> The validator actually accepts 370–590 controls/widget (all of Elementor + JupiterX). Agents don't fail
> from too FEW allowed keys — they fail by GUESSING WRONG NAMES. Below are the correct, commonly-authored
> control names. Hover = `<name>_hover`; responsive = `<name>_tablet`/`_mobile`.

## ⚠️ Confirmed wrong-guess → correct name (these cost 9–10 retries/build)

| widget | WRONG (rejected) | CORRECT |
|---|---|---|
| heading, text-editor | `text_align` | `align` |
| button, heading, container | `padding` (bare) | `_padding` |
| button | `text_color` | `button_text_color` |
| divider | `divider_color`/`divider_weight` | `color` / `weight` |
| star-rating | `star_size`/`stars_color`/`star_style` | only `rating` reliably compiles |
| image | `border_radius` on the widget | set on the container, or skip |
| icon (standalone) | `icon`/`icon_color`/`icon_size` | all rejected — substitute styled text/eyebrow |

## Correct common controls per widget

**heading** (403 total): `title`, `link`, `size`, `header_size`, `align`, `typography_typography`, `typography_font_family`, `typography_font_size`, `typography_font_weight`, `typography_text_transform`, `typography_font_style`, `typography_text_decoration`, `typography_line_height`, `typography_letter_spacing`, `typography_word_spacing`, `text_shadow_text_shadow_type`, `text_shadow_text_shadow`, `title_color`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**text-editor** (419 total): `editor`, `align`, `typography_typography`, `typography_font_family`, `typography_font_size`, `typography_font_weight`, `typography_text_transform`, `typography_font_style`, `typography_text_decoration`, `typography_line_height`, `typography_letter_spacing`, `typography_word_spacing`, `text_shadow_text_shadow_type`, `text_shadow_text_shadow`, `text_color`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**button** (485 total): `text`, `link`, `size`, `selected_icon`, `align`, `typography_typography`, `typography_font_family`, `typography_font_size`, `typography_font_weight`, `typography_text_transform`, `typography_font_style`, `typography_text_decoration`, `typography_line_height`, `typography_letter_spacing`, `typography_word_spacing`, `text_shadow_text_shadow_type`, `text_shadow_text_shadow`, `button_text_color`, `background_background`, `background_gradient_notice`, `background_color`, `background_color_stop`, `background_color_b`, `background_color_b_stop`, `background_gradient_type`, `background_gradient_angle`, `background_gradient_position`, `background_position`, `background_xpos`, `background_ypos`, `background_attachment`, `background_attachment_alert`, `background_repeat`, `background_size`, `background_bg_width`, `background_video_link`, `background_video_start`, `background_video_end`, `background_play_once`, `background_privacy_mode`, `background_video_fallback`, `background_slideshow_gallery`, `background_slideshow_loop`, `background_slideshow_slide_duration`, `background_slideshow_slide_transition`, `background_slideshow_transition_duration`, `background_slideshow_background_size`, `background_slideshow_background_position`, `background_slideshow_lazyload`, `background_slideshow_ken_burns`, `background_slideshow_ken_burns_zoom_direction`, `hover_color`, `border_border`, `border_width`, `border_color`, `border_radius`, `text_padding`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**image** (589 total): `image`, `image_size`, `image_custom_dimension`, `caption_source`, `caption`, `link`, `align`, `width`, `height`, `text_color`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**icon** (551 total): `selected_icon`, `view`, `shape`, `link`, `align`, `primary_color`, `secondary_color`, `size`, `border_width`, `border_radius`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**divider** (575 total): `style`, `width`, `align`, `look`, `text`, `html_tag`, `icon`, `color`, `weight`, `gap`, `text_color`, `typography_typography`, `typography_font_family`, `typography_font_size`, `typography_font_weight`, `typography_text_transform`, `typography_font_style`, `typography_text_decoration`, `typography_line_height`, `typography_letter_spacing`, `typography_word_spacing`, `primary_color`, `secondary_color`, `border_radius`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**spacer** (374 total): `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**video** (434 total): `video_type`, `youtube_url`, `vimeo_url`, `autoplay`, `mute`, `loop`, `controls`, `color`, `poster`, `aspect_ratio`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**html** (374 total): `html`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**social-icons** (556 total): `social_icon_list`, `shape`, `columns`, `align`, `icon_color`, `icon_primary_color`, `icon_secondary_color`, `border_radius`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**icon-list** (576 total): `view`, `icon_list`, `space_between`, `divider_color`, `icon_color`, `text_shadow_text_shadow_type`, `text_shadow_text_shadow`, `text_color`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`

**star-rating** (560 total): `rating_scale`, `rating`, `star_style`, `unmarked_star_style`, `title`, `align`, `title_color`, `stars_color`, `_margin`, `_padding`, `_element_width`, `_element_custom_width`, `_flex_align_self`, `_flex_order`, `_flex_order_custom`, `_flex_size`, `_flex_grow`, `_flex_shrink`
